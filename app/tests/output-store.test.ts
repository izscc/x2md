import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { commitOutput } from "../core/output-store.ts";

test("no-clobber output preserves an existing file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "x2md-output-"));
  writeFileSync(join(dir, "same.md"), "original");
  const result = await commitOutput({ directory: dir, basename: "same", content: "new", transactionId: "tx-one" });
  assert.equal(readFileSync(join(dir, "same.md"), "utf8"), "original");
  assert.equal(readFileSync(result.path, "utf8"), "new");
  assert.notEqual(result.path, join(dir, "same.md"));
});

test("20 concurrent same-title outputs are unique, complete and leave no parts", async () => {
  const dir = mkdtempSync(join(tmpdir(), "x2md-output-"));
  const results = await Promise.all(Array.from({ length: 20 }, (_, index) => commitOutput({
    directory: dir, basename: "same", content: `complete-${index}`, transactionId: `tx-${index}`,
  })));
  assert.equal(new Set(results.map((item) => item.path)).size, 20);
  assert.deepEqual(new Set(results.map((item) => readFileSync(item.path, "utf8"))), new Set(Array.from({ length: 20 }, (_, index) => `complete-${index}`)));
  assert.equal(readdirSync(dir).some((name) => name.endsWith(".part")), false);
});

test("exclusive-copy fallback never overwrites an existing target", async () => {
  const dir = mkdtempSync(join(tmpdir(), "x2md-output-"));
  writeFileSync(join(dir, "same.md"), "original");
  const unsupportedLink = async () => { throw Object.assign(new Error("unsupported"), { code: "ENOTSUP" }); };
  const result = await commitOutput({ directory: dir, basename: "same", content: "fallback", transactionId: "fallback-tx", linkFile: unsupportedLink });
  assert.equal(readFileSync(join(dir, "same.md"), "utf8"), "original");
  assert.equal(readFileSync(result.path, "utf8"), "fallback");
  assert.equal(result.strategy, "copy");
});

test("publish failure leaves no part or empty formal file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "x2md-output-"));
  const failedLink = async () => { throw Object.assign(new Error("disk failure"), { code: "EIO" }); };
  await assert.rejects(commitOutput({ directory: dir, basename: "failed", content: "body", transactionId: "failed-tx", linkFile: failedLink }));
  assert.deepEqual(readdirSync(dir), []);
});
