import http from "node:http";
import http2 from "node:http2";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import type { Socket } from "node:net";
import { config } from "./config.js";
import { accessLog } from "./logger.js";
import type { RequestRecorder } from "./recorder.js";
import { normalizeHost, RuleStore } from "./rules.js";
import type { ProxyRule } from "./types.js";
import { lookupUpstream } from "./upstream-lookup.js";

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);
const externalProxyPrefix = "/__proxy_recorder_origin__/";
const http2ForbiddenHeaders = new Set([
  "connection",
  "host",
  "http2-settings",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "upgrade"
]);

interface RequestLogDiagnostics {
  ruleId?: string;
  routeMode?: string;
  mountPath?: string;
  upstreamHost?: string;
  referer?: string;
  responseContentType?: string;
  bodyRewritten?: boolean;
}

interface UpstreamResponse {
  statusCode?: number;
  headers: http.IncomingHttpHeaders;
  stream: NodeJS.ReadableStream;
}

type ProxyErrorHandler = (error: Error) => void;

export async function proxyHttpRequest(
  store: RuleStore,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  protocol: "http" | "https" = "http",
  recorder?: RequestRecorder
): Promise<void> {
  const started = Date.now();
  const host = extractRequestHost(req);
  if (!host) {
    logHttpRequest(started, protocol, req, "", 400, undefined, "Missing Host header");
    sendError(res, 400, "Missing Host header");
    return;
  }

  const requestPath = extractRequestPath(req);
  const rule = await store.findEnabledByRequest(host, requestPath);
  if (!rule) {
    logHttpRequest(started, protocol, req, host, 502, undefined, `No enabled proxy rule for ${host}`);
    sendError(res, 502, `No enabled proxy rule for ${host}`);
    return;
  }

  const requestReferer = Array.isArray(req.headers.referer)
    ? req.headers.referer.join(", ")
    : req.headers.referer;
  const match = createProxyMatch(rule, requestPath, requestReferer);
  let upstream: URL;
  try {
    upstream = buildUpstreamUrl(req, match);
  } catch (error) {
    logHttpRequest(started, protocol, req, host, 400, undefined, (error as Error).message);
    sendError(res, 400, (error as Error).message);
    return;
  }

  const publicOrigin = `${protocol}://${req.headers.host ?? host}`;
  const headers = rewriteHeaders(req.headers, upstream, match, publicOrigin);
  headers["x-forwarded-host"] = req.headers.host ?? host;
  headers["x-forwarded-proto"] = protocol;
  const diagnostics: RequestLogDiagnostics = {
    ruleId: rule.id,
    routeMode: match.mode,
    mountPath: match.mountPath,
    upstreamHost: upstream.host,
    referer: requestReferer
  };
  res.once("finish", () => {
    logHttpRequest(started, protocol, req, host, res.statusCode, upstream.toString(), undefined, diagnostics);
  });

  const handleProxyError: ProxyErrorHandler = (error) => {
    recorder?.record({
      url: upstream.toString(),
      method: req.method,
      status: 502,
      requestHeaders: req.headers
    });
    logHttpRequest(started, protocol, req, host, 502, upstream.toString(), error.message, diagnostics);
    if (!res.headersSent) {
      sendError(res, 502, `Proxy request failed: ${error.message}`);
    } else {
      res.destroy(error);
    }
  };

  try {
    await proxyUpstreamHttpRequest(
      req,
      res,
      upstream,
      headers,
      match,
      publicOrigin,
      diagnostics,
      handleProxyError,
      recorder
    );
  } catch (error) {
    handleProxyError(error as Error);
  }
}

async function proxyUpstreamHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstream: URL,
  headers: http.OutgoingHttpHeaders,
  match: ProxyMatch,
  publicOrigin: string,
  diagnostics: RequestLogDiagnostics,
  onError: ProxyErrorHandler,
  recorder?: RequestRecorder
): Promise<void> {
  if (upstream.protocol === "https:") {
    const upstreamSocket = await connectHttpsUpstream(upstream);
    if (upstreamSocket.alpnProtocol === "h2") {
      proxyHttp2UpstreamRequest(
        req,
        res,
        upstream,
        headers,
        match,
        publicOrigin,
        diagnostics,
        upstreamSocket,
        onError,
        recorder
      );
      return;
    }
    proxyHttp1UpstreamRequest(
      req,
      res,
      upstream,
      headers,
      match,
      publicOrigin,
      diagnostics,
      onError,
      recorder,
      upstreamSocket
    );
    return;
  }

  proxyHttp1UpstreamRequest(req, res, upstream, headers, match, publicOrigin, diagnostics, onError, recorder);
}

