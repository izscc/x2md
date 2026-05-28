// options.js - 全部用 addEventListener，不依赖 inline onclick（规避 CSP）

let currentConfig = {};

// ─────────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    // 绑定按钮事件（不使用 inline onclick）
    document.getElementById("btnRefresh").addEventListener("click", checkStatus);
    document.getElementById("btnAdd").addEventListener("click", addPath);
    document.getElementById("btnAddCustomPath").addEventListener("click", addCustomPath);
    document.getElementById("btnSave").addEventListener("click", saveConfig);

    loadConfig();
    checkStatus();
});

// ─────────────────────────────────────────────
// 加载配置
// ─────────────────────────────────────────────
function loadConfig() {
    chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
        if (resp && resp.success && resp.config) {
            currentConfig = resp.config;
            applyConfigToUI(resp.config);
        } else {
            showToast("无法读取配置，请确认服务已启动", true);
        }
    });
}

function applyConfigToUI(cfg) {
    document.getElementById("portInput").value = cfg.port || 9527;
    document.getElementById("portLabel").textContent = cfg.port || 9527;
    document.getElementById("filenameFormat").value =
        cfg.filename_format || "{date}_{author}_{summary}";
    document.getElementById("maxLen").value = cfg.max_filename_length || 60;

    // 视频设置回显
    document.getElementById("enableVideoDownload").checked = cfg.enable_video_download !== false;
    document.getElementById("videoSavePath").value = cfg.video_save_path || "/Users/zscc.in/Desktop/船仓文件/Obsidian/OB/00-资料库/附件/视频/2026";
    document.getElementById("videoDurationThreshold").value = cfg.video_duration_threshold || 5;
    document.getElementById("showSiteSaveIcon").checked = cfg.show_site_save_icon !== false;
    document.getElementById("showXProfileCaptureButton").checked = cfg.show_x_profile_capture_button !== false;
    document.getElementById("profileCaptureRange").value = cfg.profile_capture_range || "today";
    document.getElementById("profileCaptureDays").value = cfg.profile_capture_custom_days || 7;
    document.getElementById("profileCaptureSavePath").value = cfg.profile_capture_save_path || "";

    renderPaths(cfg.save_paths || []);
    renderCustomPaths(cfg.custom_save_paths || []);
}

