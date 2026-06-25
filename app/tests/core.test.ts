import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveSavePathsForRequest, normalizeConfig, cliArg, saveConfig, logPath } from "../core/config.ts";
import { buildLaunchAgentPlist, LABEL, LEGACY_LABEL, plistPath, programArgumentsForExecutable, setAutostartEnabled } from "../main/autostart.ts";
import { bundledExtensionDirForExecutable, inlineSettingsHtml, settingsUrl, settingsViewsRootForExecutable } from "../main/desktop.ts";
import { handleTrayAction, trayMenuItems } from "../main/tray.ts";
import { buildMarkdown } from "../core/markdown.ts";
import { sanitizeFilename } from "../core/filenames.ts";
import { handleProfileCaptureSave } from "../core/profile-capture.ts";
import { sanitizeUnicodeText } from "../core/unicode.ts";
import { saveNotificationBody } from "../main/notify.ts";

const baseCfg = normalizeConfig({ filename_format: "{summary}_{date}_{author}", max_filename_length: 60, video_save_path: "/tmp/x2md-videos" });

test("自定义保存路径必须来自配置白名单", () => {
  const cfg = { save_paths: ["/vault/default"], custom_save_paths: [{ name: "生图类", path: "/vault/images" }] };
  assert.deepEqual(resolveSavePathsForRequest(cfg, {}), [["/vault/default"], false]);
  assert.deepEqual(resolveSavePathsForRequest(cfg, { custom_save_path_name: "生图类", custom_save_path: "/vault/images" }), [["/vault/images"], true]);
  assert.throws(() => resolveSavePathsForRequest(cfg, { custom_save_path_name: "生图类" }), /自定义保存路径/);
  assert.throws(() => resolveSavePathsForRequest(cfg, { custom_save_path_name: "未知", custom_save_path: "/tmp/other" }), /自定义保存路径/);
});

test("Tweet 译文和图片 alt 写入 Markdown", () => {
  const [, content] = buildMarkdown({
    type: "tweet",
    text: "Original text",
    url: "https://x.com/a/status/1",
    handle: "@alice",
    prefer_translated_content: true,
    translation_override: { type: "tweet", text: "译文正文" },
    images: ["https://pbs.twimg.com/media/watch.jpg?format=jpg&name=small"],
    image_alt_texts: { "https://pbs.twimg.com/media/watch.jpg?format=jpg&name=orig": "Apple Watch ⌚" },
  }, baseCfg);

  assert.match(content, /译文正文/);
  assert.doesNotMatch(content, /Original text/);
  assert.match(content, /!\[1\]\(https:\/\/pbs\.twimg\.com\/media\/watch\.jpg\?format=jpg&name=orig\)\n```\nApple Watch ⌚\n```/);
});

test("Tweet 译文保存前清理 X 链接协议换行", () => {
  const [, content] = buildMarkdown({
    type: "tweet",
    text: "Original text",
    url: "https://x.com/a/status/1",
    handle: "@alice",
    prefer_translated_content: true,
    translation_override: {
      type: "tweet",
      text: "实用应用、网站、资源\n\n- http://\nmake.design - AI 设计\n- https://\nAside.com - AI 浏览器",
    },
  }, baseCfg);

  assert.match(content, /- make\.design - AI 设计/);
  assert.match(content, /- Aside\.com - AI 浏览器/);
  assert.doesNotMatch(content, /http:\/\/\nmake\.design/);
});

test("Article 正文顺序保持，不补 dump 已缺失图片", () => {
  const [, content] = buildMarkdown({
    type: "article",
    article_title: "Article with images",
    article_content: "第一段\n\n![](https://pbs.twimg.com/media/inline.jpg?format=jpg&name=orig)\n\n第二段",
    url: "https://x.com/a/status/1",
    handle: "@alice",
    images: [
      "https://pbs.twimg.com/media/inline.jpg?format=jpg&name=small",
      "https://pbs.twimg.com/media/missing.jpg?format=jpg&name=small",
    ],
  }, baseCfg);

  const body = content.split("---\n").at(-1) || "";
  assert.match(body, /第一段/);
  assert.equal((content.match(/inline\.jpg/g) || []).length, 1);
  assert.doesNotMatch(content, /missing\.jpg/);
});

