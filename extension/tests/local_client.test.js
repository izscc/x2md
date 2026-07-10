const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const { BASE_URL, LocalClientError, createLocalClient } = require("../local_client.js");

function response(status, data) {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(data) };
}

test("local client owns the fixed endpoint and authenticates from local storage", async () => {
    const calls = [];
    const client = createLocalClient({
        storage: { get: async () => ({ x2md_api_token: "paired-token" }) },
        fetchImpl: async (url, init) => { calls.push([url, init]); return response(200, { status: "ok" }); },
    });
    const result = await client.request("/config");
    assert.deepEqual(result, { status: "ok" });
    assert.equal(BASE_URL, "http://127.0.0.1:9527");
    assert.equal(calls[0][0], `${BASE_URL}/config`);
    assert.equal(calls[0][1].headers.Authorization, "Bearer paired-token");
});

test("pair is unauthenticated and persists the returned token", async () => {
    const writes = [];
    const client = createLocalClient({
        storage: { get: async () => ({}), set: async (value) => writes.push(value) },
        fetchImpl: async (_url, init) => {
            assert.equal(init.headers.Authorization, undefined);
            return response(200, { token: "new-token" });
        },
    });
    assert.deepEqual(await client.pair("123456"), { token: "new-token" });
    assert.deepEqual(writes, [{ x2md_api_token: "new-token" }]);
});

test("maps offline, timeout, auth, server SaveResult errors, and invalid JSON", async (t) => {
    const cases = [
        ["offline", async () => { throw new TypeError("fetch failed"); }, "SERVER_OFFLINE"],
        ["auth", async () => response(401, {}), "PAIRING_REQUIRED"],
        ["server", async () => response(500, { error: { code: "WRITE_FAILED", message: "disk", retryable: true } }), "WRITE_FAILED"],
        ["json", async () => ({ ok: true, status: 200, text: async () => "not-json" }), "INVALID_RESPONSE"],
    ];
    for (const [name, fetchImpl, code] of cases) {
        await t.test(name, async () => {
            const client = createLocalClient({ storage: { get: async () => ({}) }, fetchImpl, retries: 0 });
            await assert.rejects(client.request("/save", { method: "POST" }), (error) => error instanceof LocalClientError && error.code === code);
        });
    }

    await t.test("timeout", async () => {
        const client = createLocalClient({
            storage: { get: async () => ({}) }, retries: 0, timeoutMs: 5,
            fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
        });
        await assert.rejects(client.request("/ping"), (error) => error.code === "SERVER_OFFLINE" && error.reason === "timeout");
    });
});

test("retries idempotent requests once but never retries POST", async () => {
    let gets = 0;
    const getClient = createLocalClient({
        storage: { get: async () => ({}) }, retries: 1, retryDelayMs: 0,
        fetchImpl: async () => { gets += 1; if (gets === 1) throw new TypeError("offline"); return response(200, { ok: true }); },
    });
    await getClient.request("/config");
    assert.equal(gets, 2);

    let posts = 0;
    const postClient = createLocalClient({
        storage: { get: async () => ({}) }, retries: 1,
        fetchImpl: async () => { posts += 1; throw new TypeError("offline"); },
    });
    await assert.rejects(postClient.request("/save", { method: "POST" }));
    assert.equal(posts, 1);
});

test("background, popup, and options have no direct local fetch and load the client first", () => {
    const background = readFileSync("extension/background.js", "utf8");
    const backgroundRuntime = readFileSync("extension/background_runtime.js", "utf8");
    const popup = readFileSync("extension/popup.js", "utf8");
    const options = readFileSync("extension/options.js", "utf8");
    const optionsHtml = readFileSync("extension/options.html", "utf8");
    for (const source of [background, popup, options]) {
        assert.doesNotMatch(source, /fetch\([^\n]*(?:127\.0\.0\.1|\/config|\/save|\/history|\/autostart|\/pair)/);
    }
    assert.ok(background.indexOf('"local_client.js"') < background.indexOf('"background_runtime.js"'));
    assert.match(backgroundRuntime, /X2MDLocalClient\.createLocalClient\(\)/);
    assert.ok(optionsHtml.indexOf('src="local_client.js"') < optionsHtml.indexOf('src="options.js"'));
});
