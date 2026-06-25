import { homedir } from "node:os";
import { join } from "node:path";

import { type X2MDConfig } from "./config.ts";
import { formatDate, formatDateTime } from "./dates.ts";
import { sanitizeFilename, normalizeImageUrl } from "./filenames.ts";
import { downloadVideoAsync } from "./media.ts";

function cleanupTwitterDisplayUrlLineBreaks(text: string): string {
  return text.replace(
    /(^|[^\w])https?:\/\/[ \t]*\n[ \t]*((?:www\.)?[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(?:\/[^\s]*)?)/g,
    "$1$2",
  );
}

function normalizeTranslationText(value: unknown): string {
  return cleanupTwitterDisplayUrlLineBreaks(String(value ?? "").replace(/\u00a0/g, " ")).trim();
}

export function applyTranslationOverride(data: Record<string, any>): Record<string, any> {
  if (!data.prefer_translated_content || !data.translation_override || typeof data.translation_override !== "object") return data;
  const result = { ...data };
  const override = result.translation_override || {};
  const overrideType = String(override.type || "").toLowerCase();

  if (overrideType === "article" || result.type === "article") {
    const title = normalizeTranslationText(override.article_title || override.title || "");
    const content = normalizeTranslationText(override.article_content || override.content || override.text || "");
    if (title) result.article_title = title;
    if (content) result.article_content = content;
    if (title || content) result.type = "article";
    return result;
  }

  const text = normalizeTranslationText(override.text || override.article_content || "");
  if (text) result.text = text;
  return result;
}

function compactAlt(value: unknown): string {
  return String(value ?? "").split(/\s+/).filter(Boolean).join(" ").trim();
}

function getImageAltText(imgUrl: string, altMap: unknown): string {
  if (!altMap || typeof altMap !== "object") return "";
  const map = altMap as Record<string, unknown>;
  const candidates = [
    imgUrl,
    normalizeImageUrl(imgUrl),
    String(imgUrl).split("?")[0],
    normalizeImageUrl(String(imgUrl).split("?")[0]),
  ];
  for (const key of candidates) {
    const value = map[key];
    if (typeof value === "string" && value.trim()) return compactAlt(value);
  }
  return "";
}

function appendAltFence(lines: string[], altText: unknown, prefix = ""): void {
  const alt = compactAlt(altText).replace(/```/g, "``\u200b`");
  if (!alt) return;
  lines.push(`${prefix}\`\`\``);
  lines.push(`${prefix}${alt}`);
  lines.push(`${prefix}\`\`\``);
}

function appendImage(lines: string[], imgUrl: string, label = "", prefix = "", altMap?: unknown): void {
  const origUrl = normalizeImageUrl(imgUrl);
  lines.push(`${prefix}![${label}](${origUrl})`);
  appendAltFence(lines, getImageAltText(origUrl, altMap), prefix);
}

export function buildMarkdown(input: Record<string, any>, cfg: X2MDConfig | Record<string, any>, appDir?: string): [string, string] {
  const data = applyTranslationOverride(input);
  const author = data.author || "unknown";
  const handle = data.handle || "";
  const text = data.text || "";
  const url = data.url || "";
  const published = data.published || "";
  const contentType = data.type || "tweet";
  let images: string[] = Array.isArray(data.images) ? data.images : [];
  const imageAltTexts = data.image_alt_texts || {};
  const videos: string[] = Array.isArray(data.videos) ? data.videos : [];
  const downloadVideo = Boolean(data.download_video) && cfg.enable_video_download !== false;
  const articleContent = data.article_content || "";
  const articleTitle = data.article_title || "";
  const threadTweets: Array<Record<string, any>> = Array.isArray(data.thread_tweets) ? data.thread_tweets : [];
  const quoteTweet = data.quote_tweet || {};
  const platform = data.platform || "Twitter/X";

  const dateStr = formatDate();
  const datetimeStr = formatDateTime();
  const summarySrc = articleTitle || text;
  const maxLen = Number(cfg.max_filename_length || 100);
  const summaryShort = sanitizeFilename(summarySrc || "untitled", maxLen);
  const authorClean = sanitizeFilename(handle ? String(handle).replace(/^@/, "") : author, 20);
  const fmt = String(cfg.filename_format || "{summary}");
  const filename = fmt
    .replace("{date}", dateStr)
    .replace("{author}", authorClean)
    .replace("{summary}", summaryShort)
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  const titleSrc = articleTitle || text;
  let title = String(titleSrc).split(/\s+/).filter(Boolean).join(" ");
  title = `${title.slice(0, 80)}${title.length > 80 ? "…" : ""}`.replace(/"/g, "'");
  const authorUrl = data.author_url ?? (handle ? `https://x.com/${String(handle).replace(/^@/, "")}` : "");

  const frontMatter = `---
title: "${title}"
tags: []
源: "${url}"
作者主页: "${authorUrl}"
创建时间: "${datetimeStr}"
发布时间: "${published}"
平台: "${platform}"
类别: "[[剪报]]"
阅读状态: false
整理: false
---
`;

  const lines: string[] = [];
  const videoMap: Record<string, string> = {};
  const saveDir = String(cfg.video_save_path || join(homedir(), "Desktop", "X2MD", "Videos"));
  const allVideos = [...videos];
  if (quoteTweet) allVideos.push(...(quoteTweet.videos || []));
  for (const tweet of threadTweets) {
    allVideos.push(...(tweet.videos || []));
    if (tweet.quote_tweet) allVideos.push(...(tweet.quote_tweet.videos || []));
  }

  let videoIdx = 1;
  for (const vidUrl of allVideos) {
    if (videoMap[vidUrl]) continue;
    if (downloadVideo) {
      const vidFilename = `${filename}_video_${videoIdx}.mp4`;
      downloadVideoAsync(vidUrl, saveDir, vidFilename, appDir);
      videoMap[vidUrl] = `![[${vidFilename}]]`;
      videoIdx += 1;
    } else {
      videoMap[vidUrl] = `🎞️ [推特媒体：点击播放视频](${vidUrl})`;
    }
  }

  const appendUnusedVideos = (linesList: string[], contentText: string) => {
    if (!videos.length) return;
    const unused = videos.filter((v) => !String(contentText || "").includes(`[MEDIA_VIDEO_URL:${v}]`));
    if (!unused.length) return;
    linesList.push("");
    for (const v of unused) linesList.push(videoMap[v]);
  };

  const appendQuoteTweet = (linesList: string[], quote: Record<string, any>) => {
    if (!quote) return;
    const qText = String(quote.text || "").trim();
    const qImages: string[] = quote.images || [];
    const qImageAltTexts = quote.image_alt_texts || {};
    const qVideos: string[] = quote.videos || [];
    const qUrl = String(quote.url || "").trim();
    if (!qText && !qImages.length && !qVideos.length && !qUrl) return;

    linesList.push("");
    linesList.push("> [!quote] 引用推文");
    if (qText) {
      for (const line of qText.split(/\r?\n/)) linesList.push(line.trim() ? `> ${line}` : ">");
    }
    for (const imgUrl of qImages) {
      linesList.push(">");
      appendImage(linesList, imgUrl, "", "> ", qImageAltTexts);
    }
    for (const videoUrl of qVideos) {
      if (videoMap[videoUrl]) {
        linesList.push(">");
        linesList.push(`> ${videoMap[videoUrl]}`);
      }
    }
    if (qUrl) {
      linesList.push(">");
      linesList.push(`> 原文：${qUrl}`);
    }
  };

  if (downloadVideo && videos.length) images = images.filter((img) => !String(img).includes("video_thumb"));

  if (contentType === "article") {
    let textResult = "";
    if (articleContent) {
      textResult = String(articleContent).trim();
      for (const [videoUrl, mdRef] of Object.entries(videoMap)) {
        textResult = textResult.replaceAll(`[MEDIA_VIDEO_URL:${videoUrl}]`, mdRef);
      }
      lines.push(textResult);
    }
    appendUnusedVideos(lines, textResult);
  } else {
    let textResult = String(text).trim();
    for (const [videoUrl, mdRef] of Object.entries(videoMap)) {
      textResult = textResult.replaceAll(`[MEDIA_VIDEO_URL:${videoUrl}]`, mdRef);
    }
    lines.push(textResult);

    if (images.length) {
      lines.push("");
      images.forEach((imgUrl, index) => appendImage(lines, imgUrl, String(index + 1), "", imageAltTexts));
    }
    appendUnusedVideos(lines, textResult);
    appendQuoteTweet(lines, quoteTweet);

    threadTweets.forEach((tweet, idx) => {
      const twText = String(tweet.text || "").trim();
      const twImages: string[] = tweet.images || [];
      const twVideos: string[] = tweet.videos || [];
      const twQuote = tweet.quote_tweet || {};
      if (!twText && !twImages.length && !twVideos.length && !twQuote) return;
      lines.push("\n---\n");
      if (twText) lines.push(twText);
      if (twImages.length) {
        lines.push("");
        const twImageAltTexts = tweet.image_alt_texts || {};
        twImages.forEach((imgUrl, i) => appendImage(lines, imgUrl, `${idx + 2}-${i + 1}`, "", twImageAltTexts));
      }
      if (twVideos.length) {
        lines.push("");
        for (const vUrl of twVideos) if (videoMap[vUrl]) lines.push(videoMap[vUrl]);
      }
      appendQuoteTweet(lines, twQuote);
    });
  }

  return [filename, `${frontMatter}\n${lines.join("\n")}`];
}