function proxyHttp1UpstreamRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstream: URL,
  headers: http.OutgoingHttpHeaders,
  match: ProxyMatch,
  publicOrigin: string,
  diagnostics: RequestLogDiagnostics,
  onError: ProxyErrorHandler,
  recorder?: RequestRecorder,
  connectedSocket?: tls.TLSSocket
): void {
  const client = upstream.protocol === "https:" ? https : http;
  const upstreamReq = client.request(
    upstream,
    {
      method: req.method,
      headers,
      lookup: lookupUpstream,
      servername: upstreamServername(upstream),
      createConnection: connectedSocket ? () => connectedSocket : undefined
    },
    (upstreamRes) => {
      recorder?.record({
        url: upstream.toString(),
        method: req.method,
        status: upstreamRes.statusCode,
        requestHeaders: req.headers,
        responseHeaders: upstreamRes.headers
      });
      handleUpstreamResponse(
        res,
        {
          statusCode: upstreamRes.statusCode,
          headers: upstreamRes.headers,
          stream: upstreamRes
        },
        match,
        publicOrigin,
        diagnostics
      );
    }
  );

  upstreamReq.on("error", (error) => {
    onError(error);
  });

  req.pipe(upstreamReq);
}

function connectHttpsUpstream(upstream: URL): Promise<tls.TLSSocket> {
  const port = upstream.port ? Number.parseInt(upstream.port, 10) : 443;
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: upstream.hostname,
      port,
      servername: upstreamServername(upstream),
      lookup: lookupUpstream,
      ALPNProtocols: ["h2", "http/1.1"]
    });
    socket.once("secureConnect", () => {
      socket.off("error", reject);
      resolve(socket);
    });
    socket.once("error", reject);
  });
}

function upstreamServername(upstream: URL): string | undefined {
  return net.isIP(upstream.hostname) ? undefined : upstream.hostname;
}

function proxyHttp2UpstreamRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  upstream: URL,
  headers: http.OutgoingHttpHeaders,
  match: ProxyMatch,
  publicOrigin: string,
  diagnostics: RequestLogDiagnostics,
  connectedSocket: tls.TLSSocket,
  onError: ProxyErrorHandler,
  recorder?: RequestRecorder
): void {
  const session = http2.connect(upstream.origin, {
    createConnection: () => connectedSocket
  });
  const closeSession = () => {
    if (!session.destroyed && !session.closed) {
      session.close();
    }
  };
  const fail = (error: Error) => {
    closeSession();
    onError(error);
  };

  session.once("error", fail);
  session.once("connect", () => {
    session.off("error", fail);
    session.on("error", (error) => {
      if (!res.headersSent) {
        sendError(res, 502, `Proxy request failed: ${error.message}`);
      } else {
        res.destroy(error);
      }
    });

    const h2Req = session.request(toHttp2RequestHeaders(req, upstream, headers));
    let gotResponse = false;
    h2Req.once("response", (h2Headers) => {
      gotResponse = true;
      const responseHeaders = fromHttp2ResponseHeaders(h2Headers);
      const statusCode = Number(h2Headers[http2.constants.HTTP2_HEADER_STATUS] ?? 502);
      recorder?.record({
        url: upstream.toString(),
        method: req.method,
        status: statusCode,
        requestHeaders: req.headers,
        responseHeaders
      });
      handleUpstreamResponse(
        res,
        {
          statusCode,
          headers: responseHeaders,
          stream: h2Req
        },
        match,
        publicOrigin,
        diagnostics
      );
    });
    h2Req.once("close", closeSession);
    h2Req.once("error", (error) => {
      closeSession();
      if (gotResponse) {
        return;
      }
      onError(error);
    });

    req.pipe(h2Req);
  });
}

