import { randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { open, mkdir, link, rm } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import { basename, dirname, join } from "node:path";

export type SafeDownloadCode = "UNSUPPORTED_MEDIA_URL" | "MEDIA_TIMEOUT" | "MEDIA_TOO_LARGE" | "MEDIA_TYPE_REJECTED" | "MEDIA_HTTP_ERROR" | "MEDIA_WRITE_FAILED";
export class SafeDownloadError extends Error {
  code: SafeDownloadCode;
  retryable: boolean;
  constructor(code: SafeDownloadCode, message: string, retryable = false) { super(message); this.code = code; this.retryable = retryable; }
}

type Address = { address: string; family: number };
type DownloadResponse = { status: number; headers: Record<string, string | string[] | undefined>; body: AsyncIterable<Uint8Array> };
type Options = {
  allowedContentTypes: string[];
  maxBytes?: number;
  timeoutMs?: number;
  maxRedirects?: number;
  resolver?: (hostname: string) => Promise<Address[]>;
  openResponse?: (url: URL, pinned: Address, signal: AbortSignal) => Promise<DownloadResponse>;
};

function ipv4Number(value: string): number | null {
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}
function inV4(value: number, base: string, bits: number): boolean {
  const b = ipv4Number(base)!;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (b & mask);
}
function ipv6Number(address: string): bigint | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if (missing < 0 || (halves.length === 1 && missing !== 0)) return null;
  const groups = [...left, ...Array(missing).fill("0"), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/i.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(parseInt(group, 16)), 0n);
}
function inV6(value: bigint, base: string, bits: number): boolean {
  const b = ipv6Number(base)!;
  const shift = BigInt(128 - bits);
  return (value >> shift) === (b >> shift);
}

export function isPublicIp(address: string): boolean {
  if (address.toLowerCase().startsWith("::ffff:")) {
    const mapped = address.slice(7);
    if (mapped.includes(".")) return isPublicIp(mapped);
    const groups = mapped.split(":");
    if (groups.length === 2) {
      const high = parseInt(groups[0], 16); const low = parseInt(groups[1], 16);
      if (Number.isFinite(high) && Number.isFinite(low)) return isPublicIp(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return false;
  }
  const version = isIP(address);
  if (version === 4) {
    const value = ipv4Number(address)!;
    return ![["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]].some(([base, bits]) => inV4(value, String(base), Number(bits)));
  }
  if (version !== 6) return false;
  const value = address.toLowerCase();
  const number = ipv6Number(value);
  if (number === null) return false;
  return ![["::", 128], ["::1", 128], ["64:ff9b:1::", 48], ["100::", 64], ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]].some(([base, bits]) => inV6(number, String(base), Number(bits)));
}

async function resolvePublic(hostname: string, resolver: NonNullable<Options["resolver"]>): Promise<Address> {
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new SafeDownloadError("UNSUPPORTED_MEDIA_URL", `non-public media address: ${hostname}`);
    return { address: hostname, family: isIP(hostname) };
  }
  const addresses = await resolver(hostname);
  if (!addresses.length || addresses.some((item) => !isPublicIp(item.address))) throw new SafeDownloadError("UNSUPPORTED_MEDIA_URL", `media hostname is not public: ${hostname}`);
  return addresses[0];
}

function productionOpen(url: URL, pinned: Address, signal: AbortSignal): Promise<DownloadResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(url, {
      method: "GET", headers: { "User-Agent": "Mozilla/5.0", Host: url.host }, agent: false,
      ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
    }, (response) => resolve({ status: response.statusCode || 0, headers: response.headers as any, body: response }));
    const abort = () => request.destroy(new SafeDownloadError("MEDIA_TIMEOUT", "media download timed out", true));
    signal.addEventListener("abort", abort, { once: true });
    request.once("error", reject);
    request.end();
  });
}

function header(headers: DownloadResponse["headers"], name: string): string {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] || "" : String(value || "");
}

