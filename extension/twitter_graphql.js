(function (globalScope) {
    const TWEET_DETAIL_OPERATION_IDS = [
        "xIYgDwjboktoFeXe_fgacw",
        "nBS-WpgA6ZG0CyNHD517JQ",
    ];

    const TWEET_RESULT_OPERATION_IDS = [
        "zy39CwTyYhU-_0LP7dljjg",
    ];

    function normalizeOperationIdList(ids) {
        const source = Array.isArray(ids) ? ids : [];
        return Array.from(new Set(source.filter((id) => typeof id === "string" && id.trim() !== "")));
    }

    function mergeOperationIds(discoveredIds, fallbackIds) {
        return normalizeOperationIdList([
            ...(Array.isArray(discoveredIds) ? discoveredIds : []),
            ...(Array.isArray(fallbackIds) ? fallbackIds : []),
        ]);
    }

    function extractGraphQLOperationIdsFromUrls(urls) {
        const discovered = {
            TweetDetail: [],
            TweetResultByRestId: [],
        };

        for (const url of Array.isArray(urls) ? urls : []) {
            if (typeof url !== "string") continue;
            const match = url.match(/\/i\/api\/graphql\/([A-Za-z0-9_-]+)\/(TweetDetail|TweetResultByRestId)(?:\?|$)/);
            if (!match) continue;

            const [, operationId, operationName] = match;
            discovered[operationName].push(operationId);
        }

        return {
            TweetDetail: normalizeOperationIdList(discovered.TweetDetail),
            TweetResultByRestId: normalizeOperationIdList(discovered.TweetResultByRestId),
        };
    }

    function extractGraphQLOperationIdsFromScriptText(text) {
        const discovered = {
            TweetDetail: [],
            TweetResultByRestId: [],
        };

        if (typeof text !== "string" || text.length === 0) {
            return discovered;
        }

        const matches = text.matchAll(/queryId:"([A-Za-z0-9_-]+)",operationName:"(TweetDetail|TweetResultByRestId)"/g);
        for (const match of matches) {
            const [, operationId, operationName] = match;
            discovered[operationName].push(operationId);
        }

        return {
            TweetDetail: normalizeOperationIdList(discovered.TweetDetail),
            TweetResultByRestId: normalizeOperationIdList(discovered.TweetResultByRestId),
        };
    }

    function extractScriptUrlsFromHtml(html, baseUrl = "https://x.com/") {
        if (typeof html !== "string" || html.length === 0) return [];

        const base = new URL(baseUrl, "https://x.com/");
        const urls = [];
        const matches = html.matchAll(/<script[^>]+src="([^"]+)"[^>]*><\/script>/g);
        for (const match of matches) {
            try {
                urls.push(new URL(match[1], base).href);
            } catch (error) { }
        }

        return Array.from(new Set(urls.filter(function (u) { return typeof u === "string" && u.trim() !== ""; })));
    }

    function buildTweetDetailVariables(tweetId) {
        return {
            focalTweetId: tweetId,
            referrer: "home",
            count: 20,
            includePromotedContent: false,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: false,
            withBirdwatchNotes: false,
            withVoice: false,
        };
    }

    function buildTweetDetailFeatures() {
        return {
            rweb_tipjar_consumption_enabled: true,
            responsive_web_graphql_exclude_directive_enabled: true,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            creator_subscriptions_quote_tweet_preview_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            rweb_video_timestamps_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: true,
            responsive_web_enhance_cards_enabled: false,
        };
    }

    function buildTweetDetailFieldToggles() {
        return {
            withArticleRichContentState: true,
            withArticlePlainText: false,
            withArticleSummaryText: true,
            withArticleVoiceOver: true,
            withGrokAnalyze: false,
            withDisallowedReplyControls: false,
        };
    }

    function buildTweetResultVariables(tweetId) {
        return {
            tweetId,
            includePromotedContent: true,
            withBirdwatchNotes: true,
            withVoice: true,
            withCommunity: true,
        };
    }

    function buildTweetResultFeatures() {
        return {
            creator_subscriptions_tweet_preview_api_enabled: true,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            tweet_awards_web_tipping_enabled: false,
            content_disclosure_indicator_enabled: true,
            content_disclosure_ai_generated_indicator_enabled: true,
            responsive_web_grok_show_grok_translated_post: false,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: false,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: false,
            verified_phone_label_enabled: false,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_grok_community_note_auto_translation_is_enabled: false,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_enhance_cards_enabled: false,
        };
    }

    function buildTweetResultFieldToggles() {
        return {
            withArticleRichContentState: true,
            withArticlePlainText: false,
            withArticleSummaryText: true,
            withArticleVoiceOver: true,
        };
    }

    function buildGraphQLRequestPlans(tweetId, options = {}) {
        const plans = [];
        const discoveredOperationIds = options.discoveredOperationIds || {};
        const tweetDetailIds = mergeOperationIds(discoveredOperationIds.TweetDetail, TWEET_DETAIL_OPERATION_IDS);
        const tweetResultIds = mergeOperationIds(discoveredOperationIds.TweetResultByRestId, TWEET_RESULT_OPERATION_IDS);

        for (const operationId of tweetDetailIds) {
            plans.push({
                kind: "TweetDetail",
                operationId,
                operationName: "TweetDetail",
                variables: buildTweetDetailVariables(tweetId),
                features: buildTweetDetailFeatures(),
                fieldToggles: buildTweetDetailFieldToggles(),
            });
        }

        for (const operationId of tweetResultIds) {
            plans.push({
                kind: "TweetResultByRestId",
                operationId,
                operationName: "TweetResultByRestId",
                variables: buildTweetResultVariables(tweetId),
                features: buildTweetResultFeatures(),
                fieldToggles: buildTweetResultFieldToggles(),
            });
        }

        return plans;
    }

    function buildGraphQLUrl(plan) {
        const params = new URLSearchParams();
        params.set("variables", JSON.stringify(plan.variables));
        params.set("features", JSON.stringify(plan.features));
        if (plan.fieldToggles && Object.keys(plan.fieldToggles).length > 0) {
            params.set("fieldToggles", JSON.stringify(plan.fieldToggles));
        }
        return `https://x.com/i/api/graphql/${plan.operationId}/${plan.operationName}?${params.toString()}`;
    }

    function matchesTweetId(result, tweetId) {
        if (!result || !tweetId) return false;
        return (result.rest_id || result.tweet?.rest_id) === tweetId ||
            result.legacy?.id_str === tweetId ||
            result.tweet?.legacy?.id_str === tweetId;
    }

    function extractTimelineTweets(json) {
        const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions || [];
        const tweets = [];

        for (const instruction of instructions) {
            if (instruction?.type !== "TimelineAddEntries") continue;
            for (const entry of instruction.entries || []) {
                if (entry?.entryId?.startsWith("tweet-")) {
                    const result = entry?.content?.itemContent?.tweet_results?.result;
                    if (result) tweets.push(result);
                    continue;
                }

                if (entry?.entryId?.startsWith("conversationthread-")) {
                    for (const item of entry?.content?.items || []) {
                        const result = item?.item?.itemContent?.tweet_results?.result;
                        if (result) tweets.push(result);
                    }
                }
            }
        }

        return tweets;
    }

    function extractMainTweetResult(json, tweetId) {
        const directResult = json?.data?.tweetResult?.result;
        if (matchesTweetId(directResult, tweetId)) {
            return directResult;
        }

        const timelineTweets = extractTimelineTweets(json);
        return timelineTweets.find((result) => matchesTweetId(result, tweetId)) || null;
    }

    const exported = {
        TWEET_DETAIL_OPERATION_IDS,
        TWEET_RESULT_OPERATION_IDS,
        buildGraphQLRequestPlans,
        buildGraphQLUrl,
        extractGraphQLOperationIdsFromUrls,
        extractGraphQLOperationIdsFromScriptText,
        extractScriptUrlsFromHtml,
        extractTimelineTweets,
        extractMainTweetResult,
        mergeOperationIds,
        matchesTweetId,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
