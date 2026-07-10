import { closeSync, constants, openSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { MIN_EXTENSION_VERSION, VERSION, type X2MDConfig } from "./config.ts";

export const SETUP_STEP_ORDER = ["runtime", "directory", "extension", "sample"] as const;
export type SetupStep = typeof SETUP_STEP_ORDER[number];

export function compareVersions(left: string, right: string): number {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return 0;
}

export function setupState(config: X2MDConfig, port: number): Record<string, unknown> {
  const completed = Object.fromEntries(SETUP_STEP_ORDER.map((step) => [step, config.setup_steps[step] === true]));
  return {
    success: true,
    setup_completed: config.setup_completed,
    steps: completed,
    version: VERSION,
    min_extension_version: MIN_EXTENSION_VERSION,
    port,
    save_path: config.save_paths[0] || "",
    sample_history_id: config.setup_sample_history_id || "",
  };
}

export function assertPreviousSteps(config: X2MDConfig, step: SetupStep): void {
  const index = SETUP_STEP_ORDER.indexOf(step);
  const missing = SETUP_STEP_ORDER.slice(0, index).find((item) => config.setup_steps[item] !== true);
  if (missing) throw new Error(`请先完成步骤：${missing}`);
}

export function probeDirectory(path: string): void {
  if (!path) throw new Error("请先选择保存目录");
  const probe = join(path, `.x2md-write-probe-${process.pid}-${Date.now()}`);
  let fd: number | undefined;
  try {
    fd = openSync(probe, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { unlinkSync(probe); } catch {}
  }
}

export function validateExtension(version: string, permissions: unknown): void {
  if (compareVersions(version, MIN_EXTENSION_VERSION) < 0) throw new Error(`扩展版本过低，需要 ${MIN_EXTENSION_VERSION} 或更高版本`);
  const list = Array.isArray(permissions) ? permissions.map(String) : [];
  for (const required of ["storage", "scripting", "http://127.0.0.1:9527/*"]) {
    if (!list.includes(required)) throw new Error(`扩展缺少权限：${required}`);
  }
}
