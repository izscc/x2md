import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { handleApiRequest, listenErrorMessage, startHttpServer } from "../main/http-server.ts";
import { configPath, logPath, VERSION, loadConfig } from "../core/config.ts";
import { issuePairingCode } from "../core/pairing.ts";

function tempApp(): string {
  return mkdtempSync(join(tmpdir(), "x2md-api-"));
}

async function json(res: Response): Promise<any> {
  return await res.json();
}

test("GET /ping 返回版本", async () => {
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/ping"), { appDir: tempApp(), testBypassAuth: true });
  assert.equal(res.status, 200);
  const body = await json(res);
  assert.equal(body.status, "ok");
  assert.equal(body.version, VERSION);
});

test("敏感路由要求配对，pairing code 单次签发扩展 token", async () => {
  const appDir = tempApp();
  const denied = await handleApiRequest(new Request("http://127.0.0.1:9527/config"), { appDir });
  assert.equal(denied.status, 401);
  const cfg = loadConfig(appDir);
  const code = issuePairingCode(String(cfg.install_secret));
  const pair = await handleApiRequest(new Request("http://127.0.0.1:9527/pair", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
  }), { appDir });
  assert.equal(pair.status, 200);
  const token = (await pair.json()).token;
  const reused = await handleApiRequest(new Request("http://127.0.0.1:9527/pair", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }),
  }), { appDir });
  assert.equal(reused.status, 401);
  const allowed = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    headers: { Authorization: `Bearer ${token}` },
  }), { appDir });
  const body = await allowed.json();
  assert.equal(allowed.status, 200);
  assert.equal(body.install_secret, undefined);
  assert.equal(body.local_api_token, undefined);
});

test("GET /status 返回服务状态摘要", async () => {
  const appDir = tempApp();
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/status"), { appDir, testBypassAuth: true });
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
  }), { appDir, testBypassAuth: true });
  assert.equal(evilPing.status, 200);

  const evilConfig = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    headers: { Origin: "https://evil.example" },
  }), { appDir, testBypassAuth: true });
  assert.equal(evilConfig.status, 403);

  const evilStatus = await handleApiRequest(new Request("http://127.0.0.1:9527/status", {
    headers: { Origin: "https://evil.example" },
  }), { appDir, testBypassAuth: true });
  assert.equal(evilStatus.status, 403);

  const localStatus = await handleApiRequest(new Request("http://127.0.0.1:9527/status", {
    headers: { Origin: "http://127.0.0.1:9527" },
  }), { appDir, testBypassAuth: true });
  assert.equal(localStatus.status, 200);

  const evilLog = await handleApiRequest(new Request("http://127.0.0.1:9527/log", {
    headers: { Origin: "https://evil.example" },
  }), { appDir, testBypassAuth: true });
  assert.equal(evilLog.status, 403);

  const evilSave = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST",
    headers: { Origin: "https://evil.example", "Content-Type": "application/json" },
    body: JSON.stringify({ type: "tweet", text: "bad" }),
  }), { appDir, testBypassAuth: true });
  assert.equal(evilSave.status, 403);

  const extensionConfig = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    headers: { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
  }), { appDir, testBypassAuth: true });
  assert.equal(extensionConfig.status, 200);
});

test("GET/POST /config 读写配置", async () => {
  const appDir = tempApp();
  const emojiDir = join(appDir, "📄 素材库");
  const post = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [emojiDir], setup_completed: true }),
  }), { appDir, testBypassAuth: true });
  assert.equal(post.status, 200);

  const get = await handleApiRequest(new Request("http://127.0.0.1:9527/config"), { appDir, testBypassAuth: true });
  const cfg = await json(get);
  assert.equal(cfg.setup_completed, true);
  assert.deepEqual(cfg.save_paths, [emojiDir]);
});

test("GET/POST /config 往返媒体与去重策略且不返回密钥", async () => {
  const appDir = tempApp();
  const post = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      duplicate_policy: "always_new",
      download_images: true,
      image_attachment_path: "media/images",
      image_embed_style: "obsidian",
      enable_video_download: false,
      install_secret: "must-not-change",
      local_api_token: "must-not-change",
    }),
  }), { appDir, testBypassAuth: true });
  assert.equal(post.status, 200);

  const cfg = await json(await handleApiRequest(new Request("http://127.0.0.1:9527/config"), { appDir, testBypassAuth: true }));
  assert.equal(cfg.duplicate_policy, "always_new");
  assert.equal(cfg.download_images, true);
  assert.equal(cfg.image_attachment_path, "media/images");
  assert.equal(cfg.image_embed_style, "obsidian");
  assert.equal(cfg.enable_video_download, false);
  assert.equal(cfg.install_secret, undefined);
  assert.equal(cfg.local_api_token, undefined);
  assert.notEqual(loadConfig(appDir).install_secret, "must-not-change");
  assert.notEqual(loadConfig(appDir).local_api_token, "must-not-change");
});

