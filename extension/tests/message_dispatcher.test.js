const test = require("node:test");
const assert = require("node:assert/strict");

const { createMessageDispatcher } = require("../message_dispatcher.js");

function fixture(overrides = {}) {
    const calls = [];
    const deps = {
        getConfig: async () => ({ enable_video_download: true, video_duration_threshold: 5 }),
        enrich: async (mode, data) => ({ ...data, enrichedAs: mode }),
        save: async (data) => { calls.push(["save", data]); return { success: true, outcome: "saved" }; },
        applyCustomSavePath: (data) => data,
        applyTranslationOverride: (data) => ({ ...data, translated: true }),
        translateTweet: async (id) => ({ translatedText: `zh:${id}`, tweetId: id }),
        translateText: async (text) => `zh:${text}`,
        fetchProfileItems: async () => ({ profile: { handle: "alice" }, items: [{ id: "1" }], source: "graphql" }),
        postProfileCapture: async (payload) => { calls.push(["batch", payload]); return { success: true }; },
        jobs: {
            create: async (type, items, metadata) => { calls.push(["job", { type, items, metadata }]); return { success: true, job: { id: "job-1", type } }; },
            list: async () => ({ success: true, jobs: [] }), detail: async () => ({ success: true }), control: async () => ({ success: true }),
        },
        pair: async () => ({ token: "token" }),
        getHistory: async () => ({ success: true, history: [] }),
        historyAction: async (data) => { calls.push(["history-action", data]); return { success: true, ...data }; },
        updateConfig: async (config) => ({ success: true, config }),
        getAutostart: async () => ({ success: true, enabled: true }),
        setAutostart: async (enabled) => ({ success: true, enabled }),
        ping: async () => ({ status: "ok", version: "4.0.0" }),
        openOptions: async () => {},
        extensionVersion: () => "4.0.0",
        ...overrides,
    };
    return { dispatch: createMessageDispatcher(deps), calls };
}

test("single capture dispatches capture -> enrich -> local save", async () => {
    const { dispatch, calls } = fixture();
    assert.deepEqual(await dispatch({ action: "save_tweet", data: { text: "hello" } }), {
        success: true,
        outcome: "saved",
    });
    assert.deepEqual(calls, [["save", { text: "hello", enrichedAs: "capture", download_video: true }]]);
});

test("force save shares save route and applies translation override", async () => {
    const { dispatch, calls } = fixture();
    await dispatch({ action: "force_save_tweet", data: { text: "hello" } });
    assert.deepEqual(calls[0], ["save", { text: "hello", translated: true }]);
});

test("history actions forward only server history id and action", async () => {
    const { dispatch, calls } = fixture();
    await dispatch({ action: "capture_result_action", id: "h-1", command: "show_file", path: "/tmp/attacker" });
    assert.deepEqual(calls, [["history-action", { id: "h-1", action: "show_file" }]]);
});

test("translation and copy messages are dispatched", async () => {
    const { dispatch } = fixture();
    assert.deepEqual(await dispatch({ action: "translate_tweet", data: { tweetId: "42" } }), {
        success: true, translatedText: "zh:42", tweetId: "42", error: "",
    });
    assert.deepEqual(await dispatch({ action: "translate_text", data: { text: "hello" } }), {
        success: true, translatedText: "zh:hello", error: "",
    });
    assert.deepEqual(await dispatch({ action: "copy_content_text", data: { text: "hello" } }), {
        success: true, text: "hello", enrichedAs: "copy",
    });
});

test("configuration messages share the dispatcher", async () => {
    const { dispatch } = fixture();
    assert.equal((await dispatch({ action: "get_config" })).success, true);
    assert.deepEqual(await dispatch({ action: "update_config", config: { locale: "zh" } }), {
        success: true, config: { locale: "zh" },
    });
    assert.deepEqual(await dispatch({ action: "get_autostart" }), { success: true, enabled: true });
    assert.deepEqual(await dispatch({ action: "set_autostart", enabled: false }), { success: true, enabled: false, error: undefined });
});

test("batch message fetches and creates a durable profile job", async () => {
    const { dispatch, calls } = fixture();
    const response = await dispatch({ action: "batch_profile_capture", data: { handle: "alice", mode: "tweets" } });
    assert.equal(response.success, true);
    assert.equal(response.found_count, 1);
    assert.equal(response.enriched_count, 0);
    assert.equal(response.source, "graphql");
    assert.deepEqual(calls[0][0], "job");
    assert.equal(calls[0][1].type, "profile-posts");
    assert.deepEqual(calls[0][1].items[0].payload.item, { id: "1" });
});

test("unknown and failed messages return stable errors", async () => {
    const { dispatch } = fixture();
    assert.deepEqual(await dispatch({ action: "no_such_action" }), {
        success: false,
        error: "Unknown message action: no_such_action",
        error_code: "unknown_action",
    });
    const failed = fixture({ translateText: async () => { throw new Error("offline"); } });
    assert.deepEqual(await failed.dispatch({ action: "translate_text", data: { text: "x" } }), {
        success: false, error: "offline", error_code: "dispatch_failed",
    });
});
