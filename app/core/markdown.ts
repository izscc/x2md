import { type X2MDConfig } from "./config.ts";
import { formatDate, formatDateTime } from "./dates.ts";
import { sanitizeFilename, normalizeImageUrl, normalizeImageUrlForCompare } from "./filenames.ts";

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


function stripLeadingSourceUrl(value: unknown, sourceUrl: unknown): string {
  const text = String(value ?? "").trim();
  const url = String(sourceUrl ?? "").trim();
  if (!/^(https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\//.test(url)) return text;
  const firstBreak = text.search(/\r?\n/);
  const firstLine = (firstBreak >= 0 ? text.slice(0, firstBreak) : text).trim();
  if (!firstLine) return text;
  const normalizedFirst = firstLine.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  const normalizedUrl = url.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
  const firstId = firstLine.match(/\/(?:i\/)?article\/(\d+)/)?.[1];
  const sourceId = url.match(/\/status\/(\d+)/)?.[1] || url.match(/\/(?:i\/)?article\/(\d+)/)?.[1];
  if (!normalizedFirst || (!normalizedUrl.includes(normalizedFirst) && firstId !== sourceId)) return text;
  return text.slice(firstBreak >= 0 ? firstBreak : text.length).trimStart();
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
  const fallback = map.__x2md_fallback_alt;
  return typeof fallback === "string" && fallback.trim() ? compactAlt(fallback) : "";
}

function appendAltFence(lines: string[], altText: unknown, prefix = ""): void {
  const alt = compactAlt(altText).replace(/```/g, "``\u200b`");
  if (!alt) return;
  lines.push(`${prefix}\`\`\``);
  lines.push(`${prefix}${alt}`);
  lines.push(`${prefix}\`\`\``);
}

function uniqueImageUrls(images: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const key = normalizeImageUrlForCompare(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
  }
  return result;
}

function collectQuoteImageKeys(quote: unknown, keys = new Set<string>()): Set<string> {
  if (!quote || typeof quote !== "object") return keys;
  const data = quote as Record<string, any>;
  for (const image of Array.isArray(data.images) ? data.images : []) {
    const key = normalizeImageUrlForCompare(image);
    if (key) keys.add(key);
  }
  collectQuoteImageKeys(data.quote_tweet, keys);
  return keys;
}

function removeQuoteImagesFromMain(images: string[], quote: unknown): string[] {
  const quoteKeys = collectQuoteImageKeys(quote);
  if (!quoteKeys.size) return images;
  return images.filter((image) => !quoteKeys.has(normalizeImageUrlForCompare(image)));
}

function appendImage(lines: string[], imgUrl: string, label = "", prefix = "", altMap?: unknown): void {
  if (imgUrl.startsWith("![[") && imgUrl.endsWith("]]")) {
    lines.push(`${prefix}${imgUrl}`);
    return;
  }
  const origUrl = normalizeImageUrl(imgUrl);
  lines.push(`${prefix}![${label}](${origUrl})`);
  appendAltFence(lines, getImageAltText(origUrl, altMap), prefix);
}

function formatPollOption(option: Record<string, any>): string {
  const label = String(option.label || option.text || "").trim();
  if (!label) return "";
  const details: string[] = [];
  const percent = Number(option.percent ?? option.percentage);
  if (Number.isFinite(percent)) details.push(`${percent}%`);
  const votes = Number(option.votes ?? option.count);
  if (Number.isFinite(votes)) details.push(`${votes} 票`);
  const suffix = details.length > 1 ? `${details[0]}（${details.slice(1).join("，")}）` : details[0];
  return `- [ ] ${label}${suffix ? ` — ${suffix}` : ""}`;
}

function appendPollBlock(lines: string[], poll: unknown): void {
  if (!poll || typeof poll !== "object") return;
  const data = poll as Record<string, any>;
  const options = Array.isArray(data.options) ? data.options.map(formatPollOption).filter(Boolean) : [];
  if (options.length < 2) return;
  lines.push("");
  lines.push("### 投票");
  lines.push(...options);
  const meta: string[] = [];
  if (data.end) meta.push(`截止：${data.end}`);
  if (Number.isFinite(Number(data.total_votes))) meta.push(`总计 ${Number(data.total_votes)} 票`);
  if (meta.length) {
    lines.push("");
    lines.push(meta.join(" · "));
  }
}

function appendCommunityNotesBlock(lines: string[], notesValue: unknown): void {
  const notes = Array.isArray(notesValue) ? notesValue : [];
  const normalized = notes
    .map((note) => (note && typeof note === "object" ? note as Record<string, any> : null))
    .filter((note): note is Record<string, any> => Boolean(note && String(note.text || "").trim()));
  if (!normalized.length) return;

  for (const note of normalized) {
    lines.push("");
    lines.push("> [!note] 社群笔记");
    for (const line of String(note.text || "").trim().split(/\r?\n/)) {
      lines.push(line.trim() ? `> ${line}` : ">");
    }
    if (note.source) {
      lines.push(">");
      lines.push(`> 来源：${note.source}`);
    }
  }
}

function appendLinkCardBlock(lines: string[], cardValue: unknown): void {
  if (!cardValue || typeof cardValue !== "object") return;
  const card = cardValue as Record<string, any>;
  const title = String(card.title || "").trim();
  const description = String(card.description || "").trim();
  const domain = String(card.domain || "").trim();
  const url = String(card.url || "").trim();
  if (!title && !description && !domain && !url) return;
  lines.push("");
  lines.push("> [!info] 链接卡片");
  if (title) lines.push(`> **${title}**`);
  if (description) lines.push(`> ${description}`);
  if (domain) lines.push(`> ${domain}`);
  if (url) lines.push(`> ${url}`);
}

function normalizeTags(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [];
  return Array.from(new Set(source.map((item) => String(item || "").trim().replace(/^#/, "")).filter(Boolean)));
}

function tagsFromRuleValue(value: unknown): string[] {
  if (Array.isArray(value)) return normalizeTags(value);
  if (value && typeof value === "object" && Array.isArray((value as Record<string, any>).tags)) {
    return normalizeTags((value as Record<string, any>).tags);
  }
  return [];
}

function appendMappedTags(tags: string[], mapping: unknown, key: string): void {
  if (!mapping || typeof mapping !== "object" || !key) return;
  const record = mapping as Record<string, unknown>;
  tags.push(...tagsFromRuleValue(record[key]));
}

function collectTags(data: Record<string, any>, cfg: Record<string, any>, text: string): string[] {
  if (cfg.auto_tags_enabled === false) return normalizeTags(data.tags);

  const tags = [...normalizeTags(cfg.default_tags), ...normalizeTags(data.tags)];
  const rules = cfg.tag_rules && typeof cfg.tag_rules === "object" ? cfg.tag_rules as Record<string, any> : {};

  appendMappedTags(tags, rules.paths, String(data.custom_save_path_name || ""));
  appendMappedTags(tags, rules.platforms, String(data.platform || "Twitter/X"));
  appendMappedTags(tags, rules.authors, String(data.handle || "").replace(/^@/, ""));
  appendMappedTags(tags, rules.authors, String(data.handle || ""));

  const keywordRules = Array.isArray(rules.keywords) ? rules.keywords : [];
  const haystack = `${text}\n${data.article_title || ""}\n${data.article_content || ""}`.toLowerCase();
  for (const rule of keywordRules) {
    if (!rule || typeof rule !== "object") continue;
    const keyword = String((rule as Record<string, any>).keyword || "").trim().toLowerCase();
    if (keyword && haystack.includes(keyword)) tags.push(...tagsFromRuleValue(rule));
  }

  return Array.from(new Set(tags));
}

function yamlString(value: unknown): string {
  return String(value ?? "").replace(/"/g, "'");
}

function statusIdFromUrl(url: string): string {
  return String(url || "").match(/\/status\/(\d+)/)?.[1] || "";
}

function renderCustomFrontMatter(template: string, vars: Record<string, string>): string {
  const allowed = new Set(Object.keys(vars));
  const rendered = String(template || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    return allowed.has(key) ? vars[key] : "";
  }).trim();
  return rendered ? `---\n${rendered}\n---\n` : "";
}

function buildFrontMatter(data: Record<string, any>, cfg: Record<string, any>, values: Record<string, any>): string {
  const tags = values.tags as string[];
  const tagsYaml = tags.length ? `\n${tags.map((tag) => `  - ${tag}`).join("\n")}` : " []";
  const pollEnd = data.poll_data && typeof data.poll_data === "object" && data.poll_data.end
    ? `poll_end: "${yamlString(data.poll_data.end)}"\n`
    : "";
  const statusId = statusIdFromUrl(values.url);
  const contentState = String(data.content_state || "available");
  const template = String(cfg.front_matter_template || "default");

  const common = {
    title: yamlString(values.title),
    url: yamlString(values.url),
    author_url: yamlString(values.authorUrl),
    created: yamlString(values.datetimeStr),
    published: yamlString(values.published),
    platform: yamlString(values.platform),
    type: yamlString(values.contentType),
    status_id: yamlString(statusId),
    tags: tags.join(", "),
    poll: data.poll_data || data.poll ? "true" : "false",
    has_community_notes: Array.isArray(data.community_notes) && data.community_notes.length ? "true" : "false",
    content_state: yamlString(contentState),
    x2md_version: yamlString(data.x2md_version || cfg.x2md_version || ""),
    repost: data.repost ? "true" : "false",
    repost_author: yamlString(data.repost_author || data.original_author || ""),
  };

  if (template === "custom") {
    const custom = renderCustomFrontMatter(String(cfg.custom_front_matter_template || ""), common);
    if (custom) return custom;
  }

  if (template === "minimal") {
    return `---\ntitle: "${common.title}"\ntags:${tagsYaml}\n源: "${common.url}"\n平台: "${common.platform}"\n---\n`;
  }

  const extra = template === "dataview-full"
    ? `status_id: "${common.status_id}"\ntype: "${common.type}"\ncontent_state: "${common.content_state}"\nrepost: ${common.repost}\nrepost_author: "${common.repost_author}"\nx2md_version: "${common.x2md_version}"\n`
    : "";

  return `---
title: "${common.title}"
tags:${tagsYaml}
源: "${common.url}"
作者主页: "${common.author_url}"
创建时间: "${common.created}"
发布时间: "${common.published}"
平台: "${common.platform}"
类别: "[[剪报]]"
阅读状态: false
整理: false
poll: ${common.poll}
has_community_notes: ${common.has_community_notes}
repost: ${common.repost}
repost_author: "${common.repost_author}"
${pollEnd}${extra}---
`;
}

export function markdownFilename(input: Record<string, any>, cfg: X2MDConfig | Record<string, any>): string {
  const data = applyTranslationOverride(input);
  const author = data.author || "unknown";
  const handle = data.handle || "";
  const text = data.text || "";
  const articleTitle = data.article_title || "";
  const repostText = data.repost_source_text || data.original_text || data.repost_text || "";
  const summarySrc = data.repost && repostText ? repostText : (articleTitle || text);
  const summaryShort = sanitizeFilename(summarySrc || "untitled", Number(cfg.max_filename_length || 100));
  const authorClean = sanitizeFilename(handle ? String(handle).replace(/^@/, "") : author, 20);
  return String(cfg.filename_format || "{summary}")
    .replace("{date}", formatDate())
    .replace("{author}", authorClean)
    .replace("{summary}", summaryShort)
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildMarkdown(input: Record<string, any>, cfg: X2MDConfig | Record<string, any>, _appDir?: string): [string, string] {
  const data = applyTranslationOverride(input);
  const author = data.author || "unknown";
  const handle = data.handle || "";
  const text = data.text || "";
  const url = data.url || "";
  const published = data.published || "";
  const contentType = data.type || "tweet";
  let images: string[] = uniqueImageUrls(Array.isArray(data.images) ? data.images : []);
  const imageAltTexts = data.image_alt_texts || {};
  const videos: string[] = Array.isArray(data.videos) ? data.videos : [];
  const articleContent = data.article_content || "";
  const articleTitle = data.article_title || "";
  const threadTweets: Array<Record<string, any>> = Array.isArray(data.thread_tweets) ? data.thread_tweets : [];
  const quoteTweet = data.quote_tweet || {};
  images = removeQuoteImagesFromMain(images, quoteTweet);
  const platform = data.platform || "Twitter/X";
  const pollData = data.poll_data || data.poll;
  const communityNotes = Array.isArray(data.community_notes) ? data.community_notes : [];
  const linkCard = data.link_card || data.card;

  const datetimeStr = formatDateTime();
  const filename = markdownFilename(data, cfg);

  const titleSrc = articleTitle || text;
  let title = String(titleSrc).split(/\s+/).filter(Boolean).join(" ");
  title = `${title.slice(0, 80)}${title.length > 80 ? "…" : ""}`.replace(/"/g, "'");
  const authorUrl = data.author_url ?? (handle ? `https://x.com/${String(handle).replace(/^@/, "")}` : "");
  const tags = collectTags(data, cfg as Record<string, any>, `${text}\n${articleContent}`);
  const frontMatter = buildFrontMatter(data, cfg as Record<string, any>, {
    title,
    tags,
    url,
    authorUrl,
    datetimeStr,
    published,
    platform,
    contentType,
  });

  const lines: string[] = [];
  const videoMap: Record<string, string> = { ...(data.video_render_map || {}) };
  const allVideos = [...videos];
  if (quoteTweet) allVideos.push(...(quoteTweet.videos || []));
  for (const tweet of threadTweets) {
    allVideos.push(...(tweet.videos || []));
    if (tweet.quote_tweet) allVideos.push(...(tweet.quote_tweet.videos || []));
  }

  for (const vidUrl of allVideos) {
    if (videoMap[vidUrl]) continue;
    videoMap[vidUrl] = `🎞️ [推特媒体：点击播放视频](${vidUrl})`;
  }

  const appendUnusedVideos = (linesList: string[], contentText: string) => {
    if (!videos.length) return;
    const content = String(contentText || "");
    const unused = videos.filter((v) => {
      const rendered = videoMap[v] || "";
      return !content.includes(`[MEDIA_VIDEO_URL:${v}]`) && (!rendered || !content.includes(rendered));
    });
    if (!unused.length) return;
    linesList.push("");
    for (const v of unused) linesList.push(videoMap[v]);
  };

  const appendQuoteTweet = (linesList: string[], quote: Record<string, any>, depth = 1) => {
    if (!quote) return;
    const qText = String(quote.text || "").trim();
    const qImages: string[] = uniqueImageUrls(quote.images || []);
    const qImageAltTexts = quote.image_alt_texts || {};
    const qVideos: string[] = quote.videos || [];
    const qUrl = String(quote.url || "").trim();
    const nestedQuote = quote.quote_tweet && typeof quote.quote_tweet === "object" ? quote.quote_tweet : null;
    if (!qText && !qImages.length && !qVideos.length && !qUrl && !nestedQuote) return;

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
    if (nestedQuote) {
      if (depth < 2) {
        appendQuoteTweet(linesList, nestedQuote, depth + 1);
      } else if (nestedQuote.url) {
        linesList.push(">");
        linesList.push(`> 更深层引用：${nestedQuote.url}`);
      }
    }
    if (qUrl) {
      linesList.push(">");
      linesList.push(`> 原文：${qUrl}`);
    }
  };

  if (Object.values(videoMap).some((value) => value.startsWith("![[")) && videos.length) images = images.filter((img) => !String(img).includes("video_thumb"));

  if (contentType === "article") {
    let textResult = "";
    if (articleContent) {
      textResult = stripLeadingSourceUrl(articleContent, url);
      for (const [videoUrl, mdRef] of Object.entries(videoMap)) {
        textResult = textResult.replaceAll(`[MEDIA_VIDEO_URL:${videoUrl}]`, mdRef);
      }
      lines.push(textResult);
    }
    appendUnusedVideos(lines, textResult);
    if (!/>\s*\[!quote\]\s*引用推文/.test(textResult)) appendQuoteTweet(lines, quoteTweet);
  } else {
    let textResult = String(text).trim();
    for (const [videoUrl, mdRef] of Object.entries(videoMap)) {
      textResult = textResult.replaceAll(`[MEDIA_VIDEO_URL:${videoUrl}]`, mdRef);
    }
    lines.push(textResult);

    if (images.length) {
      lines.push("");
      images.forEach((imgUrl, index) => appendImage(lines, imgUrl, "", "", index === 0 ? imageAltTexts : { ...imageAltTexts, __x2md_fallback_alt: "" }));
    }
    appendUnusedVideos(lines, textResult);
    appendPollBlock(lines, pollData);
    appendLinkCardBlock(lines, linkCard);
    appendCommunityNotesBlock(lines, communityNotes);
    appendQuoteTweet(lines, quoteTweet);

    threadTweets.forEach((tweet, idx) => {
      const twText = String(tweet.text || "").trim();
      const twImages: string[] = uniqueImageUrls(tweet.images || []);
      const twVideos: string[] = tweet.videos || [];
      const twQuote = tweet.quote_tweet || {};
      if (!twText && !twImages.length && !twVideos.length && !twQuote) return;
      lines.push("\n---\n");
      if (twText) lines.push(twText);
      if (twImages.length) {
        lines.push("");
        const twImageAltTexts = tweet.image_alt_texts || {};
        twImages.forEach((imgUrl, i) => appendImage(lines, imgUrl, "", "", i === 0 ? twImageAltTexts : { ...twImageAltTexts, __x2md_fallback_alt: "" }));
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
