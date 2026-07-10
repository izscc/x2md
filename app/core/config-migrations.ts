export const CONFIG_VERSION = 2;

export class ConfigVersionError extends Error {
  readonly code = "CONFIG_VERSION_UNSUPPORTED";

  constructor(version: unknown) {
    super(`Unsupported future config_version: ${String(version)} (current: ${CONFIG_VERSION})`);
    this.name = "ConfigVersionError";
  }
}

export type ConfigMigrationResult = {
  config: Record<string, unknown>;
  fromVersion: number;
  warnings: string[];
  changed: boolean;
};

const V0_DEPRECATED_KEYS = [
  "port", "overwrite", "overwrite_existing", "platform_folders", "twitter_folder",
  "x_folder", "wechat_folder", "weibo_folder", "feishu_folder", "web_folder",
] as const;

function versionOf(raw: Record<string, unknown>): number {
  if (raw.config_version === undefined) return 0;
  const version = Number(raw.config_version);
  if (!Number.isInteger(version) || version < 0) return 0;
  if (version > CONFIG_VERSION) throw new ConfigVersionError(raw.config_version);
  return version;
}

function v0ToV1(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const output = { ...input };
  if (!Array.isArray(output.save_paths) && typeof output.save_path === "string" && output.save_path.trim()) {
    output.save_paths = [output.save_path.trim()];
    warnings.push("migrated deprecated save_path to save_paths");
  }
  delete output.save_path;
  if (output.duplicate_policy === undefined) {
    const overwrite = output.overwrite ?? output.overwrite_existing;
    if (overwrite !== undefined) {
      output.duplicate_policy = overwrite === true || overwrite === 1 || overwrite === "true" ? "update" : "skip";
      warnings.push("migrated deprecated overwrite setting to duplicate_policy");
    }
  }
  for (const key of V0_DEPRECATED_KEYS) {
    if (key in output) {
      delete output[key];
      if (key !== "overwrite" && key !== "overwrite_existing") warnings.push(`removed deprecated config key: ${key}`);
    }
  }
  output.config_version = 1;
  return output;
}

function v1ToV2(input: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = { ...input, config_version: 2 };
  if (output.duplicate_policy === "overwrite") {
    output.duplicate_policy = "update";
    warnings.push("migrated deprecated duplicate_policy overwrite to update");
  } else if (output.duplicate_policy === "ask") {
    output.duplicate_policy = "skip";
    warnings.push("migrated unsupported duplicate_policy ask to skip");
  }
  return output;
}

export function migrateConfig(raw: Record<string, unknown>): ConfigMigrationResult {
  const fromVersion = versionOf(raw);
  const warnings: string[] = [];
  let config = { ...raw };
  let version = fromVersion;
  if (version === 0) { config = v0ToV1(config, warnings); version = 1; }
  if (version === 1) { config = v1ToV2(config, warnings); version = 2; }
  return { config, fromVersion, warnings, changed: fromVersion !== CONFIG_VERSION };
}
