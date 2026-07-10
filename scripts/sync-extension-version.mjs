import { existsSync, readFileSync, writeFileSync } from "node:fs";

const checkOnly = process.argv.includes("--check");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const displayVersion = String(pkg.version);
const chromeVersion = displayVersion.split("-", 1)[0];
const drift = [];

function syncText(path, current, expected) {
  if (current === expected) return;
  drift.push(path);
  if (!checkOnly) writeFileSync(path, expected);
}

const manifestPath = "extension/manifest.json";
const manifestSource = readFileSync(manifestPath, "utf8");
const manifest = JSON.parse(manifestSource);
manifest.version = chromeVersion;
manifest.version_name = displayVersion;
syncText(manifestPath, manifestSource, `${JSON.stringify(manifest, null, 4)}\n`);

const configPath = "app/core/config.ts";
const configSource = readFileSync(configPath, "utf8");
let nextConfigSource = configSource.replace(
  /export const VERSION = ["'][^"']+["'];/,
  `export const VERSION = "${displayVersion}";`,
);
nextConfigSource = nextConfigSource.replace(
  /export const MIN_EXTENSION_VERSION = ["'][^"']+["'];/,
  `export const MIN_EXTENSION_VERSION = "${displayVersion}";`,
);
if (!nextConfigSource.includes(`export const VERSION = "${displayVersion}";`) ||
    !nextConfigSource.includes(`export const MIN_EXTENSION_VERSION = "${displayVersion}";`)) {
  throw new Error("failed to locate app version constants");
}
syncText(configPath, configSource, nextConfigSource);

const releaseMetadataPath = `release/v${displayVersion}/update.json`;
if (existsSync(releaseMetadataPath)) {
  const metadataSource = readFileSync(releaseMetadataPath, "utf8");
  const metadata = JSON.parse(metadataSource);
  if (String(metadata.version) !== displayVersion) {
    metadata.version = displayVersion;
    syncText(releaseMetadataPath, metadataSource, `${JSON.stringify(metadata)}\n`);
  }
}

const readme = readFileSync("README.md", "utf8");
if (/github\.com\/izscc\/x2md\/releases\/(?:tag|download)\/v\d/i.test(readme)) {
  drift.push("README.md (latest download links must use releases/latest)");
}

if (drift.length && checkOnly) {
  console.error(`version drift: ${drift.join(", ")}`);
  process.exitCode = 1;
} else if (drift.length) {
  console.log(`synced version: ${displayVersion} (manifest ${chromeVersion})`);
} else {
  console.log(`version consistent: ${displayVersion} (manifest ${chromeVersion})`);
}
