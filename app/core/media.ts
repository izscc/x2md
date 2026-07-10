import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { logPath } from "./config.ts";
import { safeDownload, SafeDownloadError } from "./safe-download.ts";

function logVideo(appDir: string | undefined, message: string): void {
  if (!appDir) return;
  try {
    const file = logPath(appDir);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, `${new Date().toISOString()} ${message}\n`, "utf8");
  } catch {
    // ponytail: video download logging is best-effort; never break saving Markdown.
  }
}

export function downloadVideoAsync(url: string, savePath: string, filename: string, appDir?: string): void {
  void (async () => {
    logVideo(appDir, `视频下载开始：${filename}`);
    try {
      mkdirSync(savePath, { recursive: true });
      await safeDownload(url, join(savePath, filename), { allowedContentTypes: ["video/", "application/octet-stream"], maxBytes: 1024 * 1024 * 1024, timeoutMs: 10 * 60_000 });
      logVideo(appDir, `视频下载完成：${filename}`);
    } catch (error) {
      const code = error instanceof SafeDownloadError ? error.code : "MEDIA_WRITE_FAILED";
      logVideo(appDir, `视频下载失败：${filename} [${code}] ${error instanceof Error ? error.message : String(error)}`);
      console.error("视频流下载失败:", error);
    }
  })();
}