export async function proxyConnectRequest(
  store: RuleStore,
  req: http.IncomingMessage,
  clientSocket: Socket,
  head: Buffer
): Promise<void> {
  const started = Date.now();
  const [host, requestedPort] = (req.url ?? "").split(":");
  const normalizedHost = normalizeHost(host ?? "");
  const rule = await store.findEnabledByHost(normalizedHost);
  if (!rule) {
    accessLog({
      protocol: "connect",
      method: "CONNECT",
      host: normalizedHost,
      path: req.url ?? "",
      status: 403,
      durationMs: Date.now() - started,
      error: `No enabled proxy rule for ${normalizedHost}`
    });
    clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const target = new URL(rule.target);
  const port = target.port
    ? Number.parseInt(target.port, 10)
    : target.protocol === "https:"
      ? Number.parseInt(requestedPort ?? "443", 10)
      : 80;

  const upstreamSocket = net.connect({
    host: target.hostname,
    port,
    lookup: lookupUpstream
  });

  upstreamSocket.once("connect", () => {
    accessLog({
      protocol: "connect",
      method: "CONNECT",
      host: normalizedHost,
      path: req.url ?? "",
      target: `${target.hostname}:${port}`,
      status: 200,
      durationMs: Date.now() - started
    });
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(clientSocket);
    clientSocket.pipe(upstreamSocket);
  });

  upstreamSocket.once("error", () => {
    accessLog({
      protocol: "connect",
      method: "CONNECT",
      host: normalizedHost,
      path: req.url ?? "",
      target: `${target.hostname}:${port}`,
      status: 502,
      durationMs: Date.now() - started,
      error: "Upstream socket failed"
    });
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.destroy();
  });
}

export async function proxyUpgradeRequest(
  store: RuleStore,
  req: http.IncomingMessage,
  clientSocket: Socket,
  head: Buffer,
  protocol: "http" | "https" = "http",
  recorder?: RequestRecorder
): Promise<void> {
  const started = Date.now();
  const host = extractRequestHost(req);
  if (!host) {
    logUpgradeRequest(started, protocol, req, "", 400, undefined, "Missing Host header");
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const requestPath = extractRequestPath(req);
  const rule = await store.findEnabledByRequest(host, requestPath);
  if (!rule) {
    logUpgradeRequest(started, protocol, req, host, 502, undefined, `No enabled proxy rule for ${host}`);
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const requestReferer = Array.isArray(req.headers.referer)
    ? req.headers.referer.join(", ")
    : req.headers.referer;
  const match = createProxyMatch(rule, requestPath, requestReferer);
  let upstream: URL;
  try {
    upstream = buildUpstreamUrl(req, match);
  } catch (error) {
    logUpgradeRequest(started, protocol, req, host, 400, undefined, (error as Error).message);
    clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    clientSocket.destroy();
    return;
  }

  const port = upstream.port
    ? Number.parseInt(upstream.port, 10)
    : upstream.protocol === "https:"
      ? 443
      : 80;
  const connectOptions = {
    host: upstream.hostname,
    port,
    lookup: lookupUpstream
  };
  const upstreamSocket =
    upstream.protocol === "https:"
      ? tls.connect({ ...connectOptions, servername: upstreamServername(upstream) })
      : net.connect(connectOptions);

  const handlePreconnectError = (error: Error) => {
    recorder?.record({
      url: upstream.toString(),
      method: req.method,
      status: 502,
      requestHeaders: req.headers
    });
    logUpgradeRequest(started, protocol, req, host, 502, upstream.toString(), error.message, {
      ruleId: rule.id,
      routeMode: match.mode,
      mountPath: match.mountPath,
      upstreamHost: upstream.host,
      referer: requestReferer
    });
    clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    clientSocket.destroy();
  };
  upstreamSocket.once("error", handlePreconnectError);
  upstreamSocket.once(upstream.protocol === "https:" ? "secureConnect" : "connect", () => {
    upstreamSocket.off("error", handlePreconnectError);
    let handshakeComplete = false;
    upstreamSocket.on("error", (error) => {
      if (!handshakeComplete) {
        logUpgradeRequest(started, protocol, req, host, 502, upstream.toString(), error.message, {
          ruleId: rule.id,
          routeMode: match.mode,
          mountPath: match.mountPath,
          upstreamHost: upstream.host,
          referer: requestReferer
        });
      }
      clientSocket.destroy();
    });
    clientSocket.on("error", () => upstreamSocket.destroy());
    const publicOrigin = `${protocol}://${req.headers.host ?? host}`;
    const headers = rewriteUpgradeHeaders(req.headers, upstream, match, publicOrigin);
    headers["x-forwarded-host"] = req.headers.host ?? host;
    headers["x-forwarded-proto"] = protocol;
    upstreamSocket.write(serializeUpgradeRequest(req, upstream, headers));
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    clientSocket.pipe(upstreamSocket);

    let responseBuffer = Buffer.alloc(0);
    const onUpgradeResponse = (chunk: Buffer) => {
      responseBuffer = Buffer.concat([responseBuffer, chunk]);
      const headerEnd = responseBuffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) {
        if (responseBuffer.length > 64 * 1024) {
          upstreamSocket.off("data", onUpgradeResponse);
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.destroy();
          upstreamSocket.destroy();
          logUpgradeRequest(
            started,
            protocol,
            req,
            host,
            502,
            upstream.toString(),
            "Upstream upgrade response header exceeded 64 KiB",
            {
              ruleId: rule.id,
              routeMode: match.mode,
              mountPath: match.mountPath,
              upstreamHost: upstream.host,
              referer: requestReferer
            }
          );
        }
        return;
      }

      handshakeComplete = true;
      upstreamSocket.off("data", onUpgradeResponse);
      const responseHead = responseBuffer.subarray(0, headerEnd + 4);
      const tunneledBytes = responseBuffer.subarray(headerEnd + 4);
      const status = parseUpgradeStatus(responseHead.toString("latin1")) ?? 502;
      recorder?.record({
        url: upstream.toString(),
        method: req.method,
        status,
        requestHeaders: req.headers
      });
      logUpgradeRequest(started, protocol, req, host, status, upstream.toString(), undefined, {
        ruleId: rule.id,
        routeMode: match.mode,
        mountPath: match.mountPath,
        upstreamHost: upstream.host,
        referer: requestReferer
      });
      clientSocket.write(responseHead);
      if (tunneledBytes.length > 0) {
        clientSocket.write(tunneledBytes);
      }
      upstreamSocket.pipe(clientSocket);
    };
    upstreamSocket.on("data", onUpgradeResponse);
  });
}

function extractRequestHost(req: http.IncomingMessage): string | undefined {
  if (req.url?.startsWith("http://") || req.url?.startsWith("https://")) {
    return normalizeHost(new URL(req.url).host);
  }
  return normalizeHost(req.headers.host ?? "");
}

function extractRequestPath(req: http.IncomingMessage): string {
  if (req.url?.startsWith("http://") || req.url?.startsWith("https://")) {
    return new URL(req.url).pathname;
  }

  return new URL(req.url ?? "/", "http://proxy-recorder.local").pathname;
}

interface ProxyMatch {
  rule: ProxyRule;
  mode: "host" | "mount" | "origin" | "external";
  mountPath?: string;
  externalTarget?: string;
  externalFromReferer?: boolean;
}

function createProxyMatch(rule: ProxyRule, requestPath: string, referer?: string): ProxyMatch {
  const externalTarget = decodeExternalProxyUrl(requestPath);
  if (externalTarget) {
    return { rule, mode: "external", externalTarget };
  }
  const referrerExternalTarget = decodeReferrerExternalProxyUrl(requestPath, referer);
  if (referrerExternalTarget) {
    return { rule, mode: "external", externalTarget: referrerExternalTarget, externalFromReferer: true };
  }
  if (!rule.mountPath) {
    return { rule, mode: "host" };
  }
  if (pathStartsWithMount(requestPath, rule.mountPath)) {
    return { rule, mode: "mount", mountPath: rule.mountPath };
  }
  return { rule, mode: "origin", mountPath: rule.mountPath };
}

export function buildUpstreamUrl(req: http.IncomingMessage, match: ProxyMatch): URL {
  if (match.mode === "external" && match.externalTarget) {
    const source = new URL(req.url ?? "/", "http://proxy-recorder.local");
    const target = new URL(match.externalTarget);
    if (match.externalFromReferer) {
      if (source.pathname.startsWith(externalProxyPrefix) && !decodeExternalProxyUrl(source.pathname)) {
        target.pathname = malformedExternalProxyPathname(source.pathname);
      } else {
        target.pathname = source.pathname;
      }
    }
    target.search = source.search;
    target.hash = "";
    return target;
  }

  const target = new URL(match.rule.target);
  const source = req.url?.startsWith("http://") || req.url?.startsWith("https://")
    ? new URL(req.url)
    : new URL(req.url ?? "/", "http://proxy-recorder.local");

  if (match.mode === "origin") {
    target.pathname = source.pathname;
  } else if (match.mode === "mount" && match.mountPath) {
    target.pathname = joinPaths(
      new URL(match.rule.target).pathname,
      stripMountPath(source.pathname, match.mountPath)
    );
  } else {
    target.pathname = joinPaths(target.pathname, source.pathname);
  }
  target.search = source.search;
  target.hash = "";
  return target;
}

function joinPaths(basePath: string, requestPath: string): string {
  const base = basePath.replace(/\/+$/, "");
  const next = requestPath.startsWith("/") ? requestPath : `/${requestPath}`;
  return `${base}${next}`;
}

function rewriteHeaders(
  headers: http.IncomingHttpHeaders,
  upstream: URL,
  match: ProxyMatch,
  publicOrigin: string
): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      next[key] = value;
    }
  }
  next.host = upstream.host;
  next["accept-encoding"] = "identity";
  const origin = rewriteRequestOrigin(headers.origin, upstream);
  if (origin) {
    next.origin = origin;
  } else {
    delete next.origin;
  }
  const referer = rewriteRequestReferer(headers.referer, match, publicOrigin);
  if (referer) {
    next.referer = referer;
  } else {
    delete next.referer;
  }
  return next;
}

