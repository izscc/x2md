import { readFileSync, writeFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const displayVersion = String(pkg.version);
const chromeVersion = displayVersion.split("-", 1)[0];

const manifestPath = "extension/manifest.json";
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = chromeVersion;
manifest.version_name = displayVersion;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 4)}\n`);

const configPath = "app/core/config.ts";
const configSource = readFileSync(configPath, "utf8");
const nextConfigSource = configSource.replace(
  /export const VERSION = ["'][^"']+["'];/,
  `export const VERSION = "${displayVersion}";`,
);
if (nextConfigSource === configSource && !configSource.includes(`export const VERSION = "${displayVersion}";`)) {
  throw new Error("failed to sync app/core/config.ts VERSION");
}
writeFileSync(configPath, nextConfigSource);

console.log(`synced version: ${displayVersion} (manifest ${chromeVersion})`);
