import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { getAppDir, loadConfig, logPath, LOCAL_API_PORT } from "../core/config.ts";
import { log } from "./logger.ts";
import { issueAppSession, issuePairingCode, revokeAppSession } from "../core/pairing.ts";

let settingsWindow: any;

export function settingsUrl(_appDir = getAppDir()): string {
  return `views://settings/index.html#port=${LOCAL_API_PORT}`;
}

function escapeInlineScript(script: string): string {
  return script.replace(/<\/script/gi, "<\\/script");
}

function escapeInlineStyle(style: string): string {
  return style.replace(/<\/style/gi, "<\\/style");
}

export function inlineSettingsHtml(html: string, css: string, script: string, port: number | string, session = "", pairingCode = ""): string {
  const withCss = html.replace(
    /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/,
    `<style>${escapeInlineStyle(css)}</style>`,
  );
  return withCss.replace(
    /<script\s+type="module"\s+src="settings\.js"><\/script>/,
    `<script>globalThis.X2MD_PORT = ${JSON.stringify(String(port))};globalThis.X2MD_SESSION = ${JSON.stringify(session)};globalThis.X2MD_PAIRING_CODE = ${JSON.stringify(pairingCode)};</script><script type="module">${escapeInlineScript(script)}</script>`,
  );
}

export function settingsViewsRootForExecutable(executable = process.execPath): string {
  if (executable.includes(".app/Contents/MacOS/")) {
    return resolve(dirname(executable), "..", "Resources", "app", "views");
  }
  return resolve("build/dev-macos-arm64/X2MD-dev.app/Contents/Resources/app/views");
}

function readFirst(paths: string[]): string | null {
  for (const file of paths) {
    if (existsSync(file)) return readFileSync(file, "utf8");
  }
  return null;
}

export function settingsHtml(port: number | string, executable = process.execPath, session = "", pairingCode = ""): string {
  const settingsRoot = join(settingsViewsRootForExecutable(executable), "settings");
  const html = readFirst([join(settingsRoot, "index.html"), resolve("app/ui/settings/index.html")]);
  const css = readFirst([join(settingsRoot, "styles.css"), resolve("app/ui/settings/styles.css")]) || "";
  const script = readFirst([join(settingsRoot, "settings.js")]);

  if (html && script) return inlineSettingsHtml(html, css, script, port, session, pairingCode);

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>X2MD 设置</title><style>body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;padding:32px;color:#111}code{background:#eee;padding:2px 4px;border-radius:4px}</style></head><body><h1>X2MD 设置</h1><p>设置页资源未找到，请重新安装 X2MD。</p><p><code>${settingsRoot}</code></p></body></html>`;
}

export function settingsWindowOptions(port: number | string, executable = process.execPath, session = "", pairingCode = ""): { html: string; viewsRoot: string } {
  const viewsRoot = settingsViewsRootForExecutable(executable);
  return {
    html: settingsHtml(port, executable, session, pairingCode),
    viewsRoot,
  };
}

export async function showSettingsWindow(appDir = getAppDir(), port?: number): Promise<void> {
  try {
    const { BrowserWindow } = await import("electrobun/bun");
    const configuredPort = port || LOCAL_API_PORT;
    if (settingsWindow) {
      try {
        settingsWindow.show?.();
        settingsWindow.activate?.();
        log("设置页已打开：复用现有窗口", appDir);
        return;
      } catch (error) {
        settingsWindow = null;
        log(`设置页旧窗口已关闭，重新创建：${error instanceof Error ? error.message : String(error)}`, appDir);
      }
    }

    const cfg = loadConfig(appDir);
    const session = issueAppSession();
    const pairingCode = issuePairingCode(String(cfg.install_secret));
    if (process.env.X2MD_OPEN_DRY_RUN === "1") {
      writeFileSync(join(appDir, "smoke-session"), session, { encoding: "utf8", mode: 0o600 });
    }

    const window = new BrowserWindow({
      title: "X2MD 设置",
      ...settingsWindowOptions(configuredPort, process.execPath, session, pairingCode),
      frame: { x: 120, y: 120, width: 980, height: 720 },
    });
    settingsWindow = window;
    settingsWindow.on?.("close", () => {
      revokeAppSession(session);
      if (settingsWindow === window) settingsWindow = null;
    });
    log(`设置页已打开：inline viewsRoot=${settingsViewsRootForExecutable()}`, appDir);
  } catch (error) {
    log(`设置页打开失败：${error instanceof Error ? error.message : String(error)}`, appDir);
    console.log("设置页需要在 Electrobun 运行时打开：http://127.0.0.1:9527/config");
  }
}

