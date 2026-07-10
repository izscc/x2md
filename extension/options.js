(function (root, factory) {
    const api = factory(root);
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    else root.X2MDOptions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
    "use strict";

    function compareVersions(left, right) {
        const a = String(left || "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
        const b = String(right || "").split(/[.-]/).map((part) => Number.parseInt(part, 10) || 0);
        for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
            if ((a[index] || 0) > (b[index] || 0)) return 1;
            if ((a[index] || 0) < (b[index] || 0)) return -1;
        }
        return 0;
    }

    function createOptionsController({ client, extensionVersion, render }) {
        async function refresh() {
            const currentExtensionVersion = extensionVersion();
            render({ kind: "checking", extensionVersion: currentExtensionVersion, appVersion: "" });
            let ping;
            try {
                ping = await client.request("/ping", { auth: false });
            } catch {
                const state = { kind: "offline", extensionVersion: currentExtensionVersion, appVersion: "" };
                render(state);
                return state;
            }

            const appVersion = String(ping.version || "");
            const minimum = String(ping.min_extension_version || "");
            if (minimum && compareVersions(currentExtensionVersion, minimum) < 0) {
                const state = { kind: "incompatible", extensionVersion: currentExtensionVersion, appVersion, minimum };
                render(state);
                return state;
            }
            const token = await client.token();
            if (!token) {
                const state = { kind: "pairing", extensionVersion: currentExtensionVersion, appVersion, minimum };
                render(state);
                return state;
            }
            try {
                await client.request("/status");
            } catch (error) {
                const kind = error?.code === "AUTH_INVALID" || error?.code === "PAIRING_REQUIRED" ? "pairing" : "offline";
                const state = { kind, extensionVersion: currentExtensionVersion, appVersion, minimum };
                render(state);
                return state;
            }
            const state = { kind: "connected", extensionVersion: currentExtensionVersion, appVersion, minimum };
            render(state);
            return state;
        }

        async function pair(code) {
            await client.pair(String(code || "").trim());
            return refresh();
        }

        async function openDesktopSettings() {
            return client.request("/settings", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "{}",
            });
        }

        return { refresh, pair, openDesktopSettings };
    }

    function boot() {
        if (!root.document || !root.X2MDLocalClient || !root.chrome?.runtime) return;
        const byId = (id) => root.document.getElementById(id);
        const statusCopy = {
            checking: ["正在检查连接…", "正在连接 127.0.0.1:9527"],
            offline: ["桌面 App 未连接", "请启动 X2MD App，然后重新检查连接。"],
            pairing: ["需要配对", "输入桌面 App 中显示的一次性配对码。"],
            incompatible: ["扩展版本需要升级", "当前扩展与桌面 App 不兼容，请安装最新版扩展。"],
            connected: ["已连接桌面 App", "连接与认证正常，可以保存内容。"],
        };
        const render = (state) => {
            const [title, detail] = statusCopy[state.kind];
            byId("statusDot").className = `dot ${state.kind}`;
            byId("statusTitle").textContent = title;
            byId("statusDetail").textContent = state.kind === "incompatible" && state.minimum
                ? `至少需要扩展 v${state.minimum}，请升级后重试。`
                : detail;
            byId("extensionVersion").textContent = state.extensionVersion ? `v${state.extensionVersion}` : "-";
            byId("appVersion").textContent = state.appVersion ? `v${state.appVersion}` : "-";
            byId("pairingPanel").hidden = state.kind !== "pairing";
            byId("openSettings").disabled = state.kind !== "connected";
        };
        const feedback = (message, error = false) => {
            byId("feedback").textContent = message;
            byId("feedback").className = error ? "error" : "";
        };
        const controller = createOptionsController({
            client: root.X2MDLocalClient.createLocalClient(),
            extensionVersion: () => root.chrome.runtime.getManifest().version || "",
            render,
        });

        byId("refresh").addEventListener("click", () => controller.refresh().then(() => feedback("")).catch((error) => feedback(error.message, true)));
        byId("pairButton").addEventListener("click", async () => {
            const code = byId("pairingCode").value.trim();
            if (!code) return feedback("请输入配对码。", true);
            byId("pairButton").disabled = true;
            try {
                await controller.pair(code);
                byId("pairingCode").value = "";
                feedback("配对成功。", false);
            } catch (error) {
                feedback(error?.message || "配对失败，请检查配对码。", true);
            } finally {
                byId("pairButton").disabled = false;
            }
        });
        byId("openSettings").addEventListener("click", () => controller.openDesktopSettings().then(() => feedback("已打开桌面设置。")).catch((error) => feedback(error.message, true)));
        controller.refresh().catch((error) => feedback(error.message, true));
    }

    if (typeof module === "undefined" || !module.exports) {
        if (root.document?.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot);
        else boot();
    }
    return { compareVersions, createOptionsController };
});
