import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createDevEnv, resolveTsxBin } from "./dev.mjs";

test("resolveTsxBin chooses the platform-specific tsx binary", () => {
  assert.equal(resolveTsxBin("/repo", "darwin"), path.join("/repo", "node_modules", ".bin", "tsx"));
  assert.equal(resolveTsxBin("/repo", "linux"), path.join("/repo", "node_modules", ".bin", "tsx"));
  assert.equal(resolveTsxBin("C:\\repo", "win32"), path.join("C:\\repo", "node_modules", ".bin", "tsx.cmd"));
});

test("createDevEnv defaults PROXY_PORT without overwriting explicit values", () => {
  assert.equal(createDevEnv({}).PROXY_PORT, "3333");
  assert.equal(createDevEnv({ PROXY_PORT: "8080" }).PROXY_PORT, "8080");
});
