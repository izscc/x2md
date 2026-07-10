import { createServer, type Server } from "node:http";
import { existsSync, statSync } from "node:fs";

import { loadConfig, saveConfig, publicConfig, VERSION, MIN_EXTENSION_VERSION, LOCAL_API_PORT, getAppDir, configPath, logPath } from "../core/config.ts";
import { SECRET_CONFIG_KEYS } from "../core/config-schema.ts";
import { handleProfileCaptureSave, getProfileStateBucket, loadProfileCaptureState, normalizeProfileHandle } from "../core/profile-capture.ts";
import { readSaveHistory, savePayload } from "../core/save.ts";
import { sanitizeUnicodePayload } from "../core/unicode.ts";
import { isAutostartEnabled, setAutostartEnabled } from "./autostart.ts";
import { chooseFolder, openConfiguredTarget, openHistoryEntry, showSettingsWindow } from "./desktop.ts";
import { log, readLogTail } from "./logger.ts";
import { notifySaveSuccess } from "./notify.ts";
import { consumePairingCode, credentialKind, isValidCredential } from "../core/pairing.ts";
import { corsHeaders, isAllowedApiOrigin, preflightResponse } from "./request-policy.ts";
import { CAPTURE_LIMITS } from "../core/contracts.ts";
import { CaptureBoundaryError, normalizeCaptureRequest } from "../core/legacy-capture.ts";
import type { CaptureDocumentV1 } from "../core/contracts.ts";
import { assertPreviousSteps, probeDirectory, SETUP_STEP_ORDER, setupState, validateExtension, type SetupStep } from "../core/setup-doctor.ts";
import { buildDiagnostics, exportDiagnostics } from "../core/diagnostics.ts";

function json(request: Request, payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(sanitizeUnicodePayload(payload)), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders(request) },
  });
}

async function readJson(request: Request): Promise<Record<string, any>> {
  try {
    return sanitizeUnicodePayload(await request.json()) as Record<string, any>;
  } catch {
    throw new Error("Invalid JSON");
  }
}

async function readCaptureJson(request: Request): Promise<Record<string, any>> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > CAPTURE_LIMITS.body_bytes) {
    throw new CaptureBoundaryError("PAYLOAD_TOO_LARGE", "capture body exceeds 5 MiB");
  }
  if (!request.body) throw new CaptureBoundaryError("INVALID_CAPTURE", "capture body is required");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CAPTURE_LIMITS.body_bytes) {
        await reader.cancel("capture body exceeds 5 MiB");
        throw new CaptureBoundaryError("PAYLOAD_TOO_LARGE", "capture body exceeds 5 MiB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const combined = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { combined.set(chunk, offset); offset += chunk.byteLength; }
  try {
    return JSON.parse(new TextDecoder().decode(combined));
  } catch {
    throw new CaptureBoundaryError("INVALID_CAPTURE", "capture body must be valid JSON");
  }
}

function boundaryPayload(error: CaptureBoundaryError): Record<string, unknown> {
  return { success: false, error: { code: error.code, message: error.message, retryable: false } };
}

function requestBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || String(value).toLowerCase() === "true";
}

