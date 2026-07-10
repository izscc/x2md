import { createServer, type Server } from "node:http";

import { loadConfig, saveConfig, VERSION, MIN_EXTENSION_VERSION, LOCAL_API_PORT, getAppDir, configPath, logPath } from "../core/config.ts";
import { handleProfileCaptureSave, getProfileStateBucket, loadProfileCaptureState, normalizeProfileHandle } from "../core/profile-capture.ts";
import { readSaveHistory, savePayload } from "../core/save.ts";
import { sanitizeUnicodePayload } from "../core/unicode.ts";
import { isAutostartEnabled, setAutostartEnabled } from "./autostart.ts";
import { chooseFolder, openConfiguredTarget, showSettingsWindow } from "./desktop.ts";
import { log, readLogTail } from "./logger.ts";
import { notifySaveSuccess } from "./notify.ts";
import { consumePairingCode, isValidCredential } from "../core/pairing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(sanitizeUnicodePayload(payload)), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders },
  });
}

async function readJson(request: Request): Promise<Record<string, any>> {
  try {
    return sanitizeUnicodePayload(await request.json()) as Record<string, any>;
  } catch {
    throw new Error("Invalid JSON");
  }
}

function isTrustedApiOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin || origin === "null" || origin.startsWith("views://")) return true;
  if (origin.startsWith("chrome-extension://")) return true;
  try {
    const host = new URL(origin).hostname;
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function requestBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function requestCredential(request: Request): string {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || request.headers.get("x-x2md-token") || "";
}

function publicConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const { install_secret: _installSecret, local_api_token: _legacyToken, ...safe } = cfg;
  return safe;
}

export function listenErrorMessage(error: any, port: number): string {
  const message = String(error?.message || error);
  if (error?.code === "EADDRINUSE" || /EADDRINUSE|in use|address already in use/i.test(message)) {
    return `端口 ${port} 已被占用，请退出旧版 X2MD`;
  }
  return `端口 ${port} 启动失败：${message}`;
}

