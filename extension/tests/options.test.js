const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const { compareVersions, createOptionsController } = require("../options.js");

test("options page contains connection actions but no business settings", () => {
    const html = readFileSync("extension/options.html", "utf8");
    const source = readFileSync("extension/options.js", "utf8");
    for (const text of ["配对", "打开桌面设置", "诊断文档", "检查连接"]) assert.match(html, new RegExp(text));
    for (const removed of ["primarySavePath", "filenameFormat", "enableVideoDownload", "profileCaptureRange", "update_config"]) {
        assert.doesNotMatch(`${html}\n${source}`, new RegExp(removed));
    }
    assert.match(html, /local_client\.js/);
    const manifest = JSON.parse(readFileSync("extension/manifest.json", "utf8"));
    assert.equal(manifest.options_page, "options.html");
    assert.match(manifest.description, /桌面 App/);
});

test("version comparison handles numeric release components", () => {
    assert.equal(compareVersions("3.1.0", "3.1.0"), 0);
    assert.equal(compareVersions("3.2.0", "3.1.9"), 1);
    assert.equal(compareVersions("3.0.9", "3.1.0"), -1);
});

test("refresh distinguishes offline, pairing required, incompatible, and connected states", async () => {
    const states = [];
    const make = (client, version = "3.1.0") => createOptionsController({
        client,
        extensionVersion: () => version,
        render: (state) => states.push(state),
    });

    await make({ request: async () => { throw new Error("offline"); }, token: async () => "" }).refresh();
    assert.equal(states.at(-1).kind, "offline");

    await make({ request: async () => ({ status: "ok", version: "3.1.0", min_extension_version: "3.1.0" }), token: async () => "" }).refresh();
    assert.equal(states.at(-1).kind, "pairing");

    await make({
        request: async (path) => path === "/ping"
            ? ({ status: "ok", version: "4.0.0", min_extension_version: "4.0.0" })
            : ({ success: true }),
        token: async () => "",
    }, "3.1.0").refresh();
    assert.equal(states.at(-1).kind, "incompatible");

    await make({
        request: async (path) => path === "/ping"
            ? ({ status: "ok", version: "3.1.0", min_extension_version: "3.0.0" })
            : ({ success: true }),
        token: async () => "token",
    }).refresh();
    assert.equal(states.at(-1).kind, "connected");
});

test("pairing and desktop settings use LocalClient methods", async () => {
    const calls = [];
    const controller = createOptionsController({
        client: {
            pair: async (code) => { calls.push(["pair", code]); return { token: "saved" }; },
            token: async () => "saved",
            request: async (path, init) => {
                calls.push([path, init?.method]);
                return path === "/ping" ? { status: "ok", version: "3.1.0", min_extension_version: "3.0.0" } : { success: true };
            },
        },
        extensionVersion: () => "3.1.0",
        render: () => {},
    });
    await controller.pair(" 123456 ");
    await controller.openDesktopSettings();
    assert.deepEqual(calls[0], ["pair", "123456"]);
    assert.ok(calls.some((call) => call[0] === "/settings" && call[1] === "POST"));
});

test("connected extension reports version and permissions to Setup Doctor", async () => {
    const calls = [];
    const controller = createOptionsController({
        client: {
            token: async () => "token",
            request: async (path, init) => {
                calls.push([path, init]);
                if (path === "/ping") return { version: "3.1.0", min_extension_version: "3.1.0" };
                if (path === "/setup" && !init) return { setup_completed: false, steps: { directory: true, extension: false } };
                return { success: true };
            },
        },
        extensionVersion: () => "3.1.0",
        permissions: () => ["storage", "scripting", "http://127.0.0.1:9527/*"],
        render: () => {},
    });
    await controller.refresh();
    const report = calls.find(([path, init]) => path === "/setup" && init?.method === "POST");
    assert.ok(report);
    assert.deepEqual(JSON.parse(report[1].body), {
        step: "extension",
        extension_version: "3.1.0",
        permissions: ["storage", "scripting", "http://127.0.0.1:9527/*"],
    });
});
