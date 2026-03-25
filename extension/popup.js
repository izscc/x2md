// popup.js
chrome.runtime.sendMessage({ action: "ping" }, (resp) => {
    const dot = document.getElementById("dot");
    const txt = document.getElementById("status-text");
    const online = resp && resp.online;
    dot.className = "dot " + (online ? "online" : "offline");
    txt.textContent = online ? "服务运行中" : "服务未启动";
});

chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
    const list = document.getElementById("path-list");
    if (!resp || !resp.success) {
        list.innerHTML = '<div class="path-item" style="color:#f4212e">无法读取配置</div>';
        return;
    }
    const paths = (resp.config && resp.config.save_paths) || [];
    if (!paths.length) {
        list.innerHTML = '<div class="path-item">未配置保存路径</div>';
        return;
    }
    list.innerHTML = "";
    paths.forEach(p => {
        const div = document.createElement("div");
        div.className = "path-item";
        div.textContent = p;
        list.appendChild(div);
    });
});
