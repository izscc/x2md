(function (globalScope) {
    const TWEET_DETAIL_OPERATION_IDS = [
        "jd3V43oDY9cY7obs1YMfbQ",
        "xIYgDwjboktoFeXe_fgacw",
        "nBS-WpgA6ZG0CyNHD517JQ",
    ];

    const TWEET_RESULT_OPERATION_IDS = [
        "-4_LMahNlI4MuLJ-EAFEog",
        "zy39CwTyYhU-_0LP7dljjg",
    ];

    const GRAPHQL_OPS_STORAGE_KEY = "graphql_ops_v1";

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


    function normalizeGraphQLOperationCache(value, now = Date.now()) {
        const source = value && typeof value === "object" ? value : {};
        const normalized = {
            TweetDetail: normalizeOperationIdList(source.TweetDetail),
            TweetResultByRestId: normalizeOperationIdList(source.TweetResultByRestId),
        };
        if (Number.isFinite(source.updated_at)) {
            normalized.updated_at = source.updated_at;
        } else if (normalized.TweetDetail.length || normalized.TweetResultByRestId.length) {
            normalized.updated_at = now;
        }
        return normalized;
    }

    function hasGraphQLOperationCache(value) {
        const normalized = normalizeGraphQLOperationCache(value);
        return normalized.TweetDetail.length > 0 || normalized.TweetResultByRestId.length > 0;
    }

    function classifyGraphQLHttpStatus(status) {
        if (status === 401 || status === 403) return "AUTH_REQUIRED";
        if (status === 404) return "NOT_FOUND";
        if (status === 429) return "RATE_LIMITED";
        if (status >= 500) return "X_UPSTREAM_ERROR";
        return "GRAPHQL_HTTP_ERROR";
    }

    function graphQLErrorMessage(code) {
        const messages = {
            AUTH_REQUIRED: "需要登录 X 后重试",
            RATE_LIMITED: "X 接口繁忙，请稍后再试",
            NOT_FOUND: "推文不存在或已删除",
            RESTRICTED: "内容受限，无法获取完整数据",
            ARTICLE_RENDER_TIMEOUT: "长文未加载完成，请打开文章页后再保存",
            SERVER_OFFLINE: "本机 X2MD 服务未启动",
            PATH_DENIED: "保存路径不可写",
            X_UPSTREAM_ERROR: "X 接口暂时不可用",
            GRAPHQL_HTTP_ERROR: "X 接口请求失败",
        };
        return messages[code] || messages.GRAPHQL_HTTP_ERROR;
    }

    function getGraphQLRetryDelayMs(resp, attempt, now = Date.now()) {
        const resetHeader = resp?.headers?.get?.("x-rate-limit-reset");
        const resetSeconds = Number(resetHeader);
        if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
            const resetDelay = resetSeconds * 1000 - now;
            if (resetDelay > 0) return Math.min(resetDelay, 30000);
        }
        const safeAttempt = Math.max(0, Number(attempt) || 0);
        return Math.min(1000 * 2 ** safeAttempt, 8000);
    }

    function cardValueToString(value) {
        if (value == null) return "";
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
        if (typeof value !== "object") return "";
        return String(
            value.string_value ??
            value.boolean_value ??
            value.scribe_key ??
            value.image_value?.url ??
            value.player_value?.url ??
            ""
        );
    }

    function readCardBindingMap(card) {
        const map = {};
        const values = card?.legacy?.binding_values || card?.binding_values || card?.bindingValues || [];
        if (Array.isArray(values)) {
            for (const item of values) {
                const key = String(item?.key || item?.name || "");
                if (!key) continue;
                map[key] = cardValueToString(item?.value ?? item);
            }
        } else if (values && typeof values === "object") {
            for (const [key, value] of Object.entries(values)) map[key] = cardValueToString(value);
        }
        return map;
    }

    function firstCardValue(map, keys) {
        for (const key of keys) {
            const value = map[key];
            if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
        }
        return "";
    }

    function numberFromCardValue(value) {
        const text = String(value || "").replace(/,/g, "").trim();
        if (!text) return undefined;
        const match = text.match(/-?\d+(?:\.\d+)?/);
        if (!match) return undefined;
        const num = Number(match[0]);
        return Number.isFinite(num) ? num : undefined;
    }

    function extractPollFromTweetResult(result) {
        const tweet = result?.tweet || result;
        const card = tweet?.card || tweet?.legacy?.card || result?.card || result?.legacy?.card;
        const map = readCardBindingMap(card);
        const options = [];
        for (let index = 1; index <= 4; index += 1) {
            const label = firstCardValue(map, [
                `choice${index}_label`, `choice${index}_text`, `poll${index}label`, `poll${index}_label`, `option${index}_label`,
            ]);
            if (!label) continue;
            const votes = numberFromCardValue(firstCardValue(map, [
                `choice${index}_count`, `choice${index}_votes`, `poll${index}count`, `poll${index}_count`, `option${index}_count`,
            ]));
            const percent = numberFromCardValue(firstCardValue(map, [
                `choice${index}_percentage`, `choice${index}_percent`, `poll${index}percent`, `poll${index}_percent`, `option${index}_percent`,
            ]));
            options.push({ label, votes, percent });
        }
        if (options.length < 2) return null;
        const totalVotes = numberFromCardValue(firstCardValue(map, ["counts_are_final_total", "total_votes", "vote_count", "count"]));
        const inferredTotal = options.reduce((sum, option) => sum + (Number.isFinite(option.votes) ? option.votes : 0), 0);
        const end = firstCardValue(map, ["end_datetime_utc", "end_time", "poll_end", "endDateTime"]);
        return {
            options,
            total_votes: totalVotes || inferredTotal || undefined,
            end: end || undefined,
        };
    }

    function normalizeCommunityNote(note) {
        if (!note || typeof note !== "object") return null;
        const text = String(
            note.text ??
            note.summary ??
            note.body ??
            note.note_text ??
            note.data_v1?.summary ??
            ""
        ).trim();
        if (!text) return null;
        const source = String(
            note.source_url ??
            note.source ??
            note.url ??
            note.data_v1?.source_url ??
            ""
        ).trim();
        const helpfulness = Number(note.helpfulness_score ?? note.rating ?? note.score ?? 0);
        return { text, source: source || undefined, helpfulness: Number.isFinite(helpfulness) ? helpfulness : 0 };
    }

    function extractCommunityNotesFromTweetResult(result) {
        const tweet = result?.tweet || result;
        const candidates = [
            tweet?.birdwatch_pivot?.note,
            tweet?.birdwatch_pivot,
            tweet?.birdwatch_note,
            tweet?.community_note,
            ...(Array.isArray(tweet?.birdwatch_notes) ? tweet.birdwatch_notes : []),
            ...(Array.isArray(tweet?.community_notes) ? tweet.community_notes : []),
        ];
        const notes = candidates.map(normalizeCommunityNote).filter(Boolean);
        notes.sort((left, right) => (right.helpfulness || 0) - (left.helpfulness || 0));
        return notes.map(({ text, source }) => ({ text, source }));
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

        const patterns = [
            /queryId:[`"]([A-Za-z0-9_-]+)[`"],operationName:[`"](TweetDetail|TweetResultByRestId)[`"]/g,
            /params:\{id:[`"]([A-Za-z0-9_-]+)[`"].+?name:[`"](TweetDetail|TweetResultByRestId)[`"].+?operationKind:[`"]/g,
        ];

        for (const pattern of patterns) {
            const matches = text.matchAll(pattern);
            for (const match of matches) {
                const [, operationId, operationName] = match;
                discovered[operationName].push(operationId);
            }
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

        return normalizeOperationIdList(urls);
    }

    function buildTweetDetailVariables(tweetId) {
        return {
            focalTweetId: tweetId,
            with_rux_injections: false,
            rankingMode: "Relevance",
            includePromotedContent: true,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: true,
            withBirdwatchNotes: true,
            withVoice: true,
        };
    }

    function buildTweetDetailFeatures() {
        return {
            rweb_video_screen_enabled: false,
            rweb_cashtags_enabled: true,
            profile_label_improvements_pcf_label_in_post_enabled: true,
            responsive_web_profile_redirect_enabled: false,
            rweb_tipjar_consumption_enabled: false,
            verified_phone_label_enabled: false,
            creator_subscriptions_tweet_preview_api_enabled: true,
            responsive_web_graphql_timeline_navigation_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            premium_content_api_read_enabled: false,
            communities_web_enable_tweet_community_results_fetch: true,
            c9s_tweet_anatomy_moderator_badge_enabled: true,
            responsive_web_grok_analyze_button_fetch_trends_enabled: false,
            responsive_web_grok_analyze_post_followups_enabled: true,
            rweb_cashtags_composer_attachment_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            rweb_conversational_replies_downvote_enabled: false,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            content_disclosure_indicator_enabled: true,
            content_disclosure_ai_generated_indicator_enabled: true,
            responsive_web_grok_show_grok_translated_post: true,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: false,
            freedom_of_speech_not_reach_fetch_enabled: true,
            standardized_nudges_misinfo: true,
            tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
            longform_notetweets_rich_text_read_enabled: true,
            longform_notetweets_inline_media_enabled: false,
            responsive_web_grok_image_annotation_enabled: true,
            responsive_web_grok_imagine_annotation_enabled: true,
            responsive_web_grok_community_note_auto_translation_is_enabled: true,
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
            rweb_cashtags_composer_attachment_enabled: true,
            responsive_web_jetfuel_frame: true,
            responsive_web_grok_share_attachment_enabled: true,
            responsive_web_grok_annotations_enabled: true,
            articles_preview_enabled: true,
            responsive_web_edit_tweet_api_enabled: true,
            rweb_conversational_replies_downvote_enabled: false,
            graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
            view_counts_everywhere_api_enabled: true,
            longform_notetweets_consumption_enabled: true,
            responsive_web_twitter_article_tweet_consumption_enabled: true,
            content_disclosure_indicator_enabled: true,
            content_disclosure_ai_generated_indicator_enabled: true,
            responsive_web_grok_show_grok_translated_post: true,
            responsive_web_grok_analysis_button_from_backend: true,
            post_ctas_fetch_enabled: false,
            rweb_cashtags_enabled: true,
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
            responsive_web_grok_community_note_auto_translation_is_enabled: true,
            responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
            responsive_web_graphql_timeline_navigation_enabled: true,
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
        GRAPHQL_OPS_STORAGE_KEY,
        buildGraphQLRequestPlans,
        buildGraphQLUrl,
        extractGraphQLOperationIdsFromUrls,
        extractGraphQLOperationIdsFromScriptText,
        extractScriptUrlsFromHtml,
        extractTimelineTweets,
        extractMainTweetResult,
        extractPollFromTweetResult,
        extractCommunityNotesFromTweetResult,
        mergeOperationIds,
        normalizeGraphQLOperationCache,
        hasGraphQLOperationCache,
        classifyGraphQLHttpStatus,
        graphQLErrorMessage,
        getGraphQLRetryDelayMs,
        matchesTweetId,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
