import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readRecentLogs } from "./logger.js";

test("readRecentLogs treats missing and empty log files as no logs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-logs-"));
  const logPath = path.join(dir, "proxy.log");

  assert.deepEqual(await readRecentLogs(200, logPath), []);

  await fs.writeFile(logPath, "", "utf8");
  assert.deepEqual(await readRecentLogs(200, logPath), []);
});

test("readRecentLogs skips malformed lines and clamps invalid limits", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-logs-"));
  const logPath = path.join(dir, "proxy.log");

  await fs.writeFile(
    logPath,
    [
      JSON.stringify(logEntry({ path: "/first" })),
      "not-json",
      JSON.stringify(logEntry({ path: "/second" })),
      ""
    ].join("\n"),
    "utf8"
  );

  assert.deepEqual(
    (await readRecentLogs(1, logPath)).map((entry) => entry.path),
    ["/second"]
  );
  assert.deepEqual(await readRecentLogs(-1, logPath), []);
});

function logEntry(overrides: Partial<Awaited<ReturnType<typeof readRecentLogs>>[number]> = {}) {
  return {
    ts: "2026-01-01T00:00:00.000Z",
    protocol: "http",
    method: "GET",
    host: "example.test",
    path: "/",
    status: 200,
    durationMs: 1,
    ...overrides
  };
}
