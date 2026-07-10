const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

test("background pairs once and authenticates every local request from stored token", () => {
    const source = readFileSync("extension/background.js", "utf8");
    const runtime = readFileSync("extension/background_runtime.js", "utf8");
    const dispatcher = readFileSync("extension/message_dispatcher.js", "utf8");
    const client = readFileSync("extension/local_client.js", "utf8");
    assert.match(source, /X2MDBackgroundRuntime\.start\(\)/);
    assert.match(runtime, /X2MDLocalClient\.createLocalClient\(\)/);
    assert.match(dispatcher, /pair: async \(message\)/);
    assert.match(runtime, /pair: \(code\) => localClient\.pair\(code\)/);
    assert.match(client, /storage\.get\(TOKEN_KEY\)/);
    assert.match(client, /Authorization: `Bearer \$\{savedToken\}`/);
    assert.match(client, /storage\?\.set\?\.\(\{ \[TOKEN_KEY\]: data\.token \}\)/);
    for (const route of ["config", "history", "save", "profile-capture", "autostart"]) {
        assert.ok(!runtime.includes("fetch(`" + route));
    }
});
