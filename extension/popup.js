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

function escapeHtml(value) {
    return String(value || "").replace(/[&<>'"]/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[char]);
}

function renderItem(primary, secondary = "", className = "") {
    return `<div class="item ${className}"><div class="item-path">${escapeHtml(primary)}</div>${secondary ? `<div class="item-meta">${escapeHtml(secondary)}</div>` : ""}</div>`;
}

function renderHistoryItem(item) {
    const id = escapeHtml(item.id);
    const title = String(item.title || "未命名").slice(0, 80);
    const time = item.saved_at ? new Date(item.saved_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
    const actions = id ? `<div class="item-actions"><button data-history-id="${id}" data-history-action="show_file">显示</button><button data-history-id="${id}" data-history-action="open_obsidian">Obsidian</button><button data-history-id="${id}" data-history-action="open_source">原文</button><button data-history-id="${id}" data-history-action="copy_path">复制路径</button></div>` : "";
    return `<div class="item"><div class="item-path">${escapeHtml(title)}</div><div class="item-meta">${escapeHtml(time || item.platform || "")}</div>${actions}</div>`;
}

chrome.runtime.sendMessage({ action: "ping" }, (resp) => {
    const dot = document.getElementById("dot");
    const txt = document.getElementById("status-text");
    const hint = document.getElementById("status-hint");
    const online = resp && resp.online;
    dot.className = "dot " + (online ? "online" : "offline");
    txt.textContent = online ? "本机服务已就绪" : "本机服务未启动";
    const port = resp && resp.port ? resp.port : "9527";
    const upgrade = online && needsExtensionUpgrade(resp.extension_version, resp.min_extension_version);
    hint.textContent = online
        ? (upgrade ? `请升级扩展到 v${resp.min_extension_version}` : `v${resp.version || "未知版本"} · 127.0.0.1:${port}`)
        : "请打开 X2MD.app 后重试";
});

chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
    const list = document.getElementById("path-list");
    if (!resp || !resp.success) {
        list.innerHTML = renderItem("无法读取配置", "请先启动本机 X2MD 服务", "error");
        return;
    }
    const paths = (resp.config && resp.config.save_paths) || [];
    if (!paths.length) {
        list.innerHTML = renderItem("未配置保存路径", "在设置中选择一个文件夹");
        return;
    }
    list.innerHTML = paths.slice(0, 2).map((path) => renderItem(path)).join("");
    if (paths.length > 2) list.innerHTML += renderItem(`另有 ${paths.length - 2} 个保存位置`);
});

chrome.runtime.sendMessage({ action: "get_history" }, (resp) => {
    const list = document.getElementById("history-list");
    if (!list) return;
    const history = resp && resp.success && Array.isArray(resp.history) ? resp.history : [];
    if (!history.length) {
        list.innerHTML = renderItem("暂无保存记录", "保存网页后会显示在这里");
        return;
    }
    list.innerHTML = history.slice(0, 3).map(renderHistoryItem).join("");
    if (typeof list.addEventListener === "function") list.addEventListener("click", (event) => {
        const button = event.target?.closest?.("[data-history-id][data-history-action]");
        if (!button) return;
        chrome.runtime.sendMessage({ action: "history_action", id: button.dataset.historyId, command: button.dataset.historyAction }, async (response) => {
            if (button.dataset.historyAction === "copy_path" && response?.path && globalThis.navigator?.clipboard) await navigator.clipboard.writeText(response.path);
        });
    });
});

if (typeof module !== "undefined" && module.exports) module.exports = { compareSemver, needsExtensionUpgrade, escapeHtml, renderItem, renderHistoryItem };
