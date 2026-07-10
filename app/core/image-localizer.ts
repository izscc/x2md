import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { extname, join } from "node:path";

import { safeDownload, SafeDownloadError } from "./safe-download.ts";

type Download = typeof safeDownload;
type Warning = { code: string; message: string; url: string };

function imageExtension(url: string): string {
  try {
    const ext = extname(new URL(url).pathname).toLowerCase();
    return [".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"].includes(ext) ? ext : ".jpg";
  } catch { return ".jpg"; }
}

function captureId(data: Record<string, any>): string {
  return String(data.url || "").match(/\/(?:status|article)\/(\d+)/)?.[1] || "misc";
}

async function pooled<T>(jobs: Array<() => Promise<T>>, concurrency: number): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(jobs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= jobs.length) return;
      try { results[index] = { status: "fulfilled", value: await jobs[index]() }; }
      catch (reason) { results[index] = { status: "rejected", reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  return results;
}

export async function localizeImages(
  data: Record<string, any>, cfg: Record<string, any>, savePaths: string[],
  options: { download?: Download; concurrency?: number } = {},
): Promise<{ data: Record<string, any>; warnings: Warning[]; completed: number; failed: number }> {
  const images = Array.isArray(data.images) ? data.images.map(String) : [];
  if (!cfg.download_images || !images.length) return { data, warnings: [], completed: 0, failed: 0 };
  const root = String(cfg.image_attachment_path || "X2MD-attachments");
  const relativeRoot = root.replace(/^\.?\//, "");
  const id = captureId(data);
  const download = options.download || safeDownload;
  const destinations = root.startsWith("/") ? [root] : savePaths.map((path) => join(path, root));
  const jobs: Array<() => Promise<unknown>> = [];
  const spans: Array<{ start: number; count: number; paths: string[] }> = [];
  images.forEach((url, index) => {
    const filename = `image_${index + 1}${imageExtension(url)}`;
    const paths = destinations.map((base) => join(base, id, filename));
    const start = jobs.length;
    for (const destination of paths) jobs.push(async () => {
      if (existsSync(destination)) return { path: destination };
      return download(url, destination, {
        allowedContentTypes: ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"],
        maxBytes: 25 * 1024 * 1024, timeoutMs: 30_000,
      });
    });
    spans.push({ start, count: paths.length, paths });
  });
  const settled = await pooled(jobs, Math.max(1, options.concurrency || 4));
  const nextImages: string[] = [];
  const nextAlt = { ...(data.image_alt_texts || {}) };
  const warnings: Warning[] = [];
  let completed = 0;
  for (let index = 0; index < images.length; index += 1) {
    const source = images[index];
    const span = spans[index];
    const outcomes = settled.slice(span.start, span.start + span.count);
    const failure = outcomes.find((item) => item.status === "rejected") as PromiseRejectedResult | undefined;
    if (failure) {
      await Promise.all(span.paths.map((path, pathIndex) => outcomes[pathIndex]?.status === "fulfilled" ? rm(path, { force: true }).catch(() => undefined) : Promise.resolve()));
      const error = failure.reason;
      warnings.push({ code: error instanceof SafeDownloadError ? error.code : "MEDIA_WRITE_FAILED", message: "图片本地化失败，已保留远程链接", url: source });
      nextImages.push(source);
      continue;
    }
    const filename = `image_${index + 1}${imageExtension(source)}`;
    const reference = root.startsWith("/") ? join(root, id, filename) : `${relativeRoot}/${id}/${filename}`;
    const rendered = cfg.image_embed_style === "obsidian" ? `![[${reference}]]` : reference;
    nextImages.push(rendered);
    if (nextAlt[source]) nextAlt[reference] = nextAlt[source];
    completed += 1;
  }
  return {
    data: { ...data, images: nextImages, image_alt_texts: nextAlt, image_localization_errors: warnings.map((item) => `${item.url} [${item.code}]`) },
    warnings, completed, failed: warnings.length,
  };
}
