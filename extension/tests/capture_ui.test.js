const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createCaptureUi,
    describeSaveResult,
    getFocusableElements,
    handleDialogKeydown,
} = require("../capture_ui.js");

test("saved, skipped, partial and failed results have distinct presentation", () => {
    assert.deepEqual(describeSaveResult({ success: true, outcome: "saved", files: [{ path: "/vault/a.md" }] }), {
        state: "saved", title: "保存成功", detail: "a.md", retryable: false,
    });
    assert.equal(describeSaveResult({ success: true, outcome: "skipped", files: [{ path: "/vault/a.md" }] }).title, "已存在");
    assert.equal(describeSaveResult({ success: true, outcome: "partial", warnings: [{ message: "图片失败" }] }).state, "partial");
    assert.deepEqual(describeSaveResult({ success: false, outcome: "failed", error: { message: "磁盘已满", retryable: true } }), {
        state: "failed", title: "保存失败", detail: "磁盘已满", retryable: true,
    });
});

test("retry is memory-only and is cleared after success or page unload", async () => {
    const listeners = new Map();
    const win = { addEventListener: (type, fn) => listeners.set(type, fn) };
    const ui = createCaptureUi({ document: null, window: win });
    const document = { content: "secret body" };
    let retries = 0;

    ui.showSaveResult({ success: false, outcome: "failed", error: { message: "offline", retryable: true } }, {
        captureDocument: document,
        retry: async (value) => { assert.equal(value, document); retries++; },
    });
    assert.equal(ui.hasRetry(), true);
    await ui.retry();
    assert.equal(retries, 1);
    ui.showSaveResult({ success: true, outcome: "saved", files: [] });
    assert.equal(ui.hasRetry(), false);

    ui.rememberRetry(document, () => {});
    listeners.get("pagehide")();
    assert.equal(ui.hasRetry(), false);
    assert.equal(JSON.stringify(win).includes("secret body"), false);
});

test("non-retryable failures never retain an invalid retry action", () => {
    const ui = createCaptureUi({ document: null, window: null });
    ui.showSaveResult({ success: false, outcome: "failed", error: { message: "invalid", retryable: false } }, {
        captureDocument: { content: "body" }, retry: () => assert.fail("must not retry"),
    });
    assert.equal(ui.hasRetry(), false);
});

test("success actions emit only action metadata and never the capture payload", async () => {
    const sent = [];
    const copied = [];
    const ui = createCaptureUi({
        document: null,
        window: null,
        sendAction: (message) => sent.push(message),
        copyText: (text) => copied.push(text),
    });
    const result = { success: true, outcome: "saved", files: [{ path: "/vault/a.md", action_urls: { obsidian: "obsidian://open?vault=v&file=a" } }] };
    ui.showSaveResult(result, { captureDocument: { content: "secret body" } });
    await ui.runResultAction("copy_path");
    await ui.runResultAction("show_file");
    await ui.runResultAction("open_obsidian");
    assert.deepEqual(copied, ["/vault/a.md"]);
    assert.deepEqual(sent, [
        { action: "capture_result_action", command: "show_file", path: "/vault/a.md" },
        { action: "capture_result_action", command: "open_obsidian", url: "obsidian://open?vault=v&file=a" },
    ]);
    assert.equal(JSON.stringify({ sent, copied }).includes("secret body"), false);
});

test("long-video choice is remembered for the page session", async () => {
    const ui = createCaptureUi({ document: null, window: null });
    ui.setLongVideoChoice(true);
    assert.equal(await ui.confirmLongVideo({ durationMin: 42 }), true);
    ui.setLongVideoChoice(false);
    assert.equal(await ui.confirmLongVideo({ durationMin: 42 }), false);
});

test("focus trap candidates exclude disabled and hidden controls", () => {
    const enabled = { disabled: false, getAttribute: () => null };
    const disabled = { disabled: true, getAttribute: () => null };
    const hidden = { disabled: false, getAttribute: (name) => name === "aria-hidden" ? "true" : null };
    assert.deepEqual(getFocusableElements({ querySelectorAll: () => [enabled, disabled, hidden] }), [enabled]);
});

test("modal keyboard handler closes on Escape and traps Tab focus", () => {
    const focused = [];
    const first = { disabled: false, getAttribute: () => null, focus: () => focused.push("first") };
    const last = { disabled: false, getAttribute: () => null, focus: () => focused.push("last") };
    const root = { querySelectorAll: () => [first, last] };
    let prevented = 0;
    let closed = 0;
    const event = (key, shiftKey = false) => ({ key, shiftKey, preventDefault: () => prevented++ });

    assert.equal(handleDialogKeydown(event("Tab"), root, last, () => closed++), true);
    assert.equal(handleDialogKeydown(event("Tab", true), root, first, () => closed++), true);
    assert.equal(handleDialogKeydown(event("Escape"), root, first, () => closed++), true);
    assert.deepEqual(focused, ["first", "last"]);
    assert.equal(prevented, 3);
    assert.equal(closed, 1);
});
