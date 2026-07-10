import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, fsyncSync } from "node:fs";
import { open, readFile, rename, rm, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

export type StateNamespace = "config" | "history" | "save-index" | "profile" | "jobs";

const stateFiles: Record<StateNamespace, string> = {
  config: "config.json",
  history: "save_history.json",
  "save-index": "save_index.json",
  profile: "profile_capture_state.json",
  jobs: "job_state.json",
};

export class StateCorruptionError extends Error {
  readonly code = "STATE_CORRUPT";
  readonly namespace: StateNamespace;
  readonly path: string;
  readonly backupPath: string;

  constructor(
    namespace: StateNamespace,
    path: string,
    backupPath: string,
    cause?: unknown,
  ) {
    super(`STATE_CORRUPT: ${namespace} state was moved to ${backupPath}`, { cause });
    this.name = "StateCorruptionError";
    this.namespace = namespace;
    this.path = path;
    this.backupPath = backupPath;
  }
}

function backupPath(file: string): string {
  return `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.bak`;
}

function serializeState(value: unknown): string {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) throw new TypeError("State value is not JSON serializable");
  return `${serialized}\n`;
}

function parseState<T>(namespace: StateNamespace, file: string, raw: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    const backup = backupPath(file);
    renameSync(file, backup);
    throw new StateCorruptionError(namespace, file, backup, error);
  }
}

export function readJsonStateSync<T>(appDir: string, namespace: StateNamespace, fallback: () => T): T {
  const file = join(appDir, stateFiles[namespace]);
  if (!existsSync(file)) return fallback();
  return parseState<T>(namespace, file, readFileSync(file, "utf8"));
}

export function writeJsonStateSync<T>(appDir: string, namespace: StateNamespace, value: T): T {
  const file = join(appDir, stateFiles[namespace]);
  const temp = join(dirname(file), `.${stateFiles[namespace]}.${process.pid}.${randomUUID()}.tmp`);
  const body = serializeState(value);
  mkdirSync(dirname(file), { recursive: true });
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx");
    writeFileSync(fd, body, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, file);
    return value;
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temp, { force: true });
  }
}

const mutexTails = new Map<string, Promise<void>>();

async function locked<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = mutexTails.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  mutexTails.set(key, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (mutexTails.get(key) === tail) mutexTails.delete(key);
  }
}

export class StateStore {
  readonly appDir: string;

  constructor(appDir: string) {
    this.appDir = resolve(appDir);
  }

  path(namespace: StateNamespace): string {
    return join(this.appDir, stateFiles[namespace]);
  }

  async read<T>(namespace: StateNamespace, fallback: () => T): Promise<T> {
    return locked(this.path(namespace), () => this.readUnlocked(namespace, fallback));
  }

  async write<T>(namespace: StateNamespace, value: T): Promise<T> {
    return locked(this.path(namespace), () => this.writeUnlocked(namespace, value));
  }

  async update<T>(namespace: StateNamespace, fallback: () => T, mutate: (current: T) => T | void | Promise<T | void>): Promise<T> {
    return locked(this.path(namespace), async () => {
      const current = await this.readUnlocked(namespace, fallback);
      const changed = await mutate(current);
      return this.writeUnlocked(namespace, changed === undefined ? current : changed as T);
    });
  }

  private async readUnlocked<T>(namespace: StateNamespace, fallback: () => T): Promise<T> {
    const file = this.path(namespace);
    let raw: string;
    try {
      raw = await readFile(file, "utf8");
    } catch (error: any) {
      if (error?.code === "ENOENT") return fallback();
      throw error;
    }
    try {
      return JSON.parse(raw) as T;
    } catch (error) {
      const backup = backupPath(file);
      await rename(file, backup);
      throw new StateCorruptionError(namespace, file, backup, error);
    }
  }

  private async writeUnlocked<T>(namespace: StateNamespace, value: T): Promise<T> {
    const file = this.path(namespace);
    const temp = join(dirname(file), `.${stateFiles[namespace]}.${process.pid}.${randomUUID()}.tmp`);
    const body = serializeState(value);
    await mkdir(dirname(file), { recursive: true });
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temp, "wx");
      await handle.writeFile(body, "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(temp, file);
      return value;
    } finally {
      await handle?.close().catch(() => undefined);
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }
}
