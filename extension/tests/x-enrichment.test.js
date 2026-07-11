const test = require("node:test");
const assert = require("node:assert/strict");

// The module's runtime-only Chrome dependencies are referenced lazily by enrich modes.
global.mergeTweetImagesWithDomFallback = (api = [], dom = []) => Array.from(new Set([...api, ...dom]));
require("../x-enrichment.js");
const { orchestrateTweetFallback, enrich, formatExpandedUrlMarkdown } = global.X2MDXEnrichment;

test("expanded tweet links use the full URL as label while hiding the protocol", () => {
    assert.equal(
        formatExpandedUrlMarkdown("https://github.com/ai-zixun/humanizer-zh"),
        "[github.com/ai-zixun/humanizer-zh](https://github.com/ai-zixun/humanizer-zh)",
    );
});

test("tweet enrichment uses GraphQL before every fallback", async () => {
    const calls = [];
    const result = await orchestrateTweetFallback({ url: "https://x.com/u/status/42", text: "dom", images: ["dom"] }, {
        graphql: async (id) => { calls.push(`graphql:${id}`); return { text: "api", images: ["api"], poll_data: { options: [] } }; },
        oembed: async () => { calls.push("oembed"); return null; },
    });
    assert.deepEqual(calls, ["graphql:42"]);
    assert.equal(result.source, "graphql");
    assert.equal(result.data.text, "api");
    assert.deepEqual(result.data.images, ["api", "dom"]);
    assert.deepEqual(result.data.poll_data, { options: [] });
});

test("tweet enrichment falls back GraphQL -> oEmbed -> DOM", async () => {
    const calls = [];
    const input = { url: "https://x.com/u/status/42", text: "dom", images: [] };
    const oembed = await orchestrateTweetFallback(input, {
        graphql: async () => { calls.push("graphql"); return null; },
        oembed: async () => { calls.push("oembed"); return { text: "public", images: [] }; },
    });
    assert.deepEqual(calls, ["graphql", "oembed"]);
    assert.equal(oembed.source, "oembed");
    assert.equal(oembed.data.text, "public");

    calls.length = 0;
    const dom = await orchestrateTweetFallback(input, {
        graphql: async (_id, options) => { calls.push("graphql"); options.errorSink.code = "RATE_LIMITED"; options.errorSink.message = "rate limited"; return null; },
        oembed: async () => { calls.push("oembed"); return null; },
    });
    assert.deepEqual(calls, ["graphql", "oembed"]);
    assert.equal(dom.source, "dom");
    assert.equal(dom.data.text, "dom");
    assert.equal(dom.data._x2md_warning_code, "RATE_LIMITED");
});

test("non-status data remains a DOM capture without network calls", async () => {
    const input = { url: "https://x.com/home", text: "dom" };
    const result = await orchestrateTweetFallback(input, {
        graphql: async () => assert.fail("unexpected GraphQL"),
        oembed: async () => assert.fail("unexpected oEmbed"),
    });
    assert.equal(result.source, "dom");
    assert.equal(result.data, input);
});

test("unknown enrich modes fail with a stable programming error", async () => {
    await assert.rejects(() => enrich("missing", {}), /Unknown X enrichment kind: missing/);
});
