// popup.js
chrome.runtime.sendMessage({ action: "ping" }, (resp) => {
    if (chrome.runtime.lastError) { /* 扩展上下文失效，忽略 */ return; }
    const dot = document.getElementById("dot");
    const txt = document.getElementById("status-text");
    const online = resp && resp.online;
    dot.className = "dot " + (online ? "online" : "offline");
    txt.textContent = online ? "服务运行中" : "服务未启动";
});

chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
    if (chrome.runtime.lastError) { return; }
    const list = document.getElementById("path-list");
    const hint = document.getElementById("status-hint");
    if (!resp || !resp.success) {
        list.textContent = "";
        const errDiv = document.createElement("div");
        errDiv.className = "path-item";
        errDiv.style.color = "#f4212e";
        errDiv.textContent = "无法读取配置";
        list.appendChild(errDiv);
        return;
    }
    // 动态更新端口显示
    if (resp.config && resp.config.port && hint) {
        hint.textContent = `localhost:${resp.config.port}`;
    }
    const paths = (resp.config && resp.config.save_paths) || [];
    if (!paths.length) {
        list.textContent = "";
        const emptyDiv = document.createElement("div");
        emptyDiv.className = "path-item";
        emptyDiv.textContent = "未配置保存路径";
        list.appendChild(emptyDiv);
        return;
    }
    list.textContent = "";
    paths.forEach(p => {
        const div = document.createElement("div");
        div.className = "path-item";
        div.textContent = p;
        list.appendChild(div);
    });
});
