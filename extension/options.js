// options.js - Chrome 扩展设置页，保持与桌面 App 设置页一致的交互模型

const DEFAULT_FILENAME_FORMAT = "{summary}";
const DEFAULT_FILENAME_LENGTH = 100;
const PANEL_META = {
    save: { label: "保存位置", title: "内容保存到哪里", description: "选择一个主目录。额外保存位置只在需要分类时再打开。" },
    media: { label: "视频", title: "视频如何保存", description: "控制视频下载、保存目录和长视频提醒。" },
    capture: { label: "网页按钮", title: "网页上显示哪些入口", description: "控制保存按钮、博主抓取按钮和抓取范围。" },
    system: { label: "启动与工具", title: "本地服务和启动方式", description: "设置登录后自动启动和检查本地服务。" },
};
const FILENAME_PRESETS = [
    { value: "{summary}", label: "标题" },
    { value: "{summary}_{date}", label: "标题 + 日期" },
    { value: "{author}_{summary}", label: "作者 + 标题" },
    { value: "{summary}_{date}_{author}", label: "标题 + 日期 + 作者" },
];

let currentConfig = {};
const $ = (id) => document.getElementById(id);

function sendMessage(message) {
    return new Promise((resolve) => chrome.runtime.sendMessage(message, (resp) => resolve(resp || {})));
}

function apiBase() {
    return "http://127.0.0.1:9527";
}

async function localFetch(path, init = {}) {
    const stored = await chrome.storage.local.get("x2md_api_token");
    return fetch(`${apiBase()}${path}`, {
        ...init,
        headers: { ...init.headers, ...(stored.x2md_api_token ? { Authorization: `Bearer ${stored.x2md_api_token}` } : {}) },
    });
}

function showToast(message, isError = false) {
    const toast = $("toast");
    toast.textContent = message;
    toast.className = isError ? "show error" : "show";
    setTimeout(() => { toast.className = ""; }, 2400);
}

function setStatus(text, sub = "", online = false) {
    const status = $("statusText");
    status.textContent = text;
    status.classList.toggle("is-online", online);
    $("statusSub").textContent = sub || "正在连接 localhost:9527";
}

