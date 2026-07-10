import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { type X2MDConfig, profileStatePath } from "./config.ts";
import { formatDateTime, nowIsoSeconds, parseTwitterDatetime, profileDateKey, profileTimeLabel } from "./dates.ts";
import { normalizeArticleUrl, normalizeImageUrl, sanitizeFilename } from "./filenames.ts";
import { readJsonStateSync, writeJsonStateSync } from "./state-store.ts";

export function normalizeProfileHandle(handle: unknown): string {
  return String(handle ?? "").replace(/^@/, "").replace(/[^A-Za-z0-9_]/g, "").toLowerCase();
}

function extractStatusId(url: unknown): string {
  return String(url ?? "").match(/\/status\/(\d+)/)?.[1] || "";
}

function profileAuthorLabel(profile: Record<string, any>): string {
  return String(profile.displayName || profile.display_name || normalizeProfileHandle(profile.handle) || "X博主").trim();
}

function resolveProfileCaptureDir(cfg: X2MDConfig | Record<string, any>, profile: Record<string, any>): string {
  let base = String(cfg.profile_capture_save_path || "").trim();
  if (!base) {
    const savePaths = Array.isArray(cfg.save_paths) ? cfg.save_paths : [];
    base = savePaths[0] || join(homedir(), "Desktop", "X2MD", "MD");
  }
  const display = String(profile.displayName || profile.display_name || normalizeProfileHandle(profile.handle) || "X博主").trim();
  const handle = normalizeProfileHandle(profile.handle);
  let dirname = sanitizeFilename(display, 60) || handle || "X博主";
  if (handle && !dirname.toLowerCase().includes(handle)) dirname = sanitizeFilename(`${dirname}_${handle}`, 80);
  return join(base, dirname);
}

export function loadProfileCaptureState(appDir?: string): Record<string, any> {
  const state = readJsonStateSync<unknown>(appDir || dirname(profileStatePath(appDir)), "profile", () => ({ profiles: {} }));
  if (state && typeof state === "object" && !Array.isArray(state)) {
    const record = state as Record<string, any>;
    record.profiles ||= {};
    return record;
  }
  return { profiles: {} };
}

export function saveProfileCaptureState(state: Record<string, any>, appDir?: string): void {
  const dir = appDir || dirname(profileStatePath(appDir));
  writeJsonStateSync(dir, "profile", state);
}

export function getProfileStateBucket(state: Record<string, any>, handle: unknown): Record<string, any> {
  const key = normalizeProfileHandle(handle) || "unknown";
  const profiles = state.profiles ||= {};
  const bucket = profiles[key] ||= {};
  bucket.tweets ||= { captured_ids: {}, daily: {} };
  bucket.articles ||= { captured_urls: {} };
  return bucket;
}

function appendProfileImage(lines: string[], imgUrl: string, altMap?: Record<string, any>, prefix = ""): void {
  if (!imgUrl) return;
  const origUrl = normalizeImageUrl(imgUrl);
  lines.push(`${prefix}![](${origUrl})`);
  const alt = String(altMap?.[origUrl] || altMap?.[imgUrl] || altMap?.[String(imgUrl).split("?")[0]] || "")
    .split(/\s+/).filter(Boolean).join(" ").trim();
  if (alt) {
    lines.push(`${prefix}\`\`\``);
    lines.push(`${prefix}${alt.replace(/```/g, "``\u200b`")}`);
    lines.push(`${prefix}\`\`\``);
  }
}

function appendProfileQuote(lines: string[], quote: Record<string, any>): void {
  if (!quote || typeof quote !== "object") return;
  const qText = String(quote.text || "").trim();
  const qImages: string[] = quote.images || [];
  const qVideos: string[] = quote.videos || [];
  const qUrl = String(quote.url || "").trim();
  if (!qText && !qImages.length && !qVideos.length && !qUrl) return;

  lines.push("");
  lines.push("> [!quote] 引用推文");
  if (qText) for (const line of qText.split(/\r?\n/)) lines.push(line.trim() ? `> ${line}` : ">");
  for (const imgUrl of qImages) {
    lines.push(">");
    appendProfileImage(lines, imgUrl, quote.image_alt_texts || {}, "> ");
  }
  for (const videoUrl of qVideos) {
    lines.push(">");
    lines.push(`> 🎞️ [视频](${videoUrl})`);
  }
  if (qUrl) {
    lines.push(">");
    lines.push(`> 原文：${qUrl}`);
  }
}

