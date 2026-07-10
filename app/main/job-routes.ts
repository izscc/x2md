import type { CaptureJob, JobCounts, JobItem, JobItemStatus, JobItemView, JobResult, JobView } from "../core/contracts.ts";
import { JobEngine, JobNotFoundError, JobTransitionError } from "../core/jobs.ts";

type RouteReply = { status: number; body: JobResult };

const ITEM_STATUSES: JobItemStatus[] = ["pending", "leased", "saved", "updated", "skipped", "failed"];

function counts(job: CaptureJob): JobCounts {
  const result = Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0])) as Record<JobItemStatus, number>;
  for (const item of job.items) result[item.status] += 1;
  return {
    ...result,
    total: job.items.length,
    remaining: result.pending + result.leased,
  };
}

function itemView(item: JobItem): JobItemView {
  return {
    id: item.id,
    status: item.status,
    lease_owner: item.lease_owner,
    lease_expires_at: item.lease_expires_at,
    attempt: item.attempt,
    ...(item.error ? { error: item.error } : {}),
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

function jobView(job: CaptureJob, detail = false): JobView {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    ...(job.pause_reason ? { pause_reason: job.pause_reason } : {}),
    created_at: job.created_at,
    updated_at: job.updated_at,
    counts: counts(job),
    ...(detail ? { items: job.items.map(itemView) } : {}),
  };
}

function text(value: unknown): string { return typeof value === "string" ? value : ""; }
function integer(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : Number.NaN;
}

function identifier(value: unknown, field: string): string {
  const result = text(value);
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(result)) throw new Error(`${field} must be a safe identifier`);
  return result;
}

function leaseProof(data: Record<string, unknown>) {
  const leaseOwner = text(data.lease_owner);
  const attempt = integer(data.attempt);
  const idempotencyKey = text(data.idempotency_key);
  if (!leaseOwner || !Number.isInteger(attempt) || attempt < 1 || !idempotencyKey) {
    throw new JobTransitionError("lease_owner, positive attempt and idempotency_key are required");
  }
  return { leaseOwner, attempt, idempotencyKey };
}

function errorReply(error: unknown): RouteReply {
  if (error instanceof JobNotFoundError) {
    return { status: 404, body: { success: false, error: { code: "JOB_NOT_FOUND", message: error.message, retryable: false } } };
  }
  if (error instanceof JobTransitionError) {
    return { status: 409, body: { success: false, error: { code: "JOB_INVALID_TRANSITION", message: error.message, retryable: false } } };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { status: 400, body: { success: false, error: { code: "INVALID_CAPTURE", message, retryable: false } } };
}

export function isJobRoute(path: string): boolean {
  return path === "/jobs" || path.startsWith("/jobs/");
}

export async function handleJobRoute(method: string, path: string, data: Record<string, unknown>, appDir: string): Promise<RouteReply | null> {
  if (!isJobRoute(path)) return null;
  const engine = new JobEngine(appDir);
  try {
    const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
    if (method === "GET" && parts.length === 1) {
      return { status: 200, body: { success: true, jobs: (await engine.list()).map((job) => jobView(job)) } };
    }
    if (method === "POST" && parts.length === 1) {
      const type = text(data.type).trim();
      if (!type || !Array.isArray(data.items)) throw new Error("type and items are required");
      const items = data.items.map((raw) => {
        if (!raw || typeof raw !== "object" || !("payload" in raw)) throw new Error("each item must contain payload");
        const source = raw as Record<string, unknown>;
        return { ...(source.id === undefined ? {} : { id: identifier(source.id, "item id") }), payload: source.payload };
      });
      const metadata = data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata) ? data.metadata as Record<string, unknown> : undefined;
      const job = await engine.create({ type, items, metadata, ...(data.id === undefined ? {} : { id: identifier(data.id, "job id") }) });
      return { status: 201, body: { success: true, job: jobView(job, true) } };
    }
    const jobId = parts[1];
    if (method === "GET" && parts.length === 2) {
      return { status: 200, body: { success: true, job: jobView(await engine.get(jobId), true) } };
    }
    if (method === "POST" && parts.length === 3) {
      const action = parts[2];
      if (action === "pause") return { status: 200, body: { success: true, job: jobView(await engine.pause(jobId, text(data.reason) || undefined), true) } };
      if (action === "resume") return { status: 200, body: { success: true, job: jobView(await engine.resume(jobId), true) } };
      if (action === "cancel") return { status: 200, body: { success: true, job: jobView(await engine.cancel(jobId), true) } };
      if (action === "retry") return { status: 200, body: { success: true, job: jobView(await engine.retryFailed(jobId), true) } };
      if (action === "claim") {
        const leaseOwner = text(data.lease_owner);
        if (!leaseOwner) throw new JobTransitionError("lease_owner is required");
        const leaseMs = data.lease_ms === undefined ? undefined : integer(data.lease_ms);
        if (leaseMs !== undefined && (!Number.isInteger(leaseMs) || leaseMs <= 0)) throw new JobTransitionError("lease_ms must be positive");
        return { status: 200, body: { success: true, claim: await engine.claim(jobId, { leaseOwner, ...(leaseMs ? { leaseMs } : {}) }) } };
      }
    }
    if (method === "POST" && parts.length === 5 && parts[2] === "items") {
      const itemId = parts[3];
      const action = parts[4];
      const proof = leaseProof(data);
      if (action === "renew") {
        const leaseMs = data.lease_ms === undefined ? undefined : integer(data.lease_ms);
        if (leaseMs !== undefined && (!Number.isInteger(leaseMs) || leaseMs <= 0)) throw new JobTransitionError("lease_ms must be positive");
        return { status: 200, body: { success: true, item: itemView(await engine.renew(jobId, itemId, { ...proof, ...(leaseMs ? { leaseMs } : {}) })) } };
      }
      if (action === "complete") {
        if (!["saved", "updated", "skipped"].includes(text(data.outcome))) throw new JobTransitionError("outcome must be saved, updated or skipped");
        const item = await engine.complete(jobId, itemId, { ...proof, outcome: text(data.outcome) as "saved" | "updated" | "skipped", result: data.result });
        return { status: 200, body: { success: true, item: itemView(item) } };
      }
      if (action === "fail") {
        const raw = data.error;
        if (!raw || typeof raw !== "object") throw new JobTransitionError("error is required");
        const source = raw as Record<string, unknown>;
        if (!text(source.code) || !text(source.message)) throw new JobTransitionError("error code and message are required");
        const item = await engine.fail(jobId, itemId, { ...proof, error: { code: text(source.code), message: text(source.message), ...(typeof source.retryable === "boolean" ? { retryable: source.retryable } : {}) } });
        return { status: 200, body: { success: true, item: itemView(item) } };
      }
    }
    return { status: 404, body: { success: false, error: { code: "JOB_NOT_FOUND", message: "Job route not found", retryable: false } } };
  } catch (error) {
    return errorReply(error);
  }
}
