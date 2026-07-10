import { mkdirSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

import { resolveSavePathsForRequest, type X2MDConfig } from "./config.ts";
import { sanitizeFilename } from "./filenames.ts";
import { buildMarkdown } from "./markdown.ts";
import { sanitizeUnicodeText } from "./unicode.ts";
import { readJsonStateSync } from "./state-store.ts";
import { runSaveTransaction } from "./save-transaction.ts";

export function readSaveHistory(appDir = ""): Array<Record<string, any>> {
  const raw = readJsonStateSync<unknown>(appDir || ".", "history", () => []);
  return Array.isArray(raw) ? raw.slice(0, 20) : [];
}

function statusIdFromUrl(url: unknown): string {
  return String(url || "").match(/\/status\/(\d+)/)?.[1] || "misc";
}

function imageExtension(url: string, contentType = ""): string {
  const fromType = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : contentType.includes("gif") ? ".gif" : contentType.includes("jpeg") || contentType.includes("jpg") ? ".jpg" : "";
  if (fromType) return fromType;
  try {
    const ext = extname(new URL(url).pathname);
    return ext || ".jpg";
  } catch {
    return ".jpg";
  }
}

function isTwitterPayload(data: Record<string, any>): boolean {
  const platform = String(data.platform || "").toLowerCase();
  const url = String(data.url || "");
  return platform === "x" || platform.includes("twitter") || /https?:\/\/(?:x|twitter)\.com\//i.test(url);
}

async function localizeImages(data: Record<string, any>, cfg: Record<string, any>, saveRoot: string): Promise<Record<string, any>> {
  if (!cfg.download_images || isTwitterPayload(data)) return data;
  const images = Array.isArray(data.images) ? data.images : [];
  if (!images.length) return data;

  const root = String(cfg.image_attachment_path || "X2MD-attachments");
  const statusId = statusIdFromUrl(data.url);
  const attachDir = root.startsWith("/") ? join(root, statusId) : join(saveRoot, root, statusId);
  const displayRoot = root.startsWith("/") ? root : root.replace(/^\.?\//, "");
  const nextImages: string[] = [];
  const failures: string[] = [];
  mkdirSync(attachDir, { recursive: true });

  for (let index = 0; index < images.length; index += 1) {
    const url = String(images[index] || "");
    try {
      const response = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      const filename = `image_${index + 1}${imageExtension(url, response.headers.get("content-type") || "")}`;
      writeFileSync(join(attachDir, filename), buffer);
      const relativePath = `${displayRoot}/${statusId}/${filename}`;
      nextImages.push(cfg.image_embed_style === "obsidian" ? `![[${relativePath}]]` : relativePath);
    } catch (error) {
      failures.push(`${url} (${error instanceof Error ? error.message : String(error)})`);
      nextImages.push(url);
    }
  }

  return { ...data, images: nextImages, image_localization_errors: failures };
}

export async function savePayload(data: Record<string, any>, cfg: X2MDConfig | Record<string, any>, appDir?: string): Promise<Record<string, any>> {
  const [savePaths] = resolveSavePathsForRequest(cfg, data);
  if (!savePaths.length) return { success: false, errors: ["未配置保存路径"] };

  const preparedData = await localizeImages(data, cfg, savePaths[0]);
  const [filename, content] = buildMarkdown(preparedData, cfg, appDir);
  const safeFilename = sanitizeUnicodeText(sanitizeFilename(filename, Number(cfg.max_filename_length || 100))) || "untitled";
  const imageErrors = Array.isArray(preparedData.image_localization_errors) ? preparedData.image_localization_errors : [];
  const contentWithImageErrors = imageErrors.length
    ? `${content}\n\n---\n\n图片本地化失败：\n${imageErrors.map((item) => `- ${item}`).join("\n")}\n`
    : content;
  const safeContent = sanitizeUnicodeText(contentWithImageErrors);
  const history = appDir ? {
    title: String(preparedData.article_title || preparedData.text || preparedData.title || safeFilename).split(/\s+/).join(" ").slice(0, 120),
    platform: String(preparedData.platform || "Twitter/X"),
    url: String(preparedData.url || ""),
    saved_at: new Date().toISOString(),
  } : undefined;
  const { saved, errors } = await runSaveTransaction({ appDir: appDir || ".", savePaths, filename: safeFilename, content: safeContent, history });
  return saved.length ? { success: true, saved, errors } : { success: false, errors };
}