async function nextChunk(iterator: AsyncIterator<Uint8Array>, signal: AbortSignal): Promise<IteratorResult<Uint8Array>> {
  if (signal.aborted) throw new SafeDownloadError("MEDIA_TIMEOUT", "media download timed out", true);
  return await new Promise((resolve, reject) => {
    const abort = () => reject(new SafeDownloadError("MEDIA_TIMEOUT", "media download timed out", true));
    signal.addEventListener("abort", abort, { once: true });
    iterator.next().then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

export async function safeDownload(source: string, destination: string, options: Options): Promise<{ path: string; finalUrl: string; bytes: number; contentType: string }> {
  const maxBytes = options.maxBytes ?? 50 * 1024 * 1024;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000);
  const resolver = options.resolver || (async (hostname) => await lookup(hostname, { all: true, verbatim: true }) as Address[]);
  const openResponse = options.openResponse || productionOpen;
  let part = "";
  try {
    let url = new URL(source);
    for (let redirects = 0; ; redirects += 1) {
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new SafeDownloadError("UNSUPPORTED_MEDIA_URL", "media URL is not allowed");
      if ((url.port && url.protocol === "http:" && url.port !== "80") || (url.port && url.protocol === "https:" && url.port !== "443")) throw new SafeDownloadError("UNSUPPORTED_MEDIA_URL", "media URL port is not allowed");
      const pinned = await resolvePublic(url.hostname, resolver);
      const response = await Promise.race([
        openResponse(url, pinned, controller.signal),
        new Promise<never>((_, reject) => controller.signal.addEventListener("abort", () => reject(new SafeDownloadError("MEDIA_TIMEOUT", "media download timed out", true)), { once: true })),
      ]);
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= (options.maxRedirects ?? 4)) throw new SafeDownloadError("MEDIA_HTTP_ERROR", "too many media redirects");
        const location = header(response.headers, "location");
        if (!location) throw new SafeDownloadError("MEDIA_HTTP_ERROR", "media redirect has no location");
        (response.body as any).destroy?.();
        url = new URL(location, url);
        continue;
      }
      if (response.status < 200 || response.status >= 300) { (response.body as any).destroy?.(); throw new SafeDownloadError("MEDIA_HTTP_ERROR", `media HTTP ${response.status}`, response.status >= 500); }
      const contentType = header(response.headers, "content-type").split(";", 1)[0].trim().toLowerCase();
      if (!contentType || !options.allowedContentTypes.some((allowed) => allowed.endsWith("/") ? contentType.startsWith(allowed) : contentType === allowed)) { (response.body as any).destroy?.(); throw new SafeDownloadError("MEDIA_TYPE_REJECTED", `unsupported media type: ${contentType || "missing"}`); }
      const declared = Number(header(response.headers, "content-length"));
      if (Number.isFinite(declared) && declared > maxBytes) { (response.body as any).destroy?.(); throw new SafeDownloadError("MEDIA_TOO_LARGE", "media exceeds byte limit"); }
      await mkdir(dirname(destination), { recursive: true });
      part = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.part`);
      const file = await open(part, "wx");
      let bytes = 0;
      try {
        const iterator = response.body[Symbol.asyncIterator]();
        while (true) {
          const item = await nextChunk(iterator, controller.signal);
          if (item.done) break;
          const chunk = item.value;
          bytes += chunk.byteLength;
          if (bytes > maxBytes) throw new SafeDownloadError("MEDIA_TOO_LARGE", "media exceeds byte limit");
          await file.write(chunk);
        }
        await file.sync();
      } catch (error) {
        (response.body as any).destroy?.();
        throw error;
      } finally { await file.close(); }
      await link(part, destination);
      await rm(part, { force: true });
      part = "";
      return { path: destination, finalUrl: url.toString(), bytes, contentType };
    }
  } catch (error) {
    if (error instanceof SafeDownloadError) throw error;
    throw new SafeDownloadError("MEDIA_WRITE_FAILED", error instanceof Error ? error.message : String(error), true);
  } finally {
    clearTimeout(timer);
    if (part) await rm(part, { force: true }).catch(() => undefined);
  }
}
