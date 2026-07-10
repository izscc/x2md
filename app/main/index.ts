import { loadConfig, getAppDir } from "../core/config.ts";
import { startHttpServer } from "./http-server.ts";
import { log } from "./logger.ts";
import { createTray } from "./tray.ts";
import { openExtensionDir, openFirstSaveDir, openLog, openVideoDir, showSettingsWindow } from "./desktop.ts";
import { reconcileSaveTransactions } from "../core/save-transaction.ts";

const appDir = getAppDir();
await reconcileSaveTransactions(appDir);
let server;
try {
  server = await startHttpServer({ appDir });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  log(`启动失败：${message}`, appDir);
  console.error(message);
  process.exit(1);
}

async function restartServer(): Promise<void> {
  await server.stop();
  server = await startHttpServer({ appDir });
}

await createTray({
  showSettings: () => showSettingsWindow(appDir, server.port),
  openSaveDir: () => openFirstSaveDir(appDir),
  openVideoDir: () => openVideoDir(appDir),
  openExtensionDir,
  openLog: () => openLog(appDir),
  restart: restartServer,
  serviceRunning: () => Boolean(server),
  quit: async () => {
    await server.stop();
    server = null;
    process.exit(0);
  },
});

if (!loadConfig(appDir).setup_completed || process.argv.includes("--settings")) {
  await showSettingsWindow(appDir, server.port);
}

process.on("SIGINT", async () => {
  await server.stop();
  process.exit(0);
});
