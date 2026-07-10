import { randomUUID } from "node:crypto";

import type { CaptureJob, JobItem, JobItemStatus } from "./contracts.ts";
import { JobStore } from "./job-store.ts";

type Clock = () => Date;
type LeaseProof = { leaseOwner: string; attempt: number; idempotencyKey: string };
type Submission = { key: string; operation: "complete" | "fail"; leaseOwner: string; attempt: number };
type StoredItem = JobItem & { last_submission?: Submission };

export class JobTransitionError extends Error {
  readonly code = "JOB_INVALID_TRANSITION";
  constructor(message: string) { super(message); this.name = "JobTransitionError"; }
}

export class JobNotFoundError extends Error {
  readonly code = "JOB_NOT_FOUND";
  constructor(id: string) { super(`Job not found: ${id}`); this.name = "JobNotFoundError"; }
}

function copy<T>(value: T): T { return structuredClone(value); }
function iso(date: Date): string { return date.toISOString(); }

export class JobEngine {
  readonly store: JobStore;
  private readonly clock: Clock;

  constructor(store: JobStore | string, clock: Clock = () => new Date()) {
    this.store = typeof store === "string" ? new JobStore(store) : store;
    this.clock = clock;
  }

  async create(input: { type: string; items: Array<{ id?: string; payload: unknown }>; metadata?: Record<string, unknown>; id?: string }): Promise<CaptureJob> {
    if (!input.items.length) throw new JobTransitionError("A job must contain at least one item");
    const now = iso(this.clock());
    const ids = new Set<string>();
    const items = input.items.map((source): JobItem => {
      const id = source.id || randomUUID();
      if (ids.has(id)) throw new JobTransitionError(`Duplicate item id: ${id}`);
      ids.add(id);
      return { id, payload: source.payload, status: "pending", lease_owner: null, lease_expires_at: null, attempt: 0, idempotency_key: null, created_at: now, updated_at: now };
    });
    const job: CaptureJob = { id: input.id || randomUUID(), type: input.type, status: "queued", items, metadata: input.metadata, created_at: now, updated_at: now };
    return this.store.mutate((jobs) => {
      if (jobs[job.id]) throw new JobTransitionError(`Job already exists: ${job.id}`);
      jobs[job.id] = job;
      return copy(job);
    });
  }

  async list(): Promise<CaptureJob[]> { return copy(await this.store.list()); }
  async get(id: string): Promise<CaptureJob> {
    const job = await this.store.get(id);
    if (!job) throw new JobNotFoundError(id);
    return copy(job);
  }

  async claim(jobId: string, options: { leaseOwner: string; leaseMs?: number; now?: Date }): Promise<JobItem | null> {
    if (!options.leaseOwner) throw new JobTransitionError("leaseOwner is required");
    const at = options.now || this.clock();
    const leaseMs = options.leaseMs ?? 30_000;
    if (leaseMs <= 0) throw new JobTransitionError("leaseMs must be positive");
    return this.store.mutate((jobs) => {
      const job = this.requireJob(jobs, jobId);
      this.reclaimJob(job, at);
      if (job.status === "queued") job.status = "running";
      if (job.status !== "running") return null;
      const item = job.items.find((candidate) => candidate.status === "pending");
      if (!item) { this.settle(job, at); return null; }
      item.status = "leased";
      item.lease_owner = options.leaseOwner;
      item.lease_expires_at = iso(new Date(at.getTime() + leaseMs));
      item.attempt += 1;
      item.idempotency_key = randomUUID();
      item.updated_at = iso(at);
      job.updated_at = iso(at);
      return copy(item);
    });
  }

  async renew(jobId: string, itemId: string, proof: LeaseProof & { leaseMs?: number; now?: Date }): Promise<JobItem> {
    const at = proof.now || this.clock();
    const leaseMs = proof.leaseMs ?? 30_000;
    if (leaseMs <= 0) throw new JobTransitionError("leaseMs must be positive");
    return this.store.mutate((jobs) => {
      const item = this.requireItem(this.requireJob(jobs, jobId), itemId);
      this.assertLease(item, proof, at);
      item.lease_expires_at = iso(new Date(at.getTime() + leaseMs));
      item.updated_at = iso(at);
      return copy(item);
    });
  }

  async complete(jobId: string, itemId: string, proof: LeaseProof & { outcome: Extract<JobItemStatus, "saved" | "updated" | "skipped">; result?: unknown; now?: Date }): Promise<JobItem> {
    return this.submit(jobId, itemId, proof, "complete", (item) => {
      item.status = proof.outcome;
      item.result = proof.result;
      delete item.error;
    });
  }

  async fail(jobId: string, itemId: string, proof: LeaseProof & { error: { code: string; message: string; retryable?: boolean }; now?: Date }): Promise<JobItem> {
    return this.submit(jobId, itemId, proof, "fail", (item) => {
      item.status = "failed";
      item.error = proof.error;
      delete item.result;
    });
  }

  async reclaimExpired(jobId?: string, now: Date = this.clock()): Promise<number> {
    return this.store.mutate((jobs) => {
      const selected = jobId ? [this.requireJob(jobs, jobId)] : Object.values(jobs);
      return selected.reduce((total, job) => total + this.reclaimJob(job, now), 0);
    });
  }

