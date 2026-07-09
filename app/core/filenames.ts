export function sanitizeFilename(name: unknown, maxLen = 60): string {
  const limit = Math.max(0, Math.floor(Number.isFinite(Number(maxLen)) ? Number(maxLen) : 60));
  const cleaned = String(name ?? "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  const Segmenter = (Intl as unknown as {
    Segmenter?: new (locale?: string, options?: { granularity?: "grapheme" }) => {
      segment(input: string): Iterable<{ segment: string }>;
    };
  }).Segmenter;
  if (Segmenter) {
    const segmenter = new Segmenter("zh-Hans", { granularity: "grapheme" });
    return Array.from(segmenter.segment(cleaned), (item) => item.segment).slice(0, limit).join("");
  }
  return Array.from(cleaned).slice(0, limit).join("");
}

export function normalizeImageUrl(url: unknown): string {
  const raw = String(url ?? "");
  if (!raw || !raw.includes("pbs.twimg.com")) return raw;
  try {
    const parsed = new URL(raw);
    parsed.searchParams.set("name", "orig");
    return parsed.toString();
  } catch {
    return raw;
  }
}


export function normalizeImageUrlForCompare(url: unknown): string {
  const raw = String(url ?? "").trim();
  if (!raw || !raw.includes("pbs.twimg.com")) return raw;
  try {
    const parsed = new URL(raw);
    parsed.searchParams.delete("name");
    parsed.searchParams.delete("format");
    parsed.pathname = parsed.pathname.replace(/\.[a-zA-Z0-9]+$/, "");
    return `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`.replace(/\?$/, "");
  } catch {
    return raw
      .replace(/[?&](?:name|format)=[^&]+/g, "")
      .replace(/\.[a-zA-Z0-9]+(?=$|[?#])/, "")
      .replace(/[?&]$/, "");
  }
}

export function normalizeArticleUrl(url: unknown): string {
  return String(url ?? "").trim().replace("twitter.com", "x.com").split("?")[0].replace(/\/+$/, "");
}

export function uniquePath(filepath: string): string {
  return filepath;
}