function buildProfileTweetEntry(tweet: Record<string, any>): string {
  const url = String(tweet.url || "").trim();
  const published = String(tweet.published || "").trim();
  const text = String(tweet.text || "").trim();
  const lines = [url ? `## ${profileTimeLabel(published)} · [原文](${url})` : `## ${profileTimeLabel(published)}`, ""];

  if (text) lines.push(text);
  else if (tweet.article_title) lines.push(String(tweet.article_title).trim());

  const images: string[] = tweet.images || [];
  if (images.length) {
    lines.push("");
    for (const imgUrl of images) appendProfileImage(lines, imgUrl, tweet.image_alt_texts || {});
  }

  const videos: string[] = tweet.videos || [];
  if (videos.length) {
    lines.push("");
    for (const videoUrl of videos) lines.push(`🎞️ [视频](${videoUrl})`);
  }

  appendProfileQuote(lines, tweet.quote_tweet || {});

  const threadTweets: Array<Record<string, any>> = tweet.thread_tweets || [];
  threadTweets.forEach((child, index) => {
    if (!child || typeof child !== "object") return;
    const childText = String(child.text || "").trim();
    const childImages: string[] = child.images || [];
    const childVideos: string[] = child.videos || [];
    const childQuote = child.quote_tweet || {};
    if (!childText && !childImages.length && !childVideos.length && !childQuote) return;
    lines.push("", `### 续推 ${index + 1}`, "");
    if (childText) lines.push(childText);
    for (const imgUrl of childImages) appendProfileImage(lines, imgUrl, child.image_alt_texts || {});
    for (const videoUrl of childVideos) lines.push(`🎞️ [视频](${videoUrl})`);
    appendProfileQuote(lines, childQuote);
  });

  return lines.join("\n").trim();
}