  async pause(jobId: string, reason?: string): Promise<CaptureJob> {
    return this.changeStatus(jobId, ["queued", "running"], "paused", reason);
  }

  async resume(jobId: string): Promise<CaptureJob> {
    return this.store.mutate((jobs) => {
      const job = this.requireJob(jobs, jobId);
      if (job.status !== "paused") this.invalid(job, "resume");
      job.status = "running";
      delete job.pause_reason;
      job.updated_at = iso(this.clock());
      return copy(job);
    });
  }

  async cancel(jobId: string): Promise<CaptureJob> {
    return this.changeStatus(jobId, ["queued", "running", "paused", "failed"], "cancelled");
  }

  async retryFailed(jobId: string): Promise<CaptureJob> {
    return this.store.mutate((jobs) => {
      const job = this.requireJob(jobs, jobId);
      if (!["failed", "paused", "running"].includes(job.status)) this.invalid(job, "retry failed items");
      let count = 0;
      for (const raw of job.items) {
        const item = raw as StoredItem;
        if (item.status !== "failed") continue;
        item.status = "pending";
        item.lease_owner = null;
        item.lease_expires_at = null;
        item.idempotency_key = null;
        delete item.error;
        delete item.result;
        delete item.last_submission;
        item.updated_at = iso(this.clock());
        count += 1;
      }
      if (!count) throw new JobTransitionError(`Job ${job.id} has no failed items`);
      job.status = "running";
      delete job.pause_reason;
      job.updated_at = iso(this.clock());
      return copy(job);
    });
  }

  private async submit(jobId: string, itemId: string, proof: LeaseProof & { now?: Date }, operation: Submission["operation"], mutate: (item: StoredItem) => void): Promise<JobItem> {
    const at = proof.now || this.clock();
    return this.store.mutate((jobs) => {
      const job = this.requireJob(jobs, jobId);
      const item = this.requireItem(job, itemId) as StoredItem;
      if (item.last_submission?.key === proof.idempotencyKey) {
        if (item.last_submission.operation !== operation || item.last_submission.leaseOwner !== proof.leaseOwner || item.last_submission.attempt !== proof.attempt) {
          throw new JobTransitionError("Idempotency key was used for a different operation or lease proof");
        }
        return copy(item);
      }
      this.assertLease(item, proof, at);
      if (job.status === "cancelled") this.invalid(job, operation);
      mutate(item);
      item.lease_owner = null;
      item.lease_expires_at = null;
      item.last_submission = { key: proof.idempotencyKey, operation, leaseOwner: proof.leaseOwner, attempt: proof.attempt };
      item.updated_at = iso(at);
      job.updated_at = iso(at);
      this.settle(job, at);
      return copy(item);
    });
  }

  private async changeStatus(jobId: string, from: CaptureJob["status"][], to: CaptureJob["status"], reason?: string): Promise<CaptureJob> {
    return this.store.mutate((jobs) => {
      const job = this.requireJob(jobs, jobId);
      if (!from.includes(job.status)) this.invalid(job, to);
      job.status = to;
      if (to === "paused" && reason) job.pause_reason = reason;
      job.updated_at = iso(this.clock());
      return copy(job);
    });
  }

  private reclaimJob(job: CaptureJob, at: Date): number {
    if (["completed", "cancelled"].includes(job.status)) return 0;
    let count = 0;
    for (const item of job.items as StoredItem[]) {
      if (item.status !== "leased" || !item.lease_expires_at || Date.parse(item.lease_expires_at) > at.getTime()) continue;
      item.status = "pending";
      item.lease_owner = null;
      item.lease_expires_at = null;
      item.idempotency_key = null;
      delete item.last_submission;
      item.updated_at = iso(at);
      count += 1;
    }
    if (count) job.updated_at = iso(at);
    return count;
  }

  private settle(job: CaptureJob, at: Date): void {
    if (job.items.some((item) => item.status === "pending" || item.status === "leased")) return;
    job.status = job.items.some((item) => item.status === "failed") ? "failed" : "completed";
    job.updated_at = iso(at);
  }

  private assertLease(item: JobItem, proof: LeaseProof, at: Date): void {
    if (item.status !== "leased" || item.lease_owner !== proof.leaseOwner || item.attempt !== proof.attempt || item.idempotency_key !== proof.idempotencyKey || !item.lease_expires_at || Date.parse(item.lease_expires_at) <= at.getTime()) {
      throw new JobTransitionError(`Lease fencing rejected item ${item.id}`);
    }
  }

  private requireJob(jobs: Record<string, CaptureJob>, id: string): CaptureJob {
    const job = jobs[id];
    if (!job) throw new JobNotFoundError(id);
    return job;
  }

  private requireItem(job: CaptureJob, id: string): JobItem {
    const item = job.items.find((candidate) => candidate.id === id);
    if (!item) throw new JobNotFoundError(`${job.id}/${id}`);
    return item;
  }

  private invalid(job: CaptureJob, action: string): never {
    throw new JobTransitionError(`Cannot ${action} job ${job.id} from ${job.status}`);
  }
}
