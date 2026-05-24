import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { AddressInfo, Socket } from "node:net";
import {
  buildUpstreamUrl,
  decodeExternalProxyUrl,
  decodeReferrerExternalProxyUrl,
  proxyHttpRequest,
  proxyUpgradeRequest,
  shouldRewriteTextResponse,
  rewriteTextBody
} from "./proxy.js";
import { RequestRecorder } from "./recorder.js";
import { RuleStore } from "./rules.js";

test("rewriteTextBody maps upstream origin URLs to the local proxy", () => {
  const body = [
    '<script src="https://app.example.com/pinefield.jing-lao-yuan/assets/app.js"></script>',
    'fetch("https://app.example.com/query")',
    "const host = location.hostname;",
    "const windowHost = window.location.hostname;",
    "const globalHost = globalThis.location.hostname;",
    "const origin = location.origin;",
    "const windowOrigin = window.location.origin;",
    "const href = window.location.href;",
    'const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);'
  ].join("\n");

  const rewritten = rewriteTextBody(
    body,
    { "content-type": "application/javascript; charset=utf-8" },
    {
      mode: "mount",
      mountPath: "/pinefield.jing-lao-yuan/",
      rule: {
        id: "1",
        host: "localhost",
        target: "https://app.example.com/pinefield.jing-lao-yuan",
        mountPath: "/pinefield.jing-lao-yuan/",
        virtualHost: "app.example.com",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    "http://localhost:3333"
  );

  assert.match(rewritten, /http:\/\/localhost:3333\/pinefield\.jing-lao-yuan\/assets\/app\.js/);
  assert.match(rewritten, /fetch\("http:\/\/localhost:3333\/query"\)/);
  assert.match(rewritten, /const host = location\.hostname;/);
  assert.match(rewritten, /const windowHost = window\.location\.hostname;/);
  assert.match(rewritten, /const globalHost = globalThis\.location\.hostname;/);
  assert.match(rewritten, /const origin = location\.origin;/);
  assert.match(rewritten, /const windowOrigin = window\.location\.origin;/);
  assert.match(rewritten, /const href = window\.location\.href;/);
  assert.match(
    rewritten,
    /const isLocal = \["localhost", "127\.0\.0\.1"\]\.includes\(location\.hostname\);/
  );
  assert.match(rewritten, /__proxyRecorderMapUrl/);
  assert.match(rewritten, /globalThis\.fetch=/);
  assert.match(rewritten, /globalThis\.XMLHttpRequest/);
  assert.match(rewritten, /Element\.prototype\.setAttribute/);
});

test("rewriteTextBody emits syntactically valid JavaScript after shim injection", () => {
  const rewritten = rewriteTextBody(
    "console.log('loaded');",
    { "content-type": "application/javascript; charset=utf-8" },
    {
      mode: "mount",
      mountPath: "/pinefield.jing-lao-yuan/",
      rule: {
        id: "1",
        host: "localhost",
        target: "https://app.example.com/pinefield.jing-lao-yuan",
        mountPath: "/pinefield.jing-lao-yuan/",
        virtualHost: "app.example.com",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    "http://localhost:3333"
  );

  assert.doesNotThrow(() => new Function(rewritten));
});

test("rewriteTextBody maps a different upstream base path to the local mount path first", () => {
  const rewritten = rewriteTextBody(
    'import("https://app.example.com/remote-base/assets/app.js")',
    { "content-type": "application/javascript" },
    {
      mode: "mount",
      mountPath: "/local-app/",
      rule: {
        id: "1",
        host: "localhost",
        target: "https://app.example.com/remote-base",
        mountPath: "/local-app/",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    "http://localhost:3333"
  );

  assert.match(rewritten, /import\("http:\/\/localhost:3333\/local-app\/assets\/app\.js"\)/);
  assert.match(rewritten, /__proxyRecorderMapUrl/);
});

test("rewriteTextBody maps third-party absolute URLs through the local origin proxy", () => {
  const rewritten = rewriteTextBody(
    [
      'const icon = "https://test.sheepwall.com/files/web/static/Rectangle_blue.png";',
      '<img src="https://test.sheepwall.com/file/spatial-resource/abc/qhly.png">'
    ].join("\n"),
    { "content-type": "application/javascript" },
    {
      mode: "mount",
      mountPath: "/pinefield.jing-lao-yuan/",
      rule: {
        id: "1",
        host: "localhost",
        target: "https://app.example.com/pinefield.jing-lao-yuan",
        mountPath: "/pinefield.jing-lao-yuan/",
        virtualHost: "app.example.com",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    "http://localhost:3333"
  );

  assert.match(
    rewritten,
    /http:\/\/localhost:3333\/__proxy_recorder_origin__\/https%3A%2F%2Ftest\.sheepwall\.com\/files\/web\/static\/Rectangle_blue\.png/
  );
  assert.match(
    rewritten,
    /http:\/\/localhost:3333\/__proxy_recorder_origin__\/https%3A%2F%2Ftest\.sheepwall\.com\/file\/spatial-resource\/abc\/qhly\.png/
  );
});

test("rewriteTextBody injects runtime and auth shims before inline HTML scripts", () => {
  const rewritten = rewriteTextBody(
    [
      "<html><head>",
      "<script>",
      'const url = "https://test.sheepwall.com/faas/external/eventtrack-sls-sink/track/events";',
      'fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem("pinefield.sso.passport")}` } });',
      "</script>",
      "</head></html>"
    ].join(""),
    { "content-type": "text/html; charset=utf-8" },
    {
      mode: "external",
      externalTarget: "https://test.sheepwall.com/pinefield.3top/?token=abc",
      rule: {
        id: "1",
        host: "localhost",
        target: "https://app.example.com/pinefield.jing-lao-yuan",
        mountPath: "/pinefield.jing-lao-yuan/",
        virtualHost: "app.example.com",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    "http://localhost:3333"
  );

  const firstInjectedShim = rewritten.indexOf("__proxyRecorderMapUrl");
  const inlineScript = rewritten.indexOf("eventtrack-sls-sink");
  assert.ok(firstInjectedShim > 0);
  assert.ok(firstInjectedShim < inlineScript);
  assert.match(rewritten, /localStorage\.getItem\("pinefield\.sso\.passport"\)/);
  assert.match(rewritten, /localStorage\.getItem\("passport"\)/);
  assert.match(rewritten, /localStorage\.setItem\("passport",t\)/);
  assert.match(rewritten, /localStorage\.setItem\("pinefield\.sso\.passport",t\)/);
});

test("rewriteTextBody maps external root-relative assets through the origin proxy", () => {
  const rewritten = rewriteTextBody(
    [
      '<link rel="manifest" href="/manifest.json">',
      '<img src="/files/web/static/Rectangle_red.png">',
      '<style>.pin{background:url(/files/web/static/studio-point.svg)}</style>'
    ].join(""),
    { "content-type": "text/html; charset=utf-8" },
    {
      mode: "external",
      externalTarget: "https://test.sheepwall.com/pinefield.3top/?token=abc",
      rule: {
        id: "1",
        host: "localhost",
        target: "https://app.example.com/pinefield.jing-lao-yuan",
        mountPath: "/pinefield.jing-lao-yuan/",
        virtualHost: "app.example.com",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    "http://localhost:3333"
  );

  assert.match(
    rewritten,
    /href="http:\/\/localhost:3333\/__proxy_recorder_origin__\/https%3A%2F%2Ftest\.sheepwall\.com\/manifest\.json"/
  );
  assert.match(
    rewritten,
    /src="http:\/\/localhost:3333\/__proxy_recorder_origin__\/https%3A%2F%2Ftest\.sheepwall\.com\/files\/web\/static\/Rectangle_red\.png"/
  );
  assert.match(
    rewritten,
    /url\(http:\/\/localhost:3333\/__proxy_recorder_origin__\/https%3A%2F%2Ftest\.sheepwall\.com\/files\/web\/static\/studio-point\.svg\)/
  );
});

test("rewriteTextBody leaves standard XML and SVG namespace URLs unchanged", () => {
  const rewritten = rewriteTextBody(
    [
      'const svg = "http://www.w3.org/2000/svg";',
      'const xlink = "http://www.w3.org/1999/xlink";',
      'const math = "http://www.w3.org/1998/Math/MathML";',
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    ].join("\n"),
    { "content-type": "application/javascript" },
    {
      mode: "mount",
      mountPath: "/pinefield.jing-lao-yuan/",
      rule: {
        id: "1",
        host: "localhost",
        target: "https://app.example.com/pinefield.jing-lao-yuan",
        mountPath: "/pinefield.jing-lao-yuan/",
        virtualHost: "app.example.com",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    "http://localhost:3333"
  );

  assert.match(rewritten, /"http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(rewritten, /"http:\/\/www\.w3\.org\/1999\/xlink"/);
  assert.match(rewritten, /"http:\/\/www\.w3\.org\/1998\/Math\/MathML"/);
  assert.doesNotMatch(rewritten, /__proxy_recorder_origin__\/http%3A%2F%2Fwww\.w3\.org/);
});

test("decodeExternalProxyUrl treats repeated leading path slashes as a path, not a host", () => {
  assert.equal(
    decodeExternalProxyUrl(
      "/__proxy_recorder_origin__/https%3A%2F%2Ftest.sheepwall.com//tokenless/appstore/extend/init"
    ),
    "https://test.sheepwall.com/tokenless/appstore/extend/init"
  );
});

test("decodeReferrerExternalProxyUrl routes root-relative assets back to the external origin", () => {
  assert.equal(
    decodeReferrerExternalProxyUrl(
      "/files/web/static/Rectangle_red.png",
      "http://localhost:3333/__proxy_recorder_origin__/https%3A%2F%2Ftest.sheepwall.com/pinefield.3top/0.6.191/"
    ),
    "https://test.sheepwall.com"
  );
});

test("buildUpstreamUrl preserves decoded external proxy paths", () => {
  const upstream = buildUpstreamUrl(
    {
      url: "/__proxy_recorder_origin__/https%3A%2F%2Fassets.pinefield.cn/shared/images/moment-4.png"
    } as never,
    {
      mode: "external",
      externalTarget: "https://assets.pinefield.cn/shared/images/moment-4.png",
      rule: {
        id: "1",
        host: "localhost",
        target: "https://app.example.com/pinefield.jing-lao-yuan",
        mountPath: "/pinefield.jing-lao-yuan/",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    }
  );

  assert.equal(upstream.toString(), "https://assets.pinefield.cn/shared/images/moment-4.png");
});

test("buildUpstreamUrl supports an HTTPS local request to an HTTP upstream target", () => {
  const upstream = buildUpstreamUrl(
    {
      url: "/app/assets/main.js?version=1"
    } as never,
    {
      mode: "mount",
      mountPath: "/app/",
      rule: {
        id: "1",
        host: "localhost",
        target: "http://origin.example.com/remote-app",
        mountPath: "/app/",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    }
  );

  assert.equal(upstream.toString(), "http://origin.example.com/remote-app/assets/main.js?version=1");
});

test("rewriteTextBody maps HTTP upstream URLs back to the HTTPS local origin", () => {
  const rewritten = rewriteTextBody(
    [
      '<script src="http://origin.example.com/remote-app/assets/main.js"></script>',
      'fetch("http://origin.example.com/api/users")'
    ].join("\n"),
    { "content-type": "text/html; charset=utf-8" },
    {
      mode: "mount",
      mountPath: "/app/",
      rule: {
        id: "1",
        host: "localhost",
        target: "http://origin.example.com/remote-app",
        mountPath: "/app/",
        enabled: true,
        hostsEnabled: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      }
    },
    "https://localhost:3443"
  );

  assert.match(rewritten, /https:\/\/localhost:3443\/app\/assets\/main\.js/);
  assert.match(rewritten, /fetch\("https:\/\/localhost:3443\/api\/users"\)/);
  assert.match(rewritten, /__proxyRecorderMapUrl/);
});

test("shouldRewriteTextResponse skips text responses above the configured byte limit", () => {
  assert.equal(
    shouldRewriteTextResponse(
      { "content-type": "application/javascript", "content-length": "1024" },
      1024
    ),
    true
  );
  assert.equal(
    shouldRewriteTextResponse(
      { "content-type": "application/javascript", "content-length": "1025" },
      1024
    ),
    false
  );
  assert.equal(shouldRewriteTextResponse({ "content-type": "image/png" }, 1024), false);
  assert.equal(
    shouldRewriteTextResponse(
      { "content-type": "text/html", "content-length": ["512", "512"] } as unknown as http.IncomingHttpHeaders,
      1024
    ),
    false
  );
  assert.equal(
    shouldRewriteTextResponse({ "content-type": "text/html", "content-length": "bad" }, 1024),
    false
  );
});

test("proxyHttpRequest streams unknown-length text responses after the rewrite limit", async () => {
  const largeBody = "a".repeat(10 * 1024 * 1024 + 1);
  const upstreamServer = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(largeBody);
  });
  await listen(upstreamServer);

  const upstreamPort = portOf(upstreamServer);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-large-text-"));
  const store = new RuleStore(dir);
  await store.create({
    host: "localhost",
    target: `http://127.0.0.1:${upstreamPort}/remote`,
    mountPath: "/app/",
    hostsEnabled: false
  });

  const proxyServer = http.createServer((req, res) => {
    proxyHttpRequest(store, req, res, "http").catch((error) => {
      res.destroy(error);
    });
  });
  await listen(proxyServer);

  try {
    const response = await httpGet(`http://localhost:${portOf(proxyServer)}/app/index.html`);

    assert.equal(response.statusCode, 200);
    assert.equal(response.body.length, largeBody.length);
    assert.equal(response.body, largeBody);
    assert.doesNotMatch(response.body, /__proxyRecorderMapUrl/);
  } finally {
    await closeServer(proxyServer);
    await closeServer(upstreamServer);
  }
});

test("proxyUpgradeRequest forwards WebSocket upgrade handshakes and tunneled bytes", async () => {
  const upstreamServer = http.createServer();
  const upstreamSockets = new Set<Socket>();
  let upstreamRequestPath = "";
  let upstreamOrigin = "";
  upstreamServer.on("upgrade", (req, socket) => {
    const upstreamSocket = socket as Socket;
    upstreamSockets.add(upstreamSocket);
    upstreamSocket.once("close", () => upstreamSockets.delete(upstreamSocket));
    upstreamRequestPath = req.url ?? "";
    upstreamOrigin = String(req.headers.origin ?? "");
    upstreamSocket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Connection: Upgrade",
        "Upgrade: websocket",
        "",
        ""
      ].join("\r\n")
    );
    upstreamSocket.on("data", (chunk) => {
      upstreamSocket.write(chunk);
    });
  });
  await listen(upstreamServer);

  const upstreamPort = portOf(upstreamServer);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-upgrade-"));
  const store = new RuleStore(dir);
  await store.create({
    host: "localhost",
    target: `http://127.0.0.1:${upstreamPort}/remote`,
    mountPath: "/app/",
    hostsEnabled: false
  });

  const proxyServer = http.createServer();
  proxyServer.on("upgrade", (req, socket, head) => {
    proxyUpgradeRequest(store, req, socket as Socket, head, "http").catch((error) => {
      socket.destroy(error);
    });
  });
  await listen(proxyServer);

  const proxyPort = portOf(proxyServer);
  const client = net.connect(proxyPort, "127.0.0.1");
  await onceConnect(client);
  client.write(
    [
      "GET /app/socket?room=1 HTTP/1.1",
      `Host: localhost:${proxyPort}`,
      "Connection: Upgrade",
      "Upgrade: websocket",
      "Sec-WebSocket-Version: 13",
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
      `Origin: http://localhost:${proxyPort}`,
      "",
      ""
    ].join("\r\n")
  );

  const handshake = await readUntil(client, "\r\n\r\n");
  assert.match(handshake, /101 Switching Protocols/);
  client.write("ping");
  assert.equal(await readUntil(client, "ping"), "ping");
  assert.equal(upstreamRequestPath, "/remote/socket?room=1");
  assert.equal(upstreamOrigin, `http://127.0.0.1:${upstreamPort}`);

  client.destroy();
  await onceClose(client);
  for (const socket of upstreamSockets) {
    socket.destroy();
  }
  await closeServer(proxyServer);
  await closeServer(upstreamServer);
});

test("proxyUpgradeRequest records the upstream upgrade status instead of assuming success", async () => {
  const upstreamServer = http.createServer();
  upstreamServer.on("upgrade", (_req, socket) => {
    socket.write(
      [
        "HTTP/1.1 403 Forbidden",
        "Connection: close",
        "Content-Length: 0",
        "",
        ""
      ].join("\r\n")
    );
    socket.destroy();
  });
  await listen(upstreamServer);

  const upstreamPort = portOf(upstreamServer);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-upgrade-status-"));
  const store = new RuleStore(dir);
  await store.create({
    host: "localhost",
    target: `http://127.0.0.1:${upstreamPort}/remote`,
    mountPath: "/app/",
    hostsEnabled: false
  });
  const recorder = new RequestRecorder(path.join(dir, "recordings"));
  recorder.start();

  const proxyServer = http.createServer();
  proxyServer.on("upgrade", (req, socket, head) => {
    proxyUpgradeRequest(store, req, socket as Socket, head, "http", recorder).catch((error) => {
      socket.destroy(error);
    });
  });
  await listen(proxyServer);

  try {
    const proxyPort = portOf(proxyServer);
    const client = net.connect(proxyPort, "127.0.0.1");
    await onceConnect(client);
    client.write(
      [
        "GET /app/socket HTTP/1.1",
        `Host: localhost:${proxyPort}`,
        "Connection: Upgrade",
        "Upgrade: websocket",
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        "",
        ""
      ].join("\r\n")
    );

    const handshake = await readUntil(client, "\r\n\r\n");
    assert.match(handshake, /403 Forbidden/);
    client.destroy();
    await onceClose(client);

    const stopped = await recorder.stop();
    assert.equal(stopped.export?.requests[0]?.status, 403);
  } finally {
    await closeServer(proxyServer);
    await closeServer(upstreamServer);
  }
});

test("proxyHttpRequest forwards HTTPS upstream requests over HTTP/2 when ALPN selects h2", async () => {
  const previousTlsRejectUnauthorized = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  const upstreamServer = http2.createSecureServer({
    key: testTlsKey,
    cert: testTlsCert,
    allowHTTP1: false
  });
  let upstreamPath = "";
  let upstreamMethod = "";
  let upstreamForwardedHost = "";
  let upstreamPort = 0;
  let proxyServer: http.Server | undefined;
  upstreamServer.on("stream", (stream, headers) => {
    upstreamPath = String(headers[http2.constants.HTTP2_HEADER_PATH] ?? "");
    upstreamMethod = String(headers[http2.constants.HTTP2_HEADER_METHOD] ?? "");
    upstreamForwardedHost = String(headers["x-forwarded-host"] ?? "");
    stream.respond({
      [http2.constants.HTTP2_HEADER_STATUS]: 200,
      "content-type": "text/html; charset=utf-8"
    });
    stream.end(`<script src="https://127.0.0.1:${upstreamPort}/remote/assets/main.js"></script>`);
  });
  await listen(upstreamServer);

  upstreamPort = portOf(upstreamServer);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-h2-"));
  const store = new RuleStore(dir);
  await store.create({
    host: "localhost",
    target: `https://127.0.0.1:${upstreamPort}/remote`,
    mountPath: "/app/",
    hostsEnabled: false
  });

  try {
    proxyServer = http.createServer((req, res) => {
      proxyHttpRequest(store, req, res, "http").catch((error) => {
        res.destroy(error);
      });
    });
    await listen(proxyServer);

    const proxyPort = portOf(proxyServer);
    const response = await httpGet(`http://localhost:${proxyPort}/app/index.html`);

    assert.equal(response.statusCode, 200);
    assert.equal(upstreamMethod, "GET");
    assert.equal(upstreamPath, "/remote/index.html");
    assert.equal(upstreamForwardedHost, `localhost:${proxyPort}`);
    assert.match(response.body, new RegExp(`http://localhost:${proxyPort}/app/assets/main\\.js`));
  } finally {
    if (proxyServer?.listening) {
      await closeServer(proxyServer);
    }
    await closeServer(upstreamServer);
    if (previousTlsRejectUnauthorized === undefined) {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    } else {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = previousTlsRejectUnauthorized;
    }
  }
});

function listen(server: http.Server | http2.Http2SecureServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function closeServer(server: http.Server | http2.Http2SecureServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function portOf(server: http.Server | http2.Http2SecureServer): number {
  return (server.address() as AddressInfo).port;
}

function httpGet(url: string): Promise<{ statusCode?: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    }).once("error", reject);
  });
}

function onceConnect(socket: net.Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
}

function onceClose(socket: net.Socket): Promise<void> {
  return new Promise((resolve) => {
    if (socket.destroyed) {
      resolve();
      return;
    }
    socket.once("close", resolve);
  });
}

function readUntil(socket: net.Socket, marker: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      if (buffer.includes(marker)) {
        cleanup();
        resolve(marker === buffer ? buffer : buffer.slice(0, buffer.indexOf(marker) + marker.length));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      socket.off("data", onData);
      socket.off("error", onError);
    };
    socket.on("data", onData);
    socket.once("error", onError);
  });
}

const testTlsKey = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQDQRT7n9AQuolwK
5/4goX+XiywbVYqqdaYYIl6FacnbUfE8/dlDA4rb6zDMtuIX796YD+/UFHCMXEFV
fAo8n8yD3mV040XBfHhmzc/VKEF6PMgPey43M8AXVwgbbM37bIHQKDeFdw5F8pQI
DyMC8/EvzS+AjcAyTVCxahzFioBaVsnz013m9RGvn5EffWBgu2y13JGJPhaBk9Go
28aLPNZsw9eBp++EjJ+iNQBnnqy8X7gaJsy3Z94Z64KTSwMaK1HxDWNDdkxfDFQZ
Ppn9NsDly8EHSwtYHRQSqDaGeiS/cV4SbypDf0s8QmYE5JmLw1oixpcPjYFInJLe
XNVf8NEdAgMBAAECggEAAf8DpESwdhsHd5xcBGEdNsBamES9fLJcPQr6fK0g5CgK
5quvHhDpKLvG39OwXsw6sLzRCE3epcAlrX4SMOnCYHLITNKibGNj0V3CjnRSle+b
u81zo4uKf6Y8bcoP+ot1sXSmjj7rm7N8KqpGNV1v2WqjgLb9OYa7YLoRXmTtTkWr
lLmzpHNIdfZI/rRaWRYiG774ERV42umZCdkx64EN0dkIC7Xz7cHLswWxt7r5QhJH
lqJtZPFRml21ifR5i09+hxThMHBXJe2BSEG/santaq3Xfd4NRJx/QbfPEHKeRW3z
xg85T4riW21TlyRE82yffQ8G9OlTN0U/LYAAJZFLQQKBgQDvxcA7eXsQSyH82ROb
+R6MUe8fzOTDOa3RDIInxFlF82Wt/2S2OmhZC+JRbgtWIwnbm9yh6aKnMVgd3Y3y
V6lw7tNw1g4wrUEJMmhb3INOXKKw1OVXPDJQX2C/e6Zn1CWpAdqa80a9jau6KhH1
GfnJhsm76JwN5CljUqxIfyQWyQKBgQDeXbKxSEGbz55WTbBcn+5j1fwVf2dC7jbh
svgsNor+F7JFWt2y6gQqGvHRcbaVQ0jnXoxXupGxvRyWrWs2/p6w9DsIOWBzkCmf
0y4T31/djrvSo3MLHDrqrwqAcoe/gg4VWiG488MOEkUgK70/qITw0FNAd/WVRpdb
a6Mp0+CNtQKBgAeR0ajPBACWrqMB42mYKsu5RnhVip9TMdaYs3835q2bqokct/w8
ydCN3H4/oCH/By+kswl1i8oFd8exl+qfs9y53XkBeP82aQg2TC8iPg76Q7SbdAYW
A2ygJjjFWZKLkwjL4y/jIEeZsmM1Ms3vHQCsva+t/0c8/cWB9ahwQx5pAoGAFiVg
yZU3q4vm6hN8sAzhkiHapE12/Ex7PMk1PDoGZ732bD/bepkh5wud780ScRUtapWZ
Bpe3MOtzsHH/DpAXP+pjArOsLnY6HwfKPAJwKsGvZRAQQhgCqiLaueYuLN2IB4pd
d20XjQw2xDh29aMT8mPdFrubws0v/9PdgSnv4E0CgYEAx767MffsuIUunC/dICWc
zcLMe5B33s7pgfAPYXnvlZ4LWTt84v6MLrcYdrsL/meLYIQd2xGWQvyc+Zlptn4q
sKgTxTqVdtNTbpF6lxw8cCW2jOXkcPm6LjRmNWXcpVUuH2nyCl1M0mhFevUniBUD
nFis0AfZTliNLKXyCXvnuyQ=
-----END PRIVATE KEY-----`;

const testTlsCert = `-----BEGIN CERTIFICATE-----
MIIDJTCCAg2gAwIBAgIUNRE9QK0fDHN80nRCzHKrnGDze/gwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MB4XDTI2MDUyNDA1NTkzMFoXDTM2MDUy
MTA1NTkzMFowFDESMBAGA1UEAwwJbG9jYWxob3N0MIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA0EU+5/QELqJcCuf+IKF/l4ssG1WKqnWmGCJehWnJ21Hx
PP3ZQwOK2+swzLbiF+/emA/v1BRwjFxBVXwKPJ/Mg95ldONFwXx4Zs3P1ShBejzI
D3suNzPAF1cIG2zN+2yB0Cg3hXcORfKUCA8jAvPxL80vgI3AMk1QsWocxYqAWlbJ
89Nd5vURr5+RH31gYLtstdyRiT4WgZPRqNvGizzWbMPXgafvhIyfojUAZ56svF+4
GibMt2feGeuCk0sDGitR8Q1jQ3ZMXwxUGT6Z/TbA5cvBB0sLWB0UEqg2hnokv3Fe
Em8qQ39LPEJmBOSZi8NaIsaXD42BSJyS3lzVX/DRHQIDAQABo28wbTAdBgNVHQ4E
FgQUN6dylJJ1eS5l/gsteLHwBv+QNDIwHwYDVR0jBBgwFoAUN6dylJJ1eS5l/gst
eLHwBv+QNDIwDwYDVR0TAQH/BAUwAwEB/zAaBgNVHREEEzARgglsb2NhbGhvc3SH
BH8AAAEwDQYJKoZIhvcNAQELBQADggEBAFDfPnFBgAgrqHorf9vCBkNmwu4BaVgO
NDxqlWIZHqEiwVj5u6t6ItuieUa0FBXlyiyUM+RcvXMdtdTDR613xOShgv5um6W5
2d5MAR+9g9ByyD6TtzLE5F9FebkyQBGNm8UXUzfx1nmVLkcHp6DMqG3NoF9ZKP2m
5PJRmS93Tpp/vdUfFxd60mGf8gh3FNQ1EljBLCsPJMfluw5+pqdQe0zDiI/TGi8U
d6O9Pj4uIfJiCfm9PTocqUiHQL+fnT++Nz77YpkdT3AND+36HlOlqOx9h2TgX1bb
r83HUvrwVmIw/lORb/JCZGrWwHOrpaDtvONkrpmAIhvGrRjBL4/GBlQ=
-----END CERTIFICATE-----`;
