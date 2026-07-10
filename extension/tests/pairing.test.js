const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

test("background pairs once and authenticates every local request from stored token", () => {
    const source = readFileSync("extension/background.js", "utf8");
    assert.match(source, /chrome\.storage\.local\.get\("x2md_api_token"\)/);
    assert.match(source, /Authorization: `Bearer \$\{token\}`/);
    assert.match(source, /message\.action === "pair"/);
    assert.match(source, /chrome\.storage\.local\.set\(\{ x2md_api_token: json\.token \}\)/);
    for (const route of ["config", "history", "save", "profile-capture", "autostart"]) {
        assert.ok(!source.includes("fetch(`${SERVER_BASE}/" + route));
    }
});
