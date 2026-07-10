import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { CONFIG_KEYS } from "./config-schema.ts";
import { getAppDir, loadConfig, LOCAL_API_PORT, logPath, VERSION } from "./config.ts";
import { sanitizeSaveMetrics, type SaveMetrics } from "./save-metrics.ts";

const STABLE_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

export type Diagnostics = {
  schema_version: 1;
  generated_at: string;
  versions: { repo: string; app: string; extension: string; live: string };
  platform: { os: string; arch: string };
  connection: { endpoint: "loopback"; port: number; service: "reachable"; paired: boolean; setup_completed: boolean };
  config: { field_names: string[] };
  recent_error_codes: string[];
  metrics: SaveMetrics[];
};

function readExtensionVersion(): string {
  for (const file of [resolve("extension/manifest.json"), resolve(dirname(process.execPath), "../Resources/extension/manifest.json")]) {
    try {
      const value = JSON.parse(readFileSync(file, "utf8")).version;
      if (typeof value === "string" && /^\d+\.\d+\.\d+/.test(value)) return value;
    } catch { /* try the next known application-owned location */ }
  }
  return "unknown";
}

function diagnosticLogData(appDir: string): { metrics: SaveMetrics[]; codes: string[] } {
  let lines: string[] = [];
  try { lines = readFileSync(logPath(appDir), "utf8").split(/\r?\n/).slice(-500); } catch { /* no log yet */ }
  const metrics: SaveMetrics[] = [];
  const codes: string[] = [];
  const remember = (candidate: unknown) => {
    const code = String(candidate || "");
    if (STABLE_CODE.test(code) && !codes.includes(code)) codes.push(code);
  };
  for (const line of lines) {
    const marker = line.indexOf("save_metrics ");
    if (marker >= 0) {
      try {
        const parsed = JSON.parse(line.slice(marker + "save_metrics ".length));
        const clean = sanitizeSaveMetrics(parsed);
        metrics.push(clean);
        remember(clean.error_code);
      } catch { /* malformed lines are deliberately excluded */ }
    }
    for (const match of line.matchAll(/\bcode=([A-Z][A-Z0-9_]{1,63})\b/g)) remember(match[1]);
  }
  return { metrics: metrics.slice(-20), codes: codes.slice(-20) };
}

export function buildDiagnostics(opts: { appDir?: string; repoVersion?: string; appVersion?: string; extensionVersion?: string; liveVersion?: string; port?: number } = {}): Diagnostics {
  const appDir = opts.appDir || getAppDir();
  const config = loadConfig(appDir);
  const logData = diagnosticLogData(appDir);
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    versions: {
      repo: opts.repoVersion || VERSION,
      app: opts.appVersion || VERSION,
      extension: opts.extensionVersion || readExtensionVersion(),
      live: opts.liveVersion || VERSION,
    },
    platform: { os: process.platform, arch: process.arch },
    connection: {
      endpoint: "loopback",
      port: opts.port ?? LOCAL_API_PORT,
      service: "reachable",
      paired: config.setup_steps?.extension === true,
      setup_completed: config.setup_completed === true,
    },
    config: { field_names: CONFIG_KEYS.filter((key) => key in config).slice().sort() },
    recent_error_codes: logData.codes,
    metrics: logData.metrics,
  };
}

export function diagnosticsDirectory(appDir = getAppDir()): string {
  return join(appDir, "diagnostics");
}

export function exportDiagnostics(opts: Parameters<typeof buildDiagnostics>[0] = {}): { file: string; directory: string; diagnostics: Diagnostics } {
  const appDir = opts.appDir || getAppDir();
  const diagnostics = buildDiagnostics({ ...opts, appDir });
  const directory = diagnosticsDirectory(appDir);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stamp = diagnostics.generated_at.replace(/[:.]/g, "-");
  const file = join(directory, `x2md-diagnostics-${stamp}.json`);
  writeFileSync(file, `${JSON.stringify(diagnostics, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { file, directory, diagnostics };
}
