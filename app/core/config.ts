import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export const VERSION = "3.0.0";
export const MIN_EXTENSION_VERSION = "3.0.0";

export type X2MDConfig = Record<string, unknown> & {
  port: number;
  save_paths: string[];
  custom_save_paths: Array<{ name: string; path: string }>;
  filename_format: string;
  max_filename_length: number;
  video_save_path: string;
  enable_video_download: boolean;
  video_duration_threshold: number;
  show_site_save_icon: boolean;
  show_x_profile_capture_button: boolean;
  enable_save_notification: boolean;
  auto_tags_enabled: boolean;
  default_tags: string[];
  tag_rules: Record<string, unknown>;
  front_matter_template: string;
  custom_front_matter_template: string;
  local_api_token: string;
  require_local_api_token: boolean;
  download_images: boolean;
  image_attachment_path: string;
  image_embed_style: "markdown" | "obsidian";
  profile_capture_range: string;
  profile_capture_custom_days: number;
  profile_capture_save_path: string;
  setup_completed: boolean;
};

const HOME = homedir();

export function cliArg(name: string): string | undefined {
  const key = `--${name}`;
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === key) return process.argv[i + 1];
    if (arg.startsWith(`${key}=`)) return arg.slice(key.length + 1);
  }
  return undefined;
}

export const DEFAULT_CONFIG: X2MDConfig = {
  port: 9527,
  save_paths: [join(HOME, "Desktop", "X2MD", "MD")],
  custom_save_paths: [],
  filename_format: "{summary}",
  max_filename_length: 100,
  video_save_path: join(HOME, "Desktop", "X2MD", "Videos"),
  enable_video_download: true,
  video_duration_threshold: 5,
  show_site_save_icon: true,
  show_x_profile_capture_button: true,
  enable_save_notification: false,
  auto_tags_enabled: true,
  default_tags: [],
  tag_rules: {},
  front_matter_template: "default",
  custom_front_matter_template: "",
  local_api_token: "",
  require_local_api_token: false,
  download_images: false,
  image_attachment_path: "X2MD-attachments",
  image_embed_style: "markdown",
  profile_capture_range: "today",
  profile_capture_custom_days: 7,
  profile_capture_save_path: "",
  setup_completed: false,
};

function boolValue(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(text)) return false;
  if (["true", "1", "yes", "on"].includes(text)) return true;
  return Boolean(value);
}

function numberValue(value: unknown, fallback: number, min = 1, max = Number.POSITIVE_INFINITY): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(n, max);
}

export function getAppDir(): string {
  const fromCli = cliArg("app-dir");
  if (fromCli) return fromCli;
  if (process.env.X2MD_APP_DIR) return process.env.X2MD_APP_DIR;
  if (platform() === "darwin") return join(HOME, "Library", "Application Support", "X2MD");
  if (platform() === "win32") return join(process.env.APPDATA || HOME, "X2MD");
  return join(HOME, ".x2md");
}

export function configPath(appDir = getAppDir()): string {
  return join(appDir, "config.json");
}

export function profileStatePath(appDir = getAppDir()): string {
  return join(appDir, "profile_capture_state.json");
}

export function logPath(appDir = getAppDir()): string {
  return join(appDir, "x2md.log");
}

