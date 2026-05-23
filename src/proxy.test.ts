import assert from "node:assert/strict";
import test from "node:test";
import {
  buildUpstreamUrl,
  decodeExternalProxyUrl,
  decodeReferrerExternalProxyUrl,
  rewriteTextBody
} from "./proxy.js";

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
