import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JobEngine, JobTransitionError } from "../core/jobs.ts";

const dir = () => mkdtempSync(join(tmpdir(), "x2md-job-recovery-"));

test("app restart resumes checkpoint without repeating completed or skipped items", async () => {
  const appDir = dir();
  const first = new JobEngine(appDir);
  await first.create({ id: "restart", type: "bookmarks", items: ["saved", "skipped", "pending"].map((id) => ({ id, payload: id })) });
  for (const outcome of ["saved", "skipped"] as const) {
    const item = await first.claim("restart", { leaseOwner: "old" }); assert.ok(item);
    await first.complete("restart", item.id, { leaseOwner: "old", attempt: item.attempt, idempotencyKey: item.idempotency_key!, outcome });
  }
  const restarted = new JobEngine(appDir);
  const next = await restarted.claim("restart", { leaseOwner: "new" });
  assert.equal(next?.id, "pending");
  assert.deepEqual((await restarted.get("restart")).items.map((item) => item.status), ["saved", "skipped", "leased"]);
});

test("expired lease is reclaimed and fences a late worker attempt", async () => {
  const appDir = dir();
  let now = new Date("2026-07-10T00:00:00Z");
  const engine = new JobEngine(appDir, () => now);
  await engine.create({ id: "lease", type: "bookmarks", items: [{ id: "one", payload: 1 }] });
  const old = await engine.claim("lease", { leaseOwner: "old", leaseMs: 100 }); assert.ok(old);
  now = new Date(now.getTime() + 101);
  const fresh = await new JobEngine(appDir, () => now).claim("lease", { leaseOwner: "new" }); assert.ok(fresh);
  await assert.rejects(() => engine.complete("lease", old.id, { leaseOwner: "old", attempt: old.attempt, idempotencyKey: old.idempotency_key!, outcome: "saved", now }), JobTransitionError);
  await engine.complete("lease", fresh.id, { leaseOwner: "new", attempt: fresh.attempt, idempotencyKey: fresh.idempotency_key!, outcome: "saved", now });
});

test("rate limit pauses, retry resets only failed, and cancel prevents claims", async () => {
  const engine = new JobEngine(dir());
  await engine.create({ id: "controls", type: "profile-posts", items: [{ id: "bad", payload: 1 }, { id: "later", payload: 2 }] });
  const bad = await engine.claim("controls", { leaseOwner: "worker" }); assert.ok(bad);
  await engine.fail("controls", bad.id, { leaseOwner: "worker", attempt: bad.attempt, idempotencyKey: bad.idempotency_key!, error: { code: "PERMANENT", message: "bad item", retryable: false } });
  await engine.pause("controls", "RATE_LIMITED");
  assert.equal((await engine.get("controls")).pause_reason, "RATE_LIMITED");
  await engine.retryFailed("controls");
  const retried = await engine.claim("controls", { leaseOwner: "retry" }); assert.equal(retried?.id, "bad");
  await engine.cancel("controls");
  assert.equal(await engine.claim("controls", { leaseOwner: "after-cancel" }), null);
});
