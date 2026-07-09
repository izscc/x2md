const test = require("node:test");
const assert = require("node:assert/strict");

const {
    TWEET_DETAIL_OPERATION_IDS,
    TWEET_RESULT_OPERATION_IDS,
    GRAPHQL_OPS_STORAGE_KEY,
    buildGraphQLRequestPlans,
    extractGraphQLOperationIdsFromUrls,
    extractGraphQLOperationIdsFromScriptText,
    extractScriptUrlsFromHtml,
    extractTimelineTweets,
    extractMainTweetResult,
    extractPollFromTweetResult,
    extractCommunityNotesFromTweetResult,
    extractLinkCardFromTweetResult,
    normalizeGraphQLOperationCache,
    hasGraphQLOperationCache,
    classifyGraphQLHttpStatus,
    graphQLErrorMessage,
    getGraphQLRetryDelayMs,
} = require("../twitter_graphql.js");

test("buildGraphQLRequestPlans prioritizes current TweetDetail candidate before legacy hash", () => {
    const plans = buildGraphQLRequestPlans("2033535580496101790");

    assert.equal(plans[0].operationName, "TweetDetail");
    assert.equal(plans[0].operationId, TWEET_DETAIL_OPERATION_IDS[0]);
    assert.equal(plans[1].operationId, TWEET_DETAIL_OPERATION_IDS[1]);

    const tweetResultPlans = plans.filter((plan) => plan.operationName === "TweetResultByRestId");
    assert.deepEqual(
        tweetResultPlans.map((plan) => plan.operationId),
        TWEET_RESULT_OPERATION_IDS,
    );
});

test("extractGraphQLOperationIdsFromUrls discovers current operation ids from resource URLs", () => {
    const discovered = extractGraphQLOperationIdsFromUrls([
        "https://x.com/i/api/graphql/xIYgDwjboktoFeXe_fgacw/TweetDetail?variables=...",
        "https://x.com/i/api/graphql/zy39CwTyYhU-_0LP7dljjg/TweetResultByRestId?variables=...",
        "https://x.com/i/api/graphql/pb8he8eISwQOfD8f06WFCQ/ExploreSidebar?variables=...",
        "https://abs.twimg.com/responsive-web/client-web/main.123.js",
    ]);

    assert.deepEqual(discovered, {
        TweetDetail: ["xIYgDwjboktoFeXe_fgacw"],
        TweetResultByRestId: ["zy39CwTyYhU-_0LP7dljjg"],
    });
});

test("buildGraphQLRequestPlans puts discovered ids ahead of static fallbacks without duplicates", () => {
    const plans = buildGraphQLRequestPlans("2033535580496101790", {
        discoveredOperationIds: {
            TweetDetail: ["LIVE_TWEET_DETAIL", TWEET_DETAIL_OPERATION_IDS[0]],
            TweetResultByRestId: ["LIVE_TWEET_RESULT", TWEET_RESULT_OPERATION_IDS[0]],
        },
    });

    const tweetDetailPlans = plans.filter((plan) => plan.operationName === "TweetDetail");
    const tweetResultPlans = plans.filter((plan) => plan.operationName === "TweetResultByRestId");

    assert.deepEqual(
        tweetDetailPlans.map((plan) => plan.operationId),
        ["LIVE_TWEET_DETAIL", ...TWEET_DETAIL_OPERATION_IDS],
    );
    assert.deepEqual(
        tweetResultPlans.map((plan) => plan.operationId),
        ["LIVE_TWEET_RESULT", ...TWEET_RESULT_OPERATION_IDS],
    );
});

test("extractGraphQLOperationIdsFromScriptText reads queryId/operationName pairs from bundle text", () => {
    const discovered = extractGraphQLOperationIdsFromScriptText(`
        e.exports={queryId:"xIYgDwjboktoFeXe_fgacw",operationName:"TweetDetail",operationType:"query"};
        e.exports={queryId:"zy39CwTyYhU-_0LP7dljjg",operationName:"TweetResultByRestId",operationType:"query"};
        e.exports={queryId:"ignored",operationName:"ExploreSidebar",operationType:"query"};
    `);

    assert.deepEqual(discovered, {
        TweetDetail: ["xIYgDwjboktoFeXe_fgacw"],
        TweetResultByRestId: ["zy39CwTyYhU-_0LP7dljjg"],
    });
});

test("extractScriptUrlsFromHtml returns unique script sources in document order", () => {
    const urls = extractScriptUrlsFromHtml(`
        <html>
          <head>
            <script src="https://abs.twimg.com/responsive-web/client-web/vendor.aaa.js"></script>
            <script src="https://abs.twimg.com/responsive-web/client-web/main.bbb.js"></script>
            <script src="https://abs.twimg.com/responsive-web/client-web/main.bbb.js"></script>
          </head>
        </html>
    `, "https://x.com/rubenhassid/status/2033535580496101790");

    assert.deepEqual(urls, [
        "https://abs.twimg.com/responsive-web/client-web/vendor.aaa.js",
        "https://abs.twimg.com/responsive-web/client-web/main.bbb.js",
    ]);
});

