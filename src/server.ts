import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import type { Socket } from "node:net";
import { config } from "./config.js";
import { applyHostsBlock } from "./hosts.js";
import { readRecentLogs } from "./logger.js";
import { proxyConnectRequest, proxyHttpRequest } from "./proxy.js";
import { RequestRecorder } from "./recorder.js";
import { HttpError, RuleStore } from "./rules.js";
import { adminHtml } from "./ui.js";
import type { RuleInput } from "./types.js";

const store = new RuleStore(config.dataDir);
const recorder = new RequestRecorder(`${config.dataDir}/recordings`);

const server = http.createServer(async (req, res) => {
  try {
    if (isAdminRequest(req)) {
      await handleAdmin(req, res);
      return;
    }

    await proxyHttpRequest(store, req, res, "http", recorder);
  } catch (error) {
    sendJsonError(res, error);
  }
});

server.on("connect", (req, socket, head) => {
  const clientSocket = socket as Socket;
  proxyConnectRequest(store, req, clientSocket, head).catch(() => {
    socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
    socket.destroy();
  });
});

server.listen(config.proxyPort, config.bindHost, () => {
  console.log(`Proxy Recorder listening on http://${config.bindHost}:${config.proxyPort}`);
  console.log(`Admin UI: http://localhost:${config.proxyPort}/admin`);
  console.log(`Access log: ${config.logPath}`);
});

if (config.httpsProxyPort || config.tlsCertPath || config.tlsKeyPath) {
  if (!config.httpsProxyPort || !config.tlsCertPath || !config.tlsKeyPath) {
    throw new Error("HTTPS proxy requires HTTPS_PROXY_PORT, TLS_CERT_PATH, and TLS_KEY_PATH");
  }

  const httpsServer = https.createServer(
    {
      cert: fs.readFileSync(config.tlsCertPath),
      key: fs.readFileSync(config.tlsKeyPath)
    },
    async (req, res) => {
      try {
        await proxyHttpRequest(store, req, res, "https", recorder);
      } catch (error) {
        sendJsonError(res, error);
      }
    }
  );

  httpsServer.listen(config.httpsProxyPort, config.bindHost, () => {
    console.log(`HTTPS host proxy listening on https://${config.bindHost}:${config.httpsProxyPort}`);
  });
}

function isAdminRequest(req: http.IncomingMessage): boolean {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  return (
    path === "/admin" ||
    path === "/api/rules" ||
    path === "/api/logs" ||
    path === "/api/recording" ||
    path === "/api/recording/start" ||
    path === "/api/recording/stop" ||
    path === "/api/recording/export" ||
    path === "/api/hosts/apply" ||
    /^\/api\/rules\/[^/]+$/.test(path)
  );
}

async function handleAdmin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");

  if (url.pathname === "/admin" && req.method === "GET") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(adminHtml);
    return;
  }

  if (url.pathname === "/api/rules" && req.method === "GET") {
    sendJson(res, await store.list());
    return;
  }

  if (url.pathname === "/api/logs" && req.method === "GET") {
    const limit = Number.parseInt(url.searchParams.get("limit") ?? "200", 10);
    sendJson(res, await readRecentLogs(Number.isFinite(limit) ? limit : 200));
    return;
  }

  if (url.pathname === "/api/recording" && req.method === "GET") {
    sendJson(res, recorder.state());
    return;
  }

  if (url.pathname === "/api/recording/start" && req.method === "POST") {
    const input = await readOptionalJson<{ includeAjax?: boolean }>(req);
    recorder.start({ includeAjax: input.includeAjax === true });
    sendJson(res, recorder.state(), 201);
    return;
  }

  if (url.pathname === "/api/recording/stop" && req.method === "POST") {
    sendJson(res, await recorder.stop());
    return;
  }

  if (url.pathname === "/api/recording/export" && req.method === "GET") {
    const payload = await recorder.readLastExport();
    if (!payload) {
      throw new HttpError(404, "No recording export yet");
    }
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": "attachment; filename=\"proxy-recording.json\""
    });
    res.end(payload);
    return;
  }

  if (url.pathname === "/api/rules" && req.method === "POST") {
    const input = await readJson<RuleInput>(req);
    sendJson(res, await store.create(input), 201);
    return;
  }

  const ruleMatch = url.pathname.match(/^\/api\/rules\/([^/]+)$/);
  if (ruleMatch && req.method === "PUT") {
    const input = await readJson<RuleInput>(req);
    sendJson(res, await store.update(ruleMatch[1], input));
    return;
  }

  if (ruleMatch && req.method === "DELETE") {
    await store.delete(ruleMatch[1]);
    res.writeHead(204);
    res.end();
    return;
  }

  if (url.pathname === "/api/hosts/apply" && req.method === "POST") {
    await applyHostsBlock(config.hostsPath, config.hostsIp, await store.list());
    sendJson(res, { ok: true, hostsPath: config.hostsPath });
    return;
  }

  throw new HttpError(404, "Not found");
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    throw new HttpError(400, "Missing JSON body");
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

async function readOptionalJson<T>(req: http.IncomingMessage): Promise<Partial<T>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Partial<T>;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function sendJson(res: http.ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendJsonError(res: http.ServerResponse, error: unknown): void {
  const status = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "Internal server error";
  sendJson(res, { error: message }, status);
}
