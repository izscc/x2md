import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { localizeImages } from "../core/image-localizer.ts";

const temp = () => mkdtempSync(join(tmpdir(), "x2md-images-"));

test("image localization uses four workers and preserves input order", async () => {
  const root = temp();
  let active = 0;
  let maxActive = 0;
  const images = Array.from({ length: 5 }, (_, index) => `https://cdn.example/${index}.jpg`);
  const result = await localizeImages({ url: "https://x.com/a/status/42", images }, {
    download_images: true, image_attachment_path: "attachments", image_embed_style: "markdown",
  }, [root], { concurrency: 4, download: async (_url, destination) => {
    active += 1; maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    mkdirSync(join(destination, ".."), { recursive: true });
    writeFileSync(destination, "ok");
    active -= 1;
    return { path: destination, finalUrl: _url, bytes: 2, contentType: "image/jpeg" };
  } });
  assert.equal(maxActive, 4);
  assert.deepEqual(result.data.images, images.map((_, index) => `attachments/42/image_${index + 1}.jpg`));
});

test("each Markdown directory receives its relative attachment", async () => {
  const first = temp(); const second = temp();
  const result = await localizeImages({ url: "https://x.com/a/status/9", images: ["https://cdn.example/a.jpg"] }, {
    download_images: true, image_attachment_path: "assets", image_embed_style: "markdown",
  }, [first, second], { download: async (url, destination) => {
    mkdirSync(join(destination, ".."), { recursive: true }); writeFileSync(destination, url);
    return { path: destination, finalUrl: url, bytes: url.length, contentType: "image/jpeg" };
  } });
  assert.deepEqual(result.data.images, ["assets/9/image_1.jpg"]);
  assert.equal(existsSync(join(first, "assets/9/image_1.jpg")), true);
  assert.equal(existsSync(join(second, "assets/9/image_1.jpg")), true);
});

test("one destination failure rolls back copies and keeps the remote URL", async () => {
  const first = temp(); const second = temp();
  let call = 0;
  const source = "https://cdn.example/a.jpg";
  const result = await localizeImages({ url: "https://x.com/a/status/9", images: [source] }, {
    download_images: true, image_attachment_path: "assets", image_embed_style: "markdown",
  }, [first, second], { download: async (url, destination) => {
    call += 1;
    if (call === 2) throw new Error("failed");
    mkdirSync(join(destination, ".."), { recursive: true }); writeFileSync(destination, url);
    return { path: destination, finalUrl: url, bytes: url.length, contentType: "image/jpeg" };
  } });
  assert.deepEqual(result.data.images, [source]);
  assert.equal(result.failed, 1);
  assert.equal(existsSync(join(first, "assets/9/image_1.jpg")), false);
});

test("X and non-X captures both obey the image policy", async () => {
  let calls = 0;
  const download = async (url: string, destination: string) => {
    calls += 1; mkdirSync(join(destination, ".."), { recursive: true }); writeFileSync(destination, "ok");
    return { path: destination, finalUrl: url, bytes: 2, contentType: "image/jpeg" };
  };
  await localizeImages({ platform: "Twitter/X", url: "https://x.com/a/status/1", images: ["https://cdn.example/x.jpg"] }, { download_images: true }, [temp()], { download });
  await localizeImages({ platform: "网页", url: "https://example.com/a", images: ["https://cdn.example/web.jpg"] }, { download_images: true }, [temp()], { download });
  await localizeImages({ platform: "Twitter/X", url: "https://x.com/a/status/2", images: ["https://cdn.example/off.jpg"] }, { download_images: false }, [temp()], { download });
  assert.equal(calls, 2);
});
