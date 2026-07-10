export const SAVE_METRIC_STAGES = ["validate", "dedupe", "media", "render", "write"] as const;
export type SaveMetricStage = typeof SAVE_METRIC_STAGES[number];

export type SaveMetrics = {
  event: "save_pipeline";
  duration_ms: Record<SaveMetricStage, number>;
  media_count: number;
  media_completed: number;
  media_failed: number;
  target_count: number;
  outcome: "saved" | "updated" | "skipped" | "partial" | "failed";
  error_code: string | null;
};

export function createSaveMetrics(): SaveMetrics {
  return {
    event: "save_pipeline",
    duration_ms: { validate: 0, dedupe: 0, media: 0, render: 0, write: 0 },
    media_count: 0, media_completed: 0, media_failed: 0, target_count: 0,
    outcome: "failed", error_code: null,
  };
}

export async function timeSaveStage<T>(metrics: SaveMetrics, stage: SaveMetricStage, work: () => T | Promise<T>): Promise<T> {
  const start = performance.now();
  try { return await work(); }
  finally { metrics.duration_ms[stage] = Math.max(0, Math.round((performance.now() - start) * 100) / 100); }
}

export function sanitizeSaveMetrics(input: Partial<SaveMetrics> & Record<string, unknown>): SaveMetrics {
  const clean = createSaveMetrics();
  for (const stage of SAVE_METRIC_STAGES) {
    const value = Number(input.duration_ms?.[stage]);
    clean.duration_ms[stage] = Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : 0;
  }
  for (const key of ["media_count", "media_completed", "media_failed", "target_count"] as const) {
    const value = Number(input[key]);
    clean[key] = Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  }
  if (["saved", "updated", "skipped", "partial", "failed"].includes(String(input.outcome))) clean.outcome = input.outcome as SaveMetrics["outcome"];
  clean.error_code = typeof input.error_code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(input.error_code) ? input.error_code : null;
  return clean;
}
