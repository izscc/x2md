const test = require("node:test");
const assert = require("node:assert/strict");

const { capture, normalize } = require("../site-adapters/x-capture.js");

function node({ text = "", attrs = {}, selectors = {} } = {}) {
    return {
        innerText: text,
        textContent: text,
        src: attrs.src || "",
        alt: attrs.alt || "",
        tagName: attrs.tagName || "DIV",
        parentElement: null,
        getAttribute(name) { return attrs[name] || null; },
        querySelector(selector) { return selectors[selector]?.[0] || null; },
        querySelectorAll(selector) { return selectors[selector] || []; },
        closest() { return null; },
    };
}

test("capture returns a CaptureDocumentV1 for a visible tweet", () => {
    global.getTwitterArticleCardTranslationTarget = () => null;
    const status = node({ attrs: { href: "/alice/status/123", tagName: "A" } });
    const name = node({ selectors: { span: [node({ text: "Alice" }), node({ text: "@alice" })] } });
    const tweetText = node({ text: "hello from the DOM" });
    const time = node({ attrs: { datetime: "2026-07-10T12:00:00.000Z" } });
    const quoteStatus = node({ attrs: { href: "/bob/status/456", tagName: "A" } });
    const quote = node({ selectors: {
        '[data-testid="tweetText"]': [node({ text: "quoted DOM text" })],
        'a[href*="/status/"]': [quoteStatus],
        '[data-testid="tweetPhoto"] img, img': [],
    } });
    const article = node({
        attrs: { tagName: "ARTICLE" },
        selectors: {
            'a[href*="/status/"]': [status],
            '[data-testid="User-Name"]': [name],
            '[data-testid="tweetText"]': [tweetText],
            'div[lang]': [],
            'div[dir="auto"]': [],
            time: [time],
            '[data-testid="tweetPhoto"] img': [],
            '[data-testid="videoComponent"] video, [data-testid="videoPlayer"] video': [],
            '[data-testid*="card"] img, [data-testid*="Card"] img': [],
            img: [],
            '[data-testid="simpleTweet"]': [quote],
            'a[href*="/article/"]': [],
            a: [],
        },
    });
    status.closest = () => article;
    const threadReply = node({ selectors: {
        '[data-testid="User-Name"]': [node({ selectors: { span: [node({ text: "Alice" }), node({ text: "@alice" })] } })],
        '[data-testid="tweetText"]': [node({ text: "@bob thread continuation" })],
        'div[lang]': [], 'div[dir="auto"]': [],
        '[data-testid="tweetPhoto"] img': [],
        '[data-testid="videoComponent"] video, [data-testid="videoPlayer"] video': [],
        '[data-testid*="card"] img, [data-testid*="Card"] img': [], img: [],
    } });
    const document = node({
        selectors: {
            "article, [role='article']": [article, threadReply],
            'article, [role="article"]': [article, threadReply],
            '[role="dialog"], [aria-modal="true"], div': [],
        },
    });
    document.documentElement = { innerHTML: "" };

    const result = capture({
        document,
        location: { origin: "https://x.com", href: "https://x.com/alice/status/123", pathname: "/alice/status/123" },
        trigger: article,
        capturedAt: "2026-07-11T00:00:00.000Z",
        graphqlOperationIds: { TweetDetail: "operation-id" },
    });

    assert.equal(result.schema_version, 1);
    assert.deepEqual(result.source, {
        platform: "x",
        url: "https://x.com/alice/status/123",
        canonical_url: "https://x.com/alice/status/123",
        source_id: "123",
        captured_at: "2026-07-11T00:00:00.000Z",
    });
    assert.equal(result.content.type, "thread");
    assert.equal(result.content.text, "hello from the DOM");
    assert.deepEqual(result.content.author, { name: "Alice", handle: "@alice" });
    assert.deepEqual(result.media, []);
    assert.deepEqual(result.relations, {
        quote: { text: "quoted DOM text", images: [], image_alt_texts: {}, videos: [], url: "https://x.com/bob/status/456" },
        thread: [{ text: "thread continuation", images: [] }],
    });
    assert.deepEqual(result.diagnostics.graphql_operation_ids, { TweetDetail: "operation-id" });
});

test("normalize keeps the background legacy payload golden shape", () => {
    const legacy = normalize({
        schema_version: 1,
        source: {
            platform: "x", url: "https://x.com/alice/status/123",
            canonical_url: "https://x.com/alice/status/123", source_id: "123",
            captured_at: "2026-07-11T00:00:00.000Z",
        },
        content: {
            type: "thread", text: "main", published_at: "2026-07-10T12:00:00.000Z",
            author: { name: "Alice", handle: "@alice" },
        },
        media: [{ kind: "image", url: "https://pbs.twimg.com/media/a.jpg?name=orig", alt: "diagram" }],
        relations: { quote: { text: "quote" }, thread: [{ text: "next", images: [] }] },
        preferences: { custom_save_path_name: "Inbox" },
        diagnostics: { graphql_operation_ids: { TweetDetail: "operation-id" } },
    });

    assert.deepEqual(legacy, {
        type: "tweet",
        url: "https://x.com/alice/status/123",
        author: "Alice",
        handle: "@alice",
        text: "main",
        published: "2026-07-10T12:00:00.000Z",
        images: ["https://pbs.twimg.com/media/a.jpg?name=orig"],
        image_alt_texts: { "https://pbs.twimg.com/media/a.jpg?name=orig": "diagram" },
        videos: [],
        quote_tweet: { text: "quote" },
        thread_tweets: [{ text: "next", images: [] }],
        graphql_operation_ids: { TweetDetail: "operation-id" },
        x2md_custom_save_path: { name: "Inbox" },
    });
});

test("adapter exposes only capture and normalize", () => {
    assert.deepEqual(Object.keys(require("../site-adapters/x-capture.js")).sort(), ["capture", "normalize"]);
});
