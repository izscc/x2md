import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";

import { StateStore } from "./state-store.ts";
import { commitOutput } from "./output-store.ts";
import type { CaptureDocumentV1 } from "./contracts.ts";
import { recordSaveRevision } from "./save-index.ts";

export type JournalStage = "prepared" | "media_committed" | "markdown_committed" | "state_committed";
type OutputRecord = { save_path: string; target_path?: string; temp_path?: string; strategy?: "link" | "copy"; published?: boolean };
type Journal = { id: string; stage: JournalStage; outputs: OutputRecord[]; history?: Record<string, unknown>; save_index?: { key: string; capture: CaptureDocumentV1 }; created_at: string; updated_at: string };
type JobsState = Record<string, unknown> & { save_transactions?: Record<string, Journal> };

async function updateJournal(store: StateStore, journal: Journal | null, removeId?: string): Promise<void> {
  await store.update<JobsState>("jobs", () => ({}), (state) => {
    const transactions = { ...(state.save_transactions || {}) };
    if (removeId) delete transactions[removeId];
    if (journal) transactions[journal.id] = journal;
    return { ...state, save_transactions: transactions };
  });
}

async function commitHistory(store: StateStore, journal: Journal): Promise<void> {
  if (!journal.history || !journal.outputs.some((item) => item.published)) return;
  await store.update<Array<Record<string, any>>>("history", () => [], (history) => {
    if (history.some((item) => item.transaction_id === journal.id)) return history;
    return [{ ...journal.history, id: journal.id, path: journal.outputs.find((item) => item.published)?.target_path || "", transaction_id: journal.id }, ...history].slice(0, 50);
  });
}

async function commitState(store: StateStore, journal: Journal): Promise<void> {
  await commitHistory(store, journal);
  const files = journal.outputs.filter((item) => item.published && item.target_path).map((item) => item.target_path!);
  if (journal.save_index && files.length) await recordSaveRevision(store.appDir, journal.save_index.capture, journal.save_index.key, files, journal.id);
}

export async function runSaveTransaction(options: {
  appDir: string;
  savePaths: string[];
  filename: string;
  content: string;
  history?: Record<string, unknown>;
  saveIndex?: { key: string; capture: CaptureDocumentV1 };
  interruptAfterStage?: JournalStage;
}): Promise<{ saved: string[]; errors: string[]; transactionId: string }> {
  const store = new StateStore(options.appDir);
  const now = new Date().toISOString();
  const journal: Journal = { id: randomUUID(), stage: "prepared", outputs: options.savePaths.map((save_path) => ({ save_path })), history: options.history, save_index: options.saveIndex, created_at: now, updated_at: now };
  const persist = async (stage?: JournalStage) => {
    if (stage) journal.stage = stage;
    journal.updated_at = new Date().toISOString();
    await updateJournal(store, journal);
    if (stage && options.interruptAfterStage === stage) throw new Error(`INTERRUPTED_AFTER_${stage}`);
  };
  await persist("prepared");
  await persist("media_committed");
  const saved: string[] = [];
  const errors: string[] = [];
  for (let index = 0; index < options.savePaths.length; index += 1) {
    const record = journal.outputs[index];
    try {
      const committed = await commitOutput({
        directory: record.save_path, basename: options.filename, content: options.content, transactionId: journal.id,
        beforePublish: async (target, temp, strategy) => {
          Object.assign(record, { target_path: target, temp_path: temp, strategy, published: false });
          await persist();
        },
      });
      Object.assign(record, { target_path: committed.path, temp_path: undefined, strategy: committed.strategy, published: true });
      await persist();
      saved.push(committed.path);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }
  await persist("markdown_committed");
  await commitState(store, journal);
  await persist("state_committed");
  await updateJournal(store, null, journal.id);
  return { saved, errors, transactionId: journal.id };
}

export async function reconcileSaveTransactions(appDir: string): Promise<void> {
  const store = new StateStore(appDir);
  const jobs = await store.read<JobsState>("jobs", () => ({}));
  for (const journal of Object.values(jobs.save_transactions || {})) {
    if (journal.stage === "markdown_committed") {
      await commitState(store, journal);
    } else if (journal.stage !== "state_committed") {
      for (const output of journal.outputs) {
        if (output.temp_path) await rm(output.temp_path, { force: true }).catch(() => undefined);
        if (output.published && output.target_path) await rm(output.target_path, { force: true }).catch(() => undefined);
      }
    }
    await updateJournal(store, null, journal.id);
  }
}
