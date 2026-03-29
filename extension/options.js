// options.js — X2MD 设置页逻辑（V1.5）
// 全部用 addEventListener，不依赖 inline onclick（规避 CSP）

let currentConfig = {};

// ─── 初始化 ───
document.addEventListener("DOMContentLoaded", () => {
    // 主题：立即应用（避免闪烁）
    applyTheme(localStorage.getItem("x2md_theme") || "light");

    // 绑定按钮事件
    document.getElementById("btnRefresh").addEventListener("click", checkStatus);
    document.getElementById("btnAdd").addEventListener("click", addPath);
    document.getElementById("btnSave").addEventListener("click", saveConfig);

    // 评论开关联动
    document.getElementById("enableComments").addEventListener("change", toggleCommentSub);

    // Discourse 域名
    document.getElementById("btnAddDomain").addEventListener("click", addDiscourseDomain);
    document.getElementById("newDiscourseDomain").addEventListener("keydown", (e) => {
        if (e.key === "Enter") addDiscourseDomain();
    });

    // 主题切换
    document.getElementById("themeSelect").addEventListener("change", (e) => {
        applyTheme(e.target.value);
        localStorage.setItem("x2md_theme", e.target.value);
    });

    // 保存目标 checkbox 联动（显隐配置面板）
    document.getElementById("saveToObsidian").addEventListener("change", updateTargetVisibility);
    document.getElementById("saveToFeishu").addEventListener("change", updateTargetVisibility);
    document.getElementById("saveToNotion").addEventListener("change", updateTargetVisibility);
    document.getElementById("exportHtml").addEventListener("change", updateTargetVisibility);

    // 飞书 / Notion 测试连接
    document.getElementById("testFeishu").addEventListener("click", testFeishuConnection);
    document.getElementById("testNotion").addEventListener("click", testNotionConnection);

    // 重置按钮
    document.getElementById("btnResetAll").addEventListener("click", resetAllConfig);

    // 折叠面板
    setupCollapsible();

    loadConfig();
    checkStatus();
});

// ─── 主题 ───
function applyTheme(theme) {
    const html = document.documentElement;
    html.classList.remove("theme-dark", "theme-system");
    if (theme === "dark") html.classList.add("theme-dark");
    else if (theme === "system") html.classList.add("theme-system");
    // "light" = 默认，不加 class

    const sel = document.getElementById("themeSelect");
    if (sel) sel.value = theme;
}

// 监听系统主题变化（仅 system 模式有效，CSS 自动处理，这里刷新 UI 即可）
window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if ((localStorage.getItem("x2md_theme") || "light") === "system") {
        applyTheme("system");
    }
});

// ─── 折叠面板 ───
function setupCollapsible() {
    document.querySelectorAll(".card-header[data-toggle]").forEach((header) => {
        header.addEventListener("click", () => {
            const targetId = header.getAttribute("data-toggle");
            const body = document.getElementById(targetId);
            if (!body) return;
            const isHidden = body.classList.toggle("hidden");
            header.classList.toggle("collapsed", isHidden);
        });
    });
}

// ─── 保存目标联动 ───
function updateTargetVisibility() {
    const obsidian = document.getElementById("saveToObsidian").checked;
    const feishu = document.getElementById("saveToFeishu").checked;
    const notion = document.getElementById("saveToNotion").checked;
    const html = document.getElementById("exportHtml").checked;

    document.getElementById("obsidianSection").style.display = obsidian ? "" : "none";
    document.getElementById("feishuBitableSection").style.display = feishu ? "" : "none";
    document.getElementById("notionSection").style.display = notion ? "" : "none";
    document.getElementById("htmlExportSection").style.display = html ? "" : "none";
}

// ─── 加载配置 ───
function loadConfig() {
    chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
        if (chrome.runtime.lastError) {
            // 服务不可达时尝试从本地缓存恢复
            loadConfigFromLocal();
            return;
        }
        if (resp && resp.success && resp.config) {
            currentConfig = resp.config;
            applyConfigToUI(resp.config);
            // 同时写入本地缓存（备份）
            saveConfigToLocal(resp.config);
        } else {
            // 服务端无配置时尝试本地缓存
            loadConfigFromLocal();
        }
    });
}

