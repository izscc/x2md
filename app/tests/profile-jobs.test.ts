import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeConfig } from "../core/config.ts";
import { JobEngine } from "../core/jobs.ts";
import { handleProfileJobItemSave } from "../core/profile-capture.ts";

function dirs() {
  return { appDir: mkdtempSync(join(tmpdir(), "x2md-profile-job-state-")), saveDir: mkdtempSync(join(tmpdir(), "x2md-profile-job-save-")) };
}

test("profile posts resume from durable job checkpoints and preserve daily aggregation", async () => {
  const { appDir, saveDir } = dirs();
  const cfg = normalizeConfig({ save_paths: [saveDir], enable_video_download: false });
  const payloads = [
    { mode: "tweets", profile: { handle: "alice", displayName: "Alice" }, options: { range_label: "今天" }, item: { url: "https://x.com/alice/status/1", published: "2026-07-10T08:00:00Z", text: "first" } },
    { mode: "tweets", profile: { handle: "alice", displayName: "Alice" }, options: { range_label: "今天" }, item: { url: "https://x.com/alice/status/2", published: "2026-07-10T09:00:00Z", text: "second" } },
  ];
  const engine = new JobEngine(appDir);
  const job = await engine.create({ id: "posts", type: "profile-posts", items: payloads.map((payload, index) => ({ id: String(index + 1), payload })) });
  const first = await engine.claim(job.id, { leaseOwner: "worker" });
  assert.ok(first);
  const saved = await handleProfileJobItemSave(first.payload as Record<string, any>, cfg, appDir);
  await engine.complete(job.id, first.id, { leaseOwner: "worker", attempt: first.attempt, idempotencyKey: first.idempotency_key!, outcome: "saved", result: saved });

  const restarted = new JobEngine(appDir);
  const second = await restarted.claim(job.id, { leaseOwner: "worker-2" });
  assert.ok(second);
  const saved2 = await handleProfileJobItemSave(second.payload as Record<string, any>, cfg, appDir);
  await restarted.complete(job.id, second.id, { leaseOwner: "worker-2", attempt: second.attempt, idempotencyKey: second.idempotency_key!, outcome: "saved", result: saved2 });
  assert.equal((await restarted.get(job.id)).status, "completed");
  const markdown = readFileSync(saved2.saved[0], "utf8");
  assert.match(markdown, /first/);
  assert.match(markdown, /second/);
});

test("profile articles use job checkpoints and legacy duplicate index", async () => {
  const { appDir, saveDir } = dirs();
  const cfg = normalizeConfig({ save_paths: [saveDir], enable_video_download: false });
  const payload = { mode: "articles", profile: { handle: "alice", displayName: "Alice" }, item: { url: "https://x.com/i/article/9", article_title: "Nine", article_content: "article body", published: "2026-07-10T09:00:00Z" } };
  const first = await handleProfileJobItemSave(payload, cfg, appDir);
  const duplicate = await handleProfileJobItemSave(payload, cfg, appDir);
  assert.equal(first.saved.length, 1);
  assert.equal(duplicate.skipped, 1);
  assert.equal(duplicate.saved.length, 0);
});
