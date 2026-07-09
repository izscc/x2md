// popup.js
chrome.runtime.sendMessage({ action: "ping" }, (resp) => {
    const dot = document.getElementById("dot");
    const txt = document.getElementById("status-text");
    const hint = document.getElementById("status-hint");
    const online = resp && resp.online;
    dot.className = "dot " + (online ? "online" : "offline");
    txt.textContent = online ? "服务在线" : "本机服务未启动";
    if (hint) {
        const port = resp && resp.port ? resp.port : "9527";
        hint.textContent = online
            ? `v${resp.version || "未知版本"} · 127.0.0.1:${port}`
            : "请打开 X2MD.app 后重试";
    }
});

chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
    const list = document.getElementById("path-list");
    if (!resp || !resp.success) {
        list.innerHTML = '<div class="path-item" style="color:#f4212e">无法读取配置；请先启动本机 X2MD 服务</div>';
        return;
    }
    const paths = (resp.config && resp.config.save_paths) || [];
    if (!paths.length) {
        list.innerHTML = '<div class="path-item">未配置保存路径</div>';
        return;
    }
    list.innerHTML = paths.map(p => `<div class="path-item">${p}</div>`).join("");
});

chrome.runtime.sendMessage({ action: "get_history" }, (resp) => {
    const list = document.getElementById("history-list");
    if (!list) return;
    const history = resp && resp.success && Array.isArray(resp.history) ? resp.history : [];
    if (!history.length) {
        list.innerHTML = '<div class="path-item">暂无保存记录</div>';
        return;
    }
    const recent = history[0];
    const title = String(recent.title || "未命名").slice(0, 42);
    const time = recent.saved_at ? new Date(recent.saved_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    list.innerHTML = `<div class="path-item">${title}${time ? ` · ${time}` : ""}</div>`;
});