function showPanel(panel) {
    const meta = PANEL_META[panel] || PANEL_META.save;
    $("panelLabel").textContent = meta.label;
    $("panelTitle").textContent = meta.title;
    $("panelDescription").textContent = meta.description;
    document.querySelectorAll("[data-panel-button]").forEach((button) => {
        const active = button.dataset.panelButton === panel;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll("[data-panel-section]").forEach((section) => {
        section.hidden = section.dataset.panelSection !== panel;
    });
    localStorage.setItem("x2md-extension-settings-panel", panel);
}

function safePanel() {
    const value = localStorage.getItem("x2md-extension-settings-panel") || "save";
    return PANEL_META[value] ? value : "save";
}

function formatPreview(format) {
    const now = new Date("2026-06-25T10:20:00");
    return String(format || DEFAULT_FILENAME_FORMAT)
        .replaceAll("{summary}", "一篇中文长标题")
        .replaceAll("{date}", now.toISOString().slice(0, 10))
        .replaceAll("{author}", "作者")
        .replaceAll("{handle}", "handle")
        .replaceAll("{timestamp}", "102000");
}

function ensureCustomFormatChip(format) {
    const picker = $("filenameFormatChips");
    const existing = $("filenameFormatCustom");
    if (FILENAME_PRESETS.some((preset) => preset.value === format)) {
        existing?.remove();
        return;
    }
    const custom = existing || document.createElement("button");
    custom.id = "filenameFormatCustom";
    custom.className = "format-chip";
    custom.type = "button";
    custom.textContent = "沿用当前";
    custom.dataset.filenameFormat = format;
    if (!existing) {
        custom.addEventListener("click", () => setFilenameFormat(custom.dataset.filenameFormat || DEFAULT_FILENAME_FORMAT));
        picker.append(custom);
    }
}

function setFilenameFormat(format) {
    const next = format || DEFAULT_FILENAME_FORMAT;
    $("filenameFormat").value = next;
    ensureCustomFormatChip(next);
    document.querySelectorAll("[data-filename-format]").forEach((button) => {
        const active = button.dataset.filenameFormat === next;
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", active ? "true" : "false");
    });
    $("filenameFormatPreview").textContent = `示例：${formatPreview(next)}`;
}

async function chooseFolder(currentPath = "") {
    const response = await localFetch("/choose-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPath }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "文件夹选择失败");
    return String(result.path || "").trim();
}

async function chooseFolderForInput(input, label, fallbackPath = "") {
    setStatus("正在打开文件夹选择器…", `通过 localhost:9527 调用本机 App`, true);
    try {
        const selected = await chooseFolder(input.value.trim() || fallbackPath);
        if (!selected) {
            setStatus("已取消选择", `localhost:9527`, true);
            return;
        }
        input.value = selected;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        setStatus(`已选择${label}`, selected, true);
    } catch (error) {
        setStatus(error instanceof Error ? error.message : String(error), "请确认 X2MD App 正在运行", false);
        showToast("无法打开文件夹选择器", true);
    }
}

function updateCustomSummary(paths = collectCustomPaths(false)) {
    $("customSaveSummary").textContent = paths.length ? `已添加 ${paths.length} 个额外位置。` : "没有额外位置。大多数用户不用设置。";
}

function emptyState(text) {
    const node = document.createElement("div");
    node.className = "empty-state";
    node.textContent = text;
    return node;
}

function renderPrimaryPath(path = "") {
    $("primarySavePath").value = path;
}

function normalizeCustomPathEntry(entry = {}) {
    return { name: String(entry.name || "").trim(), path: String(entry.path || "").trim() };
}

function addCustomPathRow(item = {}) {
    const list = $("customPathList");
    list.querySelector(".empty-state")?.remove();
    const row = document.createElement("div");
    row.className = "path-row custom-path-row";
    row.dataset.customRow = "true";

    const nameLabel = document.createElement("label");
    nameLabel.className = "field";
    const nameTitle = document.createElement("span");
    nameTitle.textContent = "名称";
    const nameInput = document.createElement("input");
    nameInput.placeholder = "例如：生图";
    nameInput.value = item.name || "";
    nameInput.dataset.field = "name";
    nameLabel.append(nameTitle, nameInput);

    const pathLabel = document.createElement("label");
    pathLabel.className = "field";
    const pathTitle = document.createElement("span");
    pathTitle.textContent = "保存到";
    const pathInput = document.createElement("input");
    pathInput.placeholder = "还未选择文件夹";
    pathInput.value = item.path || "";
    pathInput.readOnly = true;
    pathInput.dataset.field = "path";
    pathLabel.append(pathTitle, pathInput);

    const actions = document.createElement("div");
    actions.className = "custom-path-actions";
    const choose = document.createElement("button");
    choose.className = "soft";
    choose.type = "button";
    choose.textContent = "选择文件夹";
    const useMain = document.createElement("button");
    useMain.className = "soft";
    useMain.type = "button";
    useMain.textContent = "用主目录";
    const remove = document.createElement("button");
    remove.className = "danger btn-remove";
    remove.type = "button";
    remove.textContent = "删除";
    actions.append(choose, useMain, remove);

    const sync = () => updateCustomSummary(collectCustomPaths(false));
    nameInput.addEventListener("input", sync);
    pathInput.addEventListener("input", sync);
    choose.addEventListener("click", () => chooseFolderForInput(pathInput, "额外保存位置", $("primarySavePath").value.trim()));
    useMain.addEventListener("click", () => { pathInput.value = $("primarySavePath").value.trim(); sync(); });
    remove.addEventListener("click", () => { row.remove(); if (!list.querySelector("[data-custom-row]")) list.append(emptyState("还没有额外保存位置。需要分类保存时，点击“新增位置”。")); sync(); });

    row.append(nameLabel, pathLabel, actions);
    list.append(row);
    sync();
}

function renderCustomPaths(paths = []) {
    const list = $("customPathList");
    list.innerHTML = "";
    const normalized = paths.map(normalizeCustomPathEntry).filter((entry) => entry.name || entry.path);
    if (!normalized.length) list.append(emptyState("还没有额外保存位置。需要分类保存时，点击“新增位置”。"));
    normalized.forEach((entry) => addCustomPathRow(entry));
    updateCustomSummary(normalized.filter((entry) => entry.name && entry.path));
}

function collectCustomPaths(keepIncomplete = false) {
    return [...document.querySelectorAll("#customPathList [data-custom-row]")]
        .map((row) => ({
            name: row.querySelector('[data-field="name"]')?.value.trim() || "",
            path: row.querySelector('[data-field="path"]')?.value.trim() || "",
        }))
        .filter((entry) => keepIncomplete ? (entry.name || entry.path) : (entry.name && entry.path));
}

function applyConfigToUI(cfg) {
    currentConfig = cfg || {};
    renderPrimaryPath(Array.isArray(cfg.save_paths) ? (cfg.save_paths[0] || "") : "");
    setFilenameFormat(cfg.filename_format || DEFAULT_FILENAME_FORMAT);
    $("maxLen").value = cfg.max_filename_length || DEFAULT_FILENAME_LENGTH;
    $("enableVideoDownload").checked = cfg.enable_video_download !== false;
    $("videoSavePath").value = cfg.video_save_path || "";
    $("videoDurationThreshold").value = cfg.video_duration_threshold || 5;
    $("showSiteSaveIcon").checked = cfg.show_site_save_icon !== false;
    $("showXProfileCaptureButton").checked = cfg.show_x_profile_capture_button !== false;
    $("profileCaptureRange").value = cfg.profile_capture_range || "today";
    $("profileCaptureDays").value = cfg.profile_capture_custom_days || 7;
    $("profileCaptureSavePath").value = cfg.profile_capture_save_path || "";
    renderCustomPaths(Array.isArray(cfg.custom_save_paths) ? cfg.custom_save_paths : []);
}

async function loadConfig() {
    const resp = await sendMessage({ action: "get_config" });
    if (resp && resp.success && resp.config) {
        applyConfigToUI(resp.config);
    } else {
        showToast("无法读取配置，请确认服务已启动", true);
    }
}

async function loadAutostart() {
    try {
        const response = await localFetch("/autostart");
        const result = await response.json();
        $("enableAutostart").checked = Boolean(result.enabled);
        $("autostartHint").textContent = result.enabled ? "已开启，登录 macOS 后会自动启动。" : "未开启，可在这里直接打开。";
    } catch {
        $("autostartHint").textContent = "需要 X2MD App 运行后才能读取。";
    }
}

async function saveAutostart() {
    try {
        const response = await localFetch("/autostart", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ enabled: $("enableAutostart").checked }),
        });
        const result = await response.json().catch(() => ({}));
        $("enableAutostart").checked = Boolean(result.enabled);
        $("autostartHint").textContent = result.enabled ? "已开启，登录 macOS 后会自动启动。" : "未开启，可在这里直接打开。";
        showToast(response.ok ? "启动设置已更新" : "启动设置失败", !response.ok);
    } catch {
        showToast("启动设置失败，请确认 App 正在运行", true);
    }
}