export async function handleApiRequest(request: Request, opts: { appDir?: string; autostartDryRun?: boolean; openDryRun?: boolean; dialogDryRun?: boolean; port?: number; testBypassAuth?: boolean } = {}): Promise<Response> {
  const appDir = opts.appDir || getAppDir();
  const url = new URL(request.url);
  const path = url.pathname;

  if (request.method === "OPTIONS") return new Response("", { status: 200, headers: corsHeaders });

  if (request.method === "GET" && path === "/ping") return json({ status: "ok", version: VERSION, min_extension_version: MIN_EXTENSION_VERSION });
  if (!isTrustedApiOrigin(request)) return json({ success: false, error: "Forbidden" }, 403);
  if (request.method === "POST" && path === "/pair") {
    const data: Record<string, any> = await readJson(request).catch(() => ({}));
    const cfg = loadConfig(appDir);
    const token = consumePairingCode(String(data.code || ""), String(cfg.install_secret || ""));
    return token ? json({ success: true, token }) : json({ success: false, error: "Invalid or expired pairing code" }, 401);
  }
  const authConfig = loadConfig(appDir);
  if (!opts.testBypassAuth && !isValidCredential(requestCredential(request), String(authConfig.install_secret || ""))) {
    return json({ success: false, error: "Authentication required" }, 401);
  }
  if (request.method === "GET" && path === "/config") return json(publicConfig(authConfig));
  if (request.method === "GET" && path === "/status") {
    const cfg = loadConfig(appDir);
    return json({
      success: true,
      status: "ok",
      version: VERSION,
      port: opts.port ?? LOCAL_API_PORT,
      config_path: configPath(appDir),
      log_path: logPath(appDir),
      save_paths: cfg.save_paths,
      autostart_enabled: isAutostartEnabled(),
    });
  }
  if (request.method === "GET" && path === "/log") {
    return json({ success: true, log: readLogTail(appDir) });
  }
  if (request.method === "GET" && path === "/history") {
    return json({ success: true, history: readSaveHistory(appDir) });
  }
  if (request.method === "GET" && path === "/autostart") return json({ success: true, enabled: isAutostartEnabled() });
  if (request.method === "GET" && path === "/profile-capture/state") {
    const handle = normalizeProfileHandle(url.searchParams.get("handle") || "");
    const state = loadProfileCaptureState(appDir);
    const bucket = handle ? getProfileStateBucket(state, handle) : {};
    return json({ success: true, handle, state: bucket });
  }

  if (request.method !== "POST") return json({ error: "Not Found" }, 404);

  let data: Record<string, any>;
  try {
    data = await readJson(request);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  log(`请求 ${path}: type=${data.type || "?"} platform=${data.platform || "?"} url=${String(data.url || "").slice(0, 80)}`, appDir);

  try {
    if (path === "/config") {
      const oldConfig = loadConfig(appDir);
      const nextConfig = { ...oldConfig, ...data };
      delete nextConfig.port;
      if (Array.isArray(data.save_paths) && !data.save_paths.some((item) => String(item || "").trim())) {
        return json({ success: false, error: "请至少配置一个保存路径" }, 400);
      }
      if (data.setup_completed === undefined && Array.isArray(data.save_paths) && data.save_paths.some((item) => String(item || "").trim())) {
        nextConfig.setup_completed = true;
      }
      const config = saveConfig(nextConfig, appDir);
      log(`配置已更新：keys=${Object.keys(data).join(",")}`, appDir);
      return json({ success: true, config: publicConfig(config), restart_required: false });
    }
    if (path === "/save") {
      const config = loadConfig(appDir);
      const result = await savePayload(data, config, appDir);
      log(result.success ? `保存成功：${(result.saved || []).join(",")}` : `保存失败：${(result.errors || []).join(";")}`, appDir);
      if (result.success) void notifySaveSuccess(config, result);
      return json(result, result.success ? 200 : 500);
    }
    if (path === "/profile-capture") {
      const result = handleProfileCaptureSave(data, loadConfig(appDir), appDir);
      log(`批量抓取保存：saved=${(result.saved || []).length} skipped=${result.skipped || 0} dir=${result.target_dir || ""}`, appDir);
      return json(result);
    }
    if (path === "/autostart") {
      const enabled = setAutostartEnabled(requestBoolean(data.enabled), { dryRun: opts.autostartDryRun });
      log(`开机自动运行：${enabled ? "enabled" : "disabled"}`, appDir);
      return json({ success: true, enabled });
    }
    if (path === "/choose-folder") {
      const selectedPath = await chooseFolder({ currentPath: data.currentPath, appDir, dryRun: opts.dialogDryRun ?? opts.openDryRun });
      return json({ success: true, path: selectedPath, selected: Boolean(selectedPath) });
    }
    if (path === "/settings") {
      await showSettingsWindow(appDir, opts.port);
      return json({ success: true });
    }
    if (path === "/open") return json({ success: true, target: openConfiguredTarget(data.target, appDir, opts.openDryRun) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(path === "/save" ? `保存失败：${message}` : `错误 ${path}: ${message}`, appDir);
    return json({ success: false, error: message }, path === "/save" || path === "/open" ? 400 : 500);
  }

  return json({ error: "Not Found" }, 404);
}

async function requestFromIncoming(req: any): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return new Request(`http://${req.headers.host || "127.0.0.1"}${req.url}`, {
    method: req.method,
    headers: req.headers,
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
}

async function writeNodeResponse(res: any, response: Response): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  res.end(Buffer.from(await response.arrayBuffer()));
}

export async function startHttpServer(opts: { appDir?: string; testPort?: number; hostname?: string } = {}): Promise<{ port: number; stop: () => Promise<void> | void }> {
  const appDir = opts.appDir || getAppDir();
  const cfg = loadConfig(appDir);
  const openDryRun = process.env.X2MD_OPEN_DRY_RUN === "1";
  const dialogDryRun = process.env.X2MD_DIALOG_DRY_RUN === "1" || openDryRun;
  log(`配置路径：${configPath(appDir)}`, appDir);
  const port = opts.testPort ?? LOCAL_API_PORT;
  const testBypassAuth = opts.testPort !== undefined;
  const hostname = opts.hostname || "127.0.0.1";

  if ((globalThis as any).Bun?.serve) {
    try {
      let actualPort = port;
      const server = (globalThis as any).Bun.serve({
        hostname,
        port,
        fetch: (request: Request) => handleApiRequest(request, { appDir, port: actualPort, openDryRun, dialogDryRun, testBypassAuth }),
      });
      actualPort = server.port;
      log(`x2md 服务已启动：http://${hostname}:${server.port}`, appDir);
      log(`保存路径：${cfg.save_paths.join(",")}`, appDir);
      return { port: server.port, stop: () => server.stop() };
    } catch (error) {
      throw new Error(listenErrorMessage(error, port));
    }
  }

  let actualPort = port;
  const server: Server = createServer(async (req, res) => writeNodeResponse(res, await handleApiRequest(await requestFromIncoming(req), { appDir, port: actualPort, openDryRun, dialogDryRun, testBypassAuth })));
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: any) => {
      reject(new Error(listenErrorMessage(error, port)));
    });
    server.listen(port, hostname, () => resolve());
  });
  const address = server.address();
  actualPort = typeof address === "object" && address ? address.port : port;
  log(`x2md 服务已启动：http://${hostname}:${actualPort}`, appDir);
  log(`保存路径：${cfg.save_paths.join(",")}`, appDir);
  return { port: actualPort, stop: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}
