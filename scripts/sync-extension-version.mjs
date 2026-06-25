import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const manifestPath = "extension/manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const displayVersion = String(pkg.version);
const chromeVersion = displayVersion.split("-", 1)[0];

manifest.version = chromeVersion;
manifest.version_name = displayVersion;

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);
console.log(`synced extension version: ${chromeVersion} (${displayVersion})`);
