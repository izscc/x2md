import { resolveSavePathsForRequest, type X2MDConfig } from "./config.ts";
import { sanitizeFilename } from "./filenames.ts";
import { buildMarkdown } from "./markdown.ts";
import { sanitizeUnicodeText } from "./unicode.ts";
import { readJsonStateSync } from "./state-store.ts";
import { runSaveTransaction } from "./save-transaction.ts";
import type { CaptureDocumentV1 } from "./contracts.ts";
import { normalizeCaptureRequest } from "./legacy-capture.ts";
import { captureKey, readSaveIndex, recordSaveRevision, updateIndexedFiles, withCaptureLock, type DuplicatePolicy } from "./save-index.ts";
import { localizeImages } from "./image-localizer.ts";

export function readSaveHistory(appDir = ""): Array<Record<string, any>> {
  const raw = readJsonStateSync<unknown>(appDir || ".", "history", () => []);
  return Array.isArray(raw) ? raw.slice(0, 20) : [];
}

export async function savePayload(data: Record<string, any>, cfg: X2MDConfig | Record<string, any>, appDir?: string, canonicalCapture?: CaptureDocumentV1): Promise<Record<string, any>> {
  const [savePaths] = resolveSavePathsForRequest(cfg, data);
  if (!savePaths.length) return { success: false, errors: ["未配置保存路径"] };
  const capture = canonicalCapture || normalizeCaptureRequest(data).capture;
  const key = captureKey(capture);
  const dir = appDir || ".";
  const requestedPolicy = String(capture.preferences?.duplicate_policy || cfg.duplicate_policy || "skip");
  const policy: DuplicatePolicy = ["skip", "update", "always_new"].includes(requestedPolicy) ? requestedPolicy as DuplicatePolicy : "skip";
  return withCaptureLock(dir, key, async () => {
    const existing = (await readSaveIndex(dir)).entries[key];
    const latest = existing?.revisions.find((item) => item.revision === existing.latest_revision);
    if (existing && policy === "skip") {
      const saved = latest?.files || [];
      return { success: true, outcome: "skipped", capture_key: key, saved, files: saved.map((path) => ({ path })), errors: [], warnings: [], media: { completed: 0, failed: 0, pending: 0 } };
    }
    const localized = await localizeImages(data, cfg, savePaths);
    const preparedData = localized.data;
    const [filename, content] = buildMarkdown(preparedData, cfg, appDir);
    const safeFilename = sanitizeUnicodeText(sanitizeFilename(filename, Number(cfg.max_filename_length || 100))) || "untitled";
    const imageErrors = Array.isArray(preparedData.image_localization_errors) ? preparedData.image_localization_errors : [];
    const contentWithImageErrors = imageErrors.length
      ? `${content}\n\n---\n\n图片本地化失败：\n${imageErrors.map((item) => `- ${item}`).join("\n")}\n`
      : content;
    const safeContent = sanitizeUnicodeText(contentWithImageErrors);
    if (existing && policy === "update" && latest?.files.length) {
      await updateIndexedFiles(latest.files, safeContent);
      const transactionId = `update-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      await recordSaveRevision(dir, capture, key, latest.files, transactionId);
      return { success: true, outcome: localized.failed ? "partial" : "updated", capture_key: key, saved: latest.files, files: latest.files.map((path) => ({ path })), errors: [], warnings: localized.warnings, media: { completed: localized.completed, failed: localized.failed, pending: 0 } };
    }
    const history = appDir ? {
      title: String(preparedData.article_title || preparedData.text || preparedData.title || safeFilename).split(/\s+/).join(" ").slice(0, 120),
      platform: String(preparedData.platform || "Twitter/X"), url: String(preparedData.url || ""), saved_at: new Date().toISOString(),
    } : undefined;
    const { saved, errors } = await runSaveTransaction({
      appDir: dir, savePaths, filename: safeFilename, content: safeContent, history,
      saveIndex: { key, capture },
    });
    const outcome = saved.length ? (errors.length ? "partial" : "saved") : "failed";
    return { success: saved.length > 0, outcome: localized.failed && saved.length ? "partial" : outcome, capture_key: key, saved, files: saved.map((path) => ({ path })), errors, warnings: localized.warnings, media: { completed: localized.completed, failed: localized.failed, pending: 0 } };
  });
}
