const test = require("node:test");
const assert = require("node:assert/strict");

const {
    bindBookmarkSaveListener,
    getBookmarkButtonAction,
    shouldSaveBookmarkClick,
} = require("../bookmark_semantics.js");

function button(attributes = {}) {
    const listeners = new Map();
    return {
        getAttribute(name) {
            return attributes[name] || "";
        },
        setAttribute(name, value) {
            attributes[name] = value;
        },
        addEventListener(type, listener) {
            const current = listeners.get(type) || [];
            current.push(listener);
            listeners.set(type, current);
        },
        closest() {
            return attributes.article || null;
        },
        click() {
            for (const listener of listeners.get("click") || []) listener({ type: "click" });
        },
    };
}

const immediately = (callback) => callback();

test("classifies add and remove bookmark buttons from dynamic X attributes", () => {
    for (const attributes of [
        { "data-testid": "bookmark" },
        { "aria-label": "Bookmark" },
        { "aria-label": "Add Bookmark" },
        { "aria-label": "书签" },
        { "aria-label": "添加书签" },
    ]) {
        assert.equal(getBookmarkButtonAction(button(attributes)), "add");
        assert.equal(shouldSaveBookmarkClick(button(attributes)), true);
    }

    for (const attributes of [
        { "data-testid": "removeBookmark" },
        { "aria-label": "Remove Bookmark" },
        { "aria-label": "移除书签" },
        { "aria-label": "取消书签" },
    ]) {
        assert.equal(getBookmarkButtonAction(button(attributes)), "remove");
        assert.equal(shouldSaveBookmarkClick(button(attributes)), false);
    }

    assert.equal(getBookmarkButtonAction(button({ "aria-label": "Bookmarks" })), "unknown");
    assert.equal(shouldSaveBookmarkClick(button({ "aria-label": "Bookmarks" })), false);
});

test("new bookmark sends exactly once and repeated binding stays idempotent", () => {
    const target = button({ "data-testid": "bookmark" });
    let saves = 0;
    assert.equal(bindBookmarkSaveListener(target, () => saves++, { schedule: immediately }), true);
    assert.equal(bindBookmarkSaveListener(target, () => saves++, { schedule: immediately }), false);

    target.click();
    assert.equal(saves, 1);
});

test("remove bookmark never sends a save", () => {
    const target = button({ "data-testid": "removeBookmark" });
    let saves = 0;
    bindBookmarkSaveListener(target, () => saves++, { schedule: immediately });

    target.click();
    assert.equal(saves, 0);
});

test("replacement nodes are classified from their current pre-click state", () => {
    const oldButton = button({ "data-testid": "removeBookmark" });
    const replacement = button({ "data-testid": "bookmark" });
    let saves = 0;
    bindBookmarkSaveListener(oldButton, () => saves++, { schedule: immediately });
    bindBookmarkSaveListener(replacement, () => saves++, { schedule: immediately });

    oldButton.click();
    replacement.click();
    assert.equal(saves, 1);
});

test("classification happens before X changes the button state", () => {
    const pending = [];
    const target = button({ "data-testid": "bookmark" });
    let saves = 0;
    bindBookmarkSaveListener(target, () => saves++, {
        schedule: (callback) => pending.push(callback),
    });

    target.click();
    target.setAttribute("data-testid", "removeBookmark");
    pending.shift()();
    assert.equal(saves, 1);
});

test("delayed save keeps the tweet article captured before X replaces the button", () => {
    const pending = [];
    const article = { id: "tweet-article" };
    const target = button({ "data-testid": "bookmark", article });
    let captureTarget = null;
    bindBookmarkSaveListener(target, (_button, context) => {
        captureTarget = context.captureTarget;
    }, { schedule: (callback) => pending.push(callback) });

    target.click();
    target.closest = () => null;
    pending.shift()();

    assert.equal(captureTarget, article);
});

test("custom-menu programmatic bookmark click can skip the default save once", () => {
    const target = button({ "data-testid": "bookmark" });
    let skipNext = true;
    let saves = 0;
    bindBookmarkSaveListener(target, () => saves++, {
        schedule: immediately,
        shouldSkip: () => {
            if (!skipNext) return false;
            skipNext = false;
            return true;
        },
    });

    target.click();
    target.click();
    assert.equal(saves, 1);
});
