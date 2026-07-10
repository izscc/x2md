import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { reconcileSaveTransactions, runSaveTransaction, type JournalStage } from "../core/save-transaction.ts";
import { StateStore } from "../core/state-store.ts";

function appDir(): string { return mkdtempSync(join(tmpdir(), "x2md-transaction-")); }

test("transaction preserves save-path order", async () => {
  const root = appDir();
  const paths = [join(root, "c"), join(root, "a"), join(root, "b")];
  const result = await runSaveTransaction({ appDir: root, savePaths: paths, filename: "ordered", content: "complete" });
  assert.deepEqual(result.saved.map((path) => path.split("/").at(-2)), ["c", "a", "b"]);
  assert.ok(result.saved.every((path) => readFileSync(path, "utf8") === "complete"));
});

for (const stage of ["prepared", "media_committed"] as JournalStage[]) {
  test(`reconciliation cleans an interruption after ${stage}`, async () => {
    const root = appDir();
    await assert.rejects(runSaveTransaction({ appDir: root, savePaths: [join(root, "md")], filename: "x", content: "body", interruptAfterStage: stage }));
    await reconcileSaveTransactions(root);
    assert.equal(existsSync(join(root, "md", "x.md")), false);
    assert.equal(readdirSync(root).some((name) => name.endsWith(".part")), false);
  });
}

test("markdown_committed reconciliation keeps output and commits history once", async () => {
  const root = appDir();
  await assert.rejects(runSaveTransaction({ appDir: root, savePaths: [join(root, "md")], filename: "x", content: "body", history: { title: "x" }, interruptAfterStage: "markdown_committed" }));
  await reconcileSaveTransactions(root);
  await reconcileSaveTransactions(root);
  const files = readdirSync(join(root, "md"));
  assert.equal(files.length, 1);
  const history = await new StateStore(root).read<any[]>("history", () => []);
  assert.equal(history.length, 1);
  assert.equal(history[0].title, "x");
});

test("state_committed reconciliation only clears journal", async () => {
  const root = appDir();
  await assert.rejects(runSaveTransaction({ appDir: root, savePaths: [join(root, "md")], filename: "x", content: "body", history: { title: "x" }, interruptAfterStage: "state_committed" }));
  await reconcileSaveTransactions(root);
  assert.equal(readdirSync(join(root, "md")).length, 1);
  const jobs = await new StateStore(root).read<any>("jobs", () => ({}));
  assert.deepEqual(jobs.save_transactions, {});
});
