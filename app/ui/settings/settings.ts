const api = `${location.protocol === "http:" ? location.origin : "http://127.0.0.1:9527"}`;
const session = String((globalThis as typeof globalThis & { X2MD_SESSION?: string }).X2MD_SESSION || "");
const apiFetch = (input: string, init: RequestInit = {}) => fetch(input, {
  ...init,
  headers: { ...init.headers, Authorization: `Bearer ${session}` },
});
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const field = (id: string) => $(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const pairingCode = String((globalThis as typeof globalThis & { X2MD_PAIRING_CODE?: string }).X2MD_PAIRING_CODE || "");

type PanelKey = "save" | "media" | "capture" | "system";

type PanelMeta = {
  label: string;
  title: string;
  description: string;
};

type CustomSavePath = {
  name: string;
  path: string;
};

type FilenamePreset = {
  label: string;
  value: string;
};

const DEFAULT_FILENAME_FORMAT = "{summary}";
const DEFAULT_FILENAME_LENGTH = 100;
const FILENAME_PRESETS: FilenamePreset[] = [
  { label: "标题", value: "{summary}" },
  { label: "标题 + 日期", value: "{summary}_{date}" },
  { label: "作者 + 标题", value: "{author}_{summary}" },
  { label: "标题 + 日期 + 作者", value: "{summary}_{date}_{author}" },
];

const PANEL_META: Record<PanelKey, PanelMeta> = {
  save: {
    label: "保存位置",
    title: "内容保存到哪里",
    description: "选择一个主目录。其他保存位置只在你需要分类时再打开。",
  },
  media: {
    label: "视频",
    title: "视频怎么处理",
    description: "决定是否下载视频，以及视频文件保存到哪里。",
  },
  capture: {
    label: "网页按钮",
    title: "网页上显示哪些按钮",
    description: "控制保存按钮和博主抓取按钮，默认保持开启即可。",
  },
  system: {
    label: "启动与工具",
    title: "启动方式和帮助工具",
    description: "设置登录后自动启动。日志和端口属于排查问题时使用的工具。",
  },
};

const ACTIVE_PANEL_KEY = "x2md-settings-active-panel";
const panelButtons = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-panel-button]"));
const panelSections = Array.from(document.querySelectorAll<HTMLElement>("[data-panel-section]"));
const panelLabel = document.getElementById("panelLabel");
const panelTitle = document.getElementById("panelTitle");
const panelDescription = document.getElementById("panelDescription");

function setStatus(text: string): void {
  const status = document.getElementById("status");
  if (status) status.textContent = text;
}

function setServiceInfo(info: Record<string, any>): void {
  const node = document.getElementById("serviceInfo");
  if (!node) return;
  node.textContent = info.version
    ? `本机服务正常，版本 ${info.version}，端口 ${info.port}`
    : "";
}

function formatPreview(format: string): string {
  const preview = (format || DEFAULT_FILENAME_FORMAT)
    .replaceAll("{summary}", "一篇中文长标题")
    .replaceAll("{date}", "2026-06-25")
    .replaceAll("{author}", "作者")
    .replace(/_+/g, " · ")
    .replace(/^ · | · $/g, "");
  return /[{}]/.test(preview) ? "沿用当前命名方式" : preview;
}