function rewriteUpgradeHeaders(
  headers: http.IncomingHttpHeaders,
  upstream: URL,
  match: ProxyMatch,
  publicOrigin: string
): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower !== "connection" && lower !== "upgrade" && !hopByHopHeaders.has(lower)) {
      next[key] = value;
    }
  }
  next.host = upstream.host;
  next.connection = "Upgrade";
  next.upgrade = headers.upgrade ?? "websocket";
  const origin = rewriteRequestOrigin(headers.origin, upstream);
  if (origin) {
    next.origin = origin;
  } else {
    delete next.origin;
  }
  const referer = rewriteRequestReferer(headers.referer, match, publicOrigin);
  if (referer) {
    next.referer = referer;
  } else {
    delete next.referer;
  }
  return next;
}

function toHttp2RequestHeaders(
  req: http.IncomingMessage,
  upstream: URL,
  headers: http.OutgoingHttpHeaders
): http2.OutgoingHttpHeaders {
  const next: http2.OutgoingHttpHeaders = {
    [http2.constants.HTTP2_HEADER_METHOD]: req.method ?? "GET",
    [http2.constants.HTTP2_HEADER_SCHEME]: upstream.protocol.slice(0, -1),
    [http2.constants.HTTP2_HEADER_AUTHORITY]: upstream.host,
    [http2.constants.HTTP2_HEADER_PATH]: `${upstream.pathname || "/"}${upstream.search}`
  };
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (lower.startsWith(":") || http2ForbiddenHeaders.has(lower)) {
      continue;
    }
    if (lower === "te" && String(value).toLowerCase() !== "trailers") {
      continue;
    }
    if (value !== undefined) {
      next[lower] = value;
    }
  }
  return next;
}

