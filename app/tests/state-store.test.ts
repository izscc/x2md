import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { StateCorruptionError, StateStore } from "../core/state-store.ts";

function tempApp(): string {
  return mkdtempSync(join(tmpdir(), "x2md-state-"));
}

test("same namespace concurrent updates do not lose data", async () => {
  const appDir = tempApp();
  const store = new StateStore(appDir);
  await Promise.all(Array.from({ length: 100 }, () => store.update("history", () => ({ count: 0 }), async (state) => {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * 2));
    state.count += 1;
  })));
  assert.deepEqual(await store.read("history", () => ({ count: -1 })), { count: 100 });
});

test("failed update keeps the old file and releases the mutex", async () => {
  const appDir = tempApp();
  const store = new StateStore(appDir);
  await store.write("jobs", { count: 1 });
  const before = readFileSync(store.path("jobs"), "utf8");
  await assert.rejects(store.update("jobs", () => ({ count: 0 }), () => { throw new Error("stop"); }), /stop/);
  assert.equal(readFileSync(store.path("jobs"), "utf8"), before);
  await store.update("jobs", () => ({ count: 0 }), (state) => { state.count += 1; });
  assert.deepEqual(await store.read("jobs", () => ({ count: 0 })), { count: 2 });
});

test("serialization failure leaves the committed JSON and no temp file", async () => {
  const appDir = tempApp();
  const store = new StateStore(appDir);
  await store.write("save-index", { ok: true });
  const before = readFileSync(store.path("save-index"), "utf8");
  await assert.rejects(store.write("save-index", { value: 1n }));
  assert.equal(readFileSync(store.path("save-index"), "utf8"), before);
  assert.equal(readdirSync(appDir).some((name) => name.endsWith(".tmp")), false);
});

test("corrupt JSON is preserved as backup and reported", async () => {
  const appDir = tempApp();
  const store = new StateStore(appDir);
  writeFileSync(store.path("profile"), '{"profiles":', "utf8");
  let caught: unknown;
  try {
    await store.read("profile", () => ({ profiles: {} }));
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof StateCorruptionError);
  assert.equal(caught.code, "STATE_CORRUPT");
  assert.equal(readFileSync(caught.backupPath, "utf8"), '{"profiles":');
  assert.equal(readdirSync(appDir).includes("profile_capture_state.json"), false);
});
