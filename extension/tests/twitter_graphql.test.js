const test = require("node:test");
const assert = require("node:assert/strict");

const {
    TWEET_DETAIL_OPERATION_IDS,
    TWEET_RESULT_OPERATION_IDS,
    buildGraphQLRequestPlans,
    extractGraphQLOperationIdsFromUrls,
    extractGraphQLOperationIdsFromScriptText,
    extractScriptUrlsFromHtml,
    extractTimelineTweets,
    extractMainTweetResult,
} = require("../twitter_graphql.js");

test("buildGraphQLRequestPlans prioritizes current TweetDetail candidate before legacy hash", () => {
    const plans = buildGraphQLRequestPlans("2033535580496101790");

    assert.equal(plans[0].operationName, "TweetDetail");
    assert.equal(plans[0].operationId, TWEET_DETAIL_OPERATION_IDS[0]);
    assert.equal(plans[1].operationId, TWEET_DETAIL_OPERATION_IDS[1]);
    assert.equal(plans.at(-1).operationId, TWEET_RESULT_OPERATION_IDS[0]);
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
