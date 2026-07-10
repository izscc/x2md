const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const translationUi = require("../x-translation-ui.js");

test("exports a narrow mount, schedule, and capture-override interface", () => {
    assert.equal(typeof translationUi.mount, "function");
    assert.equal(typeof translationUi.schedule, "function");
    assert.equal(typeof translationUi.applyVisibleTranslationOverride, "function");
});

test("applies an in-memory translation override without persistence", () => {
    const translated = { type: "tweet", text: "译文" };
    const scope = {
        __x2md_translation_override: translated,
        querySelector() { return null; },
    };
    const original = { type: "tweet", text: "original", images: ["a.jpg"] };

    assert.deepEqual(translationUi.applyVisibleTranslationOverride(original, scope), {
        ...original,
        text: "译文",
        prefer_translated_content: true,
        translation_override: translated,
    });
    assert.equal(Object.prototype.hasOwnProperty.call(scope, "storage"), false);
});

test("normalizes translated copy content as HTML and plain text", () => {
    assert.deepEqual(translationUi.normalizeRemoteCopyContent({
        markdown: "**Bold** [link](https://example.com)",
        source: "graphql",
    }), {
        text: "**Bold** link",
        html: "<p><strong>Bold</strong> <a href=\"https://example.com\">link</a></p>",
        source: "graphql",
    });
});

test("content entry delegates X translation UI and contains no DOM translation algorithms", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "content.js"), "utf8");
    const runtime = fs.readFileSync(path.join(__dirname, "..", "content_runtime.js"), "utf8");
    assert.match(source, /X2MDContentRuntime\.start\(\)/);
    assert.match(runtime, /X2MDXTranslationUI\.mount\(\)/);
    assert.match(runtime, /X2MDXTranslationUI\.schedule\(\)/);
    assert.match(runtime, /X2MDXTranslationUI\.applyVisibleTranslationOverride/);
    for (const implementation of [
        "translateArticleInPlace",
        "replaceElementTextWithTranslation",
        "copyContentToClipboard",
        "requestBackgroundTextTranslation",
        "xAutoTranslateQueue",
    ]) {
        assert.doesNotMatch(source, new RegExp(`function\\s+${implementation}|(?:const|let)\\s+${implementation}`));
    }
    assert.doesNotMatch(source, /action:\s*["']translate_(?:tweet|text)["']/);
    assert.doesNotMatch(source, /navigator\.clipboard|execCommand\(["']copy["']\)/);
});

test("translation UI uses extension messages rather than direct fetch or storage", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "x-translation-ui.js"), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/);
    assert.doesNotMatch(source, /chrome\.storage|localStorage|sessionStorage/);
    assert.match(source, /chrome\.runtime\.sendMessage/);
});