function requestCredential(request: Request): string {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || request.headers.get("x-x2md-token") || "";
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
  const reply = (payload: Record<string, unknown>, status = 200) => json(request, payload, status);

  if (request.method === "OPTIONS") return preflightResponse(request);

  if (request.method === "GET" && path === "/ping") return reply({ status: "ok", version: VERSION, min_extension_version: MIN_EXTENSION_VERSION });
  if (!isAllowedApiOrigin(request)) return reply({ success: false, error: "Forbidden" }, 403);
  if (request.method === "POST" && path === "/pair") {
    const data: Record<string, any> = await readJson(request).catch(() => ({}));
    const cfg = loadConfig(appDir);
    const token = consumePairingCode(String(data.code || ""), String(cfg.install_secret || ""));
    return token ? reply({ success: true, token }) : reply({ success: false, error: "Invalid or expired pairing code" }, 401);
  }
  let captureData: Record<string, any> | undefined;
  let canonicalCapture: CaptureDocumentV1 | undefined;
  let legacyCapture = true;
  if (request.method === "POST" && path === "/save") {
    try {
      const normalized = normalizeCaptureRequest(await readCaptureJson(request));
      captureData = sanitizeUnicodePayload(normalized.savePayload) as Record<string, any>;
      canonicalCapture = normalized.capture;
      legacyCapture = normalized.legacy;
    } catch (error) {
      if (error instanceof CaptureBoundaryError) return reply(boundaryPayload(error), error.status);
      return reply({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  }
  const authConfig = loadConfig(appDir);
  if (!opts.testBypassAuth && !isValidCredential(requestCredential(request), String(authConfig.install_secret || ""))) {
    return reply({ success: false, error: "Authentication required" }, 401);
  }
  if (captureData && !legacyCapture && captureData.custom_save_path_name) {
    const entry = authConfig.custom_save_paths.find((item) => item.name === captureData!.custom_save_path_name);
    if (entry) captureData.custom_save_path = entry.path;
  }
  if (request.method === "GET" && path === "/config") return reply(publicConfig(authConfig));
  if (request.method === "GET" && path === "/status") {
    const cfg = loadConfig(appDir);
    return reply({
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
    return reply({ success: true, log: readLogTail(appDir) });
  }
  if (request.method === "GET" && path === "/history") {
    return reply({ success: true, history: readSaveHistory(appDir) });
  }
  if (request.method === "GET" && path === "/setup") {
    return reply(setupState(loadConfig(appDir), opts.port ?? LOCAL_API_PORT));
  }
  if (request.method === "GET" && path === "/diagnostics") {
    return reply({ success: true, diagnostics: buildDiagnostics({ appDir, port: opts.port }) });
  }
  if (request.method === "GET" && path === "/autostart") return reply({ success: true, enabled: isAutostartEnabled() });
  if (request.method === "GET" && path === "/profile-capture/state") {
    const handle = normalizeProfileHandle(url.searchParams.get("handle") || "");
    const state = loadProfileCaptureState(appDir);
    const bucket = handle ? getProfileStateBucket(state, handle) : {};
    return reply({ success: true, handle, state: bucket });
  }

  if (request.method !== "POST") return reply({ error: "Not Found" }, 404);

  let data: Record<string, any>;
  try {
    data = captureData || await readJson(request);
  } catch (error) {
    if (error instanceof CaptureBoundaryError) return reply(boundaryPayload(error), error.status);
    return reply({ error: error instanceof Error ? error.message : String(error) }, 400);
  }

  log(path === "/save" ? "请求 /save" : `请求 ${path}: type=${data.type || "?"} platform=${data.platform || "?"}`, appDir);

  try {
    if (path === "/config") {
      const oldConfig = loadConfig(appDir);
      const publicData = Object.fromEntries(Object.entries(data).filter(([key]) => !SECRET_CONFIG_KEYS.has(key)));
      const nextConfig = { ...oldConfig, ...publicData };
      delete nextConfig.port;
      if (Array.isArray(data.save_paths) && !data.save_paths.some((item) => String(item || "").trim())) {
        return reply({ success: false, error: "请至少配置一个保存路径" }, 400);
      }
      const config = saveConfig(nextConfig, appDir);
      log(`配置已更新：keys=${Object.keys(data).join(",")}`, appDir);
      return reply({ success: true, config: publicConfig(config), restart_required: false });
    }
    if (path === "/diagnostics/export") {
      const exported = exportDiagnostics({ appDir, port: opts.port });
      log("已导出脱敏诊断包", appDir);
      return reply({ success: true, file: exported.file, directory: exported.directory });
    }
    if (path === "/setup") {
      const step = String(data.step || "") as SetupStep;
      if (!SETUP_STEP_ORDER.includes(step)) return reply({ success: false, error: "未知 Setup Doctor 步骤" }, 400);
      const config = loadConfig(appDir);
      assertPreviousSteps(config, step);
      let sampleResult: Record<string, any> | undefined;
      if (step === "runtime") {
        // Reaching this authenticated handler proves that this runtime owns the configured loopback port.
      } else if (step === "directory") {
        probeDirectory(config.save_paths[0] || "");
      } else if (step === "extension") {
        if (credentialKind(requestCredential(request), String(config.install_secret || "")) !== "extension") {
          return reply({ success: false, error: "请先使用当前扩展完成配对" }, 401);
        }
        validateExtension(String(data.extension_version || ""), data.permissions);
      } else if (step === "sample") {
        sampleResult = await savePayload({
          type: "article",
          article_title: "欢迎使用 X2MD",
          article_content: "这是 Setup Doctor 保存的本地样例。保存成功后，你可以在 Finder 或 Obsidian 中打开它。",
          url: "https://x2md.local/setup-sample",
          platform: "X2MD",
        }, config, appDir);
        if (!sampleResult.success || !sampleResult.files?.[0]?.history_id) throw new Error("样例保存失败");
      }
      const completed = { ...config.setup_steps, [step]: true };
      const done = SETUP_STEP_ORDER.every((item) => completed[item] === true);
      const saved = saveConfig({
        ...config,
        setup_steps: completed,
        setup_completed: done,
        ...(sampleResult?.files?.[0]?.history_id ? { setup_sample_history_id: sampleResult.files[0].history_id } : {}),
      }, appDir);
      return reply({ ...setupState(saved, opts.port ?? LOCAL_API_PORT), ...(sampleResult ? { result: sampleResult } : {}) });
    }
    if (path === "/save") {
      const config = loadConfig(appDir);
      const result = await savePayload(data, config, appDir, canonicalCapture);
      log(`保存完成：outcome=${result.outcome || (result.success ? "saved" : "failed")} files=${(result.saved || []).length}`, appDir);
      if (result.success) void notifySaveSuccess(config, result);
      return reply(result, result.success ? 200 : 500);
    }
    if (path === "/profile-capture") {
      const result = await handleProfileCaptureSave(data, loadConfig(appDir), appDir);
      log(`批量抓取保存：saved=${(result.saved || []).length} skipped=${result.skipped || 0} dir=${result.target_dir || ""}`, appDir);
      return reply(result);
    }
    if (path === "/autostart") {
      const enabled = setAutostartEnabled(requestBoolean(data.enabled), { dryRun: opts.autostartDryRun });
      log(`开机自动运行：${enabled ? "enabled" : "disabled"}`, appDir);
      return reply({ success: true, enabled });
    }
    if (path === "/choose-folder") {
      const selectedPath = await chooseFolder({ currentPath: data.currentPath, appDir, dryRun: opts.dialogDryRun ?? opts.openDryRun });
      return reply({ success: true, path: selectedPath, selected: Boolean(selectedPath) });
    }
    if (path === "/history/action") {
      const keys = Object.keys(data).sort();
      if (keys.length !== 2 || keys[0] !== "action" || keys[1] !== "id") throw new Error("历史动作只接受 id 和 action");
      const id = String(data.id || "");
      const action = String(data.action || "");
      if (!['copy_path', 'show_file', 'open_obsidian', 'open_source'].includes(action)) throw new Error("不支持的历史动作");
      const entry = readSaveHistory(appDir).find((item) => item.id === id);
      if (!entry) throw new Error("历史记录不存在");
      if (action === "copy_path") {
        if (!existsSync(entry.path) || !statSync(entry.path).isFile()) throw new Error("历史文件不存在，可能已删除或移动");
        return reply({ success: true, id, action, path: entry.path });
      }
      const opened = openHistoryEntry(entry, action as "show_file" | "open_obsidian" | "open_source", opts.openDryRun);
      return reply({ success: true, id, action, ...opened });
    }
    if (path === "/settings") {
      await showSettingsWindow(appDir, opts.port);
      return reply({ success: true });
    }
    if (path === "/open") return reply({ success: true, target: openConfiguredTarget(data.target, appDir, opts.openDryRun) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const saveErrorCode = String((error as any)?.code || (/保存路径|路径/.test(message) ? "PATH_DENIED" : "INVALID_CAPTURE")).replace(/[^A-Z0-9_]/g, "").slice(0, 64);
    log(path === "/save" ? `保存请求失败：code=${saveErrorCode}` : `错误 ${path}: ${message}`, appDir);
    return reply({ success: false, error: message }, path === "/save" || path === "/open" || path === "/history/action" || path === "/setup" ? 400 : 500);
  }

  return reply({ error: "Not Found" }, 404);
}

async function requestFromIncoming(req: any): Promise<Request> {
  const capped = req.method === "POST" && String(req.url || "").split("?", 1)[0] === "/save";
  const declared = Number(req.headers["content-length"]);
  if (capped && Number.isFinite(declared) && declared > CAPTURE_LIMITS.body_bytes) {
    req.resume();
    throw new CaptureBoundaryError("PAYLOAD_TOO_LARGE", "capture body exceeds 5 MiB");
  }
  return await new Promise<Request>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    let exceeded = false;
    const onData = (chunk: unknown) => {
      const buffer = Buffer.from(chunk as any);
      bytes += buffer.byteLength;
      if (capped && bytes > CAPTURE_LIMITS.body_bytes) {
        exceeded = true;
        chunks.length = 0;
        req.off("data", onData);
        req.resume();
        reject(new CaptureBoundaryError("PAYLOAD_TOO_LARGE", "capture body exceeds 5 MiB"));
        return;
      }
      chunks.push(buffer);
    };
    req.on("data", onData);
    req.once("error", reject);
    req.once("end", () => {
      if (exceeded) return;
      resolve(new Request(`http://${req.headers.host || "127.0.0.1"}${req.url}`, {
        method: req.method,
        headers: req.headers,
        body: chunks.length ? Buffer.concat(chunks) : undefined,
      }));
    });
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
  const server: Server = createServer(async (req, res) => {
    try {
      await writeNodeResponse(res, await handleApiRequest(await requestFromIncoming(req), { appDir, port: actualPort, openDryRun, dialogDryRun, testBypassAuth }));
    } catch (error) {
      if (!(error instanceof CaptureBoundaryError)) throw error;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
      }
      const request = new Request(`http://${req.headers.host || "127.0.0.1"}${req.url}`, { headers });
      res.setHeader("Connection", "close");
      await writeNodeResponse(res, json(request, boundaryPayload(error), error.status));
    }
  });
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