test("视频下载开始和完成写入日志", async () => {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-video-log-"));
  const videoDir = mkdtempSync(join(tmpdir(), "x2md-video-dir-"));
  const oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("video-bytes")) as unknown as typeof fetch;
  try {
    buildMarkdown({ text: "video", videos: ["https://video.example/a.mp4"], download_video: true }, normalizeConfig({ video_save_path: videoDir }), appDir);
    for (let i = 0; i < 30; i += 1) {
      if (existsSync(logPath(appDir)) && readFileSync(logPath(appDir), "utf8").includes("视频下载完成")) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const log = readFileSync(logPath(appDir), "utf8");
    assert.match(log, /视频下载开始：video(?:_.*)?_video_1\.mp4/);
    assert.match(log, /视频下载完成：video(?:_.*)?_video_1\.mp4/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test("配置关闭视频下载时服务端只写视频链接", () => {
  const [, content] = buildMarkdown(
    { text: "video", videos: ["https://video.example/a.mp4"], download_video: true },
    normalizeConfig({ enable_video_download: false }),
  );
  assert.match(content, /🎞️ \[推特媒体：点击播放视频\]\(https:\/\/video\.example\/a\.mp4\)/);
  assert.doesNotMatch(content, /!\[\[.*\.mp4\]\]/);
});

test("非法 Unicode surrogate 会被清理", () => {
  const [, content] = buildMarkdown({ type: "article", article_title: "Bad unicode \ud83d", article_content: "正文\ud83d", url: "https://x.com/a/status/1", handle: "@alice" }, baseCfg);
  const cleaned = sanitizeUnicodeText(content);
  assert.doesNotMatch(cleaned, /\ud83d/);
  assert.doesNotThrow(() => Buffer.from(cleaned, "utf8"));
  assert.equal(sanitizeUnicodeText("📄 素材库"), "📄 素材库");
});

test("博主推文按日聚合并跳过重复项", () => {
  const dir = mkdtempSync(join(tmpdir(), "x2md-profile-"));
  const appDir = mkdtempSync(join(tmpdir(), "x2md-state-"));
  const cfg = normalizeConfig({ save_paths: [dir], profile_capture_save_path: "" });
  const payload = {
    mode: "tweets",
    range_label: "当日",
    profile: { handle: "alice", displayName: "Alice", profileUrl: "https://x.com/alice" },
    items: [
      { url: "https://x.com/alice/status/1", published: "2026-05-29T08:00:00Z", text: "hello", images: [], videos: [] },
      { url: "https://x.com/alice/status/2", published: "2026-05-29T07:00:00Z", text: "world", images: [], videos: [] },
    ],
  };

  const first = handleProfileCaptureSave(payload, cfg, appDir);
  assert.equal(first.skipped, 0);
  assert.equal(first.saved.length, 1);
  const content = readFileSync(first.saved[0], "utf8");
  assert.match(content, /# Alice 推文 2026-05-29/);
  assert.match(content, /hello/);
  assert.match(content, /world/);

  const second = handleProfileCaptureSave(payload, cfg, appDir);
  assert.equal(second.skipped, 2);
  assert.deepEqual(second.saved, []);
});







test("CLI 参数支持 --app-dir=value 和 --port value", () => {
  const old = process.argv;
  process.argv = ["node", "x2md", "--app-dir=/tmp/x2md-app", "--port", "19527"];
  try {
    assert.equal(cliArg("app-dir"), "/tmp/x2md-app");
    assert.equal(cliArg("port"), "19527");
  } finally {
    process.argv = old;
  }
});

test("旧配置缺少视频字段时保持扩展旧默认值", () => {
  const cfg = normalizeConfig({});
  assert.equal(cfg.enable_video_download, true);
  assert.equal(cfg.video_duration_threshold, 5);
  assert.equal(cfg.enable_save_notification, false);
});

test("旧配置已有保存路径时不再触发首次设置", () => {
  const cfg = normalizeConfig({ save_paths: ["/vault/md"] });
  assert.equal(cfg.setup_completed, true);
});

test("保存路径归一化时过滤空路径", () => {
  const cfg = normalizeConfig({ save_paths: ["", "  /vault/md  ", " "] });
  assert.deepEqual(cfg.save_paths, ["/vault/md"]);
});

test("保存路径为空时不视为设置完成", () => {
  const cfg = normalizeConfig({ save_paths: [" "], setup_completed: true });
  assert.equal(cfg.setup_completed, false);
});

test("空视频目录回到默认值", () => {
  const cfg = normalizeConfig({ video_save_path: " " });
  assert.match(cfg.video_save_path, /X2MD/);
  assert.match(cfg.video_save_path, /Videos/);
});

test("无效配置端口回到默认值", () => {
  assert.equal(normalizeConfig({ port: "bad" }).port, 9527);
  assert.equal(normalizeConfig({ port: 0 }).port, 9527);
  assert.equal(normalizeConfig({ port: 70000 }).port, 9527);
});

test("无效数值配置回到默认值", () => {
  const cfg = normalizeConfig({
    max_filename_length: "bad",
    video_duration_threshold: -1,
    profile_capture_custom_days: 0,
  });
  assert.equal(cfg.max_filename_length, 100);
  assert.equal(cfg.video_duration_threshold, 5);
  assert.equal(cfg.profile_capture_custom_days, 7);
});

test("文件名长度按中文可见字符截断", () => {
  assert.equal(sanitizeFilename("中文长标题", 4), "中文长标");
  assert.equal(sanitizeFilename("🙂🙂🙂", 2), "🙂🙂");
  assert.equal(normalizeConfig({ max_filename_length: 500 }).max_filename_length, 180);
});

test("旧配置布尔字符串按布尔值迁移", () => {
  const cfg = normalizeConfig({
    enable_video_download: "false",
    enable_save_notification: "false",
    show_site_save_icon: "0",
    show_x_profile_capture_button: "off",
  });
  assert.equal(cfg.enable_video_download, false);
  assert.equal(cfg.enable_save_notification, false);
  assert.equal(cfg.show_site_save_icon, false);
  assert.equal(cfg.show_x_profile_capture_button, false);
});

test("保存通知正文不泄露完整路径", () => {
  assert.equal(saveNotificationBody(["/vault/md/hello.md"]), "hello.md");
  assert.equal(saveNotificationBody(["/vault/a.md", "/vault/b.md"]), "已保存 2 个文件");
});

test("保存配置时自动创建 Markdown 和视频目录", () => {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-config-dir-"));
  const saveDir = join(appDir, "md");
  const videoDir = join(appDir, "videos");
  const customDir = join(appDir, "custom");
  const profileDir = join(appDir, "profile");
  saveConfig({
    save_paths: [saveDir],
    video_save_path: videoDir,
    custom_save_paths: [{ name: "素材", path: customDir }],
    profile_capture_save_path: profileDir,
  }, appDir);
  assert.equal(existsSync(saveDir), true);
  assert.equal(existsSync(videoDir), true);
  assert.equal(existsSync(customDir), true);
  assert.equal(existsSync(profileDir), true);
});

test("打包 App 内扩展目录解析到 Contents/Resources/extension", () => {
  assert.equal(
    bundledExtensionDirForExecutable("/Applications/X2MD.app/Contents/MacOS/launcher"),
    "/Applications/X2MD.app/Contents/Resources/extension",
  );
  assert.equal(bundledExtensionDirForExecutable("/usr/local/bin/node"), null);
});

test("设置页 URL 带当前服务端口", () => {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-settings-"));
  saveConfig({ port: 19527 }, appDir);
  assert.equal(settingsUrl(appDir), "views://settings/index.html#port=19527");
  assert.equal(settingsUrl(appDir, 19001), "views://settings/index.html#port=19001");
});

test("设置页 HTML 内联样式和脚本，避免 views scheme 空白", () => {
  const html = inlineSettingsHtml(
    '<html><head><link rel="stylesheet" href="styles.css" /></head><body><h1>X2MD 设置</h1><script type="module" src="settings.js"></script></body></html>',
    "body { color: #111; }",
    "document.body.dataset.ready = '1';",
    19001,
  );
  assert.match(html, /globalThis\.X2MD_PORT = "19001"/);
  assert.match(html, /<style>body \{ color: #111; \}<\/style>/);
  assert.match(html, /document\.body\.dataset\.ready/);
  assert.doesNotMatch(html, /href="styles\.css"/);
  assert.doesNotMatch(html, /src="settings\.js"/);
});

test("打包 App 内设置页 views root 解析到 Contents/Resources/app/views", () => {
  assert.equal(
    settingsViewsRootForExecutable("/Applications/X2MD.app/Contents/MacOS/X2MD"),
    "/Applications/X2MD.app/Contents/Resources/app/views",
  );
});

test("托盘菜单覆盖桌面入口", () => {
  const items = trayMenuItems(true);
  const actions = items.map((item) => item.action).filter(Boolean);
  assert.deepEqual(actions, ["settings", "save-dir", "video-dir", "extension-dir", "log", "restart", "autostart", "quit"]);
  assert.equal(items.find((item) => item.action === "autostart")?.checked, true);
  assert.equal(items[0].label, "服务：运行中");
  assert.equal(trayMenuItems(false, false)[0].label, "服务：未运行");
});

test("托盘 action 分发到桌面能力", async () => {
  const calls: string[] = [];
  const actions = {
    showSettings: () => { calls.push("settings"); },
    openSaveDir: () => { calls.push("save"); },
    openVideoDir: () => { calls.push("video"); },
    openExtensionDir: () => { calls.push("extension"); },
    openLog: () => { calls.push("log"); },
    restart: () => { calls.push("restart"); },
    quit: () => { calls.push("quit"); },
  };
  for (const action of ["settings", "save-dir", "video-dir", "extension-dir", "log", "restart", "quit"]) {
    await handleTrayAction(action, actions);
  }
  assert.deepEqual(calls, ["settings", "save", "video", "extension", "log", "restart", "quit"]);
});

test("设置页字段和脚本选择器保持一致", () => {
  const html = readFileSync("app/ui/settings/index.html", "utf8");
  const script = readFileSync("app/ui/settings/settings.ts", "utf8");
  for (const id of [
    "savePath", "customSavePaths", "videoPath", "enableVideoDownload", "enableSaveNotification",
    "videoThreshold", "port", "filenameFormat", "maxFilenameLength", "profileRange",
    "profileCustomDays", "profileSavePath", "showSiteSaveIcon", "showProfileCapture",
    "autostart", "save", "test", "openSave", "openVideo", "openLog", "showLog", "openExtension",
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
    assert.match(script, new RegExp(`\\$\\("${id}"\\)|field\\("${id}"\\)|getElementById\\("${id}"\\)`));
  }
  assert.match(html, /chrome:\/\/extensions\//);
  assert.match(html, /加载已解压的扩展程序/);
  assert.match(script, /openTarget\("extension"\)/);
  assert.match(script, /location\.hash/);
  assert.match(script, /fetch\(`\$\{api\}\/ping`\)/);
});

test("自启参数在 packaged app 内只指向 app 可执行文件", () => {
  assert.deepEqual(
    programArgumentsForExecutable("/Applications/X2MD.app/Contents/MacOS/X2MD"),
    ["/Applications/X2MD.app/Contents/MacOS/X2MD"],
  );
  assert.deepEqual(programArgumentsForExecutable("/usr/local/bin/node", "/repo/app/main/index.ts"), ["/usr/local/bin/node", "/repo/app/main/index.ts"]);
});

test("LaunchAgent plist 指向 com.x2md.app", () => {
  const plist = buildLaunchAgentPlist(["/Applications/X2MD.app/Contents/MacOS/X2MD"], "/Applications/X2MD.app");
  assert.match(plist, /<string>com\.x2md\.app<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key>\n  <true\/>/);
  assert.match(plist, /X2MD\.app\/Contents\/MacOS\/X2MD/);
});

test("LaunchAgent plist 支持测试环境变量", () => {
  const plist = buildLaunchAgentPlist(["/Applications/X2MD.app/Contents/MacOS/X2MD"], "/Applications/X2MD.app", "/tmp/x2md.log", {
    HOME: "/tmp/x2md-home",
    X2MD_APP_DIR: "/tmp/x2md-home/Library/Application Support/X2MD",
  });
  assert.match(plist, /<key>EnvironmentVariables<\/key>/);
  assert.match(plist, /<key>X2MD_APP_DIR<\/key>/);
  assert.match(plist, /Application Support\/X2MD/);
});

test("关闭自启时清理新版和旧版 LaunchAgent", () => {
  const home = mkdtempSync(join(tmpdir(), "x2md-autostart-"));
  mkdirSync(join(home, "Library", "LaunchAgents"), { recursive: true });
  writeFileSync(plistPath(LABEL, home), "new", "utf8");
  writeFileSync(plistPath(LEGACY_LABEL, home), "legacy", "utf8");

  assert.equal(setAutostartEnabled(false, { home, platform: "darwin" }), false);
  assert.equal(existsSync(plistPath(LABEL, home)), false);
  assert.equal(existsSync(plistPath(LEGACY_LABEL, home)), false);
});

test("开启自启时日志路径跟随目标 home", () => {
  const home = mkdtempSync(join(tmpdir(), "x2md-autostart-home-"));
  assert.equal(setAutostartEnabled(true, { home, platform: "darwin", args: ["/Applications/X2MD.app/Contents/MacOS/X2MD"], cwd: "/Applications/X2MD.app" }), true);
  const plist = readFileSync(plistPath(LABEL, home), "utf8");
  assert.match(plist, new RegExp(join(home, "Library", "Logs", "x2md-autostart.log").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