function saveConfigToLocal(cfg) {
    try {
        chrome.storage.local.set({ x2md_config_backup: cfg });
    } catch (_) { /* 静默失败 */ }
}

function loadConfigFromLocal() {
    chrome.storage.local.get("x2md_config_backup", (result) => {
        if (result && result.x2md_config_backup) {
            currentConfig = result.x2md_config_backup;
            applyConfigToUI(result.x2md_config_backup);
            showToast("已从本地缓存恢复设置（服务未连接）");
        } else {
            showToast("无法读取配置，请确认服务已启动", true);
        }
    });
}

function resetAllConfig() {
    if (!confirm("确定要重置所有设置为默认值吗？此操作不可撤销。")) return;
    chrome.storage.local.remove("x2md_config_backup");
    chrome.runtime.sendMessage({ action: "reset_config" }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.success) {
            showToast("已清除本地缓存，刷新页面后将使用默认配置");
        } else {
            showToast("所有设置已恢复为默认值");
        }
        // 刷新页面以加载默认配置
        setTimeout(() => location.reload(), 800);
    });
}

function applyConfigToUI(cfg) {
    // 主题
    const theme = cfg.theme || localStorage.getItem("x2md_theme") || "light";
    applyTheme(theme);

    // 服务设置
    document.getElementById("portInput").value = cfg.port || 9527;
    document.getElementById("portLabel").textContent = cfg.port || 9527;
    document.getElementById("filenameFormat").value = cfg.filename_format || "{summary}_{date}_{author}";
    document.getElementById("maxLen").value = cfg.max_filename_length || 60;

    // 保存目标
    document.getElementById("saveToObsidian").checked = cfg.save_to_obsidian !== false;
    document.getElementById("saveToFeishu").checked = !!cfg.save_to_feishu;
    document.getElementById("saveToNotion").checked = !!cfg.save_to_notion;
    document.getElementById("exportHtml").checked = !!cfg.export_html;

    // 飞书多维表格
    document.getElementById("feishuApiDomain").value = cfg.feishu_api_domain || "feishu";
    document.getElementById("feishuAppId").value = cfg.feishu_app_id || "";
    document.getElementById("feishuAppSecret").value = cfg.feishu_app_secret || "";
    document.getElementById("feishuAppToken").value = cfg.feishu_app_token || "";
    document.getElementById("feishuTableId").value = cfg.feishu_table_id || "";
    document.getElementById("feishuUploadMd").checked = !!cfg.feishu_upload_md;
    document.getElementById("feishuUploadHtml").checked = !!cfg.feishu_upload_html;

    // Notion
    document.getElementById("notionToken").value = cfg.notion_token || "";
    document.getElementById("notionDatabaseId").value = cfg.notion_database_id || "";
    document.getElementById("notionPropTitle").value = cfg.notion_prop_title || "标题";
    document.getElementById("notionPropUrl").value = cfg.notion_prop_url || "链接";
    document.getElementById("notionPropAuthor").value = cfg.notion_prop_author || "作者";
    document.getElementById("notionPropTags").value = cfg.notion_prop_tags || "标签";
    document.getElementById("notionPropSavedDate").value = cfg.notion_prop_saved_date || "保存日期";
    document.getElementById("notionPropType").value = cfg.notion_prop_type || "类型";

    // HTML 导出
    document.getElementById("htmlExportFolder").value = cfg.html_export_folder || "X2MD导出";

    // 媒体设置
    document.getElementById("enableVideoDownload").checked = cfg.enable_video_download !== false;
    document.getElementById("videoSavePath").value = cfg.video_save_path || "";
    document.getElementById("videoDurationThreshold").value = cfg.video_duration_threshold || 5;
    document.getElementById("showSiteSaveIcon").checked = cfg.show_site_save_icon !== false;
    document.getElementById("enableCopyUnlock").checked = !!cfg.enable_copy_unlock;
    document.getElementById("enableWechatVideoChannel").checked = !!cfg.enable_wechat_video_channel;

    // 平台分类文件夹
    document.getElementById("enablePlatformFolders").checked = cfg.enable_platform_folders !== false;
    const folderNames = cfg.platform_folder_names || {};
    document.querySelectorAll(".platform-folder-input").forEach((input) => {
        const platform = input.dataset.platform;
        if (platform && folderNames[platform]) input.value = folderNames[platform];
    });

    // 图片
    document.getElementById("downloadImages").checked = cfg.download_images !== false;
    document.getElementById("imageSubfolder").value = cfg.image_subfolder || "assets";

    // 覆盖策略
    document.getElementById("overwriteExisting").checked = !!cfg.overwrite_existing;

    // 评论
    document.getElementById("enableComments").checked = !!cfg.enable_comments;
    document.getElementById("commentsDisplay").value = cfg.comments_display || "details";
    document.getElementById("maxComments").value = cfg.max_comments || 200;
    document.getElementById("commentFloorRange").value = cfg.comment_floor_range || "";
    toggleCommentSub();

    // Discourse 域名
    renderDiscourseDomains(cfg.discourse_domains || ["linux.do"]);

    // 嵌入模式
    document.getElementById("embedMode").value = cfg.embed_mode || "local";

    // 同步
    document.getElementById("syncEnabled").checked = cfg.sync_enabled !== false;
    updateSyncStatus(cfg.sync_enabled !== false);

    // 路径
    renderPaths(cfg.save_paths || []);

    // 保存目标联动
    updateTargetVisibility();
}

