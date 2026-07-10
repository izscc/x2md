(function (root) {
    const BASE_URL = "http://127.0.0.1:9527";
    const TOKEN_KEY = "x2md_api_token";

    class LocalClientError extends Error {
        constructor(code, message, options = {}) {
            super(message);
            this.name = "LocalClientError";
            this.code = code;
            this.retryable = Boolean(options.retryable);
            this.status = options.status || 0;
            this.reason = options.reason || "";
        }
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function serverError(status, data, hasToken) {
        const reported = data?.error;
        if (status === 401 || status === 403) {
            return new LocalClientError(hasToken ? "AUTH_INVALID" : "PAIRING_REQUIRED", hasToken ? "本地服务认证已失效，请重新配对" : "请先与 X2MD App 配对", { status });
        }
        if (reported && typeof reported === "object") {
            return new LocalClientError(reported.code || "LOCAL_API_ERROR", reported.message || `HTTP ${status}`, {
                status, retryable: reported.retryable,
            });
        }
        return new LocalClientError(data?.code || "LOCAL_API_ERROR", data?.error || `HTTP ${status}`, { status, retryable: status >= 500 });
    }

    function createLocalClient(options = {}) {
        const fetchImpl = options.fetchImpl || root.fetch?.bind(root);
        const storage = options.storage || root.chrome?.storage?.local;
        const timeoutMs = options.timeoutMs ?? 5000;
        const retries = options.retries ?? 1;
        const retryDelayMs = options.retryDelayMs ?? 100;

        async function token() {
            if (!storage?.get) return "";
            const stored = await storage.get(TOKEN_KEY);
            return stored?.[TOKEN_KEY] || "";
        }

        async function request(path, init = {}) {
            if (!fetchImpl) throw new LocalClientError("SERVER_OFFLINE", "无法连接本地服务", { retryable: true });
            const method = String(init.method || "GET").toUpperCase();
            const auth = init.auth !== false;
            const savedToken = auth ? await token() : "";
            const attempts = method === "GET" ? retries + 1 : 1;
            for (let attempt = 0; attempt < attempts; attempt += 1) {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const response = await fetchImpl(`${BASE_URL}${path}`, {
                        ...init,
                        method,
                        auth: undefined,
                        signal: controller.signal,
                        headers: {
                            ...(init.headers || {}),
                            ...(savedToken ? { Authorization: `Bearer ${savedToken}` } : {}),
                        },
                    });
                    const raw = await response.text();
                    let data = {};
                    if (raw) {
                        try { data = JSON.parse(raw); }
                        catch { throw new LocalClientError("INVALID_RESPONSE", "本地服务返回了无效 JSON", { status: response.status }); }
                    }
                    if (!response.ok) throw serverError(response.status, data, Boolean(savedToken));
                    return data;
                } catch (error) {
                    if (error instanceof LocalClientError) throw error;
                    const timedOut = controller.signal.aborted || error?.name === "AbortError";
                    if (attempt + 1 < attempts) {
                        await delay(retryDelayMs);
                        continue;
                    }
                    throw new LocalClientError("SERVER_OFFLINE", timedOut ? "本地服务请求超时" : "无法连接本地服务", {
                        retryable: true, reason: timedOut ? "timeout" : "offline",
                    });
                } finally {
                    clearTimeout(timer);
                }
            }
        }

        async function pair(code) {
            const data = await request("/pair", {
                method: "POST", auth: false,
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ code: String(code || "").trim() }),
            });
            if (!data.token) throw new LocalClientError("PAIRING_REQUIRED", data.error || "配对失败");
            await storage?.set?.({ [TOKEN_KEY]: data.token });
            return data;
        }

        return { request, pair, token };
    }

    const api = { BASE_URL, LocalClientError, createLocalClient };
    root.X2MDLocalClient = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
