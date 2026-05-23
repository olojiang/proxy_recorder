import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { classifyRequest, RequestRecorder } from "./recorder.js";

test("classifyRequest uses destination, content-type, and extension hints", () => {
  assert.equal(classifyRequest("https://example.test/app.js"), "js");
  assert.equal(classifyRequest("https://example.test/app.css"), "css");
  assert.equal(classifyRequest("https://example.test/font.woff2"), "font");
  assert.equal(classifyRequest("https://example.test/module.wasm"), "wasm");
  assert.equal(classifyRequest("https://example.test/photo.webp"), "image");
  assert.equal(classifyRequest("https://example.test/", { "sec-fetch-dest": "document" }), "doc");
  assert.equal(
    classifyRequest("https://example.test/api", undefined, { "content-type": "application/javascript" }),
    "js"
  );
});

test("RequestRecorder records ajax by default and exports sorted categories", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-recordings-"));
  const recorder = new RequestRecorder(dir);

  recorder.start();
  recorder.record({
    url: "https://example.test/api/users",
    requestHeaders: { "sec-fetch-dest": "empty" },
    responseHeaders: { "content-type": "application/json" }
  });
  recorder.record({ url: "https://example.test/main.css" });
  recorder.record({ url: "https://example.test/app.js" });

  const stopped = await recorder.stop();
  assert.equal(stopped.export?.total, 3);
  assert.deepEqual(stopped.export?.categories.js, ["https://example.test/app.js"]);
  assert.deepEqual(stopped.export?.categories.css, ["https://example.test/main.css"]);
  assert.deepEqual(stopped.export?.categories.etc, ["https://example.test/api/users"]);
  assert.ok(stopped.filePath);
  assert.match(await fs.readFile(stopped.filePath!, "utf8"), /"categories"/);
});

test("RequestRecorder keeps repeated proxy requests instead of deduping by URL", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-recordings-"));
  const recorder = new RequestRecorder(dir);

  recorder.start();
  recorder.record({ url: "https://example.test/app.js", status: 200 });
  recorder.record({ url: "https://example.test/app.js", status: 304 });

  const stopped = await recorder.stop();
  assert.equal(stopped.export?.total, 2);
  assert.deepEqual(stopped.export?.categories.js, [
    "https://example.test/app.js",
    "https://example.test/app.js"
  ]);
  assert.deepEqual(
    stopped.export?.requests.map((request) => request.status),
    [200, 304]
  );
});