function fromHttp2ResponseHeaders(headers: http2.IncomingHttpHeaders): http.IncomingHttpHeaders {
  const next: http.IncomingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    if (key.startsWith(":") || value === undefined) {
      continue;
    }
    next[key] = typeof value === "number" ? String(value) : value;
  }
  return next;
}

function serializeUpgradeRequest(
  req: http.IncomingMessage,
  upstream: URL,
  headers: http.OutgoingHttpHeaders
): string {
  const requestTarget = `${upstream.pathname || "/"}${upstream.search}`;
  const lines = [`${req.method ?? "GET"} ${requestTarget} HTTP/${req.httpVersion}`];
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        lines.push(`${key}: ${item}`);
      }
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("", "");
  return lines.join("\r\n");
}

function parseUpgradeStatus(responseHead: string): number | undefined {
  const status = responseHead.match(/^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s|$)/i)?.[1];
  return status ? Number.parseInt(status, 10) : undefined;
}

function filterResponseHeaders(
  headers: http.IncomingHttpHeaders,
  match: ProxyMatch,
  publicOrigin: string,
  rewriteBody: boolean
): http.OutgoingHttpHeaders {
  const next: http.OutgoingHttpHeaders = {};
  for (const [key, value] of Object.entries(headers)) {
    const lower = key.toLowerCase();
    if (hopByHopHeaders.has(lower)) {
      continue;
    }
    if (rewriteBody && (lower === "content-length" || lower === "content-encoding")) {
      continue;
    }
    if (lower === "content-security-policy" || lower === "content-security-policy-report-only") {
      continue;
    }
    if (lower === "location") {
      next[key] = rewriteHeaderUrl(value, match, publicOrigin);
      continue;
    }
    if (lower === "set-cookie") {
      next[key] = rewriteSetCookie(value, publicOrigin);
      continue;
    }
    next[key] = value;
  }
  return next;
}

function handleUpstreamResponse(
  res: http.ServerResponse,
  upstreamRes: UpstreamResponse,
  match: ProxyMatch,
  publicOrigin: string,
  diagnostics?: RequestLogDiagnostics
): void {
  const maxRewriteBytes = config.maxRewriteBytes;
  const shouldRewriteBody = shouldRewriteTextResponse(upstreamRes.headers, maxRewriteBytes);
  if (diagnostics) {
    diagnostics.responseContentType = Array.isArray(upstreamRes.headers["content-type"])
      ? upstreamRes.headers["content-type"].join(", ")
      : upstreamRes.headers["content-type"];
    diagnostics.bodyRewritten = shouldRewriteBody;
  }
  if (!shouldRewriteBody) {
    res.writeHead(
      upstreamRes.statusCode ?? 502,
      filterResponseHeaders(upstreamRes.headers, match, publicOrigin, false)
    );
    upstreamRes.stream.pipe(res);
    return;
  }

  const chunks: Buffer[] = [];
  let bufferedBytes = 0;
  let streamedOriginalBody = false;

  const onData = (chunk: Buffer | string) => {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bufferedBytes += buffer.length;
    if (bufferedBytes > maxRewriteBytes) {
      streamedOriginalBody = true;
      if (diagnostics) {
        diagnostics.bodyRewritten = false;
      }
      upstreamRes.stream.off("data", onData);
      res.writeHead(
        upstreamRes.statusCode ?? 502,
        filterResponseHeaders(upstreamRes.headers, match, publicOrigin, false)
      );
      for (const buffered of chunks) {
        res.write(buffered);
      }
      res.write(buffer);
      upstreamRes.stream.pipe(res);
      return;
    }
    chunks.push(buffer);
  };

  upstreamRes.stream.on("data", onData);
  upstreamRes.stream.on("end", () => {
    if (streamedOriginalBody) {
      return;
    }
    const body = Buffer.concat(chunks).toString("utf8");
    const rewritten = rewriteTextBody(body, upstreamRes.headers, match, publicOrigin);
    const headers = filterResponseHeaders(upstreamRes.headers, match, publicOrigin, true);
    headers["content-length"] = Buffer.byteLength(rewritten);
    res.writeHead(upstreamRes.statusCode ?? 502, headers);
    res.end(rewritten);
  });
  upstreamRes.stream.on("error", (error) => {
    if (!res.headersSent) {
      sendError(res, 502, `Proxy response failed: ${error.message}`);
    } else {
      res.destroy(error);
    }
  });
}

