export const CONFIG_KEYS = [
  "config_version", "save_paths", "custom_save_paths", "filename_format", "max_filename_length",
  "video_save_path", "enable_video_download", "video_duration_threshold", "show_site_save_icon",
  "show_x_profile_capture_button", "enable_save_notification", "auto_tags_enabled", "default_tags",
  "tag_rules", "front_matter_template", "custom_front_matter_template", "local_api_token",
  "install_secret", "require_local_api_token", "download_images", "image_attachment_path",
  "image_embed_style", "profile_capture_range", "profile_capture_custom_days",
  "profile_capture_save_path", "setup_completed", "duplicate_policy",
] as const;

export const SECRET_CONFIG_KEYS = new Set<string>(["install_secret", "local_api_token"]);
const allowed = new Set<string>(CONFIG_KEYS);

export function allowlistedConfig(raw: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (allowed.has(key)) output[key] = value;
    else warnings.push(`removed unknown config key: ${key}`);
  }
  return output;
}

export function safePublicConfig(raw: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(CONFIG_KEYS
    .filter((key) => !SECRET_CONFIG_KEYS.has(key) && key in raw)
    .map((key) => [key, raw[key]]));
}
