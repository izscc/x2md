#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/build-windows-beta.mjs [--output <directory>]\n\nBuilds a self-contained TypeScript/Bun Windows beta zip.");
  process.exit(0);
}
if (process.platform !== "win32") throw new Error("Windows beta artifact must be built on windows-latest");
const index = args.indexOf("--output");
const output = resolve(index >= 0 ? args[index + 1] : "artifacts/windows-beta");
if (existsSync(output)) throw new Error(`output already exists: ${output}`);
const root = join(output, "X2MD_Windows_Beta");
mkdirSync(root, { recursive: true });
const bun = process.env.BUN_EXE || "bun";
const built = spawnSync(bun, ["build", "--compile", "app/main/windows.ts", "--outfile", join(root, "x2md.exe")], { stdio: "inherit" });
if (built.status !== 0 || !existsSync(join(root, "x2md.exe"))) throw new Error("Bun compile failed");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
writeFileSync(join(root, "artifact.json"), `${JSON.stringify({ name: "X2MD Windows Beta", version: pkg.version, runtime: "bun-compiled", features: ["ping", "pairing", "config", "save", "shutdown"] }, null, 2)}\n`);
writeFileSync(join(root, "README.txt"), "X2MD Windows Beta\r\nRun x2md.exe, pair the extension with the printed code, and keep this window open.\r\nTray, settings UI and autostart are not included in this beta.\r\n");
const zip = join(output, "X2MD_Windows_Beta.zip");
const archived = spawnSync("powershell", ["-NoProfile", "-Command", `Compress-Archive -LiteralPath '${root.replaceAll("'", "''")}' -DestinationPath '${zip.replaceAll("'", "''")}'`], { stdio: "inherit" });
if (archived.status !== 0 || !existsSync(zip)) { rmSync(output, { recursive: true, force: true }); throw new Error("Compress-Archive failed"); }
console.log(zip);