export function shouldRewriteTextResponse(
  headers: http.IncomingHttpHeaders,
  maxRewriteBytes = config.maxRewriteBytes
): boolean {
  if (!isTextResponse(headers)) {
    return false;
  }

  const contentLength = parseContentLength(headers["content-length"]);
  if (contentLength === undefined) {
    return true;
  }

  return contentLength <= maxRewriteBytes;
}

function parseContentLength(value: string | string[] | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    if (value.length !== 1) {
      return Number.POSITIVE_INFINITY;
    }
    return parseContentLength(value[0]);
  }
  if (!/^\d+$/.test(value)) {
    return Number.POSITIVE_INFINITY;
  }
  return Number.parseInt(value, 10);
}

function isTextResponse(headers: http.IncomingHttpHeaders): boolean {
  if (headers["content-encoding"] && headers["content-encoding"] !== "identity") {
    return false;
  }

  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  return (
    contentType.includes("text/") ||
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    contentType.includes("xml") ||
    contentType.includes("svg")
  );
}

export function rewriteTextBody(
  body: string,
  headers: http.IncomingHttpHeaders,
  match: ProxyMatch,
  publicOrigin: string
): string {
  let next = body;
  const target = new URL(match.rule.target);
  const virtualHost = match.rule.virtualHost ?? target.hostname;
  const virtualOrigin = `${target.protocol}//${virtualHost}${target.port ? `:${target.port}` : ""}`;
  next = rewriteAbsoluteUrls(next, match, publicOrigin);
  next = rewriteExternalRootRelativeUrls(next, match, publicOrigin);

  if (isHtml(headers)) {
    next = injectProxyHtmlShim(next, match, publicOrigin, virtualOrigin);
  }

  if (isJavaScript(headers)) {
    next = injectProxyRuntimeShim(next, match, publicOrigin, virtualOrigin);
  }

  return next;
}

function isJavaScript(headers: http.IncomingHttpHeaders): boolean {
  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  return contentType.includes("javascript") || contentType.includes("ecmascript");
}

function isHtml(headers: http.IncomingHttpHeaders): boolean {
  const contentType = String(headers["content-type"] ?? "").toLowerCase();
  return contentType.includes("text/html");
}

function injectProxyHtmlShim(
  body: string,
  match: ProxyMatch,
  publicOrigin: string,
  virtualOrigin: string
): string {
  const authShim = `;(()=>{try{const p=new URL(location.href).searchParams,t=p.get("token")||localStorage.getItem("pinefield.sso.passport")||localStorage.getItem("passport");if(t){localStorage.setItem("passport",t);localStorage.setItem("pinefield.sso.passport",t)}}catch{}})();`;
  const shim = `<script>${createProxyRuntimeShim(match, publicOrigin, virtualOrigin)}${authShim}</script>`;
  if (/<head[^>]*>/i.test(body)) {
    return body.replace(/<head([^>]*)>/i, `<head$1>${shim}`);
  }
  return `${shim}${body}`;
}

function injectProxyRuntimeShim(
  body: string,
  match: ProxyMatch,
  publicOrigin: string,
  virtualOrigin: string
): string {
  return `${createProxyRuntimeShim(match, publicOrigin, virtualOrigin)}${body}`;
}

