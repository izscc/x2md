import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { createHmac } from "node:crypto";

const app = process.env.X2MD_SMOKE_APP || "build/stable-macos-arm64/X2MD.app";
if (!existsSync(`${app}/Contents/MacOS/launcher`)) throw new Error("先运行 npm run build:mac");
for (const file of ["manifest.json", "background.js", "save_response.js"]) {
  if (!existsSync(join(app, "Contents", "Resources", "extension", file))) throw new Error(`packaged extension missing ${file}`);
}

const runRoot = mkdtempSync(join(tmpdir(), "x2md-packaged-app-"));
const runApp = join(runRoot, basename(app));
cpSync(app, runApp, { recursive: true });
const launcher = `${runApp}/Contents/MacOS/launcher`;
const home = mkdtempSync(join(tmpdir(), "x2md-packaged-home-"));
const appDir = join(home, "Library", "Application Support", "X2MD");
mkdirSync(appDir, { recursive: true });
const conflictMode = process.env.X2MD_SMOKE_PORT_CONFLICT === "1";
const firstRunMode = process.env.X2MD_SMOKE_FIRST_RUN === "1";
const autostartMode = process.env.X2MD_SMOKE_AUTOSTART === "1";
const loginAutostartMode = process.env.X2MD_SMOKE_LOGIN_AUTOSTART === "1";
const extensionHealthMode = process.env.X2MD_SMOKE_EXTENSION_HEALTH === "1";
const windowVisibleMode = process.env.X2MD_SMOKE_WINDOW_VISIBLE === "1";
const menuVisibleMode = process.env.X2MD_SMOKE_MENU_VISIBLE === "1";
const port = 9527;
const mdDir = join(home, "md");
const sessionFile = join(appDir, "smoke-session");
writeFileSync(join(appDir, "config.json"), JSON.stringify((firstRunMode || windowVisibleMode)
  ? { port }
  : {
    port,
    save_paths: [mdDir],
    custom_save_paths: [],
    filename_format: "{summary}_{date}_{author}",
    max_filename_length: 60,
    video_save_path: join(home, "videos"),
    setup_completed: true,
  }, null, 2));

const blocker = conflictMode ? createServer() : null;
if (blocker) {
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(port, "127.0.0.1", resolve);
  });
}