export function openPath(target: string, dryRun = false): void {
  if (!target) return;
  mkdirSync(target.endsWith(".log") ? dirname(target) : target, { recursive: true });
  if (dryRun) return;
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(command, [target], { detached: true, stdio: "ignore" }).unref();
}

export function openFirstSaveDir(appDir?: string, dryRun = false): void {
  const cfg = loadConfig(appDir);
  openPath(String(cfg.save_paths?.[0] || ""), dryRun);
}

export function openVideoDir(appDir?: string, dryRun = false): void {
  openPath(String(loadConfig(appDir).video_save_path || ""), dryRun);
}

export function openLog(appDir?: string, dryRun = false): void {
  const file = logPath(appDir);
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, "", "utf8");
  }
  openPath(file, dryRun);
}

export function bundledExtensionDirForExecutable(executable: string): string | null {
  if (!executable.includes(".app/Contents/MacOS/")) return null;
  return resolve(dirname(executable), "..", "Resources", "extension");
}

export function extensionDir(executable = process.execPath): string {
  const bundled = bundledExtensionDirForExecutable(executable);
  return bundled && existsSync(bundled) ? bundled : resolve("extension");
}

export function openExtensionDir(dryRun = false): void {
  openPath(extensionDir(), dryRun);
}

export function openConfiguredTarget(target: unknown, appDir?: string, dryRun = false): string {
  const key = String(target || "");
  if (key === "save") openFirstSaveDir(appDir, dryRun);
  else if (key === "video") openVideoDir(appDir, dryRun);
  else if (key === "log") openLog(appDir, dryRun);
  else if (key === "extension") openExtensionDir(dryRun);
  else throw new Error("不支持的打开目标");
  return key;
}

export type HistoryFileAction = "show_file" | "open_obsidian" | "open_source";

function spawnOpen(args: string[]): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(command, args, { detached: true, stdio: "ignore" }).unref();
}

/** Opens only data previously resolved from server-owned history. Callers must never pass request paths here. */
export function openHistoryEntry(
  entry: { path: string; source_url?: string },
  action: HistoryFileAction,
  dryRun = false,
): { target: string } {
  if (action === "open_source") {
    const source = new URL(String(entry.source_url || ""));
    if (!['http:', 'https:'].includes(source.protocol)) throw new Error("历史记录没有可打开的原文链接");
    if (!dryRun) spawnOpen([source.toString()]);
    return { target: source.toString() };
  }

  const file = String(entry.path || "");
  if (!file || !existsSync(file) || !statSync(file).isFile()) throw new Error("历史文件不存在，可能已删除或移动");
  if (action === "open_obsidian") {
    const target = `obsidian://open?path=${encodeURIComponent(file)}`;
    if (!dryRun) spawnOpen([target]);
    return { target };
  }
  if (action !== "show_file") throw new Error("不支持的历史动作");
  if (!dryRun) {
    if (process.platform === "darwin") spawnOpen(["-R", file]);
    else if (process.platform === "win32") spawnOpen([`/select,${file}`]);
    else spawnOpen([dirname(file)]);
  }
  return { target: file };
}

function existingFolderForDialog(path: string): string | null {
  if (!path) return null;
  try {
    if (existsSync(path) && statSync(path).isDirectory()) return path;
    const parent = dirname(path);
    if (parent && existsSync(parent) && statSync(parent).isDirectory()) return parent;
  } catch {
    // Fall back below.
  }
  return null;
}

function folderDialogStart(currentPath: unknown, appDir?: string): string {
  const current = String(currentPath || "").trim();
  const fromCurrent = existingFolderForDialog(current);
  if (fromCurrent) return fromCurrent;
  const cfg = loadConfig(appDir);
  return existingFolderForDialog(String(cfg.save_paths?.[0] || "")) || homedir();
}

function chooseFolderWithAppleScript(startingFolder: string): string {
  if (process.platform !== "darwin") return "";
  const script = [
    `set defaultFolder to POSIX file ${JSON.stringify(startingFolder)} as alias`,
    `POSIX path of (choose folder with prompt "选择保存文件夹" default location defaultFolder)`,
  ].join("\n");
  const result = spawnSync("osascript", ["-e", script], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

export async function chooseFolder(opts: { currentPath?: unknown; appDir?: string; dryRun?: boolean } = {}): Promise<string> {
  const startingFolder = folderDialogStart(opts.currentPath, opts.appDir);
  if (opts.dryRun) return startingFolder;

  try {
    const { openFileDialog } = await import("electrobun/bun");
    const selected = await openFileDialog({
      startingFolder,
      allowedFileTypes: "*",
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
    return (Array.isArray(selected) ? selected : [selected])
      .map((item) => String(item || "").trim())
      .find(Boolean) || "";
  } catch {
    return chooseFolderWithAppleScript(startingFolder);
  }
}
