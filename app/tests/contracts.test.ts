import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { STABLE_ERROR_CODES, type CaptureDocumentV1, type SaveResultV1 } from "../core/contracts.ts";

test("CaptureDocumentV1 fixture covers the versioned save contract without secrets", () => {
  const source = readFileSync("app/tests/fixtures/capture-document-v1.json", "utf8");
  const capture = JSON.parse(source) as CaptureDocumentV1;
  assert.equal(capture.schema_version, 1);
  assert.equal(capture.source.canonical_url, "https://x.com/example/status/1234567890");
  assert.equal(capture.source.source_id, "1234567890");
  assert.ok(capture.content.text);
  assert.equal(capture.media[0].kind, "image");
  assert.ok(capture.relations?.thread?.length);
  assert.equal(capture.preferences?.duplicate_policy, "skip");
  assert.doesNotMatch(source, /cookie|authorization|bearer|ct0|token|\/Users\/|[A-Z]:\\Users\\/i);
});

test("SaveResultV1 expresses partial output with stable errors and warnings", () => {
  const result: SaveResultV1 = {
    success: true,
    outcome: "partial",
    capture_key: "x:1234567890",
    files: [{ path: "/tmp/example.md", relative_path: "example.md" }],
    media: { completed: 1, failed: 1, pending: 0 },
    warnings: [{ code: "MEDIA_DOWNLOAD_FAILED", message: "一项媒体下载失败" }],
  };
  assert.equal(result.outcome, "partial");
  assert.equal(result.files.length, 1);
});

test("stable error codes are complete and unique", () => {
  assert.equal(new Set(STABLE_ERROR_CODES).size, STABLE_ERROR_CODES.length);
  assert.deepEqual(STABLE_ERROR_CODES, [
    "SERVER_OFFLINE", "PAIRING_REQUIRED", "AUTH_INVALID",
    "X_AUTH_REQUIRED", "X_RATE_LIMITED", "X_NOT_FOUND", "X_RESTRICTED", "ARTICLE_RENDER_TIMEOUT",
    "INVALID_CAPTURE", "PAYLOAD_TOO_LARGE", "UNSUPPORTED_MEDIA_URL",
    "PATH_DENIED", "PATH_UNAVAILABLE", "WRITE_FAILED", "STATE_CORRUPT",
    "JOB_CANCELLED", "JOB_NOT_FOUND", "JOB_ITEM_FAILED", "JOB_INVALID_TRANSITION",
  ]);
});