function buildProfileDailyHeader(profile: Record<string, any>, dateKey: string, rangeLabel: string): string {
  const author = profileAuthorLabel(profile);
  const handle = normalizeProfileHandle(profile.handle);
  let profileUrl = String(profile.profileUrl || profile.profile_url || "").trim();
  if (!profileUrl && handle) profileUrl = `https://x.com/${handle}`;
  const title = `${author} 推文 ${dateKey}`.replace(/"/g, "'");
  return `---
title: "${title}"
tags: []
源: "${profileUrl}"
作者主页: "${profileUrl}"
创建时间: "${formatDateTime()}"
发布时间: "${dateKey}"
平台: "Twitter/X"
类别: "[[剪报]]"
阅读状态: false
整理: false
---

# ${author} 推文 ${dateKey}

> 抓取范围：${rangeLabel || "按设置"}
> 排列方式：按 X 时间线从新到旧排列；已自动排除转发/转载。

<!-- X2MD_PROFILE_TIMELINE -->
`;
}

function writeProfileDailyFile(filepath: string, header: string, entries: string[], opts: { prepend: boolean; overwrite: boolean }): string {
  const body = entries.filter((entry) => entry.trim()).join("\n\n---\n\n").trim();
  if (opts.overwrite || !existsSync(filepath)) {
    writeFileSync(filepath, `${header.trimEnd()}\n\n${body}\n`, "utf8");
    return filepath;
  }

  const old = readFileSync(filepath, "utf8").trimEnd();
  const marker = "<!-- X2MD_PROFILE_TIMELINE -->";
  let merged: string;
  if (old.includes(marker)) {
    const [prefix, rest] = old.split(marker, 2);
    merged = opts.prepend
      ? `${prefix.trimEnd()}\n\n${marker}\n\n${body}\n\n---\n\n${rest.trim()}\n`
      : `${old}\n\n---\n\n${body}\n`;
  } else {
    merged = `${old}\n\n---\n\n${body}\n`;
  }
  writeFileSync(filepath, merged, "utf8");
  return filepath;
}

function buildProfileArticleMarkdown(article: Record<string, any>, profile: Record<string, any>): string {
  const title = String(article.article_title || article.title || "Untitled").trim();
  let content = String(article.article_content || article.content || "").trim();
  const url = normalizeArticleUrl(article.url || article.article_url || "");
  const published = String(article.published || "").trim();
  const author = profileAuthorLabel(profile);
  const profileUrl = String(profile.profileUrl || profile.profile_url || "").trim();
  const safeTitle = title.split(/\s+/).join(" ").replace(/"/g, "'").slice(0, 100);

  for (const videoUrl of article.videos || []) content = content.replaceAll(`[MEDIA_VIDEO_URL:${videoUrl}]`, `🎞️ [视频](${videoUrl})`);

  const imageLines: string[] = [];
  for (const imageUrl of article.images || []) {
    const normalized = normalizeImageUrl(String(imageUrl).trim());
    if (!normalized) continue;
    const bare = normalized.split("?")[0];
    if (content.includes(normalized) || content.includes(bare)) continue;
    imageLines.push(`![](${normalized})`);
  }
  if (imageLines.length) content = `${content.trimEnd()}\n\n${[...new Set(imageLines)].join("\n\n")}`;

  return `---
title: "${safeTitle}"
tags: []
源: "${url}"
作者主页: "${profileUrl}"
创建时间: "${formatDateTime()}"
发布时间: "${published}"
平台: "Twitter/X"
类别: "[[剪报]]"
阅读状态: false
整理: false
---

# ${title}

> 作者：${author}
> 原文：${url}

${content}
`;
}

export function handleProfileCaptureSave(data: Record<string, any>, cfg: X2MDConfig | Record<string, any>, appDir?: string): Record<string, any> {
  const mode = String(data.mode || "tweets").trim();
  const profile = data.profile && typeof data.profile === "object" ? data.profile : {};
  const handle = normalizeProfileHandle(profile.handle);
  const forceFull = Boolean(data.force_full);
  const items: Array<Record<string, any>> = Array.isArray(data.items) ? data.items : [];
  const rangeLabel = String(data.range_label || "").trim();
  const targetDir = resolveProfileCaptureDir(cfg, profile);
  mkdirSync(targetDir, { recursive: true });

  const state = loadProfileCaptureState(appDir);
  const bucket = getProfileStateBucket(state, handle);
  const savedFiles: string[] = [];
  let skipped = 0;

  if (mode === "articles") {
    const articleState = bucket.articles ||= { captured_urls: {} };
    const capturedUrls = articleState.captured_urls ||= {};
    for (const article of items) {
      if (!article || typeof article !== "object") continue;
      const url = normalizeArticleUrl(article.url || article.article_url || "");
      if (!url) continue;
      if (!forceFull && capturedUrls[url]) {
        skipped += 1;
        continue;
      }
      article.url = url;
      const dateKey = profileDateKey(article.published || "");
      const title = String(article.article_title || article.title || "Untitled").trim();
      const filename = sanitizeFilename(`${profileAuthorLabel(profile)}文章${dateKey}_${title}`, 120) || `文章${dateKey}`;
      let filepath = join(targetDir, `${filename}.md`);
      if (existsSync(filepath) && !forceFull) filepath = join(targetDir, `${filename}_${new Date().toTimeString().slice(0, 8).replace(/:/g, "")}.md`);
      writeFileSync(filepath, buildProfileArticleMarkdown(article, profile), "utf8");
      savedFiles.push(filepath);
      capturedUrls[url] = { published: article.published || "", title, saved_at: nowIsoSeconds(), file: filepath };
    }
    articleState.last_captured_at = nowIsoSeconds();
    saveProfileCaptureState(state, appDir);
    return { success: true, saved: savedFiles, skipped, target_dir: targetDir };
  }

  const tweetState = bucket.tweets ||= { captured_ids: {}, daily: {} };
  const capturedIds = tweetState.captured_ids ||= {};
  const dailyState = tweetState.daily ||= {};
  const unique: Record<string, Record<string, any>> = {};
  for (const tweet of items) {
    if (!tweet || typeof tweet !== "object") continue;
    const tweetId = String(tweet.tweet_id || extractStatusId(tweet.url) || "").trim();
    if (!tweetId || unique[tweetId]) continue;
    tweet.tweet_id = tweetId;
    unique[tweetId] = tweet;
  }

  const grouped: Record<string, Array<Record<string, any>>> = {};
  for (const [tweetId, tweet] of Object.entries(unique)) {
    if (!forceFull && capturedIds[tweetId]) {
      skipped += 1;
      continue;
    }
    const dateKey = profileDateKey(tweet.published || "");
    (grouped[dateKey] ||= []).push(tweet);
  }

  for (const [dateKey, tweets] of Object.entries(grouped)) {
    tweets.sort((a, b) => (parseTwitterDatetime(b.published)?.getTime() || 0) - (parseTwitterDatetime(a.published)?.getTime() || 0));
    const filename = sanitizeFilename(`${profileAuthorLabel(profile)}推文${dateKey}`, 100) || `推文${dateKey}`;
    const filepath = join(targetDir, `${filename}.md`);
    const entries = tweets.map((tweet) => buildProfileTweetEntry(tweet));
    const dayBucket = dailyState[dateKey] ||= {};
    const newest = tweets.map((tweet) => parseTwitterDatetime(tweet.published)).filter(Boolean).sort((a: any, b: any) => b.getTime() - a.getTime())[0] as Date | undefined;
    const previousLatest = parseTwitterDatetime(dayBucket.latest_published || "");
    const prepend = !previousLatest || Boolean(newest && newest > previousLatest);
    writeProfileDailyFile(filepath, buildProfileDailyHeader(profile, dateKey, rangeLabel), entries, { prepend, overwrite: forceFull });
    savedFiles.push(filepath);

    for (const tweet of tweets) {
      capturedIds[tweet.tweet_id] = { published: tweet.published || "", url: tweet.url || "", saved_at: nowIsoSeconds(), file: filepath };
    }
    const combined = Object.values(capturedIds).filter((item: any) => item?.file === filepath).map((item: any) => item.published).filter(Boolean);
    const parsed = combined.map(parseTwitterDatetime).filter(Boolean) as Date[];
    if (parsed.length) {
      dayBucket.latest_published = new Date(Math.max(...parsed.map((dt) => dt.getTime()))).toISOString();
      dayBucket.earliest_published = new Date(Math.min(...parsed.map((dt) => dt.getTime()))).toISOString();
    }
    dayBucket.file = filepath;
  }

  tweetState.last_captured_at = nowIsoSeconds();
  saveProfileCaptureState(state, appDir);
  return { success: true, saved: savedFiles, skipped, target_dir: targetDir };
}