// ─── 评论子控件联动 ───
function toggleCommentSub() {
    const enabled = document.getElementById("enableComments").checked;
    const panel = document.getElementById("commentSubControls");
    panel.classList.toggle("disabled", !enabled);
    document.querySelectorAll(".comment-sub").forEach((el) => {
        el.disabled = !enabled;
    });
}

// ─── 同步状态 ───
function updateSyncStatus(enabled) {
    const el = document.getElementById("syncStatus");
    if (enabled) {
        el.textContent = "同步已开启 — 偏好设置将通过 Chrome 账号同步";
        el.style.color = "var(--success)";
    } else {
        el.textContent = "同步未开启 — 设置仅保存在本机";
        el.style.color = "var(--text-muted)";
    }
}

// ─── Discourse 域名管理 ───
let _discourseDomains = ["linux.do"];

function renderDiscourseDomains(domains) {
    _discourseDomains = domains && domains.length ? [...domains] : ["linux.do"];
    const list = document.getElementById("discourseDomainList");
    list.textContent = "";

    _discourseDomains.forEach((domain, i) => {
        const row = document.createElement("div");
        row.className = "path-row";

        const icon = document.createElement("span");
        icon.textContent = "🌐";
        icon.style.cssText = "font-size:14px; flex-shrink:0;";

        const span = document.createElement("span");
        span.style.cssText = "flex:1; font-size:13px; font-family:monospace;";
        span.textContent = domain;

        const tag = document.createElement("span");
        tag.style.cssText = "font-size:11px; padding:2px 8px; border-radius:4px; background:var(--surface2); border:1px solid var(--border); color:var(--accent);";
        tag.textContent = "检测中…";
        detectSiteType(domain, tag);

        const isBuiltin = domain === "linux.do";
        const btn = document.createElement("button");
        btn.className = "btn-remove";
        btn.textContent = "×";
        btn.style.opacity = isBuiltin ? "0.3" : "1";
        btn.disabled = isBuiltin;
        if (!isBuiltin) {
            btn.addEventListener("click", () => {
                _discourseDomains.splice(i, 1);
                renderDiscourseDomains(_discourseDomains);
            });
        }

        row.appendChild(icon);
        row.appendChild(span);
        row.appendChild(tag);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

async function detectSiteType(domain, tagEl) {
    const known = {
        "linux.do": "Discourse (LinuxDo)",
        "meta.discourse.org": "Discourse (Official)",
    };
    if (domain.endsWith(".feishu.cn")) { tagEl.textContent = "飞书"; tagEl.style.color = "var(--success)"; return; }
    if (known[domain.toLowerCase()]) { tagEl.textContent = known[domain.toLowerCase()]; tagEl.style.color = "var(--success)"; return; }
    try {
        const resp = await fetch(`https://${domain}/site.json`, { signal: AbortSignal.timeout(5000), headers: { Accept: "application/json" } });
        if (resp.ok) {
            const data = await resp.json();
            tagEl.textContent = `Discourse (${data.title || domain})`;
            tagEl.style.color = "var(--success)";
            return;
        }
    } catch {}
    tagEl.textContent = "Discourse (未验证)";
    tagEl.style.color = "var(--text-muted)";
}

function addDiscourseDomain() {
    const input = document.getElementById("newDiscourseDomain");
    let domain = input.value.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
        showToast("请输入有效域名", true); return;
    }
    // 安全校验：禁止内网地址
    if (/^(localhost|127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(domain)) {
        showToast("不允许使用内网地址", true); return;
    }
    if (_discourseDomains.includes(domain)) { showToast("该域名已存在", true); return; }
    _discourseDomains.push(domain);
    renderDiscourseDomains(_discourseDomains);
    input.value = "";
}

// ─── 路径列表 ───
function renderPaths(paths) {
    const list = document.getElementById("pathList");
    list.textContent = "";
    paths.forEach((p, i) => {
        const row = document.createElement("div");
        row.className = "path-row";

        const icon = document.createElement("span");
        icon.textContent = "📂";
        icon.style.cssText = "font-size:14px; flex-shrink:0;";

        const input = document.createElement("input");
        input.type = "text";
        input.value = p;
        input.placeholder = "/path/to/obsidian/vault";

        const btn = document.createElement("button");
        btn.className = "btn-remove";
        btn.textContent = "×";
        btn.addEventListener("click", () => {
            const all = collectPaths();
            all.splice(i, 1);
            renderPaths(all);
        });

        row.appendChild(icon);
        row.appendChild(input);
        row.appendChild(btn);
        list.appendChild(row);
    });
}

function collectPaths() {
    return [...document.querySelectorAll("#pathList input")].map(i => i.value.trim()).filter(Boolean);
}

function addPath() {
    const paths = collectPaths();
    paths.push("");
    renderPaths(paths);
    const inputs = document.querySelectorAll("#pathList input");
    if (inputs.length) inputs[inputs.length - 1].focus();
}

// ─── 服务状态 ───
function checkStatus() {
    const dot = document.getElementById("statusDot");
    const txt = document.getElementById("statusText");
    dot.className = "status-dot offline";
    txt.textContent = "检测中…";
    chrome.runtime.sendMessage({ action: "ping" }, (resp) => {
        if (chrome.runtime.lastError) return;
        const online = resp && resp.online;
        dot.className = "status-dot " + (online ? "online" : "offline");
        txt.textContent = online ? "本地服务运行中" : "服务未启动，请运行 start_server.sh";
    });
}

// ─── 飞书测试连接 ───
function testFeishuConnection() {
    const statusEl = document.getElementById("feishuStatus");
    statusEl.className = "status-msg";
    statusEl.style.display = "none";

    const appId = document.getElementById("feishuAppId").value.trim();
    const appSecret = document.getElementById("feishuAppSecret").value.trim();
    const apiDomain = document.getElementById("feishuApiDomain").value;
    const appToken = document.getElementById("feishuAppToken").value.trim();
    const tableId = document.getElementById("feishuTableId").value.trim();

    if (!appId || !appSecret) {
        statusEl.className = "status-msg error";
        statusEl.textContent = "请填写 App ID 和 App Secret";
        return;
    }

    statusEl.className = "status-msg";
    statusEl.style.display = "block";
    statusEl.textContent = "正在测试...";
    statusEl.style.color = "var(--text-muted)";

    chrome.runtime.sendMessage({
        action: "test_feishu",
        data: {
            feishu_app_id: appId,
            feishu_app_secret: appSecret,
            feishu_api_domain: apiDomain,
            feishu_app_token: appToken,
            feishu_table_id: tableId,
        }
    }, (resp) => {
        if (resp && resp.success) {
            statusEl.className = "status-msg success";
            let msg = `连接成功！检测到 ${resp.fieldCount || 0} 个字段`;
            if (resp.missingFields && resp.missingFields.length > 0) {
                msg += `\n⚠️ 缺少字段：${resp.missingFields.join("、")}`;
                statusEl.className = "status-msg warning";
            }
            statusEl.textContent = msg;
        } else {
            statusEl.className = "status-msg error";
            statusEl.textContent = "连接失败：" + (resp?.error || "未知错误");
        }
    });
}

// ─── Notion 测试连接 ───
function testNotionConnection() {
    const statusEl = document.getElementById("notionStatus");
    statusEl.className = "status-msg";
    statusEl.style.display = "none";

    const token = document.getElementById("notionToken").value.trim();
    const dbId = document.getElementById("notionDatabaseId").value.trim();

    if (!token || !dbId) {
        statusEl.className = "status-msg error";
        statusEl.textContent = "请填写 Token 和 Database ID";
        return;
    }

    statusEl.className = "status-msg";
    statusEl.style.display = "block";
    statusEl.textContent = "正在测试...";
    statusEl.style.color = "var(--text-muted)";

    chrome.runtime.sendMessage({
        action: "test_notion",
        data: { notion_token: token, notion_database_id: dbId }
    }, (resp) => {
        if (resp && resp.success) {
            let msg = `连接成功！数据库: ${resp.databaseTitle || dbId}（${resp.propertyCount || 0} 个属性）`;
            if (resp.missingProperties && resp.missingProperties.length > 0) {
                msg += `\n⚠️ 缺少属性：${resp.missingProperties.join("、")}`;
                statusEl.className = "status-msg warning";
            } else {
                statusEl.className = "status-msg success";
            }
            statusEl.textContent = msg;
        } else {
            statusEl.className = "status-msg error";
            statusEl.textContent = "连接失败：" + (resp?.error || "未知错误");
        }
    });
}

// ─── 保存配置 ───
function saveConfig() {
    const savePaths = collectPaths();
    const saveToObsidian = document.getElementById("saveToObsidian").checked;

    if (saveToObsidian && !savePaths.length) {
        showToast("Obsidian 模式下请至少添加一个保存路径", true);
        return;
    }

    // 飞书验证
    const saveToFeishu = document.getElementById("saveToFeishu").checked;
    if (saveToFeishu) {
        const appId = document.getElementById("feishuAppId").value.trim();
        const appSecret = document.getElementById("feishuAppSecret").value.trim();
        const appToken = document.getElementById("feishuAppToken").value.trim();
        const tableId = document.getElementById("feishuTableId").value.trim();
        if (!appId || !appSecret || !appToken || !tableId) {
            showToast("飞书多维表格的 App ID、App Secret、app_token、table_id 均为必填", true);
            return;
        }
    }

    // Notion 验证
    const saveToNotion = document.getElementById("saveToNotion").checked;
    if (saveToNotion) {
        const token = document.getElementById("notionToken").value.trim();
        const dbId = document.getElementById("notionDatabaseId").value.trim();
        if (!token || !dbId) {
            showToast("Notion 的 Token 和 Database ID 为必填", true);
            return;
        }
    }

    // 平台分类文件夹
    const platformFolderNames = {};
    document.querySelectorAll(".platform-folder-input").forEach((input) => {
        const platform = input.dataset.platform;
        if (platform) platformFolderNames[platform] = input.value.trim() || platform;
    });

    const port = parseInt(document.getElementById("portInput").value) || 9527;
    const syncEnabled = document.getElementById("syncEnabled").checked;

    const newConfig = {
        // 主题
        theme: document.getElementById("themeSelect").value,
        // 保存目标
        save_to_obsidian: saveToObsidian,
        save_to_feishu: saveToFeishu,
        save_to_notion: saveToNotion,
        export_html: document.getElementById("exportHtml").checked,
        // 服务
        port,
        filename_format: document.getElementById("filenameFormat").value.trim() || "{summary}_{date}_{author}",
        max_filename_length: parseInt(document.getElementById("maxLen").value) || 60,
        save_paths: savePaths,
        // 飞书
        feishu_api_domain: document.getElementById("feishuApiDomain").value,
        feishu_app_id: document.getElementById("feishuAppId").value.trim(),
        feishu_app_secret: document.getElementById("feishuAppSecret").value.trim(),
        feishu_app_token: document.getElementById("feishuAppToken").value.trim(),
        feishu_table_id: document.getElementById("feishuTableId").value.trim(),
        feishu_upload_md: document.getElementById("feishuUploadMd").checked,
        feishu_upload_html: document.getElementById("feishuUploadHtml").checked,
        // Notion
        notion_token: document.getElementById("notionToken").value.trim(),
        notion_database_id: document.getElementById("notionDatabaseId").value.trim(),
        notion_prop_title: document.getElementById("notionPropTitle").value.trim() || "标题",
        notion_prop_url: document.getElementById("notionPropUrl").value.trim() || "链接",
        notion_prop_author: document.getElementById("notionPropAuthor").value.trim() || "作者",
        notion_prop_tags: document.getElementById("notionPropTags").value.trim() || "标签",
        notion_prop_saved_date: document.getElementById("notionPropSavedDate").value.trim() || "保存日期",
        notion_prop_type: document.getElementById("notionPropType").value.trim() || "类型",
        // HTML
        html_export_folder: document.getElementById("htmlExportFolder").value.trim() || "X2MD导出",
        // 媒体
        enable_video_download: document.getElementById("enableVideoDownload").checked,
        video_save_path: document.getElementById("videoSavePath").value.trim(),
        video_duration_threshold: parseFloat(document.getElementById("videoDurationThreshold").value) || 5,
        show_site_save_icon: document.getElementById("showSiteSaveIcon").checked,
        enable_copy_unlock: document.getElementById("enableCopyUnlock").checked,
        enable_wechat_video_channel: document.getElementById("enableWechatVideoChannel").checked,
        sync_enabled: syncEnabled,
        // 平台
        enable_platform_folders: document.getElementById("enablePlatformFolders").checked,
        platform_folder_names: platformFolderNames,
        // 图片
        download_images: document.getElementById("downloadImages").checked,
        image_subfolder: document.getElementById("imageSubfolder").value.trim() || "assets",
        // 覆盖
        overwrite_existing: document.getElementById("overwriteExisting").checked,
        // 评论
        enable_comments: document.getElementById("enableComments").checked,
        comments_display: document.getElementById("commentsDisplay").value || "details",
        max_comments: parseInt(document.getElementById("maxComments").value) || 200,
        comment_floor_range: document.getElementById("commentFloorRange").value.trim(),
        // Discourse
        discourse_domains: [..._discourseDomains],
        // 嵌入
        embed_mode: document.getElementById("embedMode").value || "local",
    };

    document.getElementById("portLabel").textContent = port;

    chrome.runtime.sendMessage({ action: "update_config", config: newConfig }, (resp) => {
        if (chrome.runtime.lastError) {
            showToast("扩展通信失败，请刷新页面重试", true);
            return;
        }
        if (resp && resp.success) {
            currentConfig = newConfig;
            saveConfigToLocal(newConfig);
            updateSyncStatus(syncEnabled);
            showToast("设置已保存");
        } else {
            // 即使服务不在线，也保存到本地
            saveConfigToLocal(newConfig);
            showToast("服务未连接，设置已保存到本地缓存", true);
        }
    });
}

// ─── Toast ───
function showToast(msg, isError = false) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.className = "show" + (isError ? " error" : "");
    clearTimeout(t.__timer);
    t.__timer = setTimeout(() => { t.className = ""; }, 3000);
}
