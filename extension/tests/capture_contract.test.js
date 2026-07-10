const assert = require("node:assert/strict");
const test = require("node:test");

const { canonicalizeCaptureUrl, normalizeCaptureDocumentV1 } = require("../capture_contract.js");

test("canonicalizeCaptureUrl normalizes X URLs and removes tracking", () => {
    assert.equal(
        canonicalizeCaptureUrl("https://twitter.com/example/status/123?utm_source=test&s=20#detail"),
        "https://x.com/example/status/123",
    );
    assert.equal(canonicalizeCaptureUrl("https://example.com/post?id=7&utm_medium=social#top"), "https://example.com/post?id=7");
});

test("normalizeCaptureDocumentV1 creates a whitelist copy and derives source id", () => {
    const input = {
        schema_version: 1,
        source: { platform: "x", url: "https://twitter.com/a/status/42?s=20", captured_at: "2026-07-11T00:00:00.000Z", cookie: "secret" },
        content: { type: "tweet", text: " hello ", extra: "drop" },
        media: [{ kind: "image", url: "https://pbs.twimg.com/media/example.jpg", alt: " alt ", token: "drop" }],
        preferences: { duplicate_policy: "skip", download_images: true, cookie: "drop" },
        authorization: "drop",
    };
    const normalized = normalizeCaptureDocumentV1(input);
    assert.equal(normalized.source.canonical_url, "https://x.com/a/status/42");
    assert.equal(normalized.source.source_id, "42");
    assert.equal(normalized.content.text, "hello");
    assert.equal(normalized.authorization, undefined);
    assert.equal(normalized.source.cookie, undefined);
    assert.equal(normalized.media[0].token, undefined);
    assert.notEqual(normalized, input);
});

test("normalizeCaptureDocumentV1 rejects malformed or unversioned input", () => {
    for (const input of [{}, { schema_version: 2 }, { schema_version: 1, source: {}, content: {}, media: [] }]) {
        assert.throws(() => normalizeCaptureDocumentV1(input), (error) => error.code === "INVALID_CAPTURE");
    }
});