test("扩展保存 save_paths 时自动完成首次设置", async () => {
  const appDir = tempApp();
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [join(appDir, "md")] }),
  }), { appDir, testBypassAuth: true });
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
  }), { appDir, testBypassAuth: true });
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
  }), { appDir, testBypassAuth: true });

  const ok = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "tweet", text: "hello", url: "https://x.com/a/status/1", handle: "@alice" }),
  }), { appDir, testBypassAuth: true });
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
  }), { appDir, testBypassAuth: true });
  assert.equal(bad.status, 400);

  const logText = readFileSync(logPath(appDir), "utf8");
  assert.match(logText, /请求 \/save/);
  const requestLines = logText.split("\n").filter((line) => line.includes("请求 /save"));
  assert.equal(requestLines.some((line) => line.includes("SECRET_PRIVATE_BODY")), false);
  assert.equal(requestLines.some((line) => line.length > 180), false);
  assert.match(logText, /保存完成：outcome=saved files=1/);
  assert.match(logText, /保存请求失败：code=PATH_DENIED/);
});

test("20 个不同 capture key 的同标题并发保存不覆盖", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ save_paths: [mdDir] }),
  }), { appDir, testBypassAuth: true });
  const responses = await Promise.all(Array.from({ length: 20 }, (_, index) => handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "article", article_title: "并发标题", article_content: `完整正文 ${index}`, url: `https://example.com/items/${index}` }),
  }), { appDir, testBypassAuth: true })));
  const bodies = await Promise.all(responses.map((response) => response.json()));
  const paths = bodies.flatMap((body) => body.saved || []);
  assert.equal(new Set(paths).size, 20);
  assert.ok(paths.every((path) => readFileSync(path, "utf8").length > 0));
});

test("POST /save 默认保持远程图片链接", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [mdDir] }),
  }), { appDir, testBypassAuth: true });

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "tweet",
      text: "remote image",
      url: "https://x.com/a/status/19",
      images: ["https://pbs.twimg.com/media/abc.jpg?format=jpg&name=small"],
    }),
  }), { appDir, testBypassAuth: true });
  const body = await json(res);
  const md = readFileSync(body.saved[0], "utf8");
  assert.equal(res.status, 200);
  assert.match(md, /!\[\]\(https:\/\/pbs\.twimg\.com\/media\/abc\.jpg\?format=jpg&name=orig\)/);
});

test("POST /save 开启后拒绝私网图片并回退远程链接", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      save_paths: [mdDir],
      download_images: true,
      image_attachment_path: "attachments",
    }),
  }), { appDir, testBypassAuth: true });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]), {
    headers: { "content-type": "image/jpeg" },
  })) as unknown as typeof fetch;
  try {
    const res = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tweet",
        platform: "网页",
        text: "local image",
        url: "https://example.com/status/190",
        images: ["http://127.0.0.1/media/abc.jpg"],
      }),
    }), { appDir, testBypassAuth: true });
    const body = await json(res);
    const md = readFileSync(body.saved[0], "utf8");
    assert.equal(res.status, 200);
    assert.equal(existsSync(join(mdDir, "attachments", "190", "image_1.jpg")), false);
    assert.match(md, /!\[\]\(http:\/\/127\.0\.0\.1\/media\/abc\.jpg\)/);
    assert.match(md, /UNSUPPORTED_MEDIA_URL/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("POST /save 开启图片下载时 Twitter 仍保持远程原图链接", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      save_paths: [mdDir],
      download_images: true,
      image_attachment_path: "attachments",
    }),
  }), { appDir, testBypassAuth: true });

  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
  }) as unknown as typeof fetch;
  try {
    const res = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tweet",
        platform: "Twitter/X",
        text: "remote twitter image",
        url: "https://x.com/a/status/192",
        images: ["https://pbs.twimg.com/media/abc.jpg?format=jpg&name=small"],
      }),
    }), { appDir, testBypassAuth: true });
    const body = await json(res);
    const md = readFileSync(body.saved[0], "utf8");
    assert.equal(res.status, 200);
    assert.equal(fetchCalled, false);
    assert.equal(existsSync(join(mdDir, "attachments", "192", "image_1.jpg")), false);
    assert.match(md, /!\[\]\(https:\/\/pbs\.twimg\.com\/media\/abc\.jpg\?format=jpg&name=orig\)/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("POST /save 图片下载失败时回退远程 URL 并记录失败列表", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      save_paths: [mdDir],
      download_images: true,
      image_attachment_path: "attachments",
    }),
  }), { appDir, testBypassAuth: true });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
  try {
    const imageUrl = "http://127.0.0.1/media/missing.jpg";
    const res = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tweet",
        text: "missing image",
        platform: "网页",
        url: "https://example.com/status/191",
        images: [imageUrl],
      }),
    }), { appDir, testBypassAuth: true });
    const body = await json(res);
    const md = readFileSync(body.saved[0], "utf8");
    assert.equal(res.status, 200);
    assert.match(md, /!\[\]\(http:\/\/127\.0\.0\.1\/media\/missing\.jpg\)/);
    assert.match(md, /图片本地化失败：/);
    assert.match(md, /UNSUPPORTED_MEDIA_URL/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});