export function normalizeConfig(raw: Record<string, unknown> = {}): X2MDConfig {
  const cfg = { ...DEFAULT_CONFIG, ...raw } as X2MDConfig;
  const oldConfigHasSavePath = raw.setup_completed === undefined && Array.isArray(raw.save_paths) && raw.save_paths.some((path) => String(path || "").trim());
  const port = Number(cfg.port);
  cfg.port = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_CONFIG.port;
  cfg.save_paths = Array.isArray(cfg.save_paths) ? cfg.save_paths.map((path) => String(path).trim()).filter(Boolean) : [...DEFAULT_CONFIG.save_paths];
  cfg.video_save_path = String(cfg.video_save_path || "").trim() || DEFAULT_CONFIG.video_save_path;
  cfg.profile_capture_save_path = String(cfg.profile_capture_save_path || "").trim();
  cfg.custom_save_paths = normalizeCustomSavePaths(cfg);
  cfg.max_filename_length = numberValue(cfg.max_filename_length, DEFAULT_CONFIG.max_filename_length, 20, 180);
  cfg.video_duration_threshold = numberValue(cfg.video_duration_threshold, DEFAULT_CONFIG.video_duration_threshold, 0);
  cfg.profile_capture_custom_days = numberValue(cfg.profile_capture_custom_days, DEFAULT_CONFIG.profile_capture_custom_days);
  cfg.setup_completed = cfg.save_paths.length > 0 && (oldConfigHasSavePath || boolValue(cfg.setup_completed, DEFAULT_CONFIG.setup_completed));
  cfg.enable_video_download = boolValue(cfg.enable_video_download, DEFAULT_CONFIG.enable_video_download);
  cfg.enable_save_notification = boolValue(cfg.enable_save_notification, DEFAULT_CONFIG.enable_save_notification);
  cfg.auto_tags_enabled = boolValue(cfg.auto_tags_enabled, DEFAULT_CONFIG.auto_tags_enabled);
  cfg.default_tags = Array.isArray(cfg.default_tags) ? normalizeTagList(cfg.default_tags) : [...DEFAULT_CONFIG.default_tags];
  cfg.tag_rules = cfg.tag_rules && typeof cfg.tag_rules === "object" ? cfg.tag_rules as Record<string, unknown> : { ...DEFAULT_CONFIG.tag_rules };
  cfg.front_matter_template = ["default", "minimal", "dataview-full", "custom"].includes(String(cfg.front_matter_template)) ? String(cfg.front_matter_template) : DEFAULT_CONFIG.front_matter_template;
  cfg.custom_front_matter_template = String(cfg.custom_front_matter_template || "");
  cfg.local_api_token = String(cfg.local_api_token || "").trim() || randomUUID();
  cfg.require_local_api_token = boolValue(cfg.require_local_api_token, DEFAULT_CONFIG.require_local_api_token);
  cfg.download_images = boolValue(cfg.download_images, DEFAULT_CONFIG.download_images);
  cfg.image_attachment_path = String(cfg.image_attachment_path || "").trim() || DEFAULT_CONFIG.image_attachment_path;
  cfg.image_embed_style = String(cfg.image_embed_style) === "obsidian" ? "obsidian" : "markdown";
  cfg.show_site_save_icon = boolValue(cfg.show_site_save_icon, DEFAULT_CONFIG.show_site_save_icon);
  cfg.show_x_profile_capture_button = boolValue(cfg.show_x_profile_capture_button, DEFAULT_CONFIG.show_x_profile_capture_button);
  return cfg;
}

function normalizeTagList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(source.map((item) => String(item || "").trim().replace(/^#/, "")).filter(Boolean)));
}

export function ensureConfiguredDirs(cfg: X2MDConfig): void {
  const dirs = [
    ...cfg.save_paths,
    ...cfg.custom_save_paths.map((item) => item.path),
    cfg.video_save_path,
    cfg.profile_capture_save_path,
  ].filter(Boolean);
  for (const dir of dirs) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // ponytail: bad user paths should not prevent config loading; save/open will surface errors later.
    }
  }
}

export function loadConfig(appDir = getAppDir()): X2MDConfig {
  const file = configPath(appDir);
  if (existsSync(file)) {
    try {
      const cfg = normalizeConfig(JSON.parse(readFileSync(file, "utf8")));
      ensureConfiguredDirs(cfg);
      return cfg;
    } catch {
      // ponytail: corrupt config falls back to defaults; richer recovery can wait for support cases.
    }
  }
  const cfg = normalizeConfig();
  saveConfig(cfg, appDir);
  return cfg;
}

export function saveConfig(cfg: Record<string, unknown>, appDir = getAppDir()): X2MDConfig {
  const normalized = normalizeConfig(cfg);
  const file = configPath(appDir);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(normalized, null, 2), "utf8");
  ensureConfiguredDirs(normalized);
  return normalized;
}

export function normalizeCustomSavePaths(cfg: Record<string, unknown>): Array<{ name: string; path: string }> {
  const entries = Array.isArray(cfg.custom_save_paths) ? cfg.custom_save_paths : [];
  const normalized: Array<{ name: string; path: string }> = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const name = String(item.name ?? "").trim();
    const path = String(item.path ?? "").trim();
    if (name && path) normalized.push({ name, path });
  }
  return normalized;
}

export function resolveSavePathsForRequest(cfg: Record<string, unknown>, data: Record<string, unknown>): [string[], boolean] {
  const targetPath = String(data.custom_save_path ?? "").trim();
  const targetName = String(data.custom_save_path_name ?? "").trim();
  if (targetName && !targetPath) throw new Error("自定义保存路径无效或未在设置中配置");
  if (!targetPath) return [Array.isArray(cfg.save_paths) ? cfg.save_paths.map(String) : [], false];

  for (const entry of normalizeCustomSavePaths(cfg)) {
    if (entry.path === targetPath && (!targetName || entry.name === targetName)) return [[entry.path], true];
  }
  throw new Error("自定义保存路径无效或未在设置中配置");
}
