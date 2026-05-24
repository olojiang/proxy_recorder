import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface HttpsProxyConfig {
  port: number;
  certPath: string;
  keyPath: string;
}

export function defaultHostsPath(
  platform: NodeJS.Platform = process.platform,
  systemRoot = process.env.SystemRoot
): string {
  if (platform === "win32") {
    return path.win32.join(systemRoot || "C:\\Windows", "System32", "drivers", "etc", "hosts");
  }
  return "/etc/hosts";
}

export function parsePort(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }

  const port = Number.parseInt(value, 10);
  if (port < 1 || port > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return port;
}

export function parsePositiveInteger(value: string, name: string): number {
  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be a positive integer`);
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function resolveHttpsProxyConfig(
  env: NodeJS.ProcessEnv = process.env
): HttpsProxyConfig | undefined {
  const port = env.HTTPS_PROXY_PORT;
  const certPath = env.TLS_CERT_PATH;
  const keyPath = env.TLS_KEY_PATH;
  const hasAnyHttpsSetting = Boolean(port || certPath || keyPath);

  if (!hasAnyHttpsSetting) {
    return undefined;
  }
  if (!port || !certPath || !keyPath) {
    throw new Error("HTTPS proxy requires HTTPS_PROXY_PORT, TLS_CERT_PATH, and TLS_KEY_PATH");
  }

  return {
    port: parsePort(port, "HTTPS_PROXY_PORT"),
    certPath: path.resolve(certPath),
    keyPath: path.resolve(keyPath)
  };
}

const httpsProxy = resolveHttpsProxyConfig();

export const config = {
  bindHost: process.env.BIND_HOST ?? "0.0.0.0",
  proxyPort: parsePort(process.env.PROXY_PORT ?? "8080", "PROXY_PORT"),
  httpsProxyPort: httpsProxy?.port,
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(rootDir, "data")),
  hostsPath: path.resolve(process.env.HOSTS_PATH ?? defaultHostsPath()),
  hostsIp: process.env.HOSTS_IP ?? "127.0.0.1",
  tlsCertPath: httpsProxy?.certPath,
  tlsKeyPath: httpsProxy?.keyPath,
  logPath: path.resolve(process.env.LOG_PATH ?? path.join(rootDir, "data", "proxy.log")),
  maxRewriteBytes: parsePositiveInteger(
    process.env.MAX_REWRITE_BYTES ?? String(10 * 1024 * 1024),
    "MAX_REWRITE_BYTES"
  )
};