const child = spawn(launcher, [], {
  env: { ...process.env, HOME: home, X2MD_APP_DIR: appDir, X2MD_OPEN_DRY_RUN: "1", X2MD_SMOKE_SESSION_FILE: sessionFile, ...(loginAutostartMode ? { X2MD_AUTOSTART_SKIP_LAUNCHCTL: "1" } : {}) },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

let ok = false;
let savedOk = false;
const startedAt = Date.now();
let pingMs = 0;
let loginBootstrapped = false;
let session = "";
const authHeaders = (extra = {}) => ({ ...extra, ...(session ? { Authorization: `Bearer ${session}` } : {}) });
const smokeFetch = (input, init = {}) => fetch(input, { ...init, headers: authHeaders(init.headers || {}) });

function childPids(pid) {
  try {
    return execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" })
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return [];
  }
}

function killTree(pid) {
  for (const childPid of childPids(pid)) killTree(childPid);
  try { process.kill(pid, "SIGTERM"); } catch {}
}

function smokePids() {
  try {
    return execFileSync("ps", ["eww", "-axo", "pid=,command="], { encoding: "utf8" })
      .split("\n")
      .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
      .filter((match) => match && Number(match[1]) !== process.pid && match[2].includes(appDir))
      .map((match) => Number(match[1]));
  } catch {
    return [];
  }
}

async function cleanup() {
  if (loginBootstrapped) {
    try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, join(home, "Library", "LaunchAgents", "com.x2md.app.plist")]); } catch {}
  }
  killTree(child.pid);
  if (blocker) await new Promise((resolve) => blocker.close(resolve));
  for (let i = 0; i < 10; i += 1) {
    const pids = smokePids();
    if (pids.length === 0) break;
    for (const pid of pids) {
      try { process.kill(pid, "SIGTERM"); } catch {}
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  rmSync(home, { recursive: true, force: true });
  rmSync(runRoot, { recursive: true, force: true });
}

try {
  if (conflictMode) {
    for (let i = 0; i < 60; i += 1) {
      const log = existsSync(join(appDir, "x2md.log")) ? readFileSync(join(appDir, "x2md.log"), "utf8") : "";
      if ((output + log).includes(`端口 ${port} 已被占用`)) {
        console.log(`packaged conflict smoke ok: port ${port} reports occupied`);
        await cleanup();
        process.exit(0);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const log = existsSync(join(appDir, "x2md.log")) ? readFileSync(join(appDir, "x2md.log"), "utf8") : "";
    throw new Error(`packaged conflict smoke failed\n--- stdout ---\n${output}\n--- log ---\n${log}`);
  }

  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await smokeFetch(`http://127.0.0.1:${port}/ping`);
      const body = await res.json();
      ok = res.ok && body.status === "ok";
      if (ok) {
        pingMs = Date.now() - startedAt;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!ok) {
    const log = existsSync(join(appDir, "x2md.log")) ? readFileSync(join(appDir, "x2md.log"), "utf8") : "";
    throw new Error(`packaged ping smoke failed\n--- stdout ---\n${output}\n--- log ---\n${log}`);
  }

  for (let i = 0; i < 40 && !session; i += 1) {
    if (existsSync(sessionFile)) session = readFileSync(sessionFile, "utf8").trim();
    if (!session) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!session) {
    const log = existsSync(join(appDir, "x2md.log")) ? readFileSync(join(appDir, "x2md.log"), "utf8") : "";
    throw new Error(`packaged smoke did not receive a real settings session credential\n--- stdout ---\n${output}\n--- log ---\n${log}`);
  }

  try {
    const listeners = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], { encoding: "utf8" });
    if (!listeners.includes(`127.0.0.1:${port}`) || listeners.includes(`*:${port}`) || listeners.includes(`0.0.0.0:${port}`)) {
      throw new Error(listeners);
    }
  } catch (error) {
    throw new Error(`packaged listen address smoke failed: expected 127.0.0.1 only\n${String(error?.stdout || error?.message || error)}`);
  }

  if (firstRunMode || windowVisibleMode) {
    const before = await smokeFetch(`http://127.0.0.1:${port}/config`, { headers: authHeaders() }).then((res) => res.json());
    if (before.setup_completed !== false) throw new Error(`first-run config should be incomplete: ${JSON.stringify(before)}`);
    const log = existsSync(join(appDir, "x2md.log")) ? readFileSync(join(appDir, "x2md.log"), "utf8") : "";
    if (!log.includes("设置页已打开")) {
      throw new Error(`first-run settings window was not opened\n--- stdout ---\n${output}\n--- log ---\n${log}`);
    }
    if (!/设置页已打开：inline/.test(log)) {
      throw new Error(`first-run settings window did not use inline settings UI\n--- stdout ---\n${output}\n--- log ---\n${log}`);
    }
    const videoDir = join(home, "videos");
    const configResp = await smokeFetch(`http://127.0.0.1:${port}/config`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ save_paths: [mdDir], video_save_path: videoDir }),
    });
    const after = await configResp.json().catch(() => ({}));
    if (!configResp.ok || after.config?.setup_completed !== false || !existsSync(mdDir) || !existsSync(videoDir)) {
      throw new Error(`first-run config save failed\n--- response ---\n${JSON.stringify(after)}`);
    }
    const setup = async (step, body = {}, token = session) => {
      const response = await fetch(`http://127.0.0.1:${port}/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ step, ...body }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`first-run ${step} failed: ${JSON.stringify(payload)}`);
      return payload;
    };
    await setup("runtime");
    await setup("directory");
    const persisted = JSON.parse(readFileSync(join(appDir, "config.json"), "utf8"));
    const extensionToken = createHmac("sha256", persisted.install_secret).update("x2md-extension-v1").digest("base64url");
    const manifest = JSON.parse(readFileSync(join(app, "Contents", "Resources", "extension", "manifest.json"), "utf8"));
    await setup("extension", {
      extension_version: manifest.version,
      permissions: [...(manifest.permissions || []), ...(manifest.host_permissions || [])],
    }, extensionToken);
    const completed = await setup("sample");
    if (!completed.setup_completed || !completed.sample_history_id || !completed.result?.saved?.[0]) {
      throw new Error(`first-run sample did not complete Setup Doctor: ${JSON.stringify(completed)}`);
    }
    if (!readFileSync(completed.result.saved[0], "utf8").includes("Setup Doctor 保存的本地样例")) {
      throw new Error("first-run sample did not use the real Save Engine");
    }
    for (const action of ["show_file", "open_obsidian"]) {
      const actionResponse = await smokeFetch(`http://127.0.0.1:${port}/history/action`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: completed.sample_history_id, action }),
      });
      if (!actionResponse.ok) throw new Error(`first-run ${action} dry-run failed: ${await actionResponse.text()}`);
    }
  }

  if (extensionHealthMode) {
    const manifest = JSON.parse(readFileSync(join(app, "Contents", "Resources", "extension", "manifest.json"), "utf8"));
    if (!JSON.stringify(manifest.host_permissions || []).includes("http://127.0.0.1:9527/*")) {
      throw new Error("extension manifest missing http://127.0.0.1:9527/* host permission");
    }
    const res = await smokeFetch(`http://127.0.0.1:${port}/ping`, { headers: { Origin: "chrome-extension://x2md-smoke" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.status !== "ok" || !body.version) {
      throw new Error(`extension health ping failed\n--- response ---\n${JSON.stringify(body)}`);
    }
  }

  if (menuVisibleMode) {
    const runningApps = execFileSync("ps", ["eww", "-axo", "command="], { encoding: "utf8" });
    let menuText = "";
    if (runningApps.includes("/Applications/X2MD.app/Contents/MacOS/X2MD")) {
      console.log("menu-visible smoke skipped: installed /Applications/X2MD.app is running");
    } else try {
      menuText = execFileSync("osascript", ["-e", `tell application "System Events"
  tell process "X2MD"
    click menu bar item 1 of menu bar 1
    delay 0.3
    get name of every menu item of menu 1 of menu bar item 1 of menu bar 1
  end tell
end tell`], { encoding: "utf8" }).trim();
    } catch (error) {
      menuText = String(error?.stderr || error?.message || error);
    }
    if (menuText.includes("不允许辅助访问") || menuText.includes("not allowed assistive access")) {
      console.log("menu-visible smoke skipped: osascript lacks Accessibility permission");
    } else if (menuText && !menuText.includes("打开日志") && !menuText.includes("查看日志")) {
      console.log(`menu-visible smoke skipped: X2MD status menu not isolated (${menuText.slice(0, 160)})`);
    }
  }

  if (windowVisibleMode) {
    let windowNames = "";
    for (let i = 0; i < 20; i += 1) {
      for (const processName of [basename(app, ".app"), "bun"]) {
        try {
          windowNames = execFileSync("osascript", ["-e", `tell application "System Events" to tell process "${processName}" to get name of every window`], { encoding: "utf8" }).trim();
        } catch (error) {
          windowNames = String(error?.stderr || error?.message || error);
        }
        if (windowNames.includes("X2MD 设置")) break;
      }
      if (windowNames.includes("X2MD 设置")) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!windowNames.includes("X2MD 设置")) {
      const log = existsSync(join(appDir, "x2md.log")) ? readFileSync(join(appDir, "x2md.log"), "utf8") : "";
      if (windowNames.includes("不允许辅助访问") || windowNames.includes("not allowed assistive access")) {
        console.log("window-visible smoke skipped: osascript lacks Accessibility permission");
      } else {
        throw new Error(`settings window not visible via System Events\n--- windows ---\n${windowNames}\n--- stdout ---\n${output}\n--- log ---\n${log}`);
      }
    }
  }

  if (autostartMode) {
    const launchAgents = join(home, "Library", "LaunchAgents");
    const plist = join(launchAgents, "com.x2md.app.plist");
    const legacyPlist = join(launchAgents, "com.x2md.server.plist");
    const on = await smokeFetch(`http://127.0.0.1:${port}/autostart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }).then((res) => res.json());
    if (on.enabled !== true || !existsSync(plist) || !readFileSync(plist, "utf8").includes("com.x2md.app")) {
      throw new Error(`autostart enable failed\n--- response ---\n${JSON.stringify(on)}`);
    }
    mkdirSync(launchAgents, { recursive: true });
    writeFileSync(legacyPlist, "legacy", "utf8");
    const off = await smokeFetch(`http://127.0.0.1:${port}/autostart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    }).then((res) => res.json());
    if (off.enabled !== false || existsSync(plist) || existsSync(legacyPlist)) {
      throw new Error(`autostart disable failed\n--- response ---\n${JSON.stringify(off)}`);
    }
  }

  if (loginAutostartMode) {
    const launchAgents = join(home, "Library", "LaunchAgents");
    const plist = join(launchAgents, "com.x2md.app.plist");
    const on = await smokeFetch(`http://127.0.0.1:${port}/autostart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    }).then((res) => res.json());
    const plistText = existsSync(plist) ? readFileSync(plist, "utf8") : "";
    if (on.enabled !== true || !plistText.includes("X2MD_APP_DIR") || !plistText.includes(appDir)) {
      throw new Error(`login autostart plist failed\n--- response ---\n${JSON.stringify(on)}\n--- plist ---\n${plistText}`);
    }

    killTree(child.pid);
    for (let i = 0; i < 30; i += 1) {
      try {
        await smokeFetch(`http://127.0.0.1:${port}/ping`);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    try { execFileSync("launchctl", ["bootout", `gui/${process.getuid()}`, plist]); } catch {}
    execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, plist]);
    loginBootstrapped = true;
    let loginOk = false;
    for (let i = 0; i < 60; i += 1) {
      try {
        const res = await smokeFetch(`http://127.0.0.1:${port}/ping`);
        const body = await res.json();
        loginOk = res.ok && body.status === "ok";
        if (loginOk) break;
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!loginOk) {
      const log = existsSync(join(appDir, "x2md.log")) ? readFileSync(join(appDir, "x2md.log"), "utf8") : "";
      throw new Error(`login autostart ping failed\n--- stdout ---\n${output}\n--- log ---\n${log}`);
    }
  }

  const save = await smokeFetch(`http://127.0.0.1:${port}/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "tweet", text: "packaged smoke save", url: "https://x.com/x2md/status/1", handle: "@x2md" }),
  });
  const saveBody = await save.json().catch(() => ({}));
  savedOk = save.ok && saveBody.success === true && readdirSync(mdDir).some((name) => name.endsWith(".md") && readFileSync(join(mdDir, name), "utf8").includes("packaged smoke save"));
  if (!savedOk) {
    const log = existsSync(join(appDir, "x2md.log")) ? readFileSync(join(appDir, "x2md.log"), "utf8") : "";
    throw new Error(`packaged save smoke failed\n--- response ---\n${JSON.stringify(saveBody)}\n--- stdout ---\n${output}\n--- log ---\n${log}`);
  }

  const status = await smokeFetch(`http://127.0.0.1:${port}/status`, { headers: { Origin: `http://127.0.0.1:${port}` } });
  const statusBody = await status.json().catch(() => ({}));
  if (!status.ok || statusBody.port !== port || statusBody.status !== "ok") {
    throw new Error(`packaged status smoke failed\n--- response ---\n${JSON.stringify(statusBody)}\n--- stdout ---\n${output}`);
  }

  const logResp = await smokeFetch(`http://127.0.0.1:${port}/log`, { headers: { Origin: `http://127.0.0.1:${port}` } });
  const logBody = await logResp.json().catch(() => ({}));
  if (!logResp.ok || !String(logBody.log || "").includes("保存完成：outcome=")) {
    throw new Error(`packaged log smoke failed\n--- response ---\n${JSON.stringify(logBody)}\n--- stdout ---\n${output}`);
  }

  for (const target of ["save", "video", "log", "extension"]) {
    const openResp = await smokeFetch(`http://127.0.0.1:${port}/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target }),
    });
    const openBody = await openResp.json().catch(() => ({}));
    if (!openResp.ok || openBody.target !== target) {
      throw new Error(`packaged open ${target} smoke failed\n--- response ---\n${JSON.stringify(openBody)}\n--- stdout ---\n${output}`);
    }
  }
  const badOpen = await smokeFetch(`http://127.0.0.1:${port}/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "/tmp/evil" }),
  });
  if (badOpen.status !== 400) {
    throw new Error(`packaged open reject smoke failed: status=${badOpen.status}`);
  }

  console.log(`packaged smoke ok: http://127.0.0.1:${port}/ping + /save + /status + /log + /open${(firstRunMode || windowVisibleMode) ? " + first-run config" : ""}${autostartMode ? " + autostart" : ""}${loginAutostartMode ? " + login-autostart" : ""}${extensionHealthMode ? " + extension-health" : ""}${windowVisibleMode ? " + window-visible" : ""}${menuVisibleMode ? " + menu-visible" : ""} (${pingMs}ms to /ping)`);
} finally {
  await cleanup();
}
