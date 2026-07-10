import { constants } from "node:fs";
import { copyFile, link, mkdir, open, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const LINK_UNSUPPORTED = new Set(["EXDEV", "EPERM", "ENOSYS", "EOPNOTSUPP", "ENOTSUP"]);

export type OutputCommit = { path: string; strategy: "link" | "copy" };

export async function commitOutput(options: {
  directory: string;
  basename: string;
  content: string;
  transactionId: string;
  linkFile?: typeof link;
  beforePublish?: (target: string, temp: string, strategy: "link" | "copy") => Promise<void>;
}): Promise<OutputCommit> {
  await mkdir(options.directory, { recursive: true });
  const temp = join(options.directory, `.${options.basename}.${options.transactionId}.${randomUUID()}.part`);
  const handle = await open(temp, "wx");
  let writeError: unknown;
  try {
    await handle.writeFile(options.content, "utf8");
    await handle.sync();
  } catch (error) {
    writeError = error;
  } finally {
    await handle.close();
  }
  if (writeError) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw writeError;
  }

  try {
    for (let index = 0; ; index += 1) {
      const suffix = index ? `_${index + 1}` : "";
      const target = join(options.directory, `${options.basename}${suffix}.md`);
      await options.beforePublish?.(target, temp, "link");
      try {
        await (options.linkFile || link)(temp, target);
        await rm(temp, { force: true });
        return { path: target, strategy: "link" };
      } catch (error: any) {
        if (error?.code === "EEXIST") continue;
        if (!LINK_UNSUPPORTED.has(error?.code)) throw error;
        break;
      }
    }

    for (let index = 0; ; index += 1) {
      const suffix = `${options.transactionId.slice(0, 12)}${index ? `_${index + 1}` : ""}`;
      const target = join(options.directory, `${options.basename}_${suffix}.md`);
      await options.beforePublish?.(target, temp, "copy");
      try {
        await copyFile(temp, target, constants.COPYFILE_EXCL);
        const targetHandle = await open(target, "r");
        try { await targetHandle.sync(); } finally { await targetHandle.close(); }
        await rm(temp, { force: true });
        return { path: target, strategy: "copy" };
      } catch (error: any) {
        if (error?.code === "EEXIST") continue;
        throw error;
      }
    }
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}