test("extractTimelineTweets reads TweetDetail timeline entries", () => {
    const tweetA = { rest_id: "111", legacy: { id_str: "111", full_text: "A" } };
    const tweetB = { rest_id: "222", legacy: { id_str: "222", full_text: "B" } };
    const tweetC = { rest_id: "333", legacy: { id_str: "333", full_text: "C" } };
    const json = {
        data: {
            threaded_conversation_with_injections_v2: {
                instructions: [
                    {
                        type: "TimelineAddEntries",
                        entries: [
                            {
                                entryId: "tweet-111",
                                content: { itemContent: { tweet_results: { result: tweetA } } },
                            },
                            {
                                entryId: "conversationthread-222",
                                content: {
                                    items: [
                                        { item: { itemContent: { tweet_results: { result: tweetB } } } },
                                        { item: { itemContent: { tweet_results: { result: tweetC } } } },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
        },
    };

    assert.deepEqual(extractTimelineTweets(json), [tweetA, tweetB, tweetC]);
});

test("extractMainTweetResult supports both TweetDetail and TweetResultByRestId shapes", () => {
    const tweetId = "2033535580496101790";
    const direct = { rest_id: tweetId, legacy: { id_str: tweetId, full_text: "direct" } };
    const detail = {
        data: {
            threaded_conversation_with_injections_v2: {
                instructions: [
                    {
                        type: "TimelineAddEntries",
                        entries: [
                            {
                                entryId: "tweet-1",
                                content: { itemContent: { tweet_results: { result: direct } } },
                            },
                        ],
                    },
                ],
            },
        },
    };
    const byRestId = {
        data: {
            tweetResult: {
                result: direct,
            },
        },
    };

    assert.equal(extractMainTweetResult(detail, tweetId), direct);
    assert.equal(extractMainTweetResult(byRestId, tweetId), direct);
});


test("normalizeGraphQLOperationCache keeps unique operation ids with timestamp", () => {
    const normalized = normalizeGraphQLOperationCache({
        TweetDetail: ["LIVE", "LIVE", ""],
        TweetResultByRestId: ["RESULT"],
    }, 12345);

    assert.equal(GRAPHQL_OPS_STORAGE_KEY, "graphql_ops_v1");
    assert.deepEqual(normalized, {
        TweetDetail: ["LIVE"],
        TweetResultByRestId: ["RESULT"],
        updated_at: 12345,
    });
    assert.equal(hasGraphQLOperationCache(normalized), true);
    assert.equal(hasGraphQLOperationCache({ TweetDetail: [], TweetResultByRestId: [] }), false);
});

test("classifyGraphQLHttpStatus maps user-facing error codes", () => {
    assert.equal(classifyGraphQLHttpStatus(401), "AUTH_REQUIRED");
    assert.equal(classifyGraphQLHttpStatus(403), "AUTH_REQUIRED");
    assert.equal(classifyGraphQLHttpStatus(404), "NOT_FOUND");
    assert.equal(classifyGraphQLHttpStatus(429), "RATE_LIMITED");
    assert.equal(classifyGraphQLHttpStatus(503), "X_UPSTREAM_ERROR");
    assert.equal(classifyGraphQLHttpStatus(400), "GRAPHQL_HTTP_ERROR");
});


test("GraphQL error codes have user-facing messages", () => {
    assert.equal(graphQLErrorMessage("AUTH_REQUIRED"), "需要登录 X 后重试");
    assert.equal(graphQLErrorMessage("RATE_LIMITED"), "X 接口繁忙，请稍后再试");
});

test("getGraphQLRetryDelayMs respects rate-limit reset with bounded fallback", () => {
    const response = { headers: { get: (name) => name === "x-rate-limit-reset" ? "11" : "" } };
    assert.equal(getGraphQLRetryDelayMs(response, 0, 10000), 1000);
    assert.equal(getGraphQLRetryDelayMs({ headers: { get: () => "" } }, 2, 10000), 4000);
});


test("extractPollFromTweetResult reads poll card binding values", () => {
    const poll = extractPollFromTweetResult({
        card: {
            legacy: {
                binding_values: [
                    { key: "choice1_label", value: { string_value: "选项 A" } },
                    { key: "choice1_count", value: { string_value: "120" } },
                    { key: "choice1_percentage", value: { string_value: "42" } },
                    { key: "choice2_label", value: { string_value: "选项 B" } },
                    { key: "choice2_count", value: { string_value: "166" } },
                    { key: "choice2_percentage", value: { string_value: "58" } },
                    { key: "end_datetime_utc", value: { string_value: "2026-07-10 12:00 UTC" } },
                ],
            },
        },
    });

    assert.deepEqual(poll, {
        options: [
            { label: "选项 A", votes: 120, percent: 42 },
            { label: "选项 B", votes: 166, percent: 58 },
        ],
        total_votes: 286,
        end: "2026-07-10 12:00 UTC",
    });
});


test("extractCommunityNotesFromTweetResult reads birdwatch notes", () => {
    const notes = extractCommunityNotesFromTweetResult({
        birdwatch_notes: [
            { text: "低相关", source_url: "https://example.com/low", helpfulness_score: 1 },
            { text: "这是社群笔记", source_url: "https://example.com/high", helpfulness_score: 9 },
        ],
    });

    assert.deepEqual(notes, [
        { text: "这是社群笔记", source: "https://example.com/high" },
        { text: "低相关", source: "https://example.com/low" },
    ]);
});


test("extractLinkCardFromTweetResult reads card metadata", () => {
    const card = extractLinkCardFromTweetResult({
        card: {
            legacy: {
                binding_values: [
                    { key: "title", value: { string_value: "链接标题" } },
                    { key: "description", value: { string_value: "链接摘要" } },
                    { key: "card_url", value: { string_value: "https://example.com/post" } },
                    { key: "thumbnail_image_original", value: { string_value: "https://example.com/card.jpg" } },
                ],
            },
        },
    });

    assert.deepEqual(card, {
        title: "链接标题",
        description: "链接摘要",
        domain: "example.com",
        url: "https://example.com/post",
        image: "https://example.com/card.jpg",
    });
});