// ─────────────────────────────────────────────
// 路径列表
// ─────────────────────────────────────────────
function renderPaths(paths) {
    const list = document.getElementById("pathList");
    list.innerHTML = "";
    paths.forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "path-row";

        const icon = document.createElement("span");
        icon.className = "path-row-icon";
        icon.textContent = "📂";

        const input = document.createElement("input");
        input.type = "text";
        input.value = p;
        input.dataset.index = i;
        input.placeholder = "/path/to/obsidian/vault";

        const btn = document.createElement("button");
        btn.className = "btn-remove";
        btn.title = "删除";
        btn.textContent = "×";
        btn.addEventListener("click", () => {
            const paths2 = collectPaths();
            paths2.splice(i, 1);
            renderPaths(paths2);
        });

        row.appendChild(icon);
        row.appendChild(input);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

function collectPaths() {
    return [...document.querySelectorAll("#pathList input")]
        .map(i => i.value.trim())
        .filter(Boolean);
}

function addPath() {
    const paths = collectPaths();
    paths.push("");
    renderPaths(paths);
    const inputs = document.querySelectorAll("#pathList input");
    if (inputs.length) inputs[inputs.length - 1].focus();
}

// ─────────────────────────────────────────────
// X 书签悬停菜单的自定义保存路径
// ─────────────────────────────────────────────
function normalizeCustomPathEntry(entry = {}) {
    return {
        name: String(entry.name || "").trim(),
        path: String(entry.path || "").trim(),
    };
}

function renderCustomPaths(paths) {
    const list = document.getElementById("customPathList");
    list.innerHTML = "";
    paths.map(normalizeCustomPathEntry).forEach((entry, i) => {
        const row = document.createElement("div");
        row.className = "path-row";

        const icon = document.createElement("span");
        icon.className = "path-row-icon";
        icon.textContent = "🏷️";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = entry.name;
        nameInput.dataset.field = "name";
        nameInput.placeholder = "菜单名，如：生图类";
        nameInput.className = "custom-path-name";

        const pathInput = document.createElement("input");
        pathInput.type = "text";
        pathInput.value = entry.path;
        pathInput.dataset.field = "path";
        pathInput.placeholder = "/path/to/obsidian/subfolder";
        pathInput.className = "custom-path-target";

        const btn = document.createElement("button");
        btn.className = "btn-remove";
        btn.title = "删除";
        btn.textContent = "×";
        btn.addEventListener("click", () => {
            const paths2 = collectCustomPaths({ keepIncomplete: true });
            paths2.splice(i, 1);
            renderCustomPaths(paths2);
        });

        row.appendChild(icon);
        row.appendChild(nameInput);
        row.appendChild(pathInput);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

function collectCustomPaths(options = {}) {
    const keepIncomplete = !!options.keepIncomplete;
    return [...document.querySelectorAll("#customPathList .path-row")]
        .map((row) => ({
            name: row.querySelector('input[data-field="name"]')?.value.trim() || "",
            path: row.querySelector('input[data-field="path"]')?.value.trim() || "",
        }))
        .filter((entry) => keepIncomplete ? (entry.name || entry.path) : (entry.name && entry.path));
}

function addCustomPath() {
    const paths = collectCustomPaths({ keepIncomplete: true });
    paths.push({ name: "", path: "" });
    renderCustomPaths(paths);
    const inputs = document.querySelectorAll('#customPathList input[data-field="name"]');
    if (inputs.length) inputs[inputs.length - 1].focus();
}

// ─────────────────────────────────────────────
// 服务状态检测
// ─────────────────────────────────────────────
function checkStatus() {
    const dot = document.getElementById("statusDot");
    const txt = document.getElementById("statusText");
    dot.className = "status-indicator offline";
    txt.textContent = "检测中…";

    chrome.runtime.sendMessage({ action: "ping" }, (resp) => {
        const online = resp && resp.online;
        dot.className = "status-indicator " + (online ? "online" : "offline");
        txt.textContent = online ? "本地服务运行中 ✓" : "服务未启动，请运行 start_server.sh";
    });
}

// ─────────────────────────────────────────────
// 保存配置
// ─────────────────────────────────────────────
function saveConfig() {
    const port = parseInt(document.getElementById("portInput").value) || 9527;
    const filenameFormat =
        document.getElementById("filenameFormat").value.trim() ||
        "{date}_{author}_{summary}";
    const maxLen = parseInt(document.getElementById("maxLen").value) || 60;
    const savePaths = collectPaths();
    const rawCustomSavePaths = collectCustomPaths({ keepIncomplete: true });
    const invalidCustomPath = rawCustomSavePaths.find((entry) => (entry.name && !entry.path) || (!entry.name && entry.path));
    const customSavePaths = collectCustomPaths();

    // 媒体设置读取
    const enableVideoDownload = document.getElementById("enableVideoDownload").checked;
    const videoSavePath = document.getElementById("videoSavePath").value.trim() || "/Users/zscc.in/Desktop/船仓文件/Obsidian/OB/00-资料库/附件/视频/2026";
    const videoDurationThreshold = parseFloat(document.getElementById("videoDurationThreshold").value) || 5;
    const showSiteSaveIcon = document.getElementById("showSiteSaveIcon").checked;
    const showXProfileCaptureButton = document.getElementById("showXProfileCaptureButton").checked;
    const profileCaptureRange = document.getElementById("profileCaptureRange").value || "today";
    const profileCaptureDays = parseInt(document.getElementById("profileCaptureDays").value, 10) || 7;
    const profileCaptureSavePath = document.getElementById("profileCaptureSavePath").value.trim();

    if (!savePaths.length) {
        showToast("请至少添加一个保存路径", true);
        return;
    }
    if (invalidCustomPath) {
        showToast("自定义保存路径需要同时填写菜单名和路径", true);
        return;
    }

    const newConfig = {
        port,
        filename_format: filenameFormat,
        max_filename_length: maxLen,
        save_paths: savePaths,
        custom_save_paths: customSavePaths,
        enable_video_download: enableVideoDownload,
        video_save_path: videoSavePath,
        video_duration_threshold: videoDurationThreshold,
        show_site_save_icon: showSiteSaveIcon,
        show_x_profile_capture_button: showXProfileCaptureButton,
        profile_capture_range: profileCaptureRange,
        profile_capture_custom_days: profileCaptureDays,
        profile_capture_save_path: profileCaptureSavePath,
    };

    document.getElementById("portLabel").textContent = port;

    chrome.runtime.sendMessage({ action: "update_config", config: newConfig }, (resp) => {
        if (resp && resp.success) {
            currentConfig = newConfig;
            showToast("✅ 设置已保存");
        } else {
            showToast("❌ 保存失败，服务是否在线？", true);
        }
    });
}

// ─────────────────────────────────────────────
// Toast 提示
// ─────────────────────────────────────────────
function showToast(msg, isError = false) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "show" + (isError ? " error" : "");
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => { t.className = ""; }, 3000);
}