function createProxyRuntimeShim(
  match: ProxyMatch,
  publicOrigin: string,
  virtualOrigin: string
): string {
  const target = new URL(effectiveTarget(match));
  const remoteOrigins = [...new Set([target.origin, virtualOrigin])];
  const externalRootOrigin = match.mode === "external" ? target.origin : "";
  return `;(()=>{const r=${JSON.stringify(remoteOrigins)},l=${JSON.stringify(publicOrigin)},p=${JSON.stringify(externalProxyPrefix)},b=${JSON.stringify(externalRootOrigin)};if(globalThis.__proxyRecorderMapUrl)return;const a=u=>{if(typeof u!=="string")return u;if(b&&u.startsWith("/")&&!u.startsWith("//"))return l+p+encodeURIComponent(b)+u;const s=r.reduce((v,o)=>v.startsWith(o)?l+v.slice(o.length):v,u);if(!/^https?:\\/\\//i.test(s))return s;try{const x=new URL(s);return x.origin===l?s:l+p+encodeURIComponent(x.origin)+x.pathname+x.search+x.hash}catch{return s}};const m=u=>typeof u==="string"?a(u):u;const q=v=>String(v).split(",").map(e=>{const n=e.trimStart(),i=n.search(/\\s/);return i<0?a(n):a(n.slice(0,i))+n.slice(i)}).join(", ");globalThis.__proxyRecorderMapUrl=m;if(globalThis.fetch){const f=globalThis.fetch.bind(globalThis);globalThis.fetch=(i,n)=>{if(typeof i==="string")return f(m(i),n);if(i instanceof Request){const u=m(i.url);return f(u===i.url?i:new Request(u,i),n)}return f(i,n)}}if(globalThis.XMLHttpRequest){const o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(a,u,...x){return o.call(this,a,m(u),...x)}}if(globalThis.EventSource){const E=globalThis.EventSource;globalThis.EventSource=function(u,c){return new E(m(u),c)};globalThis.EventSource.prototype=E.prototype}if(globalThis.WebSocket){const W=globalThis.WebSocket;globalThis.WebSocket=function(u,p){const n=m(String(u)).replace(/^http:/,"ws:").replace(/^https:/,"wss:");return p===undefined?new W(n):new W(n,p)};globalThis.WebSocket.prototype=W.prototype}if(globalThis.Element){const s=Element.prototype.setAttribute;Element.prototype.setAttribute=function(n,v){const k=String(n).toLowerCase();return s.call(this,n,k==="srcset"?q(v):["src","href","action","poster"].includes(k)?m(v):v)}}const d=(P,n,f=m)=>{const e=Object.getOwnPropertyDescriptor(P,n);if(e&&e.set)Object.defineProperty(P,n,{...e,set(v){e.set.call(this,f(v))}})};const C=globalThis;[[C.HTMLImageElement,"src"],[C.HTMLScriptElement,"src"],[C.HTMLIFrameElement,"src"],[C.HTMLLinkElement,"href"],[C.HTMLSourceElement,"src"],[C.HTMLSourceElement,"srcset",q],[C.HTMLVideoElement,"src"],[C.HTMLVideoElement,"poster"],[C.HTMLAudioElement,"src"],[C.HTMLFormElement,"action"]].forEach(([P,n,f])=>P&&d(P.prototype,n,f))})();\n`;
}

function rewriteRequestOrigin(
  value: string | undefined,
  upstream: URL
): string | undefined {
  if (!value) {
    return value;
  }
  return upstream.origin;
}

function rewriteRequestReferer(
  value: string | undefined,
  match: ProxyMatch,
  publicOrigin: string
): string | undefined {
  if (!value) {
    return value;
  }
  const target = new URL(effectiveTarget(match));
  return String(value).replace(publicOrigin, target.origin);
}

function rewriteHeaderUrl(
  value: string | string[] | undefined,
  match: ProxyMatch,
  publicOrigin: string
): string | string[] | undefined {
  if (!value) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => rewriteSingleHeaderUrl(item, match, publicOrigin));
  }
  return rewriteSingleHeaderUrl(value, match, publicOrigin);
}

function rewriteSingleHeaderUrl(value: string, match: ProxyMatch, publicOrigin: string): string {
  return rewriteAbsoluteUrls(value, match, publicOrigin);
}

function rewriteSetCookie(
  value: string | string[] | undefined,
  publicOrigin: string
): string | string[] | undefined {
  if (!value) {
    return value;
  }
  const secureLocal = publicOrigin.startsWith("https://");
  const rewrite = (cookie: string) =>
    cookie
      .split(";")
      .map((part) => part.trim())
      .filter((part) => !/^domain=/i.test(part))
      .filter((part) => secureLocal || !/^secure$/i.test(part))
      .map((part) => (/^path=/i.test(part) ? "Path=/" : part))
      .join("; ");

  return Array.isArray(value) ? value.map(rewrite) : rewrite(value);
}

function stripMountPath(requestPath: string, mountPath: string): string {
  const mount = mountPath.endsWith("/") ? mountPath : `${mountPath}/`;
  if (requestPath === mount.slice(0, -1)) {
    return "/";
  }
  return requestPath.slice(mount.length - 1) || "/";
}

