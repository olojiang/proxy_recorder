import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  defaultHostsPath,
  parsePort,
  parsePositiveInteger,
  resolveHttpsProxyConfig
} from "./config.js";

test("defaultHostsPath uses the OS-specific hosts file location", () => {
  assert.equal(defaultHostsPath("darwin"), "/etc/hosts");
  assert.equal(defaultHostsPath("linux"), "/etc/hosts");
  assert.equal(
    defaultHostsPath("win32", "C:\\Windows"),
    "C:\\Windows\\System32\\drivers\\etc\\hosts"
  );
});

test("parsePort accepts only valid TCP port numbers", () => {
  assert.equal(parsePort("1", "PROXY_PORT"), 1);
  assert.equal(parsePort("65535", "PROXY_PORT"), 65535);

  for (const value of ["", "0", "65536", "abc", "443abc", "1.5", "-1"]) {
    assert.throws(() => parsePort(value, "PROXY_PORT"), /PROXY_PORT must be an integer/);
  }
});

test("parsePositiveInteger accepts only positive integers", () => {
  assert.equal(parsePositiveInteger("1", "MAX_REWRITE_BYTES"), 1);
  assert.equal(parsePositiveInteger("10485760", "MAX_REWRITE_BYTES"), 10485760);

  for (const value of ["", "0", "abc", "1.5", "-1"]) {
    assert.throws(
      () => parsePositiveInteger(value, "MAX_REWRITE_BYTES"),
      /MAX_REWRITE_BYTES must be a positive integer/
    );
  }
});

test("resolveHttpsProxyConfig requires port, certificate, and key together", () => {
  assert.equal(resolveHttpsProxyConfig({}), undefined);

  for (const env of [
    { HTTPS_PROXY_PORT: "443" },
    { TLS_CERT_PATH: "cert.pem" },
    { TLS_KEY_PATH: "key.pem" },
    { HTTPS_PROXY_PORT: "443", TLS_CERT_PATH: "cert.pem" },
    { HTTPS_PROXY_PORT: "443", TLS_KEY_PATH: "key.pem" },
    { TLS_CERT_PATH: "cert.pem", TLS_KEY_PATH: "key.pem" }
  ]) {
    assert.throws(
      () => resolveHttpsProxyConfig(env),
      /HTTPS proxy requires HTTPS_PROXY_PORT, TLS_CERT_PATH, and TLS_KEY_PATH/
    );
  }
});

test("resolveHttpsProxyConfig resolves valid HTTPS proxy settings", () => {
  assert.deepEqual(
    resolveHttpsProxyConfig({
      HTTPS_PROXY_PORT: "3443",
      TLS_CERT_PATH: "cert.pem",
      TLS_KEY_PATH: "key.pem"
    }),
    {
      port: 3443,
      certPath: path.resolve("cert.pem"),
      keyPath: path.resolve("key.pem")
    }
  );
});
