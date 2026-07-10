import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildDiagnostics, exportDiagnostics } from "../core/diagnostics.ts";
import { handleApiRequest } from "../main/http-server.ts";
import { loadConfig, logPath, saveConfig, VERSION } from "../core/config.ts";

function tempApp(): string { return mkdtempSync(join(tmpdir(), "x2md-diagnostics-")); }

test("诊断包只由 allowlist 字段构成且不泄露注入的正文、secret、cookie、URL 或个人路径", () => {
  const appDir = tempApp();
  const cfg = loadConfig(appDir);
  saveConfig({
    ...cfg,
    install_secret: "TOKEN_DO_NOT_LEAK",
    local_api_token: "AUTH_DO_NOT_LEAK",
    save_paths: ["/Users/private-person/Documents/secret"],
    injected_body: "PRIVATE ARTICLE BODY",
  }, appDir);
  appendFileSync(logPath(appDir), [
    "cookie=session-cookie https://media.example/private/photo.jpg PRIVATE ARTICLE BODY",
    'save_metrics {"event":"save_pipeline","duration_ms":{"validate":1,"dedupe":2,"media":3,"render":4,"write":5},"media_count":1,"media_completed":0,"media_failed":1,"target_count":1,"outcome":"partial","error_code":"MEDIA_TIMEOUT","body":"PRIVATE ARTICLE BODY","url":"https://media.example/private/photo.jpg"}',
    "保存请求失败：code=PATH_DENIED /Users/private-person/Documents/secret",
  ].join("\n"), "utf8");

  const diagnostic = buildDiagnostics({ appDir, extensionVersion: "3.1.0", liveVersion: "3.1.1" });
  assert.deepEqual(Object.keys(diagnostic).sort(), ["config", "connection", "generated_at", "metrics", "platform", "recent_error_codes", "schema_version", "versions"].sort());
  assert.deepEqual(diagnostic.versions, { repo: VERSION, app: VERSION, extension: "3.1.0", live: "3.1.1" });
  assert.equal(diagnostic.connection.endpoint, "loopback");
  assert.equal(diagnostic.connection.paired, false);
  assert.deepEqual(diagnostic.recent_error_codes, ["MEDIA_TIMEOUT", "PATH_DENIED"]);
  assert.equal(diagnostic.metrics[0].error_code, "MEDIA_TIMEOUT");
  assert.deepEqual(Object.keys(diagnostic.config), ["field_names"]);

  const encoded = JSON.stringify(diagnostic);
  for (const secret of ["TOKEN_DO_NOT_LEAK", "AUTH_DO_NOT_LEAK", "session-cookie", "PRIVATE ARTICLE BODY", "/Users/private-person", "https://media.example"]) {
    assert.doesNotMatch(encoded, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("导出诊断 JSON 并由 API 返回位置和支持打开所在目录", async () => {
  const appDir = tempApp();
  loadConfig(appDir);
  const exported = exportDiagnostics({ appDir });
  assert.equal(JSON.parse(readFileSync(exported.file, "utf8")).schema_version, 1);
  assert.equal(exported.directory, join(appDir, "diagnostics"));

  const response = await handleApiRequest(new Request("http://127.0.0.1:9527/diagnostics/export", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  }), { appDir, testBypassAuth: true, openDryRun: true });
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.match(result.file, /diagnostics[/\\]x2md-diagnostics-/);

  const opened = await handleApiRequest(new Request("http://127.0.0.1:9527/open", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target: "diagnostics" }),
  }), { appDir, testBypassAuth: true, openDryRun: true });
  assert.equal(opened.status, 200);
});
