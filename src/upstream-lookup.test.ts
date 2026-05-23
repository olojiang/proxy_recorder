import assert from "node:assert/strict";
import test from "node:test";
import { lookupUpstream } from "./upstream-lookup.js";

test("lookupUpstream supports Node lookup all=true callback shape for IP inputs", async () => {
  const result = await new Promise<unknown>((resolve, reject) => {
    lookupUpstream("127.0.0.1", { all: true }, (error, address) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(address);
    });
  });

  assert.deepEqual(result, [{ address: "127.0.0.1", family: 4 }]);
});

test("lookupUpstream supports two-argument callback shape for IP inputs", async () => {
  const result = await new Promise<{ address: unknown; family: unknown }>((resolve, reject) => {
    lookupUpstream("::1", (error, address, family) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ address, family });
    });
  });

  assert.deepEqual(result, { address: "::1", family: 6 });
});
