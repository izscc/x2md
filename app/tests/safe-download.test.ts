import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { isPublicIp, safeDownload, SafeDownloadError } from "../core/safe-download.ts";

const dir = () => mkdtempSync(join(tmpdir(), "x2md-download-"));
const resolver = async () => [{ address: "93.184.216.34", family: 4 }];
const response = (body: AsyncIterable<Uint8Array>, headers: Record<string, string> = { "content-type": "image/jpeg" }, status = 200) => ({ status, headers, body });
async function* chunks(...values: string[]) { for (const value of values) yield Buffer.from(value); }

test("private, loopback, link-local and reserved addresses are rejected", () => {
  for (const ip of ["0.0.0.0", "10.0.0.1", "127.0.0.1", "169.254.1.1", "172.16.0.1", "192.168.1.1", "100.64.0.1", "192.0.2.1", "198.51.100.1", "203.0.113.1", "::", "::1", "fc00::1", "fe80::1", "ff00::1", "2001:db8::1", "::ffff:127.0.0.1", "::ffff:7f00:1"]) assert.equal(isPublicIp(ip), false, ip);
  assert.equal(isPublicIp("93.184.216.34"), true);
  assert.equal(isPublicIp("2606:4700:4700::1111"), true);
});

test("pins validated DNS and validates every redirect", async () => {
  const target = join(dir(), "image.jpg");
  const resolved: string[] = [];
  const opened: string[] = [];
  await assert.rejects(() => safeDownload("https://public.example/a", target, {
    allowedContentTypes: ["image/"], resolver: async (host) => {
      resolved.push(host);
      return host === "public.example" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }];
    },
    openResponse: async (url, pinned) => {
      opened.push(`${url.hostname}=${pinned.address}`);
      return response(chunks(), { location: "http://localhost/secret" }, 302);
    },
  }), (error: any) => error.code === "UNSUPPORTED_MEDIA_URL");
  assert.deepEqual(resolved, ["public.example", "localhost"]);
  assert.deepEqual(opened, ["public.example=93.184.216.34"]);
});

test("success publishes only complete content and removes part file", async () => {
  const root = dir();
  const target = join(root, "image.jpg");
  await safeDownload("https://example.com/a.jpg", target, { allowedContentTypes: ["image/"], resolver, openResponse: async (_url, pinned) => {
    assert.equal(pinned.address, "93.184.216.34");
    assert.equal(existsSync(target), false);
    return response(chunks("abc", "def"));
  } });
  assert.equal(readFileSync(target, "utf8"), "abcdef");
  assert.equal(readdirSync(root).some((name) => name.endsWith(".part")), false);
});

test("type, byte limit and timeout failures leave no files", async () => {
  for (const mode of ["type", "bytes", "timeout", "body-timeout"] as const) {
    const root = dir(); const target = join(root, "media.bin");
    const call = safeDownload("https://example.com/media", target, {
      allowedContentTypes: ["image/"], maxBytes: 3, timeoutMs: 20, resolver,
      openResponse: async () => mode === "type"
        ? response(chunks("x"), { "content-type": "text/html" })
        : mode === "bytes" ? response(chunks("1234"))
          : mode === "body-timeout" ? response((async function* () { await new Promise(() => undefined); yield Buffer.from("never"); })())
            : await new Promise<any>(() => undefined),
    });
    await assert.rejects(call, (error: any) => error instanceof SafeDownloadError);
    assert.equal(existsSync(target), false);
    assert.equal(readdirSync(root).some((name) => name.endsWith(".part")), false);
  }
});
