import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HttpError, RuleStore } from "./rules.js";

test("RuleStore normalizes and rejects duplicate hosts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-rules-"));
  const store = new RuleStore(dir);

  const created = await store.create({
    host: "Example.TEST.",
    target: "origin.example.com",
    enabled: true,
    hostsEnabled: true
  });

  assert.equal(created.host, "example.test");
  assert.equal(created.target, "https://origin.example.com");

  await assert.rejects(
    () =>
      store.create({
        host: "example.test",
        target: "https://other.example.com"
      }),
    (error) => error instanceof HttpError && error.statusCode === 409
  );
});

test("RuleStore only returns enabled host matches", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-rules-"));
  const store = new RuleStore(dir);

  const disabled = await store.create({
    host: "disabled.test",
    target: "https://example.com",
    enabled: false
  });

  assert.equal(await store.findEnabledByHost(disabled.host), undefined);
});

test("RuleStore matches mounted paths before host fallback", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-rules-"));
  const store = new RuleStore(dir);

  const fallback = await store.create({
    host: "localhost",
    target: "https://origin.example.com"
  });
  const mounted = await store.create({
    host: "localhost",
    target: "https://app.example.com/pinefield.jing-lao-yuan",
    mountPath: "pinefield.jing-lao-yuan",
    virtualHost: "app.example.com"
  });

  assert.equal(mounted.mountPath, "/pinefield.jing-lao-yuan/");
  assert.equal(mounted.virtualHost, "app.example.com");
  assert.equal(
    (await store.findEnabledByRequest("localhost:3333", "/pinefield.jing-lao-yuan/assets/app.js"))
      ?.id,
    mounted.id
  );
  assert.equal((await store.findEnabledByRequest("localhost", "/query"))?.id, fallback.id);
});

test("RuleStore uses mounted rule as origin fallback when no plain host rule exists", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "proxy-recorder-rules-"));
  const store = new RuleStore(dir);

  const mounted = await store.create({
    host: "localhost",
    target: "https://app.example.com/pinefield.jing-lao-yuan",
    mountPath: "/pinefield.jing-lao-yuan/"
  });

  assert.equal((await store.findEnabledByRequest("localhost", "/query"))?.id, mounted.id);
});
