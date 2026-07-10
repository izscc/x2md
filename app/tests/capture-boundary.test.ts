import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

import { CAPTURE_LIMITS } from "../core/contracts.ts";
import { normalizeCaptureRequest } from "../core/legacy-capture.ts";
import { normalizeConfig, saveConfig } from "../core/config.ts";
import { buildMarkdown } from "../core/markdown.ts";
import { handleApiRequest, startHttpServer } from "../main/http-server.ts";

const fixtures = ["tweet.json", "thread.json", "article_code.json", "quote_alt.json", "video_tweet.json"];
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));

test("legacy capture normalization preserves golden markdown", () => {
  const cfg = normalizeConfig({ download_images: false });
  for (const name of fixtures) {
    const raw = fixture(name);
    const normalized = normalizeCaptureRequest(raw);
    assert.equal(normalized.capture.schema_version, 1);
    assert.equal(buildMarkdown(normalized.savePayload, cfg)[1], buildMarkdown(raw, cfg)[1], name);
  }
});

test("body cap stops a streaming request before complete buffering", async () => {
  let pulls = 0;
  let cancelled = false;
  const chunk = new Uint8Array(1024 * 1024);
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      if (pulls <= 8) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() { cancelled = true; },
  });
  const response = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
    method: "POST", headers: { "Content-Type": "application/json" }, body, duplex: "half",
  } as RequestInit), { appDir: mkdtempSync(join(tmpdir(), "x2md-cap-")), testBypassAuth: true });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error.code, "PAYLOAD_TOO_LARGE");
  assert.equal(cancelled, true);
  assert.ok(pulls < 8);
});

test("Node HTTP boundary rejects an oversized declared body before buffering", async () => {
  const server = await startHttpServer({ appDir: mkdtempSync(join(tmpdir(), "x2md-node-cap-")), testPort: 0 });
  try {
    const result = await new Promise<{ status: number; body: any }>((resolve, reject) => {
      const request = http.request({ host: "127.0.0.1", port: server.port, path: "/save", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": CAPTURE_LIMITS.body_bytes + 1 } }, (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve({ status: response.statusCode || 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      });
      request.on("error", reject);
      request.end("{}");
    });
    assert.equal(result.status, 413);
    assert.equal(result.body.error.code, "PAYLOAD_TOO_LARGE");
  } finally {
    await server.stop();
  }
});

test("invalid captures return stable errors without save side effects", async () => {
  const cases: unknown[] = [
    { schema_version: 2 },
    { type: "tweet", text: "x".repeat(CAPTURE_LIMITS.content_chars + 1), url: "https://x.com/a/status/1" },
    { type: "tweet", text: "x", url: "https://x.com/a/status/1", images: Array(CAPTURE_LIMITS.media_items + 1).fill("https://example.com/a.jpg") },
    { type: "tweet", text: "x", url: "https://x.com/a/status/1", thread_tweets: Array(CAPTURE_LIMITS.array_items + 1).fill({ text: "x" }) },
    { type: "tweet", text: "x", url: `https://example.com/${"x".repeat(CAPTURE_LIMITS.string_chars + 1)}` },
  ];
  let deep: any = { value: "x" };
  for (let i = 0; i <= CAPTURE_LIMITS.depth; i += 1) deep = { child: deep };
  cases.push({ type: "tweet", text: "x", url: "https://x.com/a/status/1", quote_tweet: deep });

  for (const payload of cases) {
    const appDir = mkdtempSync(join(tmpdir(), "x2md-invalid-"));
    const saveDir = join(appDir, "output");
    saveConfig({ save_paths: [saveDir] }, appDir);
    rmSync(saveDir, { recursive: true, force: true });
    const response = await handleApiRequest(new Request("http://127.0.0.1:9527/save", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }), { appDir, testBypassAuth: true });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_CAPTURE");
    assert.equal(existsSync(saveDir), false);
    assert.equal(existsSync(join(appDir, "save_history.json")), false);
  }
});
