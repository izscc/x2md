import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./check-fixture-privacy.mjs", import.meta.url);

test("fixture privacy scanner rejects credentials and personal paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "x2md-private-fixture-"));
  writeFileSync(join(dir, "bad.json"), JSON.stringify({ Authorization: "Bearer super-secret-token", path: "/Users/alice/private/file" }));
  assert.throws(() => execFileSync(process.execPath, [script.pathname, dir], { stdio: "pipe" }), /Command failed/);
});

test("fixture privacy scanner accepts synthetic fixture content", () => {
  const dir = mkdtempSync(join(tmpdir(), "x2md-safe-fixture-"));
  writeFileSync(join(dir, "ok.json"), JSON.stringify({ url: "https://example.test/status/1", text: "fixture" }));
  assert.doesNotThrow(() => execFileSync(process.execPath, [script.pathname, dir], { stdio: "pipe" }));
});
