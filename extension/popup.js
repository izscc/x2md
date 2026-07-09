
function compareSemver(left, right) {
    const a = String(left || "").split(".").map((item) => parseInt(item, 10) || 0);
    const b = String(right || "").split(".").map((item) => parseInt(item, 10) || 0);
    for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
        if ((a[i] || 0) > (b[i] || 0)) return 1;
        if ((a[i] || 0) < (b[i] || 0)) return -1;
    }
    return 0;
}

function needsExtensionUpgrade(current, minimum) {
    return Boolean(current && minimum && compareSemver(current, minimum) < 0);
}

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
        const upgrade = online && needsExtensionUpgrade(resp.extension_version, resp.min_extension_version);
        hint.textContent = online
            ? (upgrade ? `请升级扩展到 v${resp.min_extension_version}` : `v${resp.version || "未知版本"} · 127.0.0.1:${port}`)
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

if (typeof module !== "undefined" && module.exports) module.exports = { compareSemver, needsExtensionUpgrade };
