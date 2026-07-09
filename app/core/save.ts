import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveSavePathsForRequest, type X2MDConfig } from "./config.ts";
import { sanitizeFilename } from "./filenames.ts";
import { buildMarkdown } from "./markdown.ts";
import { sanitizeUnicodeText } from "./unicode.ts";

function timestamp(): string {
  return new Date().toTimeString().slice(0, 8).replace(/:/g, "");
}

function historyPath(appDir = ""): string {
  return join(appDir || ".", "save_history.json");
}

export function readSaveHistory(appDir = ""): Array<Record<string, any>> {
  const file = historyPath(appDir);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(raw) ? raw.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function appendSaveHistory(data: Record<string, any>, saved: string[], appDir = ""): void {
  if (!appDir || !saved.length) return;
  const title = String(data.article_title || data.text || data.title || saved[0]).split(/\s+/).join(" ").slice(0, 120);
  const item = {
    title,
    platform: String(data.platform || "Twitter/X"),
    url: String(data.url || ""),
    path: saved[0],
    saved_at: new Date().toISOString(),
  };
  const history = [item, ...readSaveHistory(appDir)].slice(0, 20);
  mkdirSync(appDir, { recursive: true });
  writeFileSync(historyPath(appDir), JSON.stringify(history, null, 2), "utf8");
}

export function savePayload(data: Record<string, any>, cfg: X2MDConfig | Record<string, any>, appDir?: string): Record<string, any> {
  const [savePaths] = resolveSavePathsForRequest(cfg, data);
  if (!savePaths.length) return { success: false, errors: ["未配置保存路径"] };

  const [filename, content] = buildMarkdown(data, cfg, appDir);
  const safeFilename = sanitizeUnicodeText(sanitizeFilename(filename, Number(cfg.max_filename_length || 100))) || "untitled";
  const safeContent = sanitizeUnicodeText(content);
  const saved: string[] = [];
  const errors: string[] = [];

  for (const savePath of savePaths) {
    try {
      mkdirSync(savePath, { recursive: true });
      let filepath = join(savePath, `${safeFilename}.md`);
      if (existsSync(filepath)) filepath = join(savePath, `${safeFilename}_${timestamp()}.md`);
      writeFileSync(filepath, safeContent, "utf8");
      saved.push(filepath);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (saved.length) appendSaveHistory(data, saved, appDir);
  return saved.length ? { success: true, saved, errors } : { success: false, errors };
}
