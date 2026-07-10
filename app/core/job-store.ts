import { StateStore } from "./state-store.ts";
import type { CaptureJob } from "./contracts.ts";

type JobsNamespace = Record<string, unknown> & {
  capture_jobs?: Record<string, CaptureJob>;
};

export class JobStore {
  readonly state: StateStore;

  constructor(appDir: string | StateStore) {
    this.state = typeof appDir === "string" ? new StateStore(appDir) : appDir;
  }

  async list(): Promise<CaptureJob[]> {
    const state = await this.state.read<JobsNamespace>("jobs", () => ({}));
    return Object.values(state.capture_jobs || {});
  }

  async get(id: string): Promise<CaptureJob | undefined> {
    const state = await this.state.read<JobsNamespace>("jobs", () => ({}));
    return state.capture_jobs?.[id];
  }

  async mutate<T>(operation: (jobs: Record<string, CaptureJob>) => T): Promise<T> {
    let result!: T;
    await this.state.update<JobsNamespace>("jobs", () => ({}), (state) => {
      const jobs = { ...(state.capture_jobs || {}) };
      result = operation(jobs);
      return { ...state, capture_jobs: jobs };
    });
    return result;
  }
}
