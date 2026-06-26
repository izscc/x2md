import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const releaseDir = "release/v2.0.2";
const macZip = join(releaseDir, "X2MD_Mac.zip");
const extZip = join(releaseDir, "X2MD_Extension.zip");
const sums = join(releaseDir, "SHA256SUMS.txt");
for (const file of [macZip, extZip, sums]) if (!existsSync(file)) throw new Error(`missing release artifact: ${file}`);

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
  if (!recorded.includes("X2MD_Mac.zip") || !recorded.includes("X2MD_Extension.zip")) throw new Error("SHA256SUMS missing release files");
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
  console.log(`release artifacts ok: zip=${zipMb.toFixed(1)}MB app=${appMb.toFixed(1)}MB`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
