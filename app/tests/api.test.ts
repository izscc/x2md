import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleApiRequest, listenErrorMessage, resolveListenPort, startHttpServer } from "../main/http-server.ts";
import { configPath, logPath, VERSION } from "../core/config.ts";

function tempApp(): string {
  return mkdtempSync(join(tmpdir(), "x2md-api-"));
}

async function json(res: Response): Promise<any> {
  return await res.json();
}

test("GET /ping 返回版本", async () => {
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/ping"), { appDir: tempApp() });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.status, "ok");
  assert.equal(body.version, VERSION);
});

test("GET /status 返回服务状态摘要", async () => {
  const appDir = tempApp();
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/status"), { appDir });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.status, "ok");
  assert.equal(body.port, 9527);
  assert.equal(body.config_path, configPath(appDir));
  assert.equal(body.log_path, logPath(appDir));
  assert.equal(Array.isArray(body.save_paths), true);
});

test("普通网页 Origin 只能访问 /ping，不能读写敏感 API", async () => {
  const appDir = tempApp();
  const evilPing = await handleApiRequest(new Request("http://127.0.0.1:9527/ping", {
    headers: { Origin: "https://evil.example" },
  }), { appDir });
  assert.equal(evilPing.status, 200);

  const evilConfig = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    headers: { Origin: "https://evil.example" },
  }), { appDir });
  assert.equal(evilConfig.status, 403);

  const evilStatus = await handleApiRequest(new Request("http://127.0.0.1:9527/status", {
    headers: { Origin: "https://evil.example" },
  }), { appDir });
  assert.equal(evilStatus.status, 403);

  const localStatus = await handleApiRequest(new Request("http://127.0.0.1:9527/status", {
    headers: { Origin: "http://127.0.0.1:9527" },
  }), { appDir });
  assert.equal(localStatus.status, 200);

  const evilLog = await handleApiRequest(new Request("http://127.0.0.1:9527/log", {
    headers: { Origin: "https://evil.example" },
  }), { appDir });
  assert.equal(evilLog.status, 403);

  const evilSave = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ type: "tweet", text: "bad" }),
  }), { appDir });
  assert.equal(evilSave.status, 403);

  const extensionConfig = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    headers: { Origin: "chrome-extension://abcdefghijklmnop" },
  }), { appDir });
  assert.equal(extensionConfig.status, 200);
});

test("GET/POST /config 读写配置", async () => {
  const appDir = tempApp();
  const emojiDir = join(appDir, "📄 素材库");
  const post = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [emojiDir], setup_completed: true }),
  }), { appDir });
  assert.equal(post.status, 200);

  const get = await handleApiRequest(new Request("http://127.0.0.1:9527/config"), { appDir });
  const cfg = await json(get);
  assert.equal(cfg.setup_completed, true);
  assert.deepEqual(cfg.save_paths, [emojiDir]);
});

test("扩展保存 save_paths 时自动完成首次设置", async () => {
  const appDir = tempApp();
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [join(appDir, "md")] }),
  }), { appDir });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.config.setup_completed, true);
});

test("POST /config 拒绝清空保存路径", async () => {
  const appDir = tempApp();
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: ["", " "] }),
  }), { appDir });
  assert.equal(res.status, 400);
  assert.match((await json(res)).error, /保存路径/);
});

test("POST /save 写入 Markdown 并拒绝未知自定义路径", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [mdDir], custom_save_paths: [{ name: "允许", path: join(appDir, "allowed") }] }),
  }), { appDir });

  const ok = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "tweet", text: "hello", url: "https://x.com/a/status/1", handle: "@alice" }),
  }), { appDir });
  const result = await json(ok);
  assert.equal(ok.status, 200);
  assert.equal(result.success, true);
  assert.match(readFileSync(result.saved[0], "utf8"), /hello/);

  const bad = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "tweet",
      text: "SECRET_PRIVATE_BODY_SHOULD_NOT_BE_IN_REQUEST_LOG",
      url: `https://x.com/a/status/${"1".repeat(120)}`,
      custom_save_path_name: "未知",
      custom_save_path: "/tmp/nope",
    }),
  }), { appDir });
  assert.equal(bad.status, 400);

  const logText = readFileSync(logPath(appDir), "utf8");
  assert.match(logText, /请求 \/save: type=tweet platform=\? url=https:\/\/x\.com\/a\/status\/1/);
  const requestLines = logText.split("\n").filter((line) => line.includes("请求 /save"));
  assert.equal(requestLines.some((line) => line.includes("SECRET_PRIVATE_BODY")), false);
  assert.equal(requestLines.some((line) => line.length > 180), false);
  assert.match(logText, /保存成功：/);
  assert.match(logText, /保存失败：自定义保存路径无效/);
});



test("POST /config 标记端口变更，并保留视频和博主配置", async () => {
  const appDir = tempApp();
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      port: 9528,
      enable_video_download: true,
      video_duration_threshold: 9,
      profile_capture_range: "days",
      profile_capture_custom_days: 14,
      custom_save_paths: [{ name: "素材", path: join(appDir, "assets") }],
    }),
  }), { appDir });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.restart_required, true);
  assert.equal(body.config.enable_video_download, true);
  assert.equal(body.config.video_duration_threshold, 9);
  assert.equal(body.config.profile_capture_custom_days, 14);
  assert.deepEqual(body.config.custom_save_paths, [{ name: "素材", path: join(appDir, "assets") }]);
});