function ensureCustomFormatChip(format: string): HTMLButtonElement | null {
  const picker = document.getElementById("filenameFormatChips");
  if (!picker) return null;
  const existing = document.getElementById("filenameFormatCustom") as HTMLButtonElement | null;
  if (FILENAME_PRESETS.some((preset) => preset.value === format)) {
    existing?.remove();
    return null;
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
  return custom;
}

function setFilenameFormat(format: string): void {
  const next = format || DEFAULT_FILENAME_FORMAT;
  $("filenameFormat").value = next;
  ensureCustomFormatChip(next);
  document.querySelectorAll<HTMLButtonElement>("[data-filename-format]").forEach((button) => {
    const active = button.dataset.filenameFormat === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });
  const preview = document.getElementById("filenameFormatPreview");
  if (preview) preview.textContent = `示例：${formatPreview(next)}`;
}

async function chooseFolder(currentPath: string): Promise<string> {
  const response = await apiFetch(`${api}/choose-folder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPath }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "文件夹选择失败");
  return String(result.path || "").trim();
}

async function chooseFolderForInput(input: HTMLInputElement, label: string, fallbackPath = ""): Promise<void> {
  setStatus("正在打开文件夹选择器…");
  try {
    const selected = await chooseFolder(input.value.trim() || fallbackPath);
    if (!selected) {
      setStatus("已取消选择");
      return;
    }
    input.value = selected;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    setStatus(`已选择${label}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

function customSavePathsField(): HTMLTextAreaElement {
  return field("customSavePaths") as HTMLTextAreaElement;
}

function updateCustomSaveSummary(paths?: CustomSavePath[]): void {
  const node = document.getElementById("customSaveSummary");
  if (!node) return;
  const list = paths || collectCustomSavePaths(false);
  node.textContent = list.length > 0
    ? `已添加 ${list.length} 个额外位置。`
    : "没有额外位置。大多数用户不用设置。";
}

function parseCustomSavePaths(): CustomSavePath[] {
  const raw = customSavePathsField().value.trim();
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) throw new Error("额外保存位置格式不正确");
  return parsed
    .map((item) => ({ name: String(item?.name || "").trim(), path: String(item?.path || "").trim() }))
    .filter((item) => item.name && item.path);
}

function setCustomSavePaths(paths: CustomSavePath[]): void {
  customSavePathsField().value = JSON.stringify(paths, null, 2);
  updateCustomSaveSummary(paths);
}

function customPathList(): HTMLElement | null {
  return document.getElementById("customSavePathList");
}

function createEmptyCustomPathState(): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "custom-path-empty";
  empty.textContent = "还没有额外保存位置。需要分类保存时，点击“新增位置”。";
  return empty;
}

function addCustomPathRow(item: Partial<CustomSavePath> = {}): void {
  const list = customPathList();
  if (!list) return;
  list.querySelector(".custom-path-empty")?.remove();

  const row = document.createElement("div");
  row.className = "custom-path-row";
  row.dataset.customSaveRow = "true";

  const nameLabel = document.createElement("label");
  nameLabel.className = "field custom-path-name";
  const nameTitle = document.createElement("span");
  nameTitle.textContent = "名称";
  const nameInput = document.createElement("input");
  nameInput.placeholder = "例如：生图";
  nameInput.value = item.name || "";
  nameInput.dataset.customSaveName = "true";
  nameLabel.append(nameTitle, nameInput);

  const pathLabel = document.createElement("label");
  pathLabel.className = "field custom-path-target";
  const pathTitle = document.createElement("span");
  pathTitle.textContent = "保存到";
  const pathInput = document.createElement("input");
  pathInput.placeholder = "还未选择文件夹";
  pathInput.value = item.path || "";
  pathInput.readOnly = true;
  pathInput.dataset.customSavePath = "true";
  pathLabel.append(pathTitle, pathInput);

  const choosePath = document.createElement("button");
  choosePath.className = "soft custom-path-choose";
  choosePath.type = "button";
  choosePath.textContent = "选择文件夹";

  const useMainPath = document.createElement("button");
  useMainPath.className = "soft custom-path-use-main";
  useMainPath.type = "button";
  useMainPath.textContent = "用主目录";

  const remove = document.createElement("button");
  remove.className = "soft subtle-danger custom-path-remove";
  remove.type = "button";
  remove.textContent = "删除";

  const sync = () => syncCustomSavePaths(false);
  nameInput.addEventListener("input", sync);
  pathInput.addEventListener("input", sync);
  choosePath.addEventListener("click", () => void chooseFolderForInput(pathInput, "额外保存位置", $("savePath").value.trim()));
  useMainPath.addEventListener("click", () => {
    pathInput.value = $("savePath").value.trim();
    sync();
    setStatus("已填入主要保存位置");
  });
  remove.addEventListener("click", () => {
    row.remove();
    if (list.querySelectorAll("[data-custom-save-row]").length === 0) {
      list.append(createEmptyCustomPathState());
    }
    syncCustomSavePaths(false);
  });

  const actions = document.createElement("div");
  actions.className = "custom-path-actions";
  actions.append(choosePath, useMainPath, remove);

  row.append(nameLabel, pathLabel, actions);
  list.append(row);
  syncCustomSavePaths(false);
}

function collectCustomSavePaths(strict: boolean): CustomSavePath[] {
  const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-custom-save-row]"));
  const paths: CustomSavePath[] = [];
  for (const row of rows) {
    const name = (row.querySelector<HTMLInputElement>("[data-custom-save-name]")?.value || "").trim();
    const path = (row.querySelector<HTMLInputElement>("[data-custom-save-path]")?.value || "").trim();
    if (!name && !path) continue;
    if (strict && (!name || !path)) throw new Error("额外保存位置需要同时填写名称和目录");
    if (name && path) paths.push({ name, path });
  }
  return paths;
}