async function checkStatus() {
    const resp = await sendMessage({ action: "ping" });
    const online = Boolean(resp.online);
    setStatus(online ? "已连接，保存功能可用" : "服务未启动", online ? `本机服务正常，端口 9527` : "正在连接 localhost:9527", online);
}

async function saveConfig() {
    const rawCustom = collectCustomPaths(true);
    const invalid = rawCustom.find((entry) => (entry.name && !entry.path) || (!entry.name && entry.path));
    if (invalid) {
        showToast("额外保存位置需要同时填写名称和路径", true);
        return;
    }
    const savePath = $("primarySavePath").value.trim();
    if (!savePath) {
        showToast("请先选择主要保存位置", true);
        showPanel("save");
        return;
    }
    const config = {
        save_paths: [savePath],
        custom_save_paths: collectCustomPaths(false),
        filename_format: $("filenameFormat").value.trim() || DEFAULT_FILENAME_FORMAT,
        max_filename_length: Number($("maxLen").value || DEFAULT_FILENAME_LENGTH),
        enable_video_download: $("enableVideoDownload").checked,
        video_save_path: $("videoSavePath").value.trim(),
        video_duration_threshold: Number($("videoDurationThreshold").value || 5),
        show_site_save_icon: $("showSiteSaveIcon").checked,
        show_x_profile_capture_button: $("showXProfileCaptureButton").checked,
        profile_capture_range: $("profileCaptureRange").value,
        profile_capture_custom_days: Number($("profileCaptureDays").value || 7),
        profile_capture_save_path: $("profileCaptureSavePath").value.trim(),
        setup_completed: true,
    };
    const resp = await sendMessage({ action: "update_config", config });
    showToast(resp.success ? "设置已保存" : "保存失败，服务是否在线？", !resp.success);
    if (resp.config) applyConfigToUI(resp.config);
    checkStatus();
}

async function pairExtension() {
    const code = $("pairingCode").value.trim();
    const resp = await sendMessage({ action: "pair", code });
    showToast(resp.success ? "扩展配对成功" : (resp.error || "配对失败"), !resp.success);
    if (resp.success) await loadConfig();
}

document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-panel-button]").forEach((button) => button.addEventListener("click", () => showPanel(button.dataset.panelButton || "save")));
    document.querySelectorAll("[data-filename-format]").forEach((button) => button.addEventListener("click", () => setFilenameFormat(button.dataset.filenameFormat || DEFAULT_FILENAME_FORMAT)));
    $("btnRefresh").addEventListener("click", checkStatus);
    $("btnSave").addEventListener("click", saveConfig);
    $("btnAddCustomPath").addEventListener("click", () => addCustomPathRow());
    $("choosePrimarySavePath").addEventListener("click", () => chooseFolderForInput($("primarySavePath"), "主要保存位置"));
    $("chooseVideoSavePath").addEventListener("click", () => chooseFolderForInput($("videoSavePath"), "视频保存位置", $("primarySavePath").value.trim()));
    $("chooseProfileCaptureSavePath").addEventListener("click", () => chooseFolderForInput($("profileCaptureSavePath"), "博主内容保存位置", $("primarySavePath").value.trim()));
    $("clearProfileCaptureSavePath").addEventListener("click", () => { $("profileCaptureSavePath").value = ""; showToast("博主内容将使用主目录"); });
    $("enableAutostart").addEventListener("change", saveAutostart);
    $("pairExtension").addEventListener("click", pairExtension);
    showPanel(safePanel());
    loadConfig().then(loadAutostart).then(checkStatus).catch(() => setStatus("服务未启动", "正在连接 localhost:9527", false));
});
