import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { safeDownload, SafeDownloadError } from "./safe-download.ts";

type Download = typeof safeDownload;
export type MediaWarning = { code: string; message: string; url: string };

function videoUrls(data: Record<string, any>): string[] {
  const urls: string[] = [];
  const visit = (item: unknown): void => {
    if (!item || typeof item !== "object") return;
    const value = item as Record<string, any>;
    if (Array.isArray(value.videos)) urls.push(...value.videos.map(String));
    visit(value.quote_tweet);
    if (Array.isArray(value.thread_tweets)) value.thread_tweets.forEach(visit);
  };
  visit(data);
  return [...new Set(urls.filter(Boolean))];
}

function withVideoRenderMap(data: Record<string, any>, videoRenderMap: Record<string, string>): Record<string, any> {
  const result: Record<string, any> = { ...data, video_render_map: videoRenderMap };
  if (result.quote_tweet && typeof result.quote_tweet === "object") result.quote_tweet = withVideoRenderMap(result.quote_tweet, videoRenderMap);
  if (Array.isArray(result.thread_tweets)) result.thread_tweets = result.thread_tweets.map((item: unknown) => item && typeof item === "object" ? withVideoRenderMap(item as Record<string, any>, videoRenderMap) : item);
  return result;
}

export async function planVideoMedia(
  data: Record<string, any>, cfg: Record<string, any>, filename: string,
  options: { download?: Download; requested?: boolean } = {},
): Promise<{ data: Record<string, any>; warnings: MediaWarning[]; completed: number; failed: number }> {
  const urls = videoUrls(data);
  const requested = options.requested ?? Boolean(data.download_video);
  const videoRenderMap: Record<string, string> = {};
  if (!requested || cfg.enable_video_download === false || !urls.length) {
    for (const url of urls) videoRenderMap[url] = `🎞️ [推特媒体：点击播放视频](${url})`;
    return { data: withVideoRenderMap(data, videoRenderMap), warnings: [], completed: 0, failed: 0 };
  }

  const download = options.download || safeDownload;
  const savePath = String(cfg.video_save_path || join(homedir(), "Desktop", "X2MD", "Videos"));
  await mkdir(savePath, { recursive: true });
  const warnings: MediaWarning[] = [];
  let completed = 0;
  for (let index = 0; index < urls.length; index += 1) {
    const url = urls[index];
    const videoFilename = `${filename}_video_${index + 1}.mp4`;
    try {
      await download(url, join(savePath, videoFilename), {
        allowedContentTypes: ["video/", "application/octet-stream"],
        maxBytes: 1024 * 1024 * 1024, timeoutMs: 10 * 60_000,
      });
      videoRenderMap[url] = `![[${videoFilename}]]`;
      completed += 1;
    } catch (error) {
      const code = error instanceof SafeDownloadError ? error.code : "MEDIA_WRITE_FAILED";
      warnings.push({ code, message: "视频下载失败，已保留远程链接", url });
      videoRenderMap[url] = `🎞️ [推特媒体：点击播放视频](${url})`;
    }
  }
  return { data: withVideoRenderMap(data, videoRenderMap), warnings, completed, failed: warnings.length };
}
