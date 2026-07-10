import { CUSTOM_FRONT_MATTER_VARIABLES, renderCustomFrontMatter } from "../../core/markdown.ts";

const api = `${location.protocol === "http:" ? location.origin : "http://127.0.0.1:9527"}`;
const session = String((globalThis as typeof globalThis & { X2MD_SESSION?: string }).X2MD_SESSION || "");
const apiFetch = (input: string, init: RequestInit = {}) => fetch(input, {
  ...init,
  headers: { ...init.headers, Authorization: `Bearer ${session}` },
});
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
const field = (id: string) => $(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
const pairingCode = String((globalThis as typeof globalThis & { X2MD_PAIRING_CODE?: string }).X2MD_PAIRING_CODE || "");

type PanelKey = "save" | "media" | "capture" | "organize" | "system";

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

type SetupState = {
  setup_completed: boolean;
  steps: Record<string, boolean>;
  sample_history_id?: string;
  version?: string;
  port?: number;
};

let currentSetup: SetupState | null = null;

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
    label: "媒体与去重",
    title: "重复内容和媒体怎么处理",
    description: "统一设置重复保存、X 图片本地化，以及所有保存方式共用的视频策略。",
  },
  capture: {
    label: "网页按钮",
    title: "网页上显示哪些按钮",
    description: "控制保存按钮和博主抓取按钮，默认保持开启即可。",
  },
  organize: {
    label: "整理规则",
    title: "标签和 Front Matter",
    description: "统一内容标签和文档元数据。规则只影响之后保存的内容。",
  },
  system: {
    label: "启动与工具",
    title: "启动方式和帮助工具",
    description: "设置登录后自动启动。日志和端口属于排查问题时使用的工具。",
  },
};

const FRONT_MATTER_PREVIEW_VALUES: Record<typeof CUSTOM_FRONT_MATTER_VARIABLES[number], string> = {
  title: "示例标题",
  url: "https://x.com/example/status/123",
  author_url: "https://x.com/example",
  created: "2026-07-11 10:30:00",
  published: "2026-07-11",
  platform: "Twitter/X",
  type: "tweet",
  status_id: "123",
  tags: "剪报, 示例",
  poll: "false",
  has_community_notes: "false",
  content_state: "available",
  x2md_version: "3.1.0",
  repost: "false",
  repost_author: "",
};

