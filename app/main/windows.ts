import { loadConfig, getAppDir } from "../core/config.ts";
import { issuePairingCode } from "../core/pairing.ts";
import { reconcileSaveTransactions } from "../core/save-transaction.ts";
import { startHttpServer } from "./http-server.ts";

const appDir = getAppDir();
await reconcileSaveTransactions(appDir);
let server: Awaited<ReturnType<typeof startHttpServer>>;
server = await startHttpServer({ appDir, shutdown: async () => { await server.stop(); process.exit(0); } });
const code = issuePairingCode(String(loadConfig(appDir).install_secret));
console.log(`X2MD Windows Beta http://127.0.0.1:${server.port}`);
console.log(`PAIRING_CODE=${code}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, async () => { await server.stop(); process.exit(0); });