function syncCustomSavePaths(strict: boolean): CustomSavePath[] {
  const paths = collectCustomSavePaths(strict);
  setCustomSavePaths(paths);
  return paths;
}

function renderCustomSavePaths(paths: CustomSavePath[]): void {
  const list = customPathList();
  if (!list) return;
  list.textContent = "";
  if (paths.length === 0) {
    list.append(createEmptyCustomPathState());
  } else {
    paths.forEach((item) => addCustomPathRow(item));
  }
  setCustomSavePaths(paths);
}

function safeGetPanel(): PanelKey {
  try {
    const stored = localStorage.getItem(ACTIVE_PANEL_KEY) as PanelKey | null;
    if (stored && PANEL_META[stored]) return stored;
  } catch {
    // Ignore storage failures and fall back to the default panel.
  }
  return "save";
}

function showPanel(panel: PanelKey): void {
  const meta = PANEL_META[panel];
  if (panelLabel) panelLabel.textContent = meta.label;
  if (panelTitle) panelTitle.textContent = meta.title;
  if (panelDescription) panelDescription.textContent = meta.description;
  panelButtons.forEach((button) => {
    const active = button.dataset.panelButton === panel;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  panelSections.forEach((section) => {
    section.hidden = section.dataset.panelSection !== panel;
  });
  document.title = `X2MD 设置 - ${meta.label}`;
  try {
    localStorage.setItem(ACTIVE_PANEL_KEY, panel);
  } catch {
    // Ignore storage failures.
  }
}

async function loadConfig(): Promise<void> {
  const response = await apiFetch(`${api}/config`);
  const cfg = await response.json();
  $("savePath").value = cfg.save_paths?.[0] || "";
  const customPaths = Array.isArray(cfg.custom_save_paths) ? cfg.custom_save_paths : [];
  renderCustomSavePaths(customPaths);
  $("videoPath").value = cfg.video_save_path || "";
  $("enableVideoDownload").checked = Boolean(cfg.enable_video_download);
  $("enableSaveNotification").checked = Boolean(cfg.enable_save_notification);
  $("videoThreshold").value = cfg.video_duration_threshold || 5;
  setFilenameFormat(cfg.filename_format || DEFAULT_FILENAME_FORMAT);
  $("maxFilenameLength").value = cfg.max_filename_length || DEFAULT_FILENAME_LENGTH;
  (field("profileRange") as HTMLSelectElement).value = cfg.profile_capture_range || "today";
  $("profileCustomDays").value = cfg.profile_capture_custom_days || 7;
  $("profileSavePath").value = cfg.profile_capture_save_path || "";
  $("showSiteSaveIcon").checked = Boolean(cfg.show_site_save_icon);
  $("showProfileCapture").checked = Boolean(cfg.show_x_profile_capture_button);
  const status = await apiFetch(`${api}/status`).then((res) => res.json()).catch(() => ({}));
  setServiceInfo(status);
  const ping = status.version ? status : await apiFetch(`${api}/ping`).then((res) => res.json()).catch(() => ({}));
  const autostart = await apiFetch(`${api}/autostart`).then((res) => res.json()).catch(() => ({}));
  $("autostart").checked = Boolean(autostart.enabled);
  setStatus(ping.version ? "已连接，保存功能可用" : "已连接");
}

async function saveConfig(): Promise<void> {
  let customSavePaths: Array<{ name: string; path: string }>;
  try {
    customSavePaths = syncCustomSavePaths(true);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    return;
  }

  const payload = {
    save_paths: [$("savePath").value.trim()].filter(Boolean),
    custom_save_paths: customSavePaths,
    video_save_path: $("videoPath").value.trim(),
    enable_video_download: $("enableVideoDownload").checked,
    enable_save_notification: $("enableSaveNotification").checked,
    video_duration_threshold: Number($("videoThreshold").value || 5),
    filename_format: $("filenameFormat").value.trim() || DEFAULT_FILENAME_FORMAT,
    max_filename_length: Number($("maxFilenameLength").value || DEFAULT_FILENAME_LENGTH),
    profile_capture_range: (field("profileRange") as HTMLSelectElement).value,
    profile_capture_custom_days: Number($("profileCustomDays").value || 7),
    profile_capture_save_path: $("profileSavePath").value.trim(),
    show_site_save_icon: $("showSiteSaveIcon").checked,
    show_x_profile_capture_button: $("showProfileCapture").checked,
    setup_completed: true,
  };
  const response = await apiFetch(`${api}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  updateCustomSaveSummary(customSavePaths);
  setStatus(response.ok ? "已保存" : "保存失败");
}

async function openTarget(target: string): Promise<void> {
  const response = await apiFetch(`${api}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  setStatus(response.ok ? "已打开" : "打开失败");
}

async function updateAutostart(): Promise<void> {
  const response = await apiFetch(`${api}/autostart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: $("autostart").checked }),
  });
  const result = await response.json().catch(() => ({}));
  $("autostart").checked = Boolean(result.enabled);
  setStatus(response.ok ? (result.enabled ? "已开启登录后自动启动" : "已关闭登录后自动启动") : "自动启动设置失败");
}

async function showLog(): Promise<void> {
  showPanel("system");
  const view = document.getElementById("logView") as HTMLPreElement | null;
  if (!view) return;
  const response = await apiFetch(`${api}/log`);
  const result = await response.json().catch(() => ({}));
  view.hidden = false;
  view.textContent = result.log || "暂无日志";
  setStatus(response.ok ? "已刷新日志" : "日志读取失败");
}

function toggleExtensionHelp(): void {
  showPanel("system");
  const help = document.getElementById("extensionHelp");
  if (help) help.hidden = !help.hidden;
}

panelButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const panel = button.dataset.panelButton as PanelKey | undefined;
    if (panel && PANEL_META[panel]) {
      showPanel(panel);
    }
  });
});

$("save").addEventListener("click", () => void saveConfig());
$("test").addEventListener("click", async () => {
  const response = await apiFetch(`${api}/ping`);
  await response.json().catch(() => ({}));
  setStatus(response.ok ? "服务正常，可以保存内容" : "服务不可用");
});
$("autostart").addEventListener("change", () => void updateAutostart());
$("customSavePaths").addEventListener("input", () => updateCustomSaveSummary(parseCustomSavePaths()));
document.getElementById("addCustomSavePath")?.addEventListener("click", () => addCustomPathRow());
document.querySelectorAll<HTMLButtonElement>("[data-filename-format]").forEach((button) => {
  button.addEventListener("click", () => setFilenameFormat(button.dataset.filenameFormat || DEFAULT_FILENAME_FORMAT));
});
document.getElementById("chooseSavePath")?.addEventListener("click", () => void chooseFolderForInput($("savePath"), "主要保存位置"));
document.getElementById("chooseVideoPath")?.addEventListener("click", () => void chooseFolderForInput($("videoPath"), "视频保存位置", $("savePath").value.trim()));
document.getElementById("chooseProfilePath")?.addEventListener("click", () => void chooseFolderForInput($("profileSavePath"), "博主内容保存位置", $("savePath").value.trim()));
document.getElementById("clearProfilePath")?.addEventListener("click", () => {
  $("profileSavePath").value = "";
  setStatus("博主内容将使用主要保存位置");
});
$("openSave").addEventListener("click", () => void openTarget("save"));
$("openVideo").addEventListener("click", () => void openTarget("video"));
$("openLog").addEventListener("click", () => {
  showPanel("system");
  void openTarget("log");
});
$("showLog").addEventListener("click", () => void showLog());
$("openExtension").addEventListener("click", () => {
  toggleExtensionHelp();
  void openTarget("extension");
});

const pairingCodeElement = document.getElementById("pairingCode");
if (pairingCodeElement && pairingCode) pairingCodeElement.textContent = pairingCode;
showPanel(safeGetPanel());
loadConfig().catch((error) => setStatus(`连接失败：${error.message}`));