test("POST /config 忽略端口，并保留视频和博主配置", async () => {
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
  }), { appDir, testBypassAuth: true });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.restart_required, false);
  assert.equal(body.config.port, undefined);
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
  }), { appDir, testBypassAuth: true });

  const save = await handleApiRequest(new Request("http://127.0.0.1:9527/profile-capture", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mode: "tweets",
      profile: { handle: "alice", displayName: "Alice" },
      items: [{ url: "https://x.com/alice/status/1", published: "2026-05-29T08:00:00Z", text: "hello" }],
    }),
  }), { appDir, testBypassAuth: true });
  const saved = await json(save);
  assert.equal(save.status, 200);
  assert.equal(saved.success, true);
  assert.equal(existsSync(saved.saved[0]), true);

  const state = await handleApiRequest(new Request("http://127.0.0.1:9527/profile-capture/state?handle=alice"), { appDir, testBypassAuth: true });
  const body = await json(state);
  assert.equal(body.handle, "alice");
  assert.equal(Boolean(body.state.tweets.captured_ids["1"]), true);
});

test("POST /autostart dry-run 不修改系统但返回目标状态", async () => {
  const appDir = tempApp();
  const get = await handleApiRequest(new Request("http://127.0.0.1:9527/autostart"), { appDir, testBypassAuth: true });
  const current = await json(get);
  assert.equal(get.status, 200);
  assert.equal(current.success, true);
  assert.equal(typeof current.enabled, "boolean");

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/autostart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: true }),
  }), { appDir, testBypassAuth: true, autostartDryRun: true });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.enabled, true);

  const off = await handleApiRequest(new Request("http://127.0.0.1:9527/autostart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: "false" }),
  }), { appDir, testBypassAuth: true, autostartDryRun: true });
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
  }), { appDir, testBypassAuth: true });

  const ok = await handleApiRequest(new Request("http://127.0.0.1:9527/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "save" }),
  }), { appDir, testBypassAuth: true, openDryRun: true });
  assert.equal(ok.status, 200);
  assert.equal((await json(ok)).target, "save");

  const bad = await handleApiRequest(new Request("http://127.0.0.1:9527/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target: "/tmp/evil" }),
  }), { appDir, testBypassAuth: true, openDryRun: true });
  assert.equal(bad.status, 400);
});

test("POST /choose-folder 使用系统文件夹选择器并支持 dry-run", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [mdDir] }),
  }), { appDir, testBypassAuth: true });

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/choose-folder", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPath: mdDir }),
  }), { appDir, testBypassAuth: true, dialogDryRun: true });
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
  }), { appDir, testBypassAuth: true });

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/log"), { appDir, testBypassAuth: true });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.match(body.log, /配置已更新/);
});



