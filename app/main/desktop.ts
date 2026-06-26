import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { homedir } from "node:os";

import { getAppDir, loadConfig, logPath } from "../core/config.ts";
import { log } from "./logger.ts";

let settingsWindow: any;

export function settingsUrl(appDir = getAppDir(), port?: number): string {
  return `views://settings/index.html#port=${encodeURIComponent(String(port || loadConfig(appDir).port || 9527))}`;
}

function escapeInlineScript(script: string): string {
  return script.replace(/<\/script/gi, "<\\/script");
}

function escapeInlineStyle(style: string): string {
  return style.replace(/<\/style/gi, "<\\/style");
}

export function inlineSettingsHtml(html: string, css: string, script: string, port: number | string): string {
  const withCss = html.replace(
    /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/,
    `<style>${escapeInlineStyle(css)}</style>`,
  );
  return withCss.replace(
    /<script\s+type="module"\s+src="settings\.js"><\/script>/,
    `<script>globalThis.X2MD_PORT = ${JSON.stringify(String(port))};</script><script type="module">${escapeInlineScript(script)}</script>`,
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

export function settingsHtml(port: number | string, executable = process.execPath): string {
  const settingsRoot = join(settingsViewsRootForExecutable(executable), "settings");
  const html = readFirst([join(settingsRoot, "index.html"), resolve("app/ui/settings/index.html")]);
  const css = readFirst([join(settingsRoot, "styles.css"), resolve("app/ui/settings/styles.css")]) || "";
  const script = readFirst([join(settingsRoot, "settings.js")]);

  if (html && script) return inlineSettingsHtml(html, css, script, port);

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>X2MD 设置</title><style>body{font:16px -apple-system,BlinkMacSystemFont,sans-serif;padding:32px;color:#111}code{background:#eee;padding:2px 4px;border-radius:4px}</style></head><body><h1>X2MD 设置</h1><p>设置页资源未找到，请重新安装 X2MD。</p><p><code>${settingsRoot}</code></p></body></html>`;
}

export async function showSettingsWindow(appDir = getAppDir(), port?: number): Promise<void> {
  try {
    const { BrowserWindow } = await import("electrobun/bun");
    const configuredPort = port || loadConfig(appDir).port || 9527;
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

    const viewsRoot = settingsViewsRootForExecutable();
    const entry = join(viewsRoot, "settings", "index.html");
    const hasPackagedView = existsSync(entry);
    const windowOptions = hasPackagedView
      ? { url: settingsUrl(appDir, configuredPort), viewsRoot }
      : { html: settingsHtml(configuredPort), viewsRoot };

    settingsWindow = new BrowserWindow({
      title: "X2MD 设置",
      ...windowOptions,
      frame: { x: 120, y: 120, width: 980, height: 720 },
    });
    log(`设置页已打开：${hasPackagedView ? "views" : "inline"} viewsRoot=${viewsRoot}`, appDir);
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
