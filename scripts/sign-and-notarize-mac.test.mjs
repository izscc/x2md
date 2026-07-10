import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = new URL("./sign-and-notarize-mac.sh", import.meta.url).pathname;
const credentials = {
  X2MD_RELEASE_CHANNEL: "stable", X2MD_SIGN_DRY_RUN: "1",
  MAC_CERTIFICATE_P12_BASE64: "ZHVtbXk=", MAC_CERTIFICATE_PASSWORD: "p12-pass", MAC_SIGN_IDENTITY: "Developer ID Application: Test",
  APPLE_ID: "release@example.test", APPLE_TEAM_ID: "TEAM123", APPLE_APP_PASSWORD: "app-pass", KEYCHAIN_PASSWORD: "keychain-pass",
};

test("dry-run records codesign, notarization, staple and validation in order", () => {
  const root = mkdtempSync(join(tmpdir(), "x2md-sign-test-"));
  const app = join(root, "X2MD.app"); mkdirSync(app);
  const log = join(root, "commands.log");
  execFileSync("bash", [script, app], { env: { ...process.env, ...credentials, X2MD_COMMAND_LOG: log } });
  const commands = readFileSync(log, "utf8");
  const markers = ["codesign --force", "codesign --verify", "notarytool submit", "stapler staple", "stapler validate", "spctl --assess"];
  let previous = -1;
  for (const marker of markers) { const index = commands.indexOf(marker); assert.ok(index > previous, `${marker} must follow the previous gate`); previous = index; }
});

test("stable builds fail closed without credentials and propagate command failures", () => {
  const root = mkdtempSync(join(tmpdir(), "x2md-sign-fail-"));
  const app = join(root, "X2MD.app"); mkdirSync(app);
  assert.throws(() => execFileSync("bash", [script, app], { env: { ...process.env, X2MD_RELEASE_CHANNEL: "stable", X2MD_SIGN_DRY_RUN: "1" }, stdio: "pipe" }));
  assert.throws(() => execFileSync("bash", [script, app], { env: { ...process.env, ...credentials, X2MD_FAKE_FAIL_MATCH: "notarytool", X2MD_COMMAND_LOG: join(root, "fail.log") }, stdio: "pipe" }));
});

test("unsigned beta is allowed explicitly when credentials are absent", () => {
  const root = mkdtempSync(join(tmpdir(), "x2md-sign-beta-"));
  const app = join(root, "X2MD.app"); mkdirSync(app);
  assert.doesNotThrow(() => execFileSync("bash", [script, app], { env: { ...process.env, X2MD_RELEASE_CHANNEL: "beta", X2MD_SIGN_DRY_RUN: "1" } }));
});
