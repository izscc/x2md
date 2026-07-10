import { createHash, randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { CaptureDocumentV1 } from "./contracts.ts";
import { StateStore } from "./state-store.ts";

export type DuplicatePolicy = "skip" | "update" | "always_new";
export type SaveRevision = { revision: number; files: string[]; saved_at: string; transaction_id: string };
export type SaveIndexEntry = {
  capture_key: string; platform: string; source_id?: string; canonical_url: string;
  latest_revision: number; created_at: string; updated_at: string; revisions: SaveRevision[];
};
export type SaveIndexV1 = { schema_version: 1; entries: Record<string, SaveIndexEntry> };

export function normalizeCanonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  const params = [...url.searchParams.entries()].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  url.search = "";
  for (const [key, item] of params) url.searchParams.append(key, item);
  return url.toString();
}

export function captureKey(capture: CaptureDocumentV1): string {
  const platform = String(capture.source.platform || "").trim().toLowerCase();
  const sourceId = String(capture.source.source_id || "").trim();
  if (sourceId) return `${platform}:id:${sourceId}`;
  const canonical = normalizeCanonicalUrl(capture.source.canonical_url);
  return `${platform}:url:${createHash("sha256").update(canonical).digest("hex")}`;
}

const lockTails = new Map<string, Promise<void>>();

export async function withCaptureLock<T>(appDir: string, key: string, operation: () => Promise<T>): Promise<T> {
  const lockKey = `${resolve(appDir)}\0${key}`;
  const previous = lockTails.get(lockKey) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((done) => { release = done; });
  const tail = previous.catch(() => undefined).then(() => current);
  lockTails.set(lockKey, tail);
  await previous.catch(() => undefined);
  try { return await operation(); } finally {
    release();
    if (lockTails.get(lockKey) === tail) lockTails.delete(lockKey);
  }
}

export function emptySaveIndex(): SaveIndexV1 {
  return { schema_version: 1, entries: {} };
}

export async function readSaveIndex(appDir: string): Promise<SaveIndexV1> {
  const value = await new StateStore(appDir).read<SaveIndexV1>("save-index", emptySaveIndex);
  return value?.schema_version === 1 && value.entries ? value : emptySaveIndex();
}

export async function recordSaveRevision(appDir: string, capture: CaptureDocumentV1, key: string, files: string[], transactionId: string): Promise<SaveIndexEntry> {
  let result!: SaveIndexEntry;
  await new StateStore(appDir).update<SaveIndexV1>("save-index", emptySaveIndex, (index) => {
    const now = new Date().toISOString();
    const old = index.entries[key];
    const committed = old?.revisions.find((item) => item.transaction_id === transactionId);
    if (old && committed) { result = old; return index; }
    const revision = (old?.latest_revision || 0) + 1;
    const revisions = [...(old?.revisions || []), { revision, files: [...files], saved_at: now, transaction_id: transactionId }].slice(-50);
    result = {
      capture_key: key, platform: capture.source.platform, source_id: capture.source.source_id,
      canonical_url: normalizeCanonicalUrl(capture.source.canonical_url), latest_revision: revision,
      created_at: old?.created_at || now, updated_at: now, revisions,
    };
    return { schema_version: 1, entries: { ...index.entries, [key]: result } };
  });
  return result;
}

export async function updateIndexedFiles(files: string[], content: string): Promise<void> {
  for (const file of files) {
    if (!file.endsWith(".md")) throw new Error("Indexed target is not Markdown");
    const temp = `${file}.${process.pid}.${randomUUID()}.part`;
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temp, "wx");
      await handle.writeFile(content, "utf8");
      await handle.sync();
      await handle.close(); handle = undefined;
      await rename(temp, file);
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
}
