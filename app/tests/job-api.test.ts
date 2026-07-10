import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../core/config.ts";
import { extensionToken } from "../core/pairing.ts";
import { handleApiRequest } from "../main/http-server.ts";

function fixture() {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-job-api-"));
  const token = extensionToken(String(loadConfig(appDir).install_secret));
  const request = async (method: string, path: string, body?: unknown, authenticated = true) => {
    const response = await handleApiRequest(new Request(`http://127.0.0.1:9527${path}`, {
      method,
      headers: {
        Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), { appDir });
    return { status: response.status, body: await response.json() as any };
  };
  return { appDir, request };
}

test("every job route requires a paired credential", async () => {
  const { request } = fixture();
  for (const [method, path] of [
    ["GET", "/jobs"], ["POST", "/jobs"], ["GET", "/jobs/job"],
    ["POST", "/jobs/job/pause"], ["POST", "/jobs/job/resume"], ["POST", "/jobs/job/cancel"],
    ["POST", "/jobs/job/retry"], ["POST", "/jobs/job/claim"],
    ["POST", "/jobs/job/items/item/renew"], ["POST", "/jobs/job/items/item/complete"], ["POST", "/jobs/job/items/item/fail"],
  ]) assert.equal((await request(method, path, method === "POST" ? {} : undefined, false)).status, 401, `${method} ${path}`);
});

test("create, list and detail return stable redacted job views", async () => {
  const { request } = fixture();
  const created = await request("POST", "/jobs", {
    id: "safe", type: "bookmarks", metadata: { bearer: "secret-metadata" },
    items: [{ id: "one", payload: { body: "secret-body", cookie: "secret-cookie" } }],
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.success, true);
  assert.deepEqual(created.body.job.counts, { pending: 1, leased: 0, saved: 0, updated: 0, skipped: 0, failed: 0, total: 1, remaining: 1 });

  const listed = await request("GET", "/jobs");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.jobs[0].items, undefined);
  const detail = await request("GET", "/jobs/safe");
  assert.equal(detail.status, 200);
  assert.equal(detail.body.job.items[0].payload, undefined);
  assert.equal(detail.body.job.items[0].result, undefined);
  assert.equal(detail.body.job.items[0].idempotency_key, undefined);
  assert.equal(JSON.stringify([created.body, listed.body, detail.body]).includes("secret"), false);
});

test("worker lease protocol validates owner, attempt and idempotency key", async () => {
  const { request } = fixture();
  await request("POST", "/jobs", { id: "worker", type: "bookmarks", items: [{ id: "one", payload: { url: "https://example.test" } }] });
  const claimed = await request("POST", "/jobs/worker/claim", { lease_owner: "worker-a", lease_ms: 10_000 });
  assert.equal(claimed.status, 200);
  assert.equal(claimed.body.claim.payload.url, "https://example.test");
  const proof = {
    lease_owner: claimed.body.claim.lease_owner,
    attempt: claimed.body.claim.attempt,
    idempotency_key: claimed.body.claim.idempotency_key,
  };
  assert.equal((await request("POST", "/jobs/worker/items/one/renew", { ...proof, lease_owner: "impostor" })).status, 409);
  assert.equal((await request("POST", "/jobs/worker/items/one/complete", { ...proof, attempt: proof.attempt + 1, outcome: "saved" })).status, 409);
  assert.equal((await request("POST", "/jobs/worker/items/one/complete", { ...proof, idempotency_key: "wrong", outcome: "saved" })).status, 409);

  const completed = await request("POST", "/jobs/worker/items/one/complete", { ...proof, outcome: "saved", result: { path: "/private/file.md" } });
  assert.equal(completed.status, 200);
  assert.equal(completed.body.item.status, "saved");
  assert.equal(completed.body.item.result, undefined);
  assert.equal(JSON.stringify(completed.body).includes(proof.idempotency_key), false);
  assert.equal((await request("POST", "/jobs/worker/items/one/complete", { ...proof, outcome: "saved" })).status, 200);
  assert.equal((await request("POST", "/jobs/worker/items/one/complete", { ...proof, lease_owner: "impostor", outcome: "saved" })).status, 409);
});

test("expired lease is reclaimed and fences the old worker", async () => {
  const { request } = fixture();
  await request("POST", "/jobs", { id: "expiry", type: "bookmarks", items: [{ id: "one", payload: 1 }] });
  const old = (await request("POST", "/jobs/expiry/claim", { lease_owner: "old", lease_ms: 1 })).body.claim;
  await new Promise((resolve) => setTimeout(resolve, 5));
  const current = (await request("POST", "/jobs/expiry/claim", { lease_owner: "new" })).body.claim;
  assert.equal(current.attempt, old.attempt + 1);
  const late = await request("POST", "/jobs/expiry/items/one/complete", {
    lease_owner: old.lease_owner, attempt: old.attempt, idempotency_key: old.idempotency_key, outcome: "saved",
  });
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, "JOB_INVALID_TRANSITION");
  const accepted = await request("POST", "/jobs/expiry/items/one/complete", {
    lease_owner: current.lease_owner, attempt: current.attempt, idempotency_key: current.idempotency_key, outcome: "updated",
  });
  assert.equal(accepted.status, 200);
});

test("controls map invalid transitions to 409 and retry resets only failed items", async () => {
  const { request } = fixture();
  await request("POST", "/jobs", { id: "controls", type: "profile", items: [{ id: "ok", payload: 1 }, { id: "bad", payload: 2 }] });
  const ok = (await request("POST", "/jobs/controls/claim", { lease_owner: "w" })).body.claim;
  await request("POST", "/jobs/controls/items/ok/complete", { lease_owner: "w", attempt: ok.attempt, idempotency_key: ok.idempotency_key, outcome: "skipped" });
  const bad = (await request("POST", "/jobs/controls/claim", { lease_owner: "w" })).body.claim;
  await request("POST", "/jobs/controls/items/bad/fail", {
    lease_owner: "w", attempt: bad.attempt, idempotency_key: bad.idempotency_key,
    error: { code: "X_NOT_FOUND", message: "gone", retryable: false },
  });
  const retried = await request("POST", "/jobs/controls/retry", {});
  assert.equal(retried.status, 200);
  assert.deepEqual(retried.body.job.items.map((item: any) => [item.id, item.status, item.attempt]), [["ok", "skipped", 1], ["bad", "pending", 1]]);
  const invalid = await request("POST", "/jobs/controls/resume", {});
  assert.equal(invalid.status, 409);
  assert.equal(invalid.body.error.code, "JOB_INVALID_TRANSITION");
  assert.equal((await request("GET", "/jobs/missing")).body.error.code, "JOB_NOT_FOUND");
});
