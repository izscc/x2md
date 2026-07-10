import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform, userInfo } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

export const LABEL = "com.x2md.app";
export const LEGACY_LABEL = "com.x2md.server";

export function autostartSupport(target: NodeJS.Platform = platform()): { supported: boolean; reason?: string } {
  return target === "darwin" ? { supported: true } : { supported: false, reason: target === "win32" ? "Windows beta does not install startup integration" : "Desktop startup integration is macOS-only" };
}

function launchAgentsDir(home = homedir()): string {
  return join(home, "Library", "LaunchAgents");
}

export function plistPath(label = LABEL, home = homedir()): string {
  return join(launchAgentsDir(home), `${label}.plist`);
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildLaunchAgentPlist(args: string[], workingDirectory: string, logFile = join(homedir(), "Library", "Logs", "x2md-autostart.log"), env: Record<string, string> = {}): string {
  const argsXml = args.map((arg) => `    <string>${escapeXml(arg)}</string>`).join("\n");
  const envXml = Object.keys(env).length ? `  <key>EnvironmentVariables</key>
  <dict>
${Object.entries(env).map(([key, value]) => `    <key>${escapeXml(key)}</key>
    <string>${escapeXml(value)}</string>`).join("\n")}
  </dict>
` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${argsXml}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(workingDirectory)}</string>
${envXml}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <false/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logFile)}</string>
</dict>
</plist>
`;
}

export function programArgumentsForExecutable(executable: string, entry = resolve("app/main/index.ts")): string[] {
  return executable.includes(".app/Contents/MacOS/") ? [executable] : [executable, entry];
}

function defaultProgramArguments(): string[] {
  if (process.env.X2MD_APP_EXECUTABLE) return [process.env.X2MD_APP_EXECUTABLE];
  return programArgumentsForExecutable(process.execPath);
}

function defaultWorkingDirectory(): string {
  if (process.env.X2MD_APP_WORKDIR) return process.env.X2MD_APP_WORKDIR;
  return process.execPath.includes(".app/Contents/MacOS/") ? dirname(process.execPath) : process.cwd();
}

function defaultEnvironmentVariables(): Record<string, string> {
  if (!process.env.X2MD_APP_DIR) return {};
  return { HOME: homedir(), X2MD_APP_DIR: process.env.X2MD_APP_DIR };
}

function runLaunchctl(path: string, action: "bootstrap" | "bootout", dryRun: boolean): void {
  if (dryRun || process.env.X2MD_AUTOSTART_SKIP_LAUNCHCTL === "1") return;
  const uid = typeof process.getuid === "function" ? process.getuid() : userInfo().uid;
  spawnSync("launchctl", [action, `gui/${uid}`, path], { stdio: "ignore" });
}

function removeLaunchAgent(label: string, home: string, dryRun: boolean): void {
  const path = plistPath(label, home);
  runLaunchctl(path, "bootout", dryRun);
  if (!dryRun && existsSync(path)) rmSync(path, { force: true });
}

export function isAutostartEnabled(opts: { home?: string; platform?: NodeJS.Platform } = {}): boolean {
  if (!autostartSupport(opts.platform || platform()).supported) return false;
  return existsSync(plistPath(LABEL, opts.home));
}

export function setAutostartEnabled(enabled: boolean, opts: { home?: string; dryRun?: boolean; platform?: NodeJS.Platform; args?: string[]; cwd?: string } = {}): boolean {
  const dryRun = Boolean(opts.dryRun || process.env.X2MD_AUTOSTART_DRY_RUN === "1");
  if (dryRun) return enabled;
  if (!autostartSupport(opts.platform || platform()).supported) return false;
  const home = opts.home || homedir();
  const path = plistPath(LABEL, home);

  if (!enabled) {
    removeLaunchAgent(LABEL, home, dryRun);
    removeLaunchAgent(LEGACY_LABEL, home, dryRun);
    return existsSync(path);
  }

  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buildLaunchAgentPlist(opts.args || defaultProgramArguments(), opts.cwd || defaultWorkingDirectory(), join(home, "Library", "Logs", "x2md-autostart.log"), defaultEnvironmentVariables()), "utf8");
  removeLaunchAgent(LEGACY_LABEL, home, dryRun);
  runLaunchctl(path, "bootout", dryRun);
  runLaunchctl(path, "bootstrap", dryRun);
  return existsSync(path);
}
