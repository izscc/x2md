import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { JobEngine, JobTransitionError } from "../core/jobs.ts";

async function fixture(now = new Date("2026-07-11T00:00:00.000Z")) {
  const root = await mkdtemp(join(tmpdir(), "x2md-jobs-"));
  return { root, now, engine: new JobEngine(root, () => now) };
}

test("create persists independent items without replacing save transaction journals", async () => {
  const { root, engine } = await fixture();
  const stateFile = join(root, "job_state.json");
  await import("node:fs/promises").then(({ mkdir, writeFile }) => Promise.all([
    mkdir(root, { recursive: true }),
    writeFile(stateFile, JSON.stringify({ save_transactions: { tx: { stage: "prepared" } } })),
  ]));
  const job = await engine.create({ id: "job", type: "bookmarks", items: [{ id: "a", payload: { url: "a" } }, { id: "b", payload: { url: "b" } }] });
  assert.equal(job.status, "queued");
  assert.deepEqual(job.items.map((item) => [item.status, item.attempt]), [["pending", 0], ["pending", 0]]);
  const disk = JSON.parse(await readFile(stateFile, "utf8"));
  assert.equal(disk.save_transactions.tx.stage, "prepared");
  assert.equal(disk.capture_jobs.job.items.length, 2);
});

test("claim, renew and every completion outcome transition independently", async () => {
  const { root, now, engine } = await fixture();
  const job = await engine.create({ type: "profile", items: ["saved", "updated", "skipped"].map((id) => ({ id, payload: id })) });
  for (const outcome of ["saved", "updated", "skipped"] as const) {
    const lease = await engine.claim(job.id, { leaseOwner: "worker", leaseMs: 1_000 });
    assert.equal(lease?.id, outcome);
    const renewed = await engine.renew(job.id, outcome, { leaseOwner: "worker", attempt: lease!.attempt, idempotencyKey: lease!.idempotency_key!, leaseMs: 2_000 });
    assert.equal(renewed.lease_expires_at, "2026-07-11T00:00:02.000Z");
    await engine.complete(job.id, outcome, { leaseOwner: "worker", attempt: lease!.attempt, idempotencyKey: lease!.idempotency_key!, outcome, result: { ok: outcome }, now });
  }
  assert.equal((await engine.get(job.id)).status, "completed");
  assert.equal(await engine.claim(job.id, { leaseOwner: "worker" }), null);
  const restarted = new JobEngine(root);
  assert.deepEqual((await restarted.get(job.id)).items.map((item) => item.status), ["saved", "updated", "skipped"]);
});

test("failed job retries only failed items and retains completed items", async () => {
  const { engine } = await fixture();
  const job = await engine.create({ type: "articles", items: [{ id: "ok", payload: 1 }, { id: "bad", payload: 2 }] });
  const ok = await engine.claim(job.id, { leaseOwner: "w" });
  await engine.complete(job.id, ok!.id, { leaseOwner: "w", attempt: ok!.attempt, idempotencyKey: ok!.idempotency_key!, outcome: "saved" });
  const bad = await engine.claim(job.id, { leaseOwner: "w" });
  await engine.fail(job.id, bad!.id, { leaseOwner: "w", attempt: bad!.attempt, idempotencyKey: bad!.idempotency_key!, error: { code: "X_NOT_FOUND", message: "gone" } });
  assert.equal((await engine.get(job.id)).status, "failed");
  const retried = await engine.retryFailed(job.id);
  assert.deepEqual(retried.items.map((item) => [item.id, item.status, item.attempt]), [["ok", "saved", 1], ["bad", "pending", 1]]);
  assert.equal((await engine.claim(job.id, { leaseOwner: "w2" }))?.id, "bad");
});

test("expired leases are reclaimed and attempt fencing rejects a late worker", async () => {
  const { engine } = await fixture();
  const job = await engine.create({ type: "bookmarks", items: [{ id: "one", payload: 1 }] });
  const oldLease = await engine.claim(job.id, { leaseOwner: "old", leaseMs: 100 });
  const later = new Date("2026-07-11T00:00:00.101Z");
  assert.equal(await engine.reclaimExpired(job.id, later), 1);
  const newLease = await engine.claim(job.id, { leaseOwner: "new", now: later });
  assert.equal(newLease?.attempt, 2);
  await assert.rejects(engine.complete(job.id, "one", { leaseOwner: "old", attempt: oldLease!.attempt, idempotencyKey: oldLease!.idempotency_key!, outcome: "saved", now: later }), JobTransitionError);
  await engine.complete(job.id, "one", { leaseOwner: "new", attempt: newLease!.attempt, idempotencyKey: newLease!.idempotency_key!, outcome: "saved", now: later });
  assert.equal((await engine.get(job.id)).items[0].status, "saved");
});

test("complete and fail submissions are idempotent", async () => {
  const { engine } = await fixture();
  const first = await engine.create({ type: "x", items: [{ id: "one", payload: null }] });
  const lease = await engine.claim(first.id, { leaseOwner: "w" });
  const complete = { leaseOwner: "w", attempt: lease!.attempt, idempotencyKey: lease!.idempotency_key!, outcome: "saved" as const, result: { path: "first" } };
  assert.deepEqual(await engine.complete(first.id, "one", complete), await engine.complete(first.id, "one", { ...complete, result: { path: "different" } }));
  await assert.rejects(engine.fail(first.id, "one", { leaseOwner: "w", attempt: lease!.attempt, idempotencyKey: lease!.idempotency_key!, error: { code: "X", message: "x" } }), /different operation/);

  const second = await engine.create({ type: "x", items: [{ id: "two", payload: null }] });
  const failedLease = await engine.claim(second.id, { leaseOwner: "w" });
  const fail = { leaseOwner: "w", attempt: failedLease!.attempt, idempotencyKey: failedLease!.idempotency_key!, error: { code: "X", message: "x" } };
  assert.deepEqual(await engine.fail(second.id, "two", fail), await engine.fail(second.id, "two", { ...fail, error: { code: "Y", message: "different" } }));
});

test("pause, resume and cancel enforce legal transitions", async () => {
  const { engine } = await fixture();
  const job = await engine.create({ type: "x", items: [{ id: "one", payload: 1 }] });
  assert.equal((await engine.pause(job.id, "rate limit")).status, "paused");
  assert.equal(await engine.claim(job.id, { leaseOwner: "w" }), null);
  assert.equal((await engine.resume(job.id)).status, "running");
  assert.equal((await engine.cancel(job.id)).status, "cancelled");
  assert.equal(await engine.claim(job.id, { leaseOwner: "w" }), null);
  await assert.rejects(engine.resume(job.id), JobTransitionError);
  await assert.rejects(engine.cancel(job.id), JobTransitionError);
  await assert.rejects(engine.pause(job.id), JobTransitionError);
});

test("concurrent claims never lease one item twice", async () => {
  const { root, engine } = await fixture();
  const job = await engine.create({ type: "x", items: [{ id: "one", payload: 1 }] });
  const otherProcessFacade = new JobEngine(root, () => new Date("2026-07-11T00:00:00.000Z"));
  const claims = await Promise.all([
    engine.claim(job.id, { leaseOwner: "a" }),
    otherProcessFacade.claim(job.id, { leaseOwner: "b" }),
  ]);
  assert.equal(claims.filter(Boolean).length, 1);
});
