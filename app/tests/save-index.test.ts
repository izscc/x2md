import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeConfig } from "../core/config.ts";
import { savePayload } from "../core/save.ts";
import { captureKey, readSaveIndex } from "../core/save-index.ts";
import { reconcileSaveTransactions, runSaveTransaction } from "../core/save-transaction.ts";
import type { CaptureDocumentV1 } from "../core/contracts.ts";

function setup() {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-index-"));
  const saveDir = join(appDir, "md");
  return { appDir, saveDir, cfg: normalizeConfig({ save_paths: [saveDir], enable_video_download: false }) };
}

function capture(id: string, policy?: "skip" | "update" | "always_new"): CaptureDocumentV1 {
  return {
    schema_version: 1,
    source: { platform: "x", url: `https://x.com/a/status/${id}`, canonical_url: `https://x.com/a/status/${id}`, source_id: id, captured_at: "2026-01-01T00:00:00Z" },
    content: { type: "tweet", text: "same title" }, media: [],
    preferences: policy ? { duplicate_policy: policy } : undefined,
  };
}

function legacy(id: string, text = "same title") { return { type: "tweet", url: `https://x.com/a/status/${id}`, text }; }

test("20 concurrent saves of one capture key produce one saved and nineteen skipped", async () => {
  const { appDir, cfg } = setup();
  const results = await Promise.all(Array.from({ length: 20 }, () => savePayload(legacy("1"), cfg, appDir, capture("1"))));
  assert.equal(results.filter((item) => item.outcome === "saved").length, 1);
  assert.equal(results.filter((item) => item.outcome === "skipped").length, 19);
  const entry = (await readSaveIndex(appDir)).entries[captureKey(capture("1"))];
  assert.equal(entry.revisions.length, 1);
});

test("20 different keys with the same title produce unique files", async () => {
  const { appDir, cfg } = setup();
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => savePayload(legacy(String(index + 10)), cfg, appDir, capture(String(index + 10)))));
  const files = results.flatMap((item) => item.saved);
  assert.equal(results.every((item) => item.outcome === "saved"), true);
  assert.equal(new Set(files).size, 20);
});

test("update changes only the latest indexed file", async () => {
  const { appDir, saveDir, cfg } = setup();
  const first = await savePayload(legacy("2", "before"), cfg, appDir, capture("2"));
  const unrelated = join(saveDir, "unrelated.md");
  writeFileSync(unrelated, "leave me", "utf8");
  const result = await savePayload(legacy("2", "after"), cfg, appDir, capture("2", "update"));
  assert.equal(result.outcome, "updated");
  assert.deepEqual(result.saved, first.saved);
  assert.match(readFileSync(first.saved[0], "utf8"), /after/);
  assert.equal(readFileSync(unrelated, "utf8"), "leave me");
});

test("always_new creates a new file and advances latest revision", async () => {
  const { appDir, cfg } = setup();
  const first = await savePayload(legacy("3"), cfg, appDir, capture("3"));
  const second = await savePayload(legacy("3"), cfg, appDir, capture("3", "always_new"));
  assert.notEqual(first.saved[0], second.saved[0]);
  const entry = (await readSaveIndex(appDir)).entries[captureKey(capture("3"))];
  assert.equal(entry.latest_revision, 2);
  assert.equal(entry.revisions.length, 2);
  assert.deepEqual(entry.revisions[1].files, second.saved);
});

test("markdown-committed reconciliation commits the save index idempotently", async () => {
  const { appDir, saveDir } = setup();
  const item = capture("4");
  const key = captureKey(item);
  await assert.rejects(runSaveTransaction({
    appDir, savePaths: [saveDir], filename: "journal", content: "complete",
    saveIndex: { key, capture: item }, interruptAfterStage: "markdown_committed",
  }), /INTERRUPTED_AFTER_markdown_committed/);
  assert.equal((await readSaveIndex(appDir)).entries[key], undefined);
  await reconcileSaveTransactions(appDir);
  await reconcileSaveTransactions(appDir);
  const entry = (await readSaveIndex(appDir)).entries[key];
  assert.equal(entry.revisions.length, 1);
  assert.equal(readFileSync(entry.revisions[0].files[0], "utf8"), "complete");
});
