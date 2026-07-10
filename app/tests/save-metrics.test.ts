import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeConfig, logPath } from "../core/config.ts";
import { createSaveMetrics, sanitizeSaveMetrics, timeSaveStage } from "../core/save-metrics.ts";
import { savePayload } from "../core/save.ts";
import { logSaveMetrics } from "../main/logger.ts";

test("保存指标只保留严格 allowlist 和稳定错误码", () => {
  const clean = sanitizeSaveMetrics({
    ...createSaveMetrics(), outcome: "partial", error_code: "WRITE_FAILED",
    duration_ms: { validate: 1.234, dedupe: 2, media: 3, render: 4, write: 5 },
    media_count: 2, media_completed: 1, media_failed: 1, target_count: 1,
    text: "SECRET_BODY", token: "SECRET_TOKEN", cookie: "SECRET_COOKIE",
    path: "/Users/alice/private/vault", url: "https://media.example/private.mp4",
  } as any);
  assert.deepEqual(Object.keys(clean).sort(), ["duration_ms", "error_code", "event", "media_completed", "media_count", "media_failed", "outcome", "target_count"].sort());
  const serialized = JSON.stringify(clean);
  for (const secret of ["SECRET_BODY", "SECRET_TOKEN", "SECRET_COOKIE", "/Users/alice", "media.example"]) assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(clean.duration_ms.validate, 1.23);
  assert.equal(clean.error_code, "WRITE_FAILED");
  assert.equal(sanitizeSaveMetrics({ error_code: "secret/token" } as any).error_code, null);
});

test("阶段计时不记录阶段输入或输出", async () => {
  const metrics = createSaveMetrics();
  assert.equal(await timeSaveStage(metrics, "render", async () => "PRIVATE_CONTENT"), "PRIVATE_CONTENT");
  assert.ok(metrics.duration_ms.render >= 0);
  assert.doesNotMatch(JSON.stringify(metrics), /PRIVATE_CONTENT/);
});

test("每次保存只写一条脱敏结构化阶段摘要", async () => {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-save-metrics-"));
  const saveDir = join(appDir, "private-vault");
  const secretBody = "SECRET_PRIVATE_SAVE_BODY";
  const secretUrl = "https://x.com/private-user/status/123456789";
  const result = await savePayload({ type: "tweet", text: secretBody, url: secretUrl, handle: "private-user" }, normalizeConfig({ save_paths: [saveDir] }), appDir);
  assert.equal(result.success, true);
  const lines = readFileSync(logPath(appDir), "utf8").split(/\r?\n/).filter((line) => line.includes("save_metrics "));
  assert.equal(lines.length, 1);
  const payload = JSON.parse(lines[0].slice(lines[0].indexOf("save_metrics ") + "save_metrics ".length));
  assert.equal(payload.event, "save_pipeline");
  assert.deepEqual(Object.keys(payload.duration_ms).sort(), ["dedupe", "media", "render", "validate", "write"]);
  assert.equal(payload.target_count, 1);
  assert.equal(payload.outcome, "saved");
  for (const secret of [secretBody, secretUrl, appDir, saveDir, "private-user"]) assert.equal(lines[0].includes(secret), false);
});

test("logger 丢弃调用方附带的敏感字段", () => {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-metric-logger-"));
  logSaveMetrics({ ...createSaveMetrics(), outcome: "failed", token: "TOKEN_VALUE", cookie: "COOKIE_VALUE", path: "/Users/alice/private" } as any, appDir);
  const line = readFileSync(logPath(appDir), "utf8");
  assert.match(line, /save_metrics/);
  assert.doesNotMatch(line, /TOKEN_VALUE|COOKIE_VALUE|\/Users\/alice/);
});
