import { CAPTURE_LIMITS, type CaptureContentType, type CaptureDocumentV1, type CapturePlatform } from "./contracts.ts";

export class CaptureBoundaryError extends Error {
  code: "INVALID_CAPTURE" | "PAYLOAD_TOO_LARGE";
  status: 400 | 413;

  constructor(code: "INVALID_CAPTURE" | "PAYLOAD_TOO_LARGE", message: string) {
    super(message);
    this.code = code;
    this.status = code === "PAYLOAD_TOO_LARGE" ? 413 : 400;
  }
}

function invalid(message: string): never {
  throw new CaptureBoundaryError("INVALID_CAPTURE", message);
}

export function validateCaptureShape(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("capture must be an object");
  const stack: Array<{ value: unknown; depth: number; key: string }> = [{ value, depth: 0, key: "" }];
  let mediaItems = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (current.depth > CAPTURE_LIMITS.depth) invalid("capture nesting is too deep");
    if (typeof current.value === "string") {
      const isContent = ["text", "content", "markdown", "article_content"].includes(current.key);
      if (isContent && current.value.length > CAPTURE_LIMITS.content_chars) invalid("capture content is too long");
      if (!isContent && current.value.length > CAPTURE_LIMITS.string_chars) invalid("capture string is too long");
      continue;
    }
    if (!current.value || typeof current.value !== "object") continue;
    if (Array.isArray(current.value)) {
      if (current.value.length > CAPTURE_LIMITS.array_items) invalid("capture array has too many items");
      if (["media", "images", "videos"].includes(current.key)) mediaItems += current.value.length;
      if (mediaItems > CAPTURE_LIMITS.media_items) invalid("capture has too many media items");
      for (const item of current.value) stack.push({ value: item, depth: current.depth + 1, key: current.key });
    } else {
      for (const [key, item] of Object.entries(current.value)) stack.push({ value: item, depth: current.depth + 1, key });
    }
  }
  return value as Record<string, any>;
}

function httpUrl(value: unknown): string {
  try {
    const url = new URL(String(value || ""));
    if (!["http:", "https:"].includes(url.protocol)) invalid("source URL must use HTTP");
    return url.toString();
  } catch (error) {
    if (error instanceof CaptureBoundaryError) throw error;
    return invalid("source URL is invalid");
  }
}

function platformFor(raw: Record<string, any>, url: string): CapturePlatform {
  const value = String(raw.platform || "").toLowerCase();
  if (value.includes("linux") || url.includes("linux.do")) return "linuxdo";
  if (value.includes("飞书") || value.includes("feishu") || /feishu|larksuite/.test(url)) return "feishu";
  if (value.includes("微信") || value.includes("wechat") || url.includes("weixin.qq.com")) return "wechat";
  return "x";
}

function typeFor(raw: Record<string, any>): CaptureContentType {
  if (Array.isArray(raw.thread_tweets) && raw.thread_tweets.length) return "thread";
  if (raw.article_content !== undefined) return platformFor(raw, String(raw.url || "")) === "x" ? "article" : "web-article";
  return raw.type === "article" ? "article" : "tweet";
}

function normalizeV1(raw: Record<string, any>): CaptureDocumentV1 {
  if (raw.schema_version !== 1 || !raw.source || !raw.content || !Array.isArray(raw.media)) invalid("invalid CaptureDocumentV1");
  const sourceUrl = httpUrl(raw.source.url);
  const platform = raw.source.platform as CapturePlatform;
  if (!["x", "linuxdo", "feishu", "wechat"].includes(platform)) invalid("unsupported source platform");
  if (!raw.source.canonical_url || !raw.source.captured_at) invalid("capture source fields are required");
  httpUrl(raw.source.canonical_url);
  if (!Number.isFinite(Date.parse(raw.source.captured_at))) invalid("captured_at is invalid");
  if (!["tweet", "thread", "article", "profile-item", "web-article"].includes(raw.content.type)) invalid("unsupported content type");
  for (const item of raw.media) {
    if (!item || !["image", "video", "gif"].includes(item.kind)) invalid("invalid media item");
    httpUrl(item.url);
  }
  return { ...raw, source: { ...raw.source, url: sourceUrl } } as CaptureDocumentV1;
}

function fromLegacy(raw: Record<string, any>): CaptureDocumentV1 {
  const url = httpUrl(raw.url || raw.article_url || raw.note_article_url);
  const images = (Array.isArray(raw.images) ? raw.images : []).map(httpUrl);
  const videos = (Array.isArray(raw.videos) ? raw.videos : []).map(httpUrl);
  const alt = raw.image_alt_texts && typeof raw.image_alt_texts === "object" ? raw.image_alt_texts : {};
  const relations: Record<string, unknown> = {};
  if (raw.quote_tweet !== undefined) relations.quote = raw.quote_tweet;
  if (raw.thread_tweets !== undefined) relations.thread = raw.thread_tweets;
  for (const key of ["poll", "community_notes", "link_card"]) if (raw[key] !== undefined) relations[key] = raw[key];
  return {
    schema_version: 1,
    source: {
      platform: platformFor(raw, url), url, canonical_url: url,
      source_id: url.match(/\/(?:status|article)\/(\d+)/)?.[1], captured_at: new Date().toISOString(),
    },
    content: {
      type: typeFor(raw), title: raw.article_title || raw.title, text: raw.text,
      markdown: raw.article_content, author: { name: raw.author, handle: raw.handle }, published_at: raw.published,
    },
    media: [
      ...images.map((item: unknown) => ({ kind: "image" as const, url: String(item), alt: alt[String(item)] })),
      ...videos.map((item: unknown) => ({ kind: "video" as const, url: String(item) })),
    ],
    ...(Object.keys(relations).length ? { relations } : {}),
    preferences: {
      custom_save_path_name: raw.custom_save_path_name,
      download_images: raw.download_images,
      download_videos: raw.download_video,
    },
  };
}

function toLegacy(capture: CaptureDocumentV1): Record<string, any> {
  const images = capture.media.filter((item) => item.kind === "image").map((item) => item.url);
  const videos = capture.media.filter((item) => item.kind !== "image").map((item) => item.url);
  const imageAltTexts = Object.fromEntries(capture.media.filter((item) => item.alt).map((item) => [item.url, item.alt]));
  return {
    type: capture.content.type === "web-article" ? "article" : capture.content.type,
    platform: capture.source.platform,
    url: capture.source.url,
    article_title: capture.content.title,
    article_content: capture.content.markdown,
    text: capture.content.text,
    author: capture.content.author?.name,
    handle: capture.content.author?.handle,
    published: capture.content.published_at,
    images, videos, image_alt_texts: imageAltTexts,
    quote_tweet: capture.relations?.quote,
    thread_tweets: capture.relations?.thread,
    poll: capture.relations?.poll,
    community_notes: capture.relations?.community_notes,
    link_card: capture.relations?.link_card,
    custom_save_path_name: capture.preferences?.custom_save_path_name,
    download_video: capture.preferences?.download_videos,
  };
}

export function normalizeCaptureRequest(value: unknown): { capture: CaptureDocumentV1; savePayload: Record<string, any>; legacy: boolean } {
  const raw = validateCaptureShape(value);
  if (raw.schema_version !== undefined && raw.schema_version !== 1) invalid("schema_version must be 1");
  if (raw.schema_version === 1) {
    const capture = normalizeV1(raw);
    return { capture, savePayload: toLegacy(capture), legacy: false };
  }
  const capture = fromLegacy(raw);
  return { capture, savePayload: raw, legacy: true };
}
