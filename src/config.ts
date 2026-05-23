import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const config = {
  bindHost: process.env.BIND_HOST ?? "0.0.0.0",
  proxyPort: Number.parseInt(process.env.PROXY_PORT ?? "8080", 10),
  httpsProxyPort: process.env.HTTPS_PROXY_PORT
    ? Number.parseInt(process.env.HTTPS_PROXY_PORT, 10)
    : undefined,
  dataDir: path.resolve(process.env.DATA_DIR ?? path.join(rootDir, "data")),
  hostsPath: path.resolve(process.env.HOSTS_PATH ?? "/etc/hosts"),
  hostsIp: process.env.HOSTS_IP ?? "127.0.0.1",
  tlsCertPath: process.env.TLS_CERT_PATH ? path.resolve(process.env.TLS_CERT_PATH) : undefined,
  tlsKeyPath: process.env.TLS_KEY_PATH ? path.resolve(process.env.TLS_KEY_PATH) : undefined,
  logPath: path.resolve(process.env.LOG_PATH ?? path.join(rootDir, "data", "proxy.log"))
};
