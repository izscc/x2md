import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONFIG_VERSION, ConfigVersionError, migrateConfig } from "../core/config-migrations.ts";
import { loadConfig, normalizeConfig, normalizeConfigWithWarnings, publicConfig } from "../core/config.ts";

test("v0 -> v1 -> v2 保留核心字段并映射旧 overwrite", () => {
  const result = migrateConfig({
    save_paths: ["/vault/inbox"], filename_format: "{author}-{summary}",
    overwrite: true, port: 9527, twitter_folder: "/old/twitter",
  });
  assert.equal(result.fromVersion, 0);
  assert.equal(result.config.config_version, CONFIG_VERSION);
  assert.deepEqual(result.config.save_paths, ["/vault/inbox"]);
  assert.equal(result.config.filename_format, "{author}-{summary}");
  assert.equal(result.config.duplicate_policy, "update");
  assert.equal(result.config.overwrite, undefined);
  assert.equal(result.config.port, undefined);
  assert.equal(result.config.twitter_folder, undefined);
  assert.ok(result.warnings.some((warning) => warning.includes("overwrite")));
});

test("migration 严格清除未知键，schema 对无效字段回退并给 warning", () => {
  const migrated = migrateConfig({ config_version: 1, mystery: "persist-me" });
  const result = normalizeConfigWithWarnings(migrated.config, migrated.warnings);
  assert.equal((result.config as Record<string, unknown>).mystery, undefined);
  assert.equal(result.config.config_version, CONFIG_VERSION);
  assert.ok(result.warnings.some((warning) => warning.includes("mystery")));

  const invalid = normalizeConfigWithWarnings({ config_version: 2, max_filename_length: "nope", image_embed_style: "html" });
  assert.equal(invalid.config.max_filename_length, 100);
  assert.equal(invalid.config.image_embed_style, "markdown");
  assert.ok(invalid.warnings.some((warning) => warning.includes("max_filename_length")));
});

test("拒绝 future config version", () => {
  assert.throws(() => migrateConfig({ config_version: CONFIG_VERSION + 1 }), ConfigVersionError);
});

test("v1 的旧 duplicate policy 显式映射而不是静默回退", () => {
  const result = migrateConfig({ config_version: 1, duplicate_policy: "overwrite" });
  assert.equal(result.config.duplicate_policy, "update");
  assert.ok(result.warnings.some((warning) => warning.includes("overwrite")));
});

test("首次加载旧配置先备份再原子回写，后续不重复备份", () => {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-config-migration-"));
  const file = join(appDir, "config.json");
  writeFileSync(file, `${JSON.stringify({ save_paths: [join(appDir, "md")], port: 1234, unknown: true })}\n`);
  const cfg = loadConfig(appDir);
  assert.equal(cfg.config_version, CONFIG_VERSION);
  assert.equal((cfg as Record<string, unknown>).port, undefined);
  const backup = `${file}.v0.bak`;
  assert.equal(existsSync(backup), true);
  assert.equal(JSON.parse(readFileSync(backup, "utf8")).port, 1234);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).config_version, CONFIG_VERSION);
  loadConfig(appDir);
  assert.equal(existsSync(backup), true);
});

test("public config 永不暴露 secret 且只返回 schema allowlist", () => {
  const cfg = normalizeConfig({ install_secret: "install", local_api_token: "legacy", unknown: "secret-ish" });
  const safe = publicConfig(cfg);
  assert.equal(safe.install_secret, undefined);
  assert.equal(safe.local_api_token, undefined);
  assert.equal(safe.unknown, undefined);
  assert.equal(safe.config_version, CONFIG_VERSION);
});
