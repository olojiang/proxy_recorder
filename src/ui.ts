export const adminHtml = String.raw`<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Proxy Recorder</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f6f7f9;
        --panel: #ffffff;
        --text: #17202a;
        --muted: #61707f;
        --line: #d8dee6;
        --primary: #1167b1;
        --danger: #b42318;
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      header {
        border-bottom: 1px solid var(--line);
        background: var(--panel);
      }

      .wrap {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
      }

      header .wrap {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        min-height: 72px;
      }

      h1 {
        margin: 0;
        font-size: 22px;
      }

      main {
        padding: 24px 0 40px;
      }

      section {
        background: var(--panel);
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 18px;
        margin-bottom: 18px;
      }

      form {
        display: grid;
        grid-template-columns: minmax(140px, 1fr) minmax(220px, 2fr) minmax(180px, 1fr) minmax(160px, 1fr) auto auto auto;
        gap: 12px;
        align-items: end;
      }

      label {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 13px;
      }

      input[type="text"] {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 6px;
        padding: 10px 11px;
        font-size: 14px;
      }

      .check {
        display: flex;
        min-height: 40px;
        align-items: center;
        gap: 8px;
        color: var(--text);
      }

      button {
        min-height: 40px;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
        color: var(--text);
        padding: 0 13px;
        font-weight: 600;
        cursor: pointer;
      }

      button.primary {
        background: var(--primary);
        color: #fff;
        border-color: var(--primary);
      }

      button.danger {
        color: var(--danger);
      }

      a.button-link {
        display: inline-flex;
        min-height: 40px;
        align-items: center;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #fff;
        color: var(--primary);
        padding: 0 13px;
        font-weight: 600;
        text-decoration: none;
      }

      table {
        width: 100%;
        border-collapse: collapse;
      }

      th,
      td {
        border-bottom: 1px solid var(--line);
        padding: 11px 8px;
        text-align: left;
        vertical-align: middle;
      }

      th {
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
      }

      td input[type="text"] {
        min-width: 180px;
      }

      .actions {
        display: flex;
        gap: 8px;
        justify-content: flex-end;
      }

      .status {
        color: var(--muted);
        font-size: 14px;
      }

      .status a {
        color: var(--primary);
        font-weight: 700;
      }

      .section-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }

      .record-controls {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }

      .record-summary {
        margin-top: 12px;
        display: grid;
        gap: 10px;
      }

      .category-list {
        display: grid;
        gap: 8px;
      }

      .category-row {
        display: grid;
        grid-template-columns: 72px 1fr;
        gap: 10px;
        border-top: 1px solid var(--line);
        padding-top: 8px;
        font-size: 13px;
      }

      .category-row strong {
        text-transform: uppercase;
      }

      .url-list {
        margin: 0;
        padding-left: 18px;
        overflow-wrap: anywhere;
      }

      h2 {
        margin: 0;
        font-size: 16px;
      }

      pre {
        overflow: auto;
        max-height: 320px;
        margin: 0;
        border: 1px solid var(--line);
        border-radius: 6px;
        background: #0f1720;
        color: #d7e2ee;
        padding: 12px;
        font-size: 12px;
        line-height: 1.45;
      }

      .error {
        color: var(--danger);
      }

      @media (max-width: 820px) {
        form {
          grid-template-columns: 1fr;
        }

        table,
        thead,
        tbody,
        tr,
        th,
        td {
          display: block;
        }

        thead {
          display: none;
        }

        tr {
          border-bottom: 1px solid var(--line);
          padding: 10px 0;
        }

        td {
          border: 0;
          padding: 7px 0;
        }

        .actions {
          justify-content: flex-start;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="wrap">
        <h1>Proxy Recorder</h1>
        <button id="applyHosts" class="primary">应用 hosts</button>
      </div>
    </header>
    <main class="wrap">
      <section>
        <form id="createForm">
          <label>Host <input name="host" type="text" placeholder="example.test" required /></label>
          <label>Target <input name="target" type="text" placeholder="https://www.example.com" required /></label>
          <label>Mount <input name="mountPath" type="text" placeholder="/pinefield.jing-lao-yuan/" /></label>
          <label>Virtual Host <input name="virtualHost" type="text" placeholder="app.pinefield.cn" /></label>
          <label class="check"><input name="enabled" type="checkbox" checked /> 有效</label>
          <label class="check"><input name="hostsEnabled" type="checkbox" /> 写入 hosts</label>
          <button class="primary" type="submit">添加</button>
        </form>
      </section>
      <section>
        <div id="status" class="status">加载中</div>
        <table>
          <thead>
            <tr>
              <th>Host</th>
              <th>Target</th>
              <th>Mount</th>
              <th>Virtual Host</th>
              <th>有效</th>
              <th>Hosts</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="rules"></tbody>
        </table>
      </section>
      <section>
        <div class="section-head">
          <h2>请求记录</h2>
          <div class="record-controls">
            <button id="startRecording" class="primary" type="button">开始记录</button>
            <button id="stopRecording" type="button" disabled>结束记录</button>
            <button id="exportRecording" type="button" disabled>导出文件</button>
          </div>
        </div>
        <div id="recordStatus" class="status">未开始</div>
        <div id="recordSummary" class="record-summary"></div>
      </section>
      <section>
        <div class="section-head">
          <h2>最近日志</h2>
          <button id="refreshLogs" type="button">刷新</button>
        </div>
        <pre id="logs">加载中</pre>
      </section>
    </main>
    <script>
      const statusEl = document.querySelector("#status");
      const tbody = document.querySelector("#rules");
      const form = document.querySelector("#createForm");
      const applyHosts = document.querySelector("#applyHosts");
      const logsEl = document.querySelector("#logs");
      const refreshLogs = document.querySelector("#refreshLogs");
      const startRecording = document.querySelector("#startRecording");
      const stopRecording = document.querySelector("#stopRecording");
      const exportRecording = document.querySelector("#exportRecording");
      const recordStatus = document.querySelector("#recordStatus");
      const recordSummary = document.querySelector("#recordSummary");

      function setStatus(message, isError = false) {
        statusEl.textContent = message;
        statusEl.className = isError ? "status error" : "status";
      }

      function setStatusHtml(html, isError = false) {
        statusEl.innerHTML = html;
        statusEl.className = isError ? "status error" : "status";
      }

      async function api(path, options = {}) {
        const response = await fetch(path, {
          headers: { "content-type": "application/json" },
          ...options
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "Request failed");
        }
        return payload;
      }

      async function loadRules(messageHtml) {
        const rules = await api("/api/rules");
        renderRules(rules);
        if (messageHtml) {
          setStatusHtml(messageHtml);
          return;
        }
        setStatusHtml(rules.length ? rules.length + " 条规则。点击表格里的“打开”访问。" : "暂无规则");
      }

      async function loadLogs() {
        const logs = await api("/api/logs?limit=100");
        logsEl.textContent = logs.length
          ? logs.map((entry) => JSON.stringify(entry)).join("\\n")
          : "暂无日志";
      }

      async function loadRecordingState() {
        const state = await api("/api/recording");
        renderRecordingState(state);
      }

      function renderRecordingState(state) {
        startRecording.disabled = state.active;
        stopRecording.disabled = !state.active;
        exportRecording.disabled = !state.lastFileName || state.active;
        recordStatus.textContent = state.active
          ? "记录中：" + state.count + " 条，开始时间 " + state.startedAt
          : state.lastFileName
            ? "已生成：" + state.lastFileName
            : "未开始";
      }

      function renderRecordingResult(result) {
        if (!result.export) {
          recordSummary.innerHTML = "";
          renderRecordingState(result);
          return;
        }
        const data = result.export;
        renderRecordingState({
          active: false,
          count: data.total,
          lastFileName: result.fileName
        });
        recordStatus.textContent = "已结束：记录 " + data.total + " 条，文件 " + result.fileName;
        exportRecording.disabled = false;
        recordSummary.innerHTML =
          '<div class="category-list">' +
          ["js", "css", "doc", "image", "font", "wasm", "etc"].map((category) => {
            const urls = data.categories[category] || [];
            return '<div class="category-row"><strong>' + category + '</strong><ol class="url-list">' +
              (urls.length ? urls.map((url) => '<li>' + escapeHtml(url) + '</li>').join("") : '<li>无</li>') +
              '</ol></div>';
          }).join("") +
          "</div>";
      }

      function renderRules(rules) {
        tbody.innerHTML = "";
        for (const rule of rules) {
          const tr = document.createElement("tr");
          tr.innerHTML =
            '<td><input data-field="host" type="text" value="' + escapeHtml(rule.host) + '" /></td>' +
            '<td><input data-field="target" type="text" value="' + escapeHtml(rule.target) + '" /></td>' +
            '<td><input data-field="mountPath" type="text" value="' + escapeHtml(rule.mountPath || "") + '" /></td>' +
            '<td><input data-field="virtualHost" type="text" value="' + escapeHtml(rule.virtualHost || "") + '" /></td>' +
            '<td><input data-field="enabled" type="checkbox" ' + (rule.enabled ? "checked" : "") + " /></td>" +
            '<td><input data-field="hostsEnabled" type="checkbox" ' + (rule.hostsEnabled ? "checked" : "") + " /></td>" +
            '<td><div class="actions"><a class="button-link" target="_blank" rel="noreferrer" href="' + escapeHtml(accessUrl(rule)) + '">打开</a><button data-action="save">保存</button><button data-action="delete" class="danger">删除</button></div></td>';
          tr.querySelector('[data-action="save"]').addEventListener("click", () => saveRule(rule.id, tr));
          tr.querySelector('[data-action="delete"]').addEventListener("click", () => deleteRule(rule.id));
          tbody.appendChild(tr);
        }
      }

      async function saveRule(id, row) {
        try {
          await api("/api/rules/" + id, {
            method: "PUT",
            body: JSON.stringify(readRow(row))
          });
          await loadRules();
        } catch (error) {
          setStatus(error.message, true);
        }
      }

      async function deleteRule(id) {
        try {
          await api("/api/rules/" + id, { method: "DELETE" });
          await loadRules();
        } catch (error) {
          setStatus(error.message, true);
        }
      }

      function readRow(row) {
        return {
          host: row.querySelector('[data-field="host"]').value,
          target: row.querySelector('[data-field="target"]').value,
          mountPath: row.querySelector('[data-field="mountPath"]').value,
          virtualHost: row.querySelector('[data-field="virtualHost"]').value,
          enabled: row.querySelector('[data-field="enabled"]').checked,
          hostsEnabled: row.querySelector('[data-field="hostsEnabled"]').checked
        };
      }

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(form);
        const submitButton = form.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        submitButton.textContent = "添加中";
        try {
          const created = await api("/api/rules", {
            method: "POST",
            body: JSON.stringify({
              host: data.get("host"),
              target: data.get("target"),
              mountPath: data.get("mountPath"),
              virtualHost: data.get("virtualHost"),
              enabled: data.get("enabled") === "on",
              hostsEnabled: data.get("hostsEnabled") === "on"
            })
          });
          form.reset();
          form.elements.enabled.checked = true;
          form.elements.hostsEnabled.checked = false;
          await loadRules(successHtml("已添加", created));
        } catch (error) {
          const draft = {
            host: data.get("host"),
            mountPath: data.get("mountPath")
          };
          if (String(error.message).includes("Route already exists")) {
            setStatusHtml(successHtml("规则已存在，可直接访问", draft));
          } else {
            setStatus(error.message, true);
          }
        } finally {
          submitButton.disabled = false;
          submitButton.textContent = "添加";
        }
      });

      form.elements.host.addEventListener("input", updateHostsDefault);
      form.elements.mountPath.addEventListener("input", updateHostsDefault);

      function updateHostsDefault() {
        const host = String(form.elements.host.value || "").trim().toLowerCase();
        const hasMount = String(form.elements.mountPath.value || "").trim() !== "";
        if (host === "localhost" || host === "127.0.0.1" || hasMount) {
          form.elements.hostsEnabled.checked = false;
        }
      }

      applyHosts.addEventListener("click", async () => {
        try {
          const result = await api("/api/hosts/apply", { method: "POST" });
          setStatus("已写入 " + result.hostsPath);
        } catch (error) {
          setStatus(error.message, true);
        }
      });

      refreshLogs.addEventListener("click", () => {
        loadLogs().catch((error) => setStatus(error.message, true));
      });

      startRecording.addEventListener("click", async () => {
        try {
          recordSummary.innerHTML = "";
          const state = await api("/api/recording/start", {
            method: "POST"
          });
          renderRecordingState(state);
        } catch (error) {
          setStatus(error.message, true);
        }
      });

      stopRecording.addEventListener("click", async () => {
        try {
          const result = await api("/api/recording/stop", { method: "POST" });
          renderRecordingResult(result);
        } catch (error) {
          setStatus(error.message, true);
        }
      });

      exportRecording.addEventListener("click", () => {
        window.location.href = "/api/recording/export";
      });

      function escapeHtml(value) {
        return String(value)
          .replaceAll("&", "&amp;")
          .replaceAll("<", "&lt;")
          .replaceAll(">", "&gt;")
          .replaceAll('"', "&quot;");
      }

      function accessUrl(rule) {
        const host = String(rule.host || "").trim();
        const current = new URL(window.location.href);
        const hostWithPort =
          host === "localhost" || host === "127.0.0.1" ? current.host : host;
        const mountPath = normalizeMountPath(rule.mountPath || "/");
        return current.protocol + "//" + hostWithPort + mountPath;
      }

      function normalizeMountPath(value) {
        const trimmed = String(value || "/").trim();
        const withLeadingSlash = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
        return withLeadingSlash.endsWith("/") ? withLeadingSlash : withLeadingSlash + "/";
      }

      function successHtml(prefix, rule) {
        const url = accessUrl(rule);
        return escapeHtml(prefix) + '：<a target="_blank" rel="noreferrer" href="' + escapeHtml(url) + '">' + escapeHtml(url) + "</a>";
      }

      loadRules().catch((error) => setStatus(error.message, true));
      loadRecordingState().catch((error) => setStatus(error.message, true));
      loadLogs().catch((error) => setStatus(error.message, true));
    </script>
  </body>
</html>`;
