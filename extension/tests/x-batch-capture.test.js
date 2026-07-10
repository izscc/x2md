const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    collectUniqueStatusUrls,
    getXProfileCaptureRangeStart,
    getTwitterProfileContext,
} = require("../x-batch-capture.js");

test("collectUniqueStatusUrls keeps visible status links in order", () => {
    const root = {
        querySelectorAll: () => [
            { getAttribute: () => "/alice/status/1" },
            { getAttribute: () => "/alice/status/1/photo/1" },
            { getAttribute: () => "https://twitter.com/bob/status/2?ref=bookmarks" },
        ],
    };

    assert.deepEqual(collectUniqueStatusUrls(root), [
        "https://x.com/alice/status/1",
        "https://x.com/bob/status/2",
    ]);
});

test("getTwitterProfileContext recognizes profiles and articles without reserved pages", () => {
    assert.deepEqual(getTwitterProfileContext({ hostname: "x.com", pathname: "/alice/articles", origin: "https://x.com" }), {
        handle: "alice",
        tab: "articles",
        isArticles: true,
        profileUrl: "https://x.com/alice",
    });
    assert.equal(getTwitterProfileContext({ hostname: "x.com", pathname: "/home", origin: "https://x.com" }), null);
});

test("getXProfileCaptureRangeStart returns deterministic range boundaries", () => {
    const now = new Date("2026-07-11T12:00:00Z");
    assert.equal(getXProfileCaptureRangeStart({ range: "all", days: 1 }, now), null);
    assert.equal(getXProfileCaptureRangeStart({ range: "days", days: 3 }, now).toISOString(), "2026-07-08T12:00:00.000Z");
});

test("content entry only starts the content runtime", () => {
    const content = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
    assert.match(content, /X2MDContentRuntime\.start\(\)/);
    assert.equal(content.includes("function "), false);
    assert.equal(content.includes("chrome.runtime.sendMessage"), false);
    assert.equal(content.includes("MutationObserver"), false);
});
