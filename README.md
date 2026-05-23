# Proxy Recorder

Node.js + TypeScript host-based proxy server with a small management UI.

It supports two modes:

- **Host-file reverse proxy for HTTP**: add a host rule, apply it to `/etc/hosts`, then visit `http://host:port/path`. The proxy receives the request and forwards it to the configured target URL.
- **Host-file reverse proxy for HTTPS**: run the HTTPS proxy listener with a certificate trusted by your browser for the intercepted host, then visit `https://host/path`.
- **Explicit browser proxy for HTTPS**: configure the browser/system HTTP proxy to this server and the proxy will handle `CONNECT host:443` tunnels for enabled host rules.

Transparent HTTPS through `/etc/hosts` cannot work with a plain HTTP proxy. The browser connects to local port 443 and validates the certificate for the requested host. Use a locally trusted certificate, for example from `mkcert`.

## Install

```bash
npm install
npm run build
```

## Run

The dev script listens on `3333` by default and clears any existing listener on that port before starting:

```bash
npm run dev
```

Open the admin UI:

```text
http://localhost:3333/admin
```

Override the dev port when needed:

```bash
PROXY_PORT=8080 npm run dev
```

To listen on port 80 for direct `http://host/path` browser traffic, run with privileges:

```bash
PROXY_PORT=80 npm start
```

To intercept `https://app.pinefield.cn/` through hosts, create and trust a certificate for that host, then run both HTTP and HTTPS listeners:

```bash
mkcert app.pinefield.cn
sudo HOSTS_PATH=/etc/hosts \
  PROXY_PORT=80 \
  HTTPS_PROXY_PORT=443 \
  TLS_CERT_PATH=./app.pinefield.cn.pem \
  TLS_KEY_PATH=./app.pinefield.cn-key.pem \
  npm start
```

Then add a rule in the UI:

```text
Host: app.pinefield.cn
Target: https://app.pinefield.cn
Enabled: checked
Write hosts: checked
```

Click `应用 hosts`, then visit:

```text
https://app.pinefield.cn/
```

The request path is then:

```text
browser -> 127.0.0.1:443 -> Proxy Recorder -> https://app.pinefield.cn
```

The proxy resolves upstream targets through DNS instead of `/etc/hosts`, so this same-host target will not loop back into the local proxy after hosts interception.

## Hosts File Permissions

Applying hosts changes writes a managed block to `/etc/hosts`. On macOS/Linux this normally requires privileges:

```bash
sudo HOSTS_PATH=/etc/hosts PROXY_PORT=80 npm start
```

For local testing without touching the real hosts file:

```bash
HOSTS_PATH=./data/hosts.test npm run dev
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `PROXY_PORT` | `8080` | Server listen port for admin UI and proxy traffic. |
| `HTTPS_PROXY_PORT` | unset | Optional HTTPS host proxy port, usually `443`. |
| `BIND_HOST` | `0.0.0.0` | Listen address. |
| `DATA_DIR` | `./data` | Rule storage directory. |
| `HOSTS_PATH` | `/etc/hosts` | Hosts file to update from the admin UI. |
| `HOSTS_IP` | `127.0.0.1` | IP written for enabled host rules. |
| `TLS_CERT_PATH` | unset | Certificate path for HTTPS host proxy. |
| `TLS_KEY_PATH` | unset | Private key path for HTTPS host proxy. |
| `LOG_PATH` | `./data/proxy.log` | JSONL access log path. |

## Logs

Every proxied request writes one JSON line to stdout and to `LOG_PATH`. The admin UI also shows recent log entries.

## Rule Behavior

- `host` is an exact host match, for example `example.test`.
- `target` is the upstream base URL, for example `https://www.example.com`.
- The proxy forwards the original path and query to the target.
- Unmatched hosts return `502`.
- Disabled rules are ignored and removed from the managed hosts block.
