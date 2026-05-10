const test = require("node:test");
const assert = require("node:assert/strict");

const {
    applyTranslationOverrideToData,
    buildArticleTranslationSource,
    isExpandableTweetTextControl,
} = require("../translation_helpers.js");

test("isExpandableTweetTextControl matches tweet truncation controls only", () => {
    assert.equal(isExpandableTweetTextControl("显示更多"), true);
    assert.equal(isExpandableTweetTextControl("Show more"), true);
    assert.equal(isExpandableTweetTextControl("Show More"), true);

    assert.equal(isExpandableTweetTextControl("显示更多回复"), false);
    assert.equal(isExpandableTweetTextControl("Show more replies"), false);
    assert.equal(isExpandableTweetTextControl("查看更多回复"), false);
    assert.equal(isExpandableTweetTextControl("Load more"), false);
});

test("buildArticleTranslationSource keeps article title and body explicit", () => {
    assert.deepEqual(
        buildArticleTranslationSource({
            title: "I'm Local AI Maxxing",
            body: "First paragraph.\n\nSecond paragraph.",
        }),
        {
            title: "I'm Local AI Maxxing",
            body: "First paragraph.\n\nSecond paragraph.",
            text: "I'm Local AI Maxxing\n\nFirst paragraph.\n\nSecond paragraph.",
        },
    );
});

test("applyTranslationOverrideToData prefers translated tweet text while preserving media", () => {
    const result = applyTranslationOverrideToData({
        type: "tweet",
        text: "Original text",
        url: "https://x.com/a/status/1",
        images: ["https://pbs.twimg.com/media/a.jpg"],
        prefer_translated_content: true,
        translation_override: {
            type: "tweet",
            text: "译文正文",
        },
    });

    assert.equal(result.text, "译文正文");
    assert.deepEqual(result.images, ["https://pbs.twimg.com/media/a.jpg"]);
    assert.equal(result.url, "https://x.com/a/status/1");
});

test("applyTranslationOverrideToData prefers translated article title and content", () => {
    const result = applyTranslationOverrideToData({
        type: "article",
        article_title: "Original title",
        article_content: "Original body",
        prefer_translated_content: true,
        translation_override: {
            type: "article",
            article_title: "译文标题",
            article_content: "译文第一段\n\n译文第二段",
        },
    });

    assert.equal(result.article_title, "译文标题");
    assert.equal(result.article_content, "译文第一段\n\n译文第二段");
});