function pathStartsWithMount(requestPath: string, mountPath: string): boolean {
  const mount = mountPath.endsWith("/") ? mountPath : `${mountPath}/`;
  return requestPath === mount.slice(0, -1) || requestPath.startsWith(mount);
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function replaceAll(value: string, search: string, replacement: string): string {
  return search ? value.split(search).join(replacement) : value;
}

function escapeForJsString(value: string): string {
  return value.replace(/\//g, "\\/");
}

function rewriteAbsoluteUrls(value: string, match: ProxyMatch, publicOrigin: string): string {
  const target = new URL(effectiveTarget(match));
  const publicHost = new URL(publicOrigin).host;
  let next = value;

  if (match.mountPath) {
    const localMount = new URL(match.mountPath, ensureTrailingSlash(publicOrigin))
      .toString()
      .replace(/\/$/, "");
    const targetBasePath = target.pathname.replace(/\/+$/, "");
    if (targetBasePath) {
      next = replaceAll(next, `${target.origin}${targetBasePath}/`, `${localMount}/`);
      next = replaceAll(
        next,
        `${target.origin}${targetBasePath}\\/`,
        `${escapeForJsString(localMount)}\\/`
      );
    }
  }

  next = replaceAll(next, `${target.origin}/`, `${publicOrigin}/`);
  next = replaceAll(next, `${target.origin}\\/`, `${escapeForJsString(publicOrigin)}\\/`);
  next = replaceAll(next, `//${target.host}/`, `//${publicHost}/`);
  return rewriteExternalAbsoluteUrls(next, publicOrigin);
}

function rewriteExternalRootRelativeUrls(
  value: string,
  match: ProxyMatch,
  publicOrigin: string
): string {
  if (match.mode !== "external") {
    return value;
  }

  const targetOrigin = new URL(effectiveTarget(match)).origin;
  const localPrefix = `${publicOrigin}${externalProxyPrefix}${encodeURIComponent(targetOrigin)}`;
  return value
    .replace(
      /\b(src|href|action|poster)\s*=\s*(["'])\/(?!\/)([^"'<>\s]*)\2/gi,
      (_raw, attr: string, quote: string, path: string) =>
        `${attr}=${quote}${localPrefix}/${path}${quote}`
    )
    .replace(
      /url\(\s*(["']?)\/(?!\/)([^"')\s]+)\1\s*\)/gi,
      (_raw, quote: string, path: string) => `url(${quote}${localPrefix}/${path}${quote})`
    );
}

function effectiveTarget(match: ProxyMatch): string {
  return match.externalTarget ?? match.rule.target;
}

export function decodeExternalProxyUrl(requestPath: string): string | undefined {
  if (!requestPath.startsWith(externalProxyPrefix)) {
    return undefined;
  }
  const remainder = requestPath.slice(externalProxyPrefix.length);
  const slashIndex = remainder.indexOf("/");
  const encodedOrigin = slashIndex === -1 ? remainder : remainder.slice(0, slashIndex);
  const rawPathname = slashIndex === -1 ? "/" : remainder.slice(slashIndex);
  const pathname = rawPathname.replace(/^\/+/, "/");
  const nestedTarget = decodeExternalProxyUrl(pathname);
  if (nestedTarget) {
    return nestedTarget;
  }
  try {
    const origin = decodeURIComponent(encodedOrigin);
    const target = new URL(pathname || "/", origin);
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      return undefined;
    }
    return target.toString();
  } catch {
    return undefined;
  }
}

export function decodeReferrerExternalProxyUrl(
  requestPath: string,
  referer: string | undefined
): string | undefined {
  if (!shouldUseExternalReferrerFallback(requestPath)) {
    return undefined;
  }
  if (!referer) {
    return undefined;
  }
  try {
    const refererPath = new URL(referer).pathname;
    const refererTarget = decodeExternalProxyUrl(refererPath);
    if (!refererTarget) {
      return undefined;
    }
    const refererUrl = new URL(refererTarget);
    return refererUrl.origin;
  } catch {
    return undefined;
  }
}

function shouldUseExternalReferrerFallback(requestPath: string): boolean {
  return (
    requestPath.startsWith("/files/") ||
    requestPath.startsWith("/pfile/") ||
    requestPath.startsWith("/file/") ||
    (requestPath.startsWith(externalProxyPrefix) && !decodeExternalProxyUrl(requestPath))
  );
}

function malformedExternalProxyPathname(requestPath: string): string {
  return requestPath.slice(externalProxyPrefix.length - 1) || "/";
}

function rewriteExternalAbsoluteUrls(value: string, publicOrigin: string): string {
  const localOrigin = new URL(publicOrigin).origin;
  return value.replace(/\bhttps?:\/\/[^\s"'`<>)\\]+/g, (raw) => {
    try {
      const url = new URL(raw);
      if (url.origin === localOrigin || isStandardNamespaceUrl(url)) {
        return raw;
      }
      return `${publicOrigin}${externalProxyPrefix}${encodeURIComponent(url.origin)}${url.pathname}${url.search}${url.hash}`;
    } catch {
      return raw;
    }
  });
}

function isStandardNamespaceUrl(url: URL): boolean {
  return url.hostname === "www.w3.org";
}

function sendError(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(`${message}\n`);
}

function logHttpRequest(
  started: number,
  protocol: "http" | "https",
  req: http.IncomingMessage,
  host: string,
  status: number,
  target?: string,
  error?: string,
  diagnostics: RequestLogDiagnostics = {}
): void {
  accessLog({
    protocol,
    method: req.method ?? "GET",
    host,
    path: req.url ?? "/",
    target,
    ...diagnostics,
    status,
    durationMs: Date.now() - started,
    error
  });
}

function logUpgradeRequest(
  started: number,
  protocol: "http" | "https",
  req: http.IncomingMessage,
  host: string,
  status: number,
  target?: string,
  error?: string,
  diagnostics: RequestLogDiagnostics = {}
): void {
  accessLog({
    protocol,
    method: req.method ?? "GET",
    host,
    path: req.url ?? "/",
    target,
    ...diagnostics,
    status,
    durationMs: Date.now() - started,
    error
  });
}
