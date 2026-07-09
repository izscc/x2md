const test = require("node:test");
const assert = require("node:assert/strict");

const {
    collectUniqueStatusUrls,
    detectFloatingSaveSite,
    isFloatingSaveIconEnabled,
    isXBookmarksPage,
} = require("../site_actions.js");

test("detectFloatingSaveSite recognizes supported site pages only", () => {
    assert.equal(detectFloatingSaveSite({ hostname: "linux.do", pathname: "/t/topic/841319" }), "linux_do");
    assert.equal(detectFloatingSaveSite({ hostname: "waytoagi.feishu.cn", pathname: "/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e" }), "feishu");
    assert.equal(detectFloatingSaveSite({ hostname: "waytoagi.feishu.cn", pathname: "/docx/G9fzdabOlocE16x80BXcFXtUnu8" }), "feishu");
    assert.equal(detectFloatingSaveSite({ hostname: "x.com", pathname: "/foo/status/1" }), null);
});

test("isFloatingSaveIconEnabled defaults to true and respects config", () => {
    assert.equal(isFloatingSaveIconEnabled({}), true);
    assert.equal(isFloatingSaveIconEnabled({ show_site_save_icon: true }), true);
    assert.equal(isFloatingSaveIconEnabled({ show_site_save_icon: false }), false);
});

test("isXBookmarksPage only matches X bookmarks", () => {
    assert.equal(isXBookmarksPage({ hostname: "x.com", pathname: "/i/bookmarks" }), true);
    assert.equal(isXBookmarksPage({ hostname: "twitter.com", pathname: "/i/bookmarks" }), true);
    assert.equal(isXBookmarksPage({ hostname: "x.com", pathname: "/home" }), false);
});

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
