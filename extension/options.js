// options.js - 全部用 addEventListener，不依赖 inline onclick（规避 CSP）

let currentConfig = {};

// ─────────────────────────────────────────────
// 初始化
// ─────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    // 绑定按钮事件（不使用 inline onclick）
    document.getElementById("btnRefresh").addEventListener("click", checkStatus);
    document.getElementById("btnAdd").addEventListener("click", addPath);
    document.getElementById("btnSave").addEventListener("click", saveConfig);

    loadConfig();
    checkStatus();
});

// ─────────────────────────────────────────────
// 加载配置
// ─────────────────────────────────────────────
function loadConfig() {
    chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
        if (chrome.runtime.lastError) {
            showToast("扩展通信失败，请刷新页面重试", true);
            return;
        }
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
    document.getElementById("videoSavePath").value = cfg.video_save_path || "";
    document.getElementById("videoDurationThreshold").value = cfg.video_duration_threshold || 5;
    document.getElementById("showSiteSaveIcon").checked = cfg.show_site_save_icon !== false;

    // 平台分类文件夹（V1.2）
    document.getElementById("enablePlatformFolders").checked = cfg.enable_platform_folders !== false;
    const folderNames = cfg.platform_folder_names || {};
    document.querySelectorAll(".platform-folder-input").forEach((input) => {
        const platform = input.dataset.platform;
        if (platform && folderNames[platform]) {
            input.value = folderNames[platform];
        }
    });

    // 图片本地下载（V1.2）
    document.getElementById("downloadImages").checked = cfg.download_images !== false;
    document.getElementById("imageSubfolder").value = cfg.image_subfolder || "assets";

    // 同步开关回显
    document.getElementById("syncEnabled").checked = !!cfg.sync_enabled;
    updateSyncStatus(!!cfg.sync_enabled);

    renderPaths(cfg.save_paths || []);
}

function updateSyncStatus(enabled) {
    const el = document.getElementById("syncStatus");
    if (enabled) {
        el.textContent = "同步已开启 — 偏好设置将通过 Chrome 账号同步到其他设备";
        el.style.color = "var(--success)";
    } else {
        el.textContent = "同步未开启 — 设置仅保存在本机";
        el.style.color = "var(--text-muted)";
    }
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
// 服务状态检测
// ─────────────────────────────────────────────
function checkStatus() {
    const dot = document.getElementById("statusDot");
    const txt = document.getElementById("statusText");
    dot.className = "status-indicator offline";
    txt.textContent = "检测中…";

    chrome.runtime.sendMessage({ action: "ping" }, (resp) => {
        if (chrome.runtime.lastError) { return; }
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

    // 媒体设置读取
    const enableVideoDownload = document.getElementById("enableVideoDownload").checked;
    const videoSavePath = document.getElementById("videoSavePath").value.trim();
    const videoDurationThreshold = parseFloat(document.getElementById("videoDurationThreshold").value) || 5;
    const showSiteSaveIcon = document.getElementById("showSiteSaveIcon").checked;
    const syncEnabled = document.getElementById("syncEnabled").checked;

    // 平台分类文件夹（V1.2）
    const enablePlatformFolders = document.getElementById("enablePlatformFolders").checked;
    const platformFolderNames = {};
    document.querySelectorAll(".platform-folder-input").forEach((input) => {
        const platform = input.dataset.platform;
        if (platform) {
            platformFolderNames[platform] = input.value.trim() || platform;
        }
    });

    // 图片本地下载（V1.2）
    const downloadImages = document.getElementById("downloadImages").checked;
    const imageSubfolder = document.getElementById("imageSubfolder").value.trim() || "assets";

    if (!savePaths.length) {
        showToast("请至少添加一个保存路径", true);
        return;
    }

    const newConfig = {
        port,
        filename_format: filenameFormat,
        max_filename_length: maxLen,
        save_paths: savePaths,
        enable_video_download: enableVideoDownload,
        video_save_path: videoSavePath,
        video_duration_threshold: videoDurationThreshold,
        show_site_save_icon: showSiteSaveIcon,
        sync_enabled: syncEnabled,
        enable_platform_folders: enablePlatformFolders,
        platform_folder_names: platformFolderNames,
        download_images: downloadImages,
        image_subfolder: imageSubfolder,
    };

    document.getElementById("portLabel").textContent = port;

    chrome.runtime.sendMessage({ action: "update_config", config: newConfig }, (resp) => {
        if (chrome.runtime.lastError) {
            showToast("❌ 扩展通信失败，请刷新页面重试", true);
            return;
        }
        if (resp && resp.success) {
            currentConfig = newConfig;
            updateSyncStatus(syncEnabled);
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
