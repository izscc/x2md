import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { normalizeConfig } from "../core/config.ts";
import { buildMarkdown } from "../core/markdown.ts";
import { handleProfileCaptureSave, handleProfileJobItemSave } from "../core/profile-capture.ts";

function fixture(name: string): any {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

const cfg = normalizeConfig({ filename_format: "{summary}_{date}_{author}", max_filename_length: 80, video_save_path: "/tmp/x2md-videos" });

test("golden fixtures: tweet/thread/article/quote/video markdown 关键输出稳定", () => {
  const [, tweet] = buildMarkdown(fixture("tweet.json"), cfg);
  assert.match(tweet, /单条 Tweet 正文/);
  assert.match(tweet, /name=orig/);
  assert.match(tweet, /一张测试图片/);

  const [, thread] = buildMarkdown(fixture("thread.json"), cfg);
  assert.match(thread, /主推正文/);
  assert.match(thread, /续推第一条/);
  assert.match(thread, /续推第二条/);

  const [, article] = buildMarkdown(fixture("article_code.json"), cfg);
  assert.match(article, /Article with code/);
  assert.match(article, /```js\nconsole\.log\('x2md'\)\n```/);

  const [, quote] = buildMarkdown(fixture("quote_alt.json"), cfg);
  assert.match(quote, /> \[!quote\] 引用推文/);
  assert.match(quote, /引用图片描述/);

  const [, video] = buildMarkdown(fixture("video_tweet.json"), cfg);
  assert.match(video, /🎞️ \[推特媒体：点击播放视频\]/);
});

test("golden fixtures: LINUX DO / 飞书 / 微信 payload 可经保存核心生成 Markdown", () => {
  const payloads = fixture("site_payloads.json");
  for (const payload of payloads) {
    const [, content] = buildMarkdown(payload, cfg);
    assert.match(content, new RegExp(`平台: "${payload.platform}"`));
    assert.match(content, new RegExp(payload.article_title));
    assert.match(content, new RegExp(payload.article_content.split("\n")[0]));
  }
});

test("golden fixtures: 博主 tweets/articles 批量抓取写入预期文件", async () => {
  const appDir = mkdtempSync(join(tmpdir(), "x2md-fixture-state-"));
  const saveRoot = mkdtempSync(join(tmpdir(), "x2md-fixture-save-"));
  const profileCfg = normalizeConfig({ save_paths: [saveRoot], profile_capture_save_path: "" });

  const tweets = await handleProfileCaptureSave(fixture("profile_tweets.json"), profileCfg, appDir);
  assert.equal(tweets.saved.length, 1);
  assert.match(readFileSync(tweets.saved[0], "utf8"), /profile tweet one/);

  const articles = await handleProfileCaptureSave(fixture("profile_articles.json"), profileCfg, appDir);
  assert.equal(articles.saved.length, 1);
  assert.match(readFileSync(articles.saved[0], "utf8"), /Long Note/);

  const checkpointRoot = mkdtempSync(join(tmpdir(), "x2md-fixture-job-save-"));
  const checkpoint = await handleProfileJobItemSave({
    mode: "tweets", profile: { handle: "bob", displayName: "Bob" },
    item: { url: "https://x.com/bob/status/301", published: "2026-05-29T08:00:00Z", text: "checkpoint golden" },
  }, normalizeConfig({ save_paths: [checkpointRoot], enable_video_download: false }), mkdtempSync(join(tmpdir(), "x2md-fixture-job-state-")));
  assert.match(readFileSync(checkpoint.saved[0], "utf8"), /checkpoint golden/);
});
