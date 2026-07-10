import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const sourceApp = process.env.X2MD_SMOKE_APP || "build/stable-macos-arm64/X2MD.app";
const maxSecondMs = Number(process.env.X2MD_STARTUP_MAX_MS || 1000);
const root = mkdtempSync(join(tmpdir(), "x2md-startup-time-"));
const app = join(root, basename(sourceApp));
const home = join(root, "home");
const appDir = join(home, "Library", "Application Support", "X2MD");
const port = 9527;

mkdirSync(appDir, { recursive: true });
cpSync(sourceApp, app, { recursive: true });
writeFileSync(join(appDir, "config.json"), JSON.stringify({
  port,
  save_paths: [join(home, "md")],
  video_save_path: join(home, "videos"),
  setup_completed: true,
}, null, 2));

function pids() {
  try {
    return execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
      .filter((match) => match && match[2].includes(root) && Number(match[1]) !== process.pid)
      .map((match) => Number(match[1]));
  } catch {
    return [];
  }
}

async function killAll() {
  for (let round = 0; round < 8; round += 1) {
    const found = pids();
    if (!found.length) return;
    for (const pid of found) {
      try { process.kill(pid, round < 4 ? "SIGTERM" : "SIGKILL"); } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function waitForPortClosed() {
  for (let i = 0; i < 40; i += 1) {
    try { await fetch(`http://127.0.0.1:${port}/ping`); } catch { return; }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`port ${port} still responds after app stop`);
}

async function launchAndTime(label) {
  await waitForPortClosed();
  spawn(join(app, "Contents", "MacOS", "launcher"), [], {
    env: { ...process.env, HOME: home, X2MD_APP_DIR: appDir },
    stdio: "ignore",
  });

  const startedAt = Date.now();
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/ping`);
      const body = await res.json();
      if (res.ok && body.status === "ok") {
        const ms = Date.now() - startedAt;
        await killAll();
        await waitForPortClosed();
        return ms;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await killAll();
  throw new Error(`${label} startup did not reach /ping`);
}

try {
  const firstMs = await launchAndTime("first");
  const secondMs = await launchAndTime("second");
  if (secondMs > maxSecondMs) throw new Error(`second startup ${secondMs}ms > ${maxSecondMs}ms`);
  console.log(`mac startup smoke ok: first=${firstMs}ms second=${secondMs}ms max=${maxSecondMs}ms`);
} finally {
  await killAll();
  rmSync(root, { recursive: true, force: true });
}
