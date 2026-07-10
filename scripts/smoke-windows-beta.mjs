#!/usr/bin/env node
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";

const args = process.argv.slice(2);
if (args.includes("--help")) { console.log("Usage: node scripts/smoke-windows-beta.mjs --artifact <X2MD_Windows_Beta directory>"); process.exit(0); }
const index = args.indexOf("--artifact");
const root = resolve(index >= 0 ? args[index + 1] : "artifacts/windows-beta/X2MD_Windows_Beta");
const exe = join(root, "x2md.exe");
if (!existsSync(exe)) throw new Error(`missing runtime: ${exe}`);
const run = mkdtempSync(join(tmpdir(), "x2md-windows-smoke-"));
const appDir = join(run, "app"); const saveDir = join(run, "md"); mkdirSync(appDir); mkdirSync(saveDir);
const child = spawn(exe, [], { env: { ...process.env, X2MD_APP_DIR: appDir }, stdio: ["ignore", "pipe", "pipe"] });
let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
try {
  let ping;
  for (let i = 0; i < 100; i += 1) { try { const response = await fetch("http://127.0.0.1:9527/ping"); ping = await response.json(); if (response.ok) break; } catch {} await sleep(100); }
  if (ping?.status !== "ok") throw new Error(`Windows artifact did not start: ${output}`);
  let code = "";
  for (let i = 0; i < 30 && !code; i += 1) { code = output.match(/PAIRING_CODE=(\d{6})/)?.[1] || ""; if (!code) await sleep(100); }
  const pair = await fetch("http://127.0.0.1:9527/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }).then((response) => response.json());
  if (!pair.token) throw new Error(`Windows pairing failed: ${JSON.stringify(pair)}`);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${pair.token}` };
  const config = await fetch("http://127.0.0.1:9527/config", { method: "POST", headers, body: JSON.stringify({ save_paths: [saveDir], setup_completed: true }) });
  if (!config.ok) throw new Error(`Windows config failed: ${await config.text()}`);
  const save = await fetch("http://127.0.0.1:9527/save", { method: "POST", headers, body: JSON.stringify({ type: "article", article_title: "Windows beta smoke", article_content: "TypeScript artifact save", url: "https://x2md.local/windows-smoke" }) });
  if (!save.ok || !readdirSync(saveDir).some((file) => file.endsWith(".md") && readFileSync(join(saveDir, file), "utf8").includes("TypeScript artifact save"))) throw new Error(`Windows save failed: ${await save.text()}`);
  const shutdown = await fetch("http://127.0.0.1:9527/shutdown", { method: "POST", headers, body: "{}" });
  if (!shutdown.ok) throw new Error(`Windows shutdown failed: ${await shutdown.text()}`);
  await new Promise((resolvePromise, reject) => { const timer = setTimeout(() => reject(new Error("Windows artifact did not shut down")), 5000); child.once("exit", () => { clearTimeout(timer); resolvePromise(); }); });
  console.log(`windows beta smoke ok: version=${ping.version}`);
} finally { if (child.exitCode === null) child.kill(); }
