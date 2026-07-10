import { resolveSavePathsForRequest, type X2MDConfig } from "./config.ts";
import { sanitizeFilename } from "./filenames.ts";
import { buildMarkdown, markdownFilename } from "./markdown.ts";
import { sanitizeUnicodeText } from "./unicode.ts";
import { readJsonStateSync } from "./state-store.ts";
import { runSaveTransaction } from "./save-transaction.ts";
import type { CaptureDocumentV1 } from "./contracts.ts";
import { normalizeCaptureRequest } from "./legacy-capture.ts";
import { captureKey, readSaveIndex, recordSaveRevision, updateIndexedFiles, withCaptureLock, type DuplicatePolicy } from "./save-index.ts";
import { localizeImages } from "./image-localizer.ts";
import { planVideoMedia } from "./media-plan.ts";
import { createSaveMetrics, timeSaveStage, type SaveMetrics } from "./save-metrics.ts";
import { logSaveMetrics } from "../main/logger.ts";
import { StateStore } from "./state-store.ts";
import { randomUUID } from "node:crypto";

export type SaveHistoryEntry = {
  id: string;
  title: string;
  platform: string;
  source_url: string;
  saved_at: string;
  path: string;
  outcome?: "saved" | "updated" | "partial";
};

function safeSourceUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    if (!['http:', 'https:'].includes(url.protocol)) return "";
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:access_?token|token|auth|authorization|session|cookie|ct0)$/i.test(key) || /^utm_/i.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}

function historyTitle(data: Record<string, any>): string {
  const explicit = String(data.article_title || data.page_title || "").split(/\s+/).join(" ").trim().slice(0, 120);
  if (explicit) return explicit;
  const author = String(data.author_name || data.author || data.username || "").split(/\s+/).join(" ").trim().slice(0, 80);
  return author ? `${author} 的内容` : "未命名内容";
}

export function readSaveHistory(appDir = ""): SaveHistoryEntry[] {
  const raw = readJsonStateSync<unknown>(appDir || ".", "history", () => []);
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 50).map((item: any) => ({
    id: String(item.id || item.transaction_id || ""),
    title: String(item.title || "").slice(0, 120),
    platform: String(item.platform || "").slice(0, 40),
    source_url: safeSourceUrl(item.source_url || item.url),
    saved_at: String(item.saved_at || ""),
    path: String(item.path || ""),
    ...(item.outcome ? { outcome: item.outcome } : {}),
  })).filter((item) => item.id && item.path);
}

async function appendSaveHistory(appDir: string, entry: Omit<SaveHistoryEntry, "id">): Promise<string> {
  const id = randomUUID();
  await new StateStore(appDir).update<Array<Record<string, any>>>("history", () => [], (history) => [{ ...entry, id }, ...history].slice(0, 50));
  return id;
}

