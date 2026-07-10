import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("..", import.meta.url).pathname;
const script = join(root, "scripts/sync-extension-version.mjs");

function fixture(version = "4.2.0-beta.1") {
  const dir = mkdtempSync(join(tmpdir(), "x2md-version-"));
  mkdirSync(join(dir, "extension"));
  mkdirSync(join(dir, "app/core"), { recursive: true });
  mkdirSync(join(dir, `release/v${version}`), { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ version }));
  writeFileSync(join(dir, "extension/manifest.json"), JSON.stringify({ version: "0.0.0", version_name: "0.0.0" }));
  writeFileSync(join(dir, "app/core/config.ts"), 'export const VERSION = "0.0.0";\nexport const MIN_EXTENSION_VERSION = "0.0.0";\n');
  writeFileSync(join(dir, `release/v${version}/update.json`), JSON.stringify({ version: "0.0.0" }));
  writeFileSync(join(dir, "README.md"), "Download from https://github.com/izscc/x2md/releases/latest\n");
  return dir;
}

test("--check reports drift without modifying derived files", () => {
  const dir = fixture();
  const before = readFileSync(join(dir, "extension/manifest.json"), "utf8");
  const result = spawnSync(process.execPath, [script, "--check"], { cwd: dir, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.equal(readFileSync(join(dir, "extension/manifest.json"), "utf8"), before);
});

test("sync updates all derived version metadata and then passes --check", () => {
  const dir = fixture();
  assert.equal(spawnSync(process.execPath, [script], { cwd: dir }).status, 0);
  assert.equal(spawnSync(process.execPath, [script, "--check"], { cwd: dir }).status, 0);
  const manifest = JSON.parse(readFileSync(join(dir, "extension/manifest.json"), "utf8"));
  assert.deepEqual({ version: manifest.version, version_name: manifest.version_name }, { version: "4.2.0", version_name: "4.2.0-beta.1" });
  assert.equal(JSON.parse(readFileSync(join(dir, "release/v4.2.0-beta.1/update.json"), "utf8")).version, "4.2.0-beta.1");
});