function parseDefaultTags(value: string): string[] {
  return Array.from(new Set(value.split(/[,，\n]/).map((tag) => tag.trim().replace(/^#/, "")).filter(Boolean)));
}

function updateImageAttachmentPreview(): void {
  const preview = document.getElementById("imageAttachmentPreview");
  if (!preview) return;
  const directory = $("imageAttachmentPath").value.trim().replace(/\/+$/g, "") || "X2MD-attachments";
  const path = `${directory}/123/image_1.jpg`;
  preview.textContent = (field("imageEmbedStyle") as HTMLSelectElement).value === "obsidian"
    ? `![[${path}]]`
    : `![](${path})`;
}

function validateTagList(value: unknown, location: string): void {
  if (!Array.isArray(value) || value.length === 0 || value.some((tag) => typeof tag !== "string" || !tag.trim())) {
    throw new Error(`${location} 必须是非空标签字符串数组`);
  }
}

function validateMappedRules(value: unknown, location: string): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${location} 必须是对象`);
  for (const [name, rule] of Object.entries(value)) {
    if (!name.trim()) throw new Error(`${location} 不能包含空名称`);
    if (Array.isArray(rule)) validateTagList(rule, `${location}.${name}`);
    else if (rule && typeof rule === "object" && !Array.isArray(rule)) {
      const keys = Object.keys(rule);
      if (keys.length !== 1 || keys[0] !== "tags") throw new Error(`${location}.${name} 只允许 tags 字段`);
      validateTagList((rule as Record<string, unknown>).tags, `${location}.${name}.tags`);
    } else throw new Error(`${location}.${name} 必须是标签数组或 { "tags": [...] }`);
  }
}

function validateTagRules(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("标签规则必须是 JSON 对象");
  const rules = value as Record<string, unknown>;
  const allowed = new Set(["paths", "keywords", "authors", "platforms"]);
  const unknown = Object.keys(rules).find((key) => !allowed.has(key));
  if (unknown) throw new Error(`标签规则不支持字段：${unknown}`);
  for (const key of ["paths", "authors", "platforms"]) {
    if (rules[key] !== undefined) validateMappedRules(rules[key], key);
  }
  if (rules.keywords !== undefined) {
    if (!Array.isArray(rules.keywords)) throw new Error("keywords 必须是数组");
    rules.keywords.forEach((rule, index) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule)) throw new Error(`keywords[${index}] 必须是对象`);
      const record = rule as Record<string, unknown>;
      if (Object.keys(record).some((key) => !["keyword", "tags"].includes(key))) throw new Error(`keywords[${index}] 只允许 keyword 和 tags 字段`);
      if (typeof record.keyword !== "string" || !record.keyword.trim()) throw new Error(`keywords[${index}].keyword 不能为空`);
      validateTagList(record.tags, `keywords[${index}].tags`);
    });
  }
  return rules;
}

function parseTagRules(): Record<string, unknown> {
  const source = (field("tagRules") as HTMLTextAreaElement).value.trim();
  if (!source) return {};
  try {
    return validateTagRules(JSON.parse(source));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("标签规则不是有效的 JSON");
    throw error;
  }
}

function validateCustomFrontMatterTemplate(template: string): void {
  const allowed = new Set<string>(CUSTOM_FRONT_MATTER_VARIABLES);
  const unknown = Array.from(template.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g))
    .map((match) => match[1])
    .find((variable) => !allowed.has(variable));
  if (unknown) throw new Error(`自定义 Front Matter 不支持变量：{{${unknown}}}`);
}

function updateFrontMatterEditor(): void {
  const preset = (field("frontMatterTemplate") as HTMLSelectElement).value;
  const editor = document.getElementById("customFrontMatterEditor");
  if (editor) editor.hidden = preset !== "custom";
  const template = (field("customFrontMatterTemplate") as HTMLTextAreaElement).value;
  const preview = document.getElementById("customFrontMatterPreview");
  if (preview) preview.textContent = renderCustomFrontMatter(template, FRONT_MATTER_PREVIEW_VALUES) || "输入模板后在这里预览。";
}

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
  (field("duplicatePolicy") as HTMLSelectElement).value = cfg.duplicate_policy || "skip";
  $("downloadImages").checked = Boolean(cfg.download_images);
  $("imageAttachmentPath").value = cfg.image_attachment_path || "X2MD-attachments";
  (field("imageEmbedStyle") as HTMLSelectElement).value = cfg.image_embed_style || "markdown";
  updateImageAttachmentPreview();
  $("enableSaveNotification").checked = Boolean(cfg.enable_save_notification);
  $("videoThreshold").value = cfg.video_duration_threshold || 5;
  setFilenameFormat(cfg.filename_format || DEFAULT_FILENAME_FORMAT);
  $("maxFilenameLength").value = cfg.max_filename_length || DEFAULT_FILENAME_LENGTH;
  (field("profileRange") as HTMLSelectElement).value = cfg.profile_capture_range || "today";
  $("profileCustomDays").value = cfg.profile_capture_custom_days || 7;
  $("profileSavePath").value = cfg.profile_capture_save_path || "";
  $("showSiteSaveIcon").checked = Boolean(cfg.show_site_save_icon);
  $("showProfileCapture").checked = Boolean(cfg.show_x_profile_capture_button);
  $("autoTagsEnabled").checked = cfg.auto_tags_enabled !== false;
  (field("defaultTags") as HTMLTextAreaElement).value = Array.isArray(cfg.default_tags) ? cfg.default_tags.join(", ") : "";
  (field("tagRules") as HTMLTextAreaElement).value = JSON.stringify(cfg.tag_rules || {}, null, 2);
  (field("frontMatterTemplate") as HTMLSelectElement).value = cfg.front_matter_template || "default";
  (field("customFrontMatterTemplate") as HTMLTextAreaElement).value = cfg.custom_front_matter_template || "";
  updateFrontMatterEditor();
  const status = await apiFetch(`${api}/status`).then((res) => res.json()).catch(() => ({}));
  setServiceInfo(status);
  const ping = status.version ? status : await apiFetch(`${api}/ping`).then((res) => res.json()).catch(() => ({}));
  const autostart = await apiFetch(`${api}/autostart`).then((res) => res.json()).catch(() => ({}));
  $("autostart").checked = Boolean(autostart.enabled);
  setStatus(ping.version ? "已连接，保存功能可用" : "已连接");
  await refreshSetup();
}

function renderSetup(state: SetupState): void {
  currentSetup = state;
  const doctor = document.getElementById("setupDoctor");
  if (doctor) doctor.hidden = state.setup_completed;
  document.querySelectorAll<HTMLElement>("[data-setup-step]").forEach((item) => {
    const step = item.dataset.setupStep || "";
    const done = state.steps?.[step] === true;
    item.classList.toggle("is-done", done);
    const button = item.querySelector<HTMLButtonElement>("[data-setup-action]");
    if (button) {
      button.disabled = done;
      if (done) button.textContent = "已完成";
    }
  });
  const runtime = document.getElementById("setup-runtime-detail");
  if (runtime && state.steps?.runtime) runtime.textContent = `版本 ${state.version}，端口 ${state.port} 正常。`;
  const resultActions = document.getElementById("setupResultActions");
  if (resultActions) resultActions.hidden = !state.sample_history_id;
}

async function refreshSetup(): Promise<void> {
  const response = await apiFetch(`${api}/setup`);
  const state = await response.json().catch(() => ({}));
  if (response.ok) renderSetup(state);
}

async function runSetupStep(step: string): Promise<void> {
  if (step === "extension") {
    toggleExtensionHelp();
    await openTarget("extension");
    setStatus("请在扩展设置中输入配对码；配对完成后此步骤会自动更新");
    return;
  }
  if (step === "directory") {
    const path = $("savePath").value.trim();
    if (!path) {
      setStatus("请先选择主要保存位置");
      return;
    }
    const configResponse = await apiFetch(`${api}/config`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ save_paths: [path] }),
    });
    if (!configResponse.ok) throw new Error("保存目录配置失败");
  }
  const response = await apiFetch(`${api}/setup`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step }),
  });
  const state = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(state.error || "检查失败");
  renderSetup(state);
  setStatus(step === "sample" ? "首次激活完成，样例已保存" : "检查通过，请继续下一步");
}

async function openSetupSample(action: string): Promise<void> {
  const id = currentSetup?.sample_history_id;
  if (!id) throw new Error("样例记录不存在");
  const response = await apiFetch(`${api}/history/action`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, action }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "打开样例失败");
  setStatus(action === "show_file" ? "已在 Finder 显示样例" : "已在 Obsidian 打开样例");
}

async function saveConfig(): Promise<void> {
  let customSavePaths: Array<{ name: string; path: string }>;
  let tagRules: Record<string, unknown>;
  try {
    customSavePaths = syncCustomSavePaths(true);
    tagRules = parseTagRules();
    if ((field("frontMatterTemplate") as HTMLSelectElement).value === "custom") {
      validateCustomFrontMatterTemplate((field("customFrontMatterTemplate") as HTMLTextAreaElement).value);
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error));
    return;
  }

  const payload = {
    save_paths: [$("savePath").value.trim()].filter(Boolean),
    custom_save_paths: customSavePaths,
    video_save_path: $("videoPath").value.trim(),
    enable_video_download: $("enableVideoDownload").checked,
    duplicate_policy: (field("duplicatePolicy") as HTMLSelectElement).value,
    download_images: $("downloadImages").checked,
    image_attachment_path: $("imageAttachmentPath").value.trim(),
    image_embed_style: (field("imageEmbedStyle") as HTMLSelectElement).value,
    enable_save_notification: $("enableSaveNotification").checked,
    video_duration_threshold: Number($("videoThreshold").value || 5),
    filename_format: $("filenameFormat").value.trim() || DEFAULT_FILENAME_FORMAT,
    max_filename_length: Number($("maxFilenameLength").value || DEFAULT_FILENAME_LENGTH),
    profile_capture_range: (field("profileRange") as HTMLSelectElement).value,
    profile_capture_custom_days: Number($("profileCustomDays").value || 7),
    profile_capture_save_path: $("profileSavePath").value.trim(),
    show_site_save_icon: $("showSiteSaveIcon").checked,
    show_x_profile_capture_button: $("showProfileCapture").checked,
    auto_tags_enabled: $("autoTagsEnabled").checked,
    default_tags: parseDefaultTags((field("defaultTags") as HTMLTextAreaElement).value),
    tag_rules: tagRules,
    front_matter_template: (field("frontMatterTemplate") as HTMLSelectElement).value,
    custom_front_matter_template: (field("customFrontMatterTemplate") as HTMLTextAreaElement).value,
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

async function retryConnection(): Promise<void> {
  const detail = document.getElementById("diagnosticsConnection");
  setStatus("正在重试本机连接…");
  try {
    const response = await apiFetch(`${api}/status`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== "ok") throw new Error(result.error || "本机服务未响应");
    if (detail) detail.textContent = `连接正常：App ${result.version}，端口 ${result.port}。`;
    setServiceInfo(result);
    setStatus("连接已恢复，保存功能可用");
  } catch (error) {
    if (detail) detail.textContent = "仍无法连接。请确认 X2MD 正在运行且端口 9527 未被其他程序占用。";
    setStatus(error instanceof Error ? error.message : String(error));
  }
}

async function exportDiagnostics(): Promise<void> {
  setStatus("正在生成脱敏诊断包…");
  const response = await apiFetch(`${api}/diagnostics/export`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "诊断包生成失败");
  const location = document.getElementById("diagnosticsLocation");
  if (location) {
    location.hidden = false;
    location.textContent = `已导出：${result.file}`;
  }
  const open = document.getElementById("openDiagnostics") as HTMLButtonElement | null;
  if (open) open.disabled = false;
  setStatus("脱敏诊断包已生成");
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
$("imageAttachmentPath").addEventListener("input", updateImageAttachmentPreview);
(field("imageEmbedStyle") as HTMLSelectElement).addEventListener("change", updateImageAttachmentPreview);
document.getElementById("addCustomSavePath")?.addEventListener("click", () => addCustomPathRow());
document.querySelectorAll<HTMLButtonElement>("[data-filename-format]").forEach((button) => {
  button.addEventListener("click", () => setFilenameFormat(button.dataset.filenameFormat || DEFAULT_FILENAME_FORMAT));
});
(field("frontMatterTemplate") as HTMLSelectElement).addEventListener("change", updateFrontMatterEditor);
(field("customFrontMatterTemplate") as HTMLTextAreaElement).addEventListener("input", updateFrontMatterEditor);
const customFrontMatterVariables = document.getElementById("customFrontMatterVariables");
if (customFrontMatterVariables) {
  for (const variable of CUSTOM_FRONT_MATTER_VARIABLES) {
    const code = document.createElement("code");
    code.textContent = `{{${variable}}}`;
    customFrontMatterVariables.append(code);
  }
}
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
document.getElementById("retryConnection")?.addEventListener("click", () => void retryConnection());
document.getElementById("exportDiagnostics")?.addEventListener("click", () => void exportDiagnostics().catch((error) => setStatus(error.message)));
document.getElementById("openDiagnostics")?.addEventListener("click", () => void openTarget("diagnostics"));
$("openExtension").addEventListener("click", () => {
  toggleExtensionHelp();
  void openTarget("extension");
});

const pairingCodeElement = document.getElementById("pairingCode");
if (pairingCodeElement && pairingCode) pairingCodeElement.textContent = pairingCode;
const setupPairingCode = document.getElementById("setupPairingCode");
if (setupPairingCode && pairingCode) setupPairingCode.textContent = pairingCode;
document.querySelectorAll<HTMLButtonElement>("[data-setup-action]").forEach((button) => {
  button.addEventListener("click", () => void runSetupStep(button.dataset.setupAction || "").catch((error) => setStatus(error.message)));
});
document.querySelectorAll<HTMLButtonElement>("[data-sample-action]").forEach((button) => {
  button.addEventListener("click", () => void openSetupSample(button.dataset.sampleAction || "").catch((error) => setStatus(error.message)));
});
setInterval(() => { if (currentSetup && !currentSetup.setup_completed) void refreshSetup(); }, 2000);
showPanel(safeGetPanel());
loadConfig().catch((error) => setStatus(`连接失败：${error.message}`));
