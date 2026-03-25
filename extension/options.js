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

    // 评论开关联动：关闭时禁用子控件
    document.getElementById("enableComments").addEventListener("change", toggleCommentSubControls);

    // Discourse 域名添加
    document.getElementById("btnAddDomain").addEventListener("click", addDiscourseDomain);
    document.getElementById("newDiscourseDomain").addEventListener("keydown", (e) => {
        if (e.key === "Enter") addDiscourseDomain();
    });

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
        cfg.filename_format || "{summary}_{date}_{author}";
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

    // 覆盖策略（默认关闭）
    document.getElementById("overwriteExisting").checked = !!cfg.overwrite_existing;

    // 评论/回复设置（默认关闭）
    document.getElementById("enableComments").checked = !!cfg.enable_comments;
    document.getElementById("commentsDisplay").value = cfg.comments_display || "details";
    document.getElementById("maxComments").value = cfg.max_comments || 200;
    document.getElementById("commentFloorRange").value = cfg.comment_floor_range || "";
    toggleCommentSubControls();

    // Discourse 域名列表
    renderDiscourseDomains(cfg.discourse_domains || ["linux.do"]);

    // 嵌入模式
    document.getElementById("embedMode").value = cfg.embed_mode || "local";

    // 同步开关回显（默认开启，与 server DEFAULT_CONFIG 一致）
    document.getElementById("syncEnabled").checked = cfg.sync_enabled !== false;
    updateSyncStatus(cfg.sync_enabled !== false);

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

function toggleCommentSubControls() {
    const enabled = document.getElementById("enableComments").checked;
    document.querySelectorAll(".comment-sub").forEach((el) => {
        el.disabled = !enabled;
        el.style.opacity = enabled ? "1" : "0.4";
    });
    const container = document.getElementById("commentSubControls");
    if (container) {
        container.style.opacity = enabled ? "1" : "0.5";
    }
}

// ─────────────────────────────────────────────
// Discourse 域名管理
// ─────────────────────────────────────────────
let _discourseDomainsList = ["linux.do"];

function renderDiscourseDomains(domains) {
    _discourseDomainsList = domains && domains.length ? [...domains] : ["linux.do"];
    const list = document.getElementById("discourseDomainList");
    list.innerHTML = "";

    _discourseDomainsList.forEach((domain, i) => {
        const row = document.createElement("div");
        row.className = "path-row";

        const icon = document.createElement("span");
        icon.className = "path-row-icon";
        icon.textContent = "🌐";

        const domainSpan = document.createElement("span");
        domainSpan.style.cssText = "flex:1; font-size:13px; font-family:monospace;";
        domainSpan.textContent = domain;

        // 站点类型标签（自动检索显示）
        const typeTag = document.createElement("span");
        typeTag.style.cssText = "font-size:11px; padding:2px 8px; border-radius:4px; background:var(--surface2); border:1px solid var(--border); color:var(--accent); margin-right:8px;";
        typeTag.textContent = "检测中…";
        typeTag.id = `domain-type-${i}`;

        // 异步检测站点类型
        detectSiteType(domain, typeTag);

        const isBuiltin = domain === "linux.do";
        const btn = document.createElement("button");
        btn.className = "btn-remove";
        btn.title = isBuiltin ? "内置域名，不可删除" : "删除";
        btn.textContent = "×";
        btn.style.opacity = isBuiltin ? "0.3" : "1";
        btn.disabled = isBuiltin;
        if (!isBuiltin) {
            btn.addEventListener("click", () => {
                _discourseDomainsList.splice(i, 1);
                renderDiscourseDomains(_discourseDomainsList);
            });
        }

        row.appendChild(icon);
        row.appendChild(domainSpan);
        row.appendChild(typeTag);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

async function detectSiteType(domain, tagElement) {
    const lowerDomain = domain.toLowerCase();

    // 已知平台快速匹配
    const knownPlatforms = {
        "linux.do": "Discourse (LinuxDo)",
        "meta.discourse.org": "Discourse (Official)",
        "x.com": "Twitter/X",
        "twitter.com": "Twitter/X",
        "mp.weixin.qq.com": "微信公众号",
    };

    // 飞书匹配
    if (lowerDomain.endsWith(".feishu.cn")) {
        tagElement.textContent = "飞书知识库";
        tagElement.style.color = "var(--success)";
        return;
    }

    if (knownPlatforms[lowerDomain]) {
        tagElement.textContent = knownPlatforms[lowerDomain];
        tagElement.style.color = "var(--success)";
        return;
    }

    // 尝试检测 Discourse 实例（通过 /site.json API）
    try {
        const resp = await fetch(`https://${domain}/site.json`, {
            signal: AbortSignal.timeout(5000),
            headers: { "Accept": "application/json" },
        });
        if (resp.ok) {
            const data = await resp.json();
            const siteName = data.title || data.description || domain;
            tagElement.textContent = `Discourse (${siteName})`;
            tagElement.style.color = "var(--success)";
            return;
        }
    } catch { /* 网络错误或非 Discourse */ }

    // 检测失败，显示为未知类型
    tagElement.textContent = "Discourse (未验证)";
    tagElement.style.color = "var(--text-muted)";
}

function addDiscourseDomain() {
    const input = document.getElementById("newDiscourseDomain");
    let domain = input.value.trim().toLowerCase();
    if (!domain) return;

    // 清理输入：去掉协议前缀和尾部斜杠
    domain = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");

    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
        showToast("请输入有效的域名格式，如 forum.example.com", true);
        return;
    }

    if (_discourseDomainsList.includes(domain)) {
        showToast("该域名已存在", true);
        return;
    }

    _discourseDomainsList.push(domain);
    renderDiscourseDomains(_discourseDomainsList);
    input.value = "";
}

function collectDiscourseDomains() {
    return [..._discourseDomainsList];
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
        "{summary}_{date}_{author}";
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

    // 覆盖策略
    const overwriteExisting = document.getElementById("overwriteExisting").checked;

    // 评论/回复设置
    const enableComments = document.getElementById("enableComments").checked;
    const commentsDisplay = document.getElementById("commentsDisplay").value || "details";
    const maxComments = parseInt(document.getElementById("maxComments").value) || 200;
    const commentFloorRange = document.getElementById("commentFloorRange").value.trim();

    // Discourse 域名列表
    const discourseDomains = collectDiscourseDomains();

    // 嵌入模式
    const embedMode = document.getElementById("embedMode").value || "local";

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
        overwrite_existing: overwriteExisting,
        enable_comments: enableComments,
        comments_display: commentsDisplay,
        max_comments: maxComments,
        comment_floor_range: commentFloorRange,
        discourse_domains: discourseDomains,
        embed_mode: embedMode,
    };

    document.getElementById("portLabel").textContent = port;

    chrome.runtime.sendMessage({ action: "update_config", config: newConfig }, (resp) => {
        if (chrome.runtime.lastError) {
            showToast("扩展通信失败，请刷新页面重试", true);
            return;
        }
        if (resp && resp.success) {
            currentConfig = newConfig;
            updateSyncStatus(syncEnabled);
            showToast("设置已保存");
        } else {
            showToast("保存失败，服务是否在线？", true);
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