export async function savePayload(data: Record<string, any>, cfg: X2MDConfig | Record<string, any>, appDir?: string, canonicalCapture?: CaptureDocumentV1): Promise<Record<string, any>> {
  const dir = appDir || ".";
  const metrics = createSaveMetrics();
  let metricsLogged = false;
  const finish = (result: Record<string, any>, errorCode: string | null = null): Record<string, any> => {
    metrics.outcome = (["saved", "updated", "skipped", "partial", "failed"].includes(result.outcome) ? result.outcome : (result.success ? "saved" : "failed")) as SaveMetrics["outcome"];
    metrics.error_code = errorCode || result.error?.code || result.warnings?.find((item: any) => item?.code)?.code || null;
    if (!metricsLogged) {
      metricsLogged = true;
      logSaveMetrics(metrics, appDir);
    }
    return result;
  };
  let validated: { savePaths: string[]; capture: CaptureDocumentV1; key: string; policy: DuplicatePolicy };
  try {
    validated = await timeSaveStage(metrics, "validate", () => {
      const [resolved] = resolveSavePathsForRequest(cfg, data);
      const normalized = canonicalCapture || normalizeCaptureRequest(data).capture;
      const requestedPolicy = String(normalized.preferences?.duplicate_policy || cfg.duplicate_policy || "skip");
      return {
        savePaths: resolved, capture: normalized, key: captureKey(normalized),
        policy: (["skip", "update", "always_new"].includes(requestedPolicy) ? requestedPolicy : "skip") as DuplicatePolicy,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    finish({ success: false, outcome: "failed" }, String((error as any)?.code || (/保存路径|路径/.test(message) ? "PATH_DENIED" : "INVALID_CAPTURE")));
    throw error;
  }
  const { savePaths, capture, key, policy } = validated;
  metrics.target_count = savePaths.length;
  metrics.media_count = capture.media.length;
  if (!savePaths.length) return finish({ success: false, outcome: "failed", errors: ["未配置保存路径"] }, "PATH_UNAVAILABLE");
  return withCaptureLock(dir, key, async () => {
    const existing = await timeSaveStage(metrics, "dedupe", async () => (await readSaveIndex(dir)).entries[key]);
    const latest = existing?.revisions.find((item) => item.revision === existing.latest_revision);
    if (existing && policy === "skip") {
      const saved = latest?.files || [];
      const historyId = readSaveHistory(dir).find((item) => saved.includes(item.path))?.id;
      return finish({ success: true, outcome: "skipped", capture_key: key, saved, files: saved.map((path, index) => ({ path, ...(historyId && index === 0 ? { history_id: historyId } : {}) })), errors: [], warnings: [], media: { completed: 0, failed: 0, pending: 0 } });
    }
    const { localized, videoPlan } = await timeSaveStage(metrics, "media", async () => {
      const localized = await localizeImages(data, cfg, savePaths);
      const videoPlan = await planVideoMedia(localized.data, cfg, markdownFilename(localized.data, cfg));
      return { localized, videoPlan };
    });
    metrics.media_completed = localized.completed + videoPlan.completed;
    metrics.media_failed = localized.failed + videoPlan.failed;
    const preparedData = videoPlan.data;
    const { safeFilename, safeContent } = await timeSaveStage(metrics, "render", () => {
      const [filename, content] = buildMarkdown(preparedData, cfg, appDir);
      const safeFilename = sanitizeUnicodeText(sanitizeFilename(filename, Number(cfg.max_filename_length || 100))) || "untitled";
      const imageErrors = Array.isArray(preparedData.image_localization_errors) ? preparedData.image_localization_errors : [];
      const contentWithImageErrors = imageErrors.length
        ? `${content}\n\n---\n\n图片本地化失败：\n${imageErrors.map((item) => `- ${item}`).join("\n")}\n`
        : content;
      return { safeFilename, safeContent: sanitizeUnicodeText(contentWithImageErrors) };
    });
    if (existing && policy === "update" && latest?.files.length) {
      await timeSaveStage(metrics, "write", async () => {
        await updateIndexedFiles(latest.files, safeContent);
        const transactionId = `update-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        await recordSaveRevision(dir, capture, key, latest.files, transactionId);
      });
      const failedMedia = localized.failed + videoPlan.failed;
      const historyId = await appendSaveHistory(dir, {
        title: historyTitle(preparedData),
        platform: String(preparedData.platform || "Twitter/X").slice(0, 40), source_url: safeSourceUrl(preparedData.url), saved_at: new Date().toISOString(), path: latest.files[0], outcome: failedMedia ? "partial" : "updated",
      });
      return finish({ success: true, outcome: failedMedia ? "partial" : "updated", capture_key: key, saved: latest.files, files: latest.files.map((path, index) => ({ path, ...(index === 0 ? { history_id: historyId } : {}) })), errors: [], warnings: [...localized.warnings, ...videoPlan.warnings], media: { completed: localized.completed + videoPlan.completed, failed: failedMedia, pending: 0 } });
    }
    const history = appDir ? {
      title: historyTitle(preparedData),
      platform: String(preparedData.platform || "Twitter/X").slice(0, 40), source_url: safeSourceUrl(preparedData.url), saved_at: new Date().toISOString(),
      outcome: (localized.failed + videoPlan.failed) ? "partial" : "saved",
    } : undefined;
    const { saved, errors, transactionId } = await timeSaveStage(metrics, "write", () => runSaveTransaction({
      appDir: dir, savePaths, filename: safeFilename, content: safeContent, history,
      saveIndex: { key, capture },
    }));
    const outcome = saved.length ? (errors.length ? "partial" : "saved") : "failed";
    const failedMedia = localized.failed + videoPlan.failed;
    const result = { success: saved.length > 0, outcome: failedMedia && saved.length ? "partial" : outcome, capture_key: key, saved, files: saved.map((path, index) => ({ path, ...(index === 0 ? { history_id: transactionId } : {}) })), errors, warnings: [...localized.warnings, ...videoPlan.warnings], media: { completed: localized.completed + videoPlan.completed, failed: failedMedia, pending: 0 } };
    return finish(result, saved.length ? null : "WRITE_FAILED");
  }).catch((error) => {
    finish({ success: false, outcome: "failed" }, String((error as any)?.code || "WRITE_FAILED"));
    throw error;
  });
}
