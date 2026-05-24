# Proxy Recorder 使用说明

## 真实 HTTPS 拦截启动方式

先构建项目：

```bash
npm run build
```

为要拦截的域名创建并信任本地证书：

```bash
mkcert install
mkcert app.pinefield.cn
```

启动本机代理服务，同时监听 HTTP 80 和 HTTPS 443：

```bash
sudo env \
  HOSTS_PATH=/etc/hosts \
  PROXY_PORT=80 \
  HTTPS_PROXY_PORT=443 \
  TLS_CERT_PATH="$(pwd)/app.pinefield.cn.pem" \
  TLS_KEY_PATH="$(pwd)/app.pinefield.cn-key.pem" \
  npm start
```

## 添加代理规则

打开管理界面：

```text
http://localhost/admin
```

添加规则：

```text
Host: app.pinefield.cn
Target: https://app.pinefield.cn
Enabled: checked
Write hosts: checked
```

`Target` 的协议决定真实上游协议；本地浏览器访问 HTTPS 不要求上游也必须是 HTTPS。如果上游只有 HTTP，可以写：

```text
Host: app.pinefield.cn
Target: http://origin.example.com
Enabled: checked
Write hosts: checked
```

点击 `应用 hosts`。

之后在浏览器访问：

```text
https://app.pinefield.cn/pinefield.jing-lao-yuan/#/
```

请求链路：

```text
browser -> 127.0.0.1:443 -> local proxy -> https://app.pinefield.cn
```

HTTP 上游时链路是：

```text
browser -> 127.0.0.1:443 -> local proxy -> http://origin.example.com
```

## 日志

日志位置：

```text
data/proxy.log
```

管理界面也会显示最近日志。

注意：`#/` 是浏览器 fragment，不会发给服务器或 proxy，所以日志里只能看到：

```text
/pinefield.jing-lao-yuan/
```

## 验证状态

当前实现已跑过：

```bash
npm test
```

并已用本地 HTTPS 端到端模拟验证通过。