test("启动日志记录配置路径和保存路径", async () => {
  const appDir = tempApp();
  const server = await startHttpServer({ appDir, testPort: 0 });
  await server.stop();
  const logText = readFileSync(logPath(appDir), "utf8");
  assert.match(logText, new RegExp(configPath(appDir).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(logText, /x2md 服务已启动：http:\/\/127\.0\.0\.1:\d+/);
  assert.match(logText, /保存路径：/);
});

test("GET /status 返回实际监听端口", async () => {
  const appDir = tempApp();
  const server = await startHttpServer({ appDir, testPort: 0 });
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
  const first = await startHttpServer({ appDir, testPort: 0 });
  await assert.rejects(
    () => startHttpServer({ appDir: tempApp(), testPort: first.port }),
    /端口 .* 已被占用/,
  );
  await first.stop();
});

test("Bun 常见端口占用错误也返回明确提示", () => {
  assert.equal(
    listenErrorMessage(new Error("Failed to start server. Is port 9527 in use?"), 9527),
    "端口 9527 已被占用，请退出旧版 X2MD",
  );
});

test("CORS OPTIONS 兼容扩展", async () => {
  const origin = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "OPTIONS",
    headers: { Origin: origin, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type, authorization" },
  }), { appDir: tempApp(), testBypassAuth: true });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), origin);
});


test("GET /history 返回最近保存记录", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ save_paths: [mdDir] }),
  }), { appDir, testBypassAuth: true });

  await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "tweet", text: "history title", url: "https://x.com/a/status/9" }),
  }), { appDir, testBypassAuth: true });

  const res = await handleApiRequest(new Request("http://127.0.0.1:9527/history"), { appDir, testBypassAuth: true });
  const body = await json(res);
  assert.equal(res.status, 200);
  assert.equal(body.success, true);
  assert.equal(body.history.length, 1);
  assert.equal(body.history[0].title, "未命名内容");
  assert.match(body.history[0].path, /history title/);
  assert.ok(body.history[0].id);
  assert.equal(body.history[0].text, undefined);
  assert.doesNotMatch(JSON.stringify(body.history[0]), /history title(?!\.md)/);
});

test("POST /history/action 只能按服务端历史 ID 执行安全动作", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ save_paths: [mdDir] }),
  }), { appDir, testBypassAuth: true });
  await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "tweet", text: "safe action", url: "https://x.com/a/status/31" }),
  }), { appDir, testBypassAuth: true });
  const history = await json(await handleApiRequest(new Request("http://127.0.0.1:9527/history"), { appDir, testBypassAuth: true }));
  const item = history.history[0];

  const copy = await json(await handleApiRequest(new Request("http://127.0.0.1:9527/history/action", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, action: "copy_path" }),
  }), { appDir, testBypassAuth: true, openDryRun: true }));
  assert.equal(copy.path, item.path);
  assert.equal(copy.action, "copy_path");

  for (const body of [
    { id: "missing", action: "show_file" },
    { id: item.id, action: "show_file", path: "/tmp/attacker-selected" },
  ]) {
    const response = await handleApiRequest(new Request("http://127.0.0.1:9527/history/action", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    }), { appDir, testBypassAuth: true, openDryRun: true });
    assert.equal(response.status, 400);
  }
});

test("POST /history/action 对已删除或移动文件返回明确错误", async () => {
  const appDir = tempApp();
  const mdDir = join(appDir, "md");
  await handleApiRequest(new Request("http://127.0.0.1:9527/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ save_paths: [mdDir] }) }), { appDir, testBypassAuth: true });
  await handleApiRequest(new Request("http://127.0.0.1:9527/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "tweet", text: "deleted", url: "https://x.com/a/status/32" }) }), { appDir, testBypassAuth: true });
  const item = (await json(await handleApiRequest(new Request("http://127.0.0.1:9527/history"), { appDir, testBypassAuth: true }))).history[0];
  rmSync(item.path);
  const response = await handleApiRequest(new Request("http://127.0.0.1:9527/history/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: item.id, action: "show_file" }) }), { appDir, testBypassAuth: true, openDryRun: true });
  assert.equal(response.status, 400);
  assert.match((await json(response)).error, /不存在|移动|删除/);
});


test("新配置持久化 install secret 但 API 不返回凭据", async () => {
  const appDir = tempApp();
  const first = loadConfig(appDir).install_secret;
  const second = loadConfig(appDir).install_secret;
  assert.equal(first, second);
  assert.ok(String(first).length > 8);
  const cfg = await json(await handleApiRequest(new Request("http://127.0.0.1:9527/config"), { appDir, testBypassAuth: true }));
  assert.equal(cfg.install_secret, undefined);
  assert.equal(cfg.local_api_token, undefined);
});
