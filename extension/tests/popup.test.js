const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");

function runPopup(responses) {
    const elements = {
        dot: { className: "" },
        "status-text": { textContent: "" },
        "status-hint": { textContent: "" },
        "path-list": { innerHTML: "" },
        "history-list": { innerHTML: "" },
    };
    const context = {
        document: { getElementById: (id) => elements[id] },
        chrome: {
            runtime: {
                sendMessage(message, callback) {
                    callback(responses[message.action]);
                },
            },
        },
    };
    vm.runInNewContext(readFileSync("extension/popup.js", "utf8"), context);
    return elements;
}

test("popup shows service online and configured paths", () => {
    const elements = runPopup({
        ping: { online: true, version: "2.0.4", port: "9527" },
        get_config: { success: true, config: { save_paths: ["/vault/md"] } },
        get_history: { success: true, history: [{ title: "最近保存标题", saved_at: "2026-07-09T00:00:00.000Z" }] },
    });
    assert.equal(elements.dot.className, "dot online");
    assert.equal(elements["status-text"].textContent, "服务在线");
    assert.equal(elements["status-hint"].textContent, "v2.0.4 · 127.0.0.1:9527");
    assert.match(elements["path-list"].innerHTML, /\/vault\/md/);
    assert.match(elements["history-list"].innerHTML, /最近保存标题/);
});

test("popup shows service offline and config error", () => {
    const elements = runPopup({ ping: { online: false }, get_config: { success: false }, get_history: { success: true, history: [] } });
    assert.equal(elements.dot.className, "dot offline");
    assert.equal(elements["status-text"].textContent, "本机服务未启动");
    assert.equal(elements["status-hint"].textContent, "请打开 X2MD.app 后重试");
    assert.match(elements["path-list"].innerHTML, /请先启动本机 X2MD 服务/);
    assert.match(elements["history-list"].innerHTML, /暂无保存记录/);
});
