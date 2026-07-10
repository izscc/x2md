import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import { logPath } from "../core/config.ts";
import { sanitizeSaveMetrics, type SaveMetrics } from "../core/save-metrics.ts";

export function log(message: string, appDir?: string): void {
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    const file = logPath(appDir);
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, line, "utf8");
  } catch {
    // logging must never break saves
  }
  console.log(message);
}

export function logSaveMetrics(metrics: Partial<SaveMetrics> & Record<string, unknown>, appDir?: string): void {
  log(`save_metrics ${JSON.stringify(sanitizeSaveMetrics(metrics))}`, appDir);
}

export function readLogTail(appDir?: string, maxLines = 200): string {
  const file = logPath(appDir);
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").split(/\r?\n/).slice(-maxLines).join("\n");
}
