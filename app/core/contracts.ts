export const STABLE_ERROR_CODES = [
  "SERVER_OFFLINE", "PAIRING_REQUIRED", "AUTH_INVALID",
  "X_AUTH_REQUIRED", "X_RATE_LIMITED", "X_NOT_FOUND", "X_RESTRICTED", "ARTICLE_RENDER_TIMEOUT",
  "INVALID_CAPTURE", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_URL",
  "PATH_DENIED", "PATH_UNAVAILABLE", "WRITE_FAILED", "STATE_CORRUPT",
  "JOB_CANCELLED", "JOB_NOT_FOUND", "JOB_ITEM_FAILED", "JOB_INVALID_TRANSITION",
] as const;

export type StableErrorCode = typeof STABLE_ERROR_CODES[number];
export const CAPTURE_LIMITS = {
  body_bytes: 5 * 1024 * 1024,
  depth: 12,
  array_items: 500,
  media_items: 200,
  string_chars: 256 * 1024,
  content_chars: 2 * 1024 * 1024,
} as const;
export type CapturePlatform = "x" | "linuxdo" | "feishu" | "wechat";
export type CaptureContentType = "tweet" | "thread" | "article" | "profile-item" | "web-article";

export type CaptureMediaV1 = {
  kind: "image" | "video" | "gif";
  url: string;
  alt?: string;
  duration_seconds?: number;
};

export type CaptureDocumentV1 = {
  schema_version: 1;
  source: {
    platform: CapturePlatform;
    url: string;
    canonical_url: string;
    source_id?: string;
    captured_at: string;
  };
  content: {
    type: CaptureContentType;
    title?: string;
    text?: string;
    markdown?: string;
    author?: { name?: string; handle?: string; url?: string };
    published_at?: string;
  };
  media: CaptureMediaV1[];
  relations?: {
    quote?: unknown;
    thread?: unknown[];
    poll?: unknown;
    community_notes?: unknown[];
    link_card?: unknown;
  };
  preferences?: {
    custom_save_path_name?: string;
    duplicate_policy?: "skip" | "update" | "always_new";
    download_images?: boolean;
    download_videos?: boolean;
  };
  diagnostics?: { capture_path?: string; warnings?: string[] };
};

export type SaveResultV1 = {
  success: boolean;
  outcome: "saved" | "updated" | "skipped" | "partial" | "failed";
  capture_key?: string;
  files: Array<{
    path: string;
    history_id?: string;
    relative_path?: string;
    action_urls?: { obsidian?: string };
  }>;
  media: { completed: number; failed: number; pending: number };
  error?: { code: StableErrorCode; message: string; retryable: boolean };
  warnings: Array<{ code: string; message: string }>;
};

export type JobStatus = "queued" | "running" | "paused" | "completed" | "failed" | "cancelled";
export type JobItemStatus = "pending" | "leased" | "saved" | "updated" | "skipped" | "failed";

export type JobItem = {
  id: string;
  status: JobItemStatus;
  payload: unknown;
  lease_owner: string | null;
  lease_expires_at: string | null;
  attempt: number;
  idempotency_key: string | null;
  result?: unknown;
  error?: { code: string; message: string; retryable?: boolean };
  created_at: string;
  updated_at: string;
};

export type CaptureJob = {
  id: string;
  type: string;
  status: JobStatus;
  items: JobItem[];
  metadata?: Record<string, unknown>;
  pause_reason?: string;
  created_at: string;
  updated_at: string;
};