test("POST /profile-capture 写入文件，GET state 返回去重状态", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [mdDir] }),
  }), { appDir });

  const save = await handleApiRequest(new Request("http://127.0.0.1:9527/profile-capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "tweets",
      profile: { handle: "alice", displayName: "Alice" },
      items: [{ url: "https://x.com/alice/status/1", published: "2026-05-29T08:00:00Z", text: "hello" }],
    }),
  }), { appDir });
  const saved = await json(save);
  assert.equal(save.status, 200);
  assert.equal(saved.success, true);
  assert.equal(existsSync(saved.saved[0]), true);

  const state = await handleApiRequest(new Request("http://127.0.0.1:9527/profile-capture/state?handle=alice"), { appDir });
  const body = await json(state);
  assert.equal(body.handle, "alice");
  assert.equal(Boolean(body.state.tweets.captured_ids["1"]), true);
});

test("POST /autostart dry-run 不修改系统但返回目标状态", async () => {
  const appDir = tempApp();
  const get = await handleApiRequest(new Request("http://127.0.0.1:9527/autostart"), { appDir });
  const current = await json(get);
  assert.equal(get.status, 200);
  assert.equal(current.success, true);
  assert.equal(typeof current.enabled, "boolean");

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/autostart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  }), { appDir, autostartDryRun: true });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.enabled, true);

  const off = await handleApiRequest(new Request("http://127.0.0.1:9527/autostart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: "false" }),
  }), { appDir, autostartDryRun: true });
  assert.equal((await json(off)).enabled, false);
  const logText = readFileSync(logPath(appDir), "utf8");
  assert.match(logText, /开机自动运行：enabled/);
  assert.match(logText, /开机自动运行：disabled/);
});



test("POST /open 只允许打开白名单目标", async () => {
  const appDir = tempApp();
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [join(appDir, "md")], video_save_path: join(appDir, "video") }),
  }), { appDir });

  const ok = await handleApiRequest(new Request("http://127.0.0.1:9527/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "save" }),
  }), { appDir, openDryRun: true });
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).target, "save");

  const bad = await handleApiRequest(new Request("http://127.0.0.1:9527/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "/tmp/evil" }),
  }), { appDir, openDryRun: true });
  assert.equal(bad.status, 400);
});

test("POST /choose-folder 使用系统文件夹选择器并支持 dry-run", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [mdDir] }),
  }), { appDir });

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/choose-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPath: mdDir }),
  }), { appDir, dialogDryRun: true });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.path, mdDir);
  assert.equal(body.selected, true);
});

test("GET /log 返回日志尾部", async () => {
  const appDir = tempApp();
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [join(appDir, "md")] }),
  }), { appDir });

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/log"), { appDir });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.match(body.log, /配置已更新/);
});



test("启动日志记录配置路径和保存路径", async () => {
  const appDir = tempApp();
  const server = await startHttpServer({ appDir, port: 0 });
  await server.stop();
  const logText = readFileSync(logPath(appDir), "utf8");
  assert.match(logText, new RegExp(configPath(appDir).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(logText, /x2md 服务已启动：http:\/\/127\.0\.0\.1:\d+/);
  assert.match(logText, /保存路径：/);
});

test("GET /status 返回实际监听端口", async () => {
  const appDir = tempApp();
  const server = await startHttpServer({ appDir, port: 0 });
  try {
    const res = await fetch(`http://127.0.0.1:${server.port}/status`);
    const body = await res.json();
    assert.equal(body.port, server.port);
  } finally {
    await server.stop();
  }
});



test("端口占用时返回明确错误", async () => {
  const appDir = tempApp();
  const first = await startHttpServer({ appDir, port: 0 });
  await assert.rejects(
    () => startHttpServer({ appDir: tempApp(), port: first.port }),
    /端口 .* 已被占用/,
  );
  await first.stop();
});

test("Bun 常见端口占用错误也返回明确提示", () => {
  assert.equal(
    listenErrorMessage(new Error("Failed to start server. Is port 9527 in use?"), 9527),
    "端口 9527 已被占用，请退出旧版 X2MD 或修改配置端口",
  );
});

test("启动端口参数无效时回退配置端口", () => {
  assert.equal(resolveListenPort(undefined, 9527), 9527);
  assert.equal(resolveListenPort(0, 9527), 0);
  assert.equal(resolveListenPort(Number.NaN, 19527), 19527);
  assert.equal(resolveListenPort("bad", 19527), 19527);
});

test("CORS OPTIONS 兼容扩展", async () => {
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/save", { method: "OPTIONS" }), { appDir: tempApp() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
});


test("GET /history 返回最近保存记录", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [mdDir] }),
  }), { appDir });

  await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "tweet", text: "history title", url: "https://x.com/a/status/9" }),
  }), { appDir });

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/history"), { appDir });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.history.length, 1);
  assert.match(body.history[0].title, /history title/);
  assert.match(body.history[0].path, /history title/);
});
