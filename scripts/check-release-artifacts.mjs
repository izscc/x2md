import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/check-release-artifacts.mjs [--dir <directory>]\n\nValidates artifacts in the explicit directory, or artifacts/v<package version> by default.");
  process.exit(0);
}
const dirIndex = args.indexOf("--dir");
if (dirIndex >= 0 && !args[dirIndex + 1]) throw new Error("--dir requires a directory");
const releaseDir = dirIndex >= 0 ? args[dirIndex + 1] : `artifacts/v${pkg.version}`;
const macZip = join(releaseDir, "X2MD_Mac.zip");
const extZip = join(releaseDir, "X2MD_Extension.zip");
const winZip = join(releaseDir, "X2MD_Windows_Lite.zip");
const updateJson = join(releaseDir, "update.json");
const sums = join(releaseDir, "SHA256SUMS.txt");
for (const file of [macZip, extZip, winZip, updateJson, sums]) if (!existsSync(file)) throw new Error(`missing release artifact: ${file}`);

execFileSync("shasum", ["-a", "256", "-c", "SHA256SUMS.txt"], { cwd: releaseDir, stdio: "inherit" });

const zipMb = statSync(macZip).size / 1024 / 1024;
if (zipMb > 30) throw new Error(`X2MD_Mac.zip too large: ${zipMb.toFixed(1)}MB > 30MB`);

const dir = mkdtempSync(join(tmpdir(), "x2md-release-size-"));
try {
  execFileSync("ditto", ["-x", "-k", macZip, dir]);
  const du = execFileSync("du", ["-sk", join(dir, "X2MD.app")], { encoding: "utf8" });
  const appMb = Number(du.split(/\s+/)[0]) / 1024;
  if (appMb > 90) throw new Error(`X2MD.app too large: ${appMb.toFixed(1)}MB > 90MB`);
  const recorded = readFileSync(sums, "utf8");
  if (!recorded.includes("X2MD_Mac.zip") || !recorded.includes("X2MD_Extension.zip") || !recorded.includes("X2MD_Windows_Lite.zip") || !recorded.includes("update.json")) throw new Error("SHA256SUMS missing release files");
  for (const file of ["index.html", "styles.css", "settings.js"]) {
    if (!existsSync(join(dir, "X2MD.app", "Contents", "Resources", "app", "views", "settings", file))) {
      throw new Error(`X2MD_Mac.zip missing settings view ${file}`);
    }
  }

  const extDir = join(dir, "extension");
  execFileSync("unzip", ["-q", extZip, "-d", extDir]);
  for (const file of ["manifest.json", "background.js", "save_response.js"]) {
    if (!existsSync(join(extDir, file))) throw new Error(`X2MD_Extension.zip missing ${file}`);
  }
  const manifest = JSON.parse(readFileSync(join(extDir, "manifest.json"), "utf8"));
  if (manifest.manifest_version !== 3 || !String(manifest.name || "").includes("X2MD")) throw new Error("X2MD_Extension.zip manifest invalid");
  const update = JSON.parse(readFileSync(updateJson, "utf8"));
  if (!update.version && !update.updateInfo && !update.artifacts) throw new Error("update.json missing update metadata");

  const winDir = join(dir, "windows");
  execFileSync("unzip", ["-q", winZip, "-d", winDir]);
  for (const file of ["windows-lite/start-windows.bat", "windows-lite/app/main/index.ts"]) {
    if (!existsSync(join(winDir, file))) throw new Error(`X2MD_Windows_Lite.zip missing ${file}`);
  }

  console.log(`release artifacts ok: zip=${zipMb.toFixed(1)}MB app=${appMb.toFixed(1)}MB`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
