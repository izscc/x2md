import { existsSync, mkdirSync, cpSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;
const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log("Usage: node scripts/package-release.mjs [--output-dir <directory>]\n\nDefaults to artifacts/v<package version> and refuses to overwrite an existing directory.");
  process.exit(0);
}
const outputIndex = args.indexOf("--output-dir");
if (outputIndex >= 0 && !args[outputIndex + 1]) throw new Error("--output-dir requires a directory");
const releaseDir = outputIndex >= 0 ? args[outputIndex + 1] : join("artifacts", `v${version}`);
const appPath = "build/stable-macos-arm64/X2MD.app";
if (!existsSync(appPath)) throw new Error(`missing ${appPath}; run npm run build:mac first`);
if (existsSync(releaseDir)) throw new Error(`output directory already exists: ${releaseDir}`);
mkdirSync(releaseDir, { recursive: true });

execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", appPath, join(releaseDir, "X2MD_Mac.zip")], { stdio: "inherit" });
execFileSync("zip", ["-qr", join("..", releaseDir, "X2MD_Extension.zip"), ".", "-x", "tests/*", "*.DS_Store"], { cwd: "extension", stdio: "inherit" });

const winRoot = join(releaseDir, "windows-lite");
mkdirSync(winRoot, { recursive: true });
for (const dir of ["app", "extension", "scripts"]) cpSync(dir, join(winRoot, dir), { recursive: true, filter: (source) => !source.includes("tests") && !source.includes(".DS_Store") });
for (const file of ["package.json", "package-lock.json", "README.md"]) if (existsSync(file)) cpSync(file, join(winRoot, file));
writeFileSync(join(winRoot, "start-windows.bat"), "@echo off\r\nset X2MD_APP_DIR=%APPDATA%\\X2MD\r\nnode app/main/index.ts\r\n", "utf8");
writeFileSync(join(winRoot, "README-Windows.txt"), `X2MD Windows Lite v${version}\r\n\r\nRun start-windows.bat after installing Node.js 22+.\r\nSupports ping/config/save/settings/autostart API surface.\r\n`, "utf8");
execFileSync("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", winRoot, join(releaseDir, "X2MD_Windows_Lite.zip")], { stdio: "inherit" });
rmSync(winRoot, { recursive: true, force: true });

if (existsSync("artifacts/stable-macos-arm64-update.json")) {
  cpSync("artifacts/stable-macos-arm64-update.json", join(releaseDir, "update.json"));
} else {
  writeFileSync(join(releaseDir, "update.json"), JSON.stringify({ version, notes: `X2MD v${version}` }, null, 2), "utf8");
}

const notesPath = join("release", `v${version}`, "RELEASE_NOTES.md");
if (existsSync(notesPath)) cpSync(notesPath, join(releaseDir, "RELEASE_NOTES.md"));
const sums = execFileSync("shasum", ["-a", "256", "X2MD_Mac.zip", "X2MD_Extension.zip", "X2MD_Windows_Lite.zip", "update.json"], { cwd: releaseDir, encoding: "utf8" });
writeFileSync(join(releaseDir, "SHA256SUMS.txt"), sums, "utf8");
console.log(`packaged release ${releaseDir}`);
