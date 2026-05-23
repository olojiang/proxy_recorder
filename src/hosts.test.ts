import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyHostsBlock } from "./hosts.js";
import type { ProxyRule } from "./types.js";

test("applyHostsBlock replaces only the managed block", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-hosts-"));
  const hostsPath = path.join(dir, "hosts");

  await fs.writeFile(
    hostsPath,
    "127.0.0.1\tlocalhost\n\n# proxy-recorder:start\n127.0.0.1\told.test\t# proxy-recorder:old\n# proxy-recorder:end\n",
    "utf8"
  );

  await applyHostsBlock(hostsPath, "127.0.0.1", [
    rule({ id: "1", host: "b.test", enabled: true, hostsEnabled: true }),
    rule({ id: "2", host: "a.test", enabled: true, hostsEnabled: true }),
    rule({ id: "3", host: "off.test", enabled: false, hostsEnabled: true }),
    rule({ id: "4", host: "skip.test", enabled: true, hostsEnabled: false })
  ]);

  const content = await fs.readFile(hostsPath, "utf8");
  assert.equal(
    content,
    "127.0.0.1\tlocalhost\n\n# proxy-recorder:start\n127.0.0.1\ta.test\t# proxy-recorder:2\n127.0.0.1\tb.test\t# proxy-recorder:1\n# proxy-recorder:end\n"
  );
});

function rule(overrides: Partial<ProxyRule>): ProxyRule {
  return {
    id: "id",
    host: "example.test",
    target: "https://example.com",
    enabled: true,
    hostsEnabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides
  };
}
