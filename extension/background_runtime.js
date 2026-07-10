(function (root) {
    "use strict";

    function start() {
        const localClient = X2MDLocalClient.createLocalClient();
        const xEnrichment = X2MDXEnrichment;
        const TWITTER_BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
        const PLAIN_TEXT_TRANSLATE_CHUNK_SIZE = 2600;
        const USER_BY_SCREEN_NAME_OPERATION_IDS = ["2qvSHpkWTMS9i0zJAwDNiA"];
        const USER_TWEETS_OPERATION_IDS = ["hr4gzZONlq23okjU8fIe_A"];
        const USER_ARTICLES_TWEETS_OPERATION_IDS = ["tC8Mkunj-1cqFwXmw0DQRg"];

        // ─────────────────────────────────────────────
        // 获取 Twitter Note 文章内容（通过后台 Tab 渲染提取）
        // 1. 后台静默打开 /article/ 页面
        // 2. 等待 twitterArticleRichTextView 渲染
        // 3. executeScript 提取完整内容
        // 4. 关闭 tab
        // ─────────────────────────────────────────────
        async function getCookieValue(name) {
            const cookies = await chrome.cookies.getAll({ domain: ".x.com", name });
            if (cookies.length) return cookies[0].value;
            const fallback = await chrome.cookies.getAll({ domain: ".twitter.com", name });
            return fallback.length ? fallback[0].value : null;
        }

        async function fetchGrokTranslation(tweetId) {
            const id = String(tweetId || "").match(/\d+/)?.[0] || "";
            if (!id) {
                throw new Error("missing tweet id");
            }

            const csrfToken = await getCookieValue("ct0");
            if (!csrfToken) {
                throw new Error("missing ct0 cookie");
            }

            const resp = await fetch("https://api.x.com/2/grok/translation.json", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Authorization": `Bearer ${TWITTER_BEARER_TOKEN}`,
                    "X-Csrf-Token": csrfToken,
                    "Content-Type": "text/plain;charset=UTF-8",
                    "x-twitter-active-user": "yes",
                    "x-twitter-client-language": "zh-cn",
                },
                body: JSON.stringify({
                    content_type: "POST",
                    id,
                    dst_lang: "zh",
                }),
            });

            if (!resp.ok) {
                throw new Error(`grok translation failed: ${resp.status}`);
            }

            const json = await resp.json();
            const translatedText = String(json?.result?.text || "").trim();
            if (!translatedText) {
                throw new Error("empty translation");
            }

            return {
                translatedText,
                tweetId: id,
                contentType: json?.result?.content_type || "POST",
            };
        }

        function splitTextForTranslation(text, maxLen = PLAIN_TEXT_TRANSLATE_CHUNK_SIZE) {
            const source = String(text || "").replace(/\r\n/g, "\n").trim();
            if (!source) return [];

            const chunks = [];
            const paragraphs = source.split(/(\n{2,})/);
            let current = "";

            const pushCurrent = () => {
                const value = current.trim();
                if (value) chunks.push(value);
                current = "";
            };

            for (const part of paragraphs) {
                if (!part) continue;
                if (part.length > maxLen) {
                    pushCurrent();
                    for (let i = 0; i < part.length; i += maxLen) {
                        const slice = part.slice(i, i + maxLen).trim();
                        if (slice) chunks.push(slice);
                    }
                    continue;
                }
                if ((current + part).length > maxLen) {
                    pushCurrent();
                }
                current += part;
            }
            pushCurrent();
            return chunks;
        }

        function parseGoogleTranslateResponse(json) {
            if (!Array.isArray(json?.[0])) return "";
            return json[0]
                .map((segment) => Array.isArray(segment) ? String(segment[0] || "") : "")
                .join("")
                .trim();
        }

        async function translatePlainTextToChinese(text) {
            const chunks = splitTextForTranslation(text);
            if (!chunks.length) {
                throw new Error("empty text");
            }

            const translated = [];
            for (const chunk of chunks) {
                const apiUrl = "https://translate.googleapis.com/translate_a/single"
                    + "?client=gtx&sl=auto&tl=zh-CN&dt=t&q="
                    + encodeURIComponent(chunk);
                const resp = await fetch(apiUrl);
                if (!resp.ok) {
                    throw new Error(`plain text translation failed: ${resp.status}`);
                }
                const json = await resp.json();
                const part = parseGoogleTranslateResponse(json);
                if (!part) {
                    throw new Error("empty plain text translation");
                }
                translated.push(part);
            }

            return translated.join("\n\n").trim();
        }


        function extractArticleUrlFromText(text) {
            const match = String(text || "").match(/https?:\/\/(?:x|twitter)\.com\/(?:i\/article|[^/]+\/article)\/\d+/i);
            return match ? match[0].replace("twitter.com", "x.com") : "";
        }

        function getCustomSavePathEntries(config = {}) {
            const entries = Array.isArray(config.custom_save_paths) ? config.custom_save_paths : [];
            return entries
                .map((entry, index) => ({
                    index,
                    name: String(entry?.name || "").trim(),
                    path: String(entry?.path || "").trim(),
                }))
                .filter((entry) => entry.name && entry.path);
        }

        function applyCustomSavePathSelection(data, config) {
            const selection = data?.x2md_custom_save_path;
            if (!selection) return data;

            const selectedIndex = Number.isInteger(selection.index) ? selection.index : Number(selection.index);
            const selectedName = String(selection.name || "").trim();
            const entries = getCustomSavePathEntries(config);
            const matched = entries.find((entry) => entry.index === selectedIndex && (!selectedName || entry.name === selectedName)) ||
                entries.find((entry) => selectedName && entry.name === selectedName);

            if (!matched) {
                throw new Error(`自定义保存路径未配置或已失效：${selectedName || selectedIndex}`);
            }

            const nextData = {
                ...data,
                custom_save_path: matched.path,
                custom_save_path_name: matched.name,
            };
            delete nextData.x2md_custom_save_path;
            return nextData;
        }


        async function postProfileCapturePayload(payload) {
            const resp = await localClient.request(`/profile-capture`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            });
            return resp;
        }

        function buildUserByScreenNameFeatures() {
            return {
                hidden_profile_subscriptions_enabled: true,
                profile_label_improvements_pcf_label_in_post_enabled: true,
                responsive_web_profile_redirect_enabled: false,
                rweb_tipjar_consumption_enabled: true,
                verified_phone_label_enabled: false,
                subscriptions_verification_info_is_identity_verified_enabled: true,
                subscriptions_verification_info_verified_since_enabled: true,
                highlights_tweets_tab_ui_enabled: true,
                responsive_web_twitter_article_notes_tab_enabled: true,
                subscriptions_feature_can_gift_premium: true,
                creator_subscriptions_tweet_preview_api_enabled: true,
                responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                responsive_web_graphql_timeline_navigation_enabled: true,
            };
        }

        function buildProfileTimelineFeatures() {
            return {
                rweb_video_screen_enabled: false,
                rweb_cashtags_enabled: true,
                profile_label_improvements_pcf_label_in_post_enabled: true,
                responsive_web_profile_redirect_enabled: false,
                rweb_tipjar_consumption_enabled: true,
                verified_phone_label_enabled: false,
                creator_subscriptions_tweet_preview_api_enabled: true,
                responsive_web_graphql_timeline_navigation_enabled: true,
                responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
                premium_content_api_read_enabled: false,
                communities_web_enable_tweet_community_results_fetch: true,
                c9s_tweet_anatomy_moderator_badge_enabled: true,
                responsive_web_grok_analyze_button_fetch_trends_enabled: false,
                responsive_web_grok_analyze_post_followups_enabled: false,
                rweb_cashtags_composer_attachment_enabled: false,
                responsive_web_jetfuel_frame: false,
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
                post_ctas_fetch_enabled: true,
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

        function buildProfileTimelineFieldToggles() {
            return {
                withPayments: true,
                withAuxiliaryUserLabels: true,
                withArticleRichContentState: true,
                withArticlePlainText: false,
                withArticleSummaryText: false,
                withArticleVoiceOver: false,
                withGrokAnalyze: false,
                withDisallowedReplyControls: false,
            };
        }

        async function fetchTwitterGraphQL(operationName, operationIds, variables, features = {}, fieldToggles = {}) {
            const csrfToken = await getCookieValue("ct0");
            if (!csrfToken) throw new Error("未找到 X 登录 cookie（ct0）");

            const headers = {
                "Authorization": `Bearer ${TWITTER_BEARER_TOKEN}`,
                "X-Csrf-Token": csrfToken,
                "Content-Type": "application/json",
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "zh-cn",
            };

            let lastError = "";
            for (const operationId of operationIds) {
                const url = buildGraphQLUrl({
                    operationId,
                    operationName,
                    variables,
                    features,
                    fieldToggles,
                });
                const resp = await fetch(url, { credentials: "include", headers });
                if (!resp.ok) {
                    lastError = `${operationName}(${operationId}) 返回 ${resp.status}`;
                    console.warn(`[x2md] ${lastError}`);
                    continue;
                }
                const json = await resp.json();
                if (Array.isArray(json.errors) && json.errors.length) {
                    lastError = json.errors.map((item) => item.message || item.code || "GraphQL error").join("; ");
                    console.warn(`[x2md] ${operationName}(${operationId}) 错误：${lastError}`);
                    continue;
                }
                return json;
            }
            throw new Error(lastError || `${operationName} 请求失败`);
        }

        async function fetchXUserByScreenName(handle) {
            const screenName = String(handle || "").replace(/^@/, "").trim();
            if (!screenName) throw new Error("缺少博主 handle");
            const json = await fetchTwitterGraphQL(
                "UserByScreenName",
                USER_BY_SCREEN_NAME_OPERATION_IDS,
                { screen_name: screenName, withGrokTranslatedBio: true },
                buildUserByScreenNameFeatures(),
                { withPayments: true, withAuxiliaryUserLabels: true },
            );
            const result = json?.data?.user?.result;
            if (!result?.rest_id) throw new Error(`未找到 X 博主：@${screenName}`);
            const legacy = result.legacy || result.core || {};
            return {
                restId: result.rest_id,
                handle: legacy.screen_name || screenName,
                displayName: legacy.name || screenName,
            };
        }

        function getProfileCaptureRangeStart(payload = {}) {
            const range = String(payload.range || "today");
            const days = Math.max(1, parseInt(payload.days || payload.profile_capture_custom_days, 10) || 7);
            const now = new Date();
            if (range === "all") return null;
            if (range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
            if (range === "days") return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
            return new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }

        function extractProfileTimelineInstructions(json) {
            return json?.data?.user?.result?.timeline?.timeline?.instructions || [];
        }

        function extractProfileTimelineEntries(json) {
            const entries = [];
            for (const instruction of extractProfileTimelineInstructions(json)) {
                if (Array.isArray(instruction.entries)) entries.push(...instruction.entries);
                if (instruction.entry) entries.push(instruction.entry);
            }
            return entries;
        }

        function extractProfileTimelineTweetResults(json) {
            const results = [];
            for (const entry of extractProfileTimelineEntries(json)) {
                const direct = entry?.content?.itemContent?.tweet_results?.result;
                if (direct) results.push(direct);
                for (const item of entry?.content?.items || []) {
                    const result = item?.item?.itemContent?.tweet_results?.result;
                    if (result) results.push(result);
                }
            }
            return results;
        }

        function extractBottomCursorFromProfileTimeline(json) {
            const cursorEntries = extractProfileTimelineEntries(json)
                .map((entry) => entry?.content)
                .filter((content) => content?.entryType === "TimelineTimelineCursor" && content.cursorType === "Bottom" && content.value);
            return cursorEntries[cursorEntries.length - 1]?.value || "";
        }

        function isRetweetResult(result) {
            const tweet = unwrapTweetResult(result);
            const legacy = tweet?.legacy || {};
            return !!legacy.retweeted_status_result || /^RT\s+@/i.test(String(legacy.full_text || legacy.text || ""));
        }

        function getTweetResultAuthor(result) {
            const tweet = unwrapTweetResult(result);
            const userResult = tweet?.core?.user_results?.result || {};
            const legacy = userResult.legacy || userResult.core || {};
            return {
                restId: userResult.rest_id || legacy.id_str || "",
                handle: legacy.screen_name || "",
                displayName: legacy.name || "",
                legacy,
            };
        }

        function getTweetResultCreatedAt(result) {
            const tweet = unwrapTweetResult(result);
            return tweet?.legacy?.created_at || "";
        }

        function tweetCreatedBefore(result, rangeStart) {
            if (!rangeStart) return false;
            const createdAt = getTweetResultCreatedAt(result);
            const time = createdAt ? Date.parse(createdAt) : 0;
            return !!time && time < rangeStart.getTime();
        }

        function profileTweetRawItemFromResult(result, profile, options = {}) {
            const tweet = unwrapTweetResult(result);
            const legacy = tweet?.legacy || {};
            const tweetId = legacy.id_str || tweet?.rest_id || result?.rest_id || "";
            if (!tweetId) return null;
            const author = getTweetResultAuthor(result);
            const handle = author.handle ? `@${author.handle}` : `@${profile.handle}`;
            const screenName = String(handle || "").replace(/^@/, "");
            return {
                type: options.mode === "articles" ? "article" : "tweet",
                tweet_id: tweetId,
                url: `https://x.com/${screenName}/status/${tweetId}`,
                tweet_url: `https://x.com/${screenName}/status/${tweetId}`,
                author: author.displayName || profile.displayName || profile.handle,
                handle,
                author_url: profile.profileUrl,
                published: legacy.created_at || "",
                text: legacy.full_text || legacy.text || "",
                article_url: options.mode === "articles" ? extractArticleUrlFromText(legacy.full_text || legacy.text || "") : "",
                graphql_operation_ids: {},
            };
        }

        async function fetchProfileItemsViaGraphQL(payload = {}) {
            const requestedProfile = payload.profile || {};
            const requestedHandle = requestedProfile.handle || payload.handle || "";
            const user = await fetchXUserByScreenName(requestedHandle);
            const profile = {
                handle: user.handle || String(requestedHandle).replace(/^@/, ""),
                displayName: requestedProfile.displayName || requestedProfile.display_name || user.displayName || requestedHandle,
                profileUrl: requestedProfile.profileUrl || requestedProfile.profile_url || `https://x.com/${user.handle || requestedHandle}`,
            };
            const mode = payload.mode === "articles" ? "articles" : "tweets";
            const operationName = mode === "articles" ? "UserArticlesTweets" : "UserTweets";
            const operationIds = mode === "articles" ? USER_ARTICLES_TWEETS_OPERATION_IDS : USER_TWEETS_OPERATION_IDS;
            const rangeStart = mode === "tweets" ? getProfileCaptureRangeStart(payload) : null;
            const maxPages = mode === "articles" ? 120 : (String(payload.range || "today") === "all" ? 260 : 90);
            const collected = new Map();
            let cursor = "";
            let olderRounds = 0;
            let noNewPages = 0;

            for (let page = 0; page < maxPages; page++) {
                const beforeSize = collected.size;
                const variables = {
                    userId: user.restId,
                    count: 20,
                    includePromotedContent: true,
                    withQuickPromoteEligibilityTweetFields: true,
                    withVoice: true,
                };
                if (cursor) variables.cursor = cursor;

                const json = await fetchTwitterGraphQL(
                    operationName,
                    operationIds,
                    variables,
                    buildProfileTimelineFeatures(),
                    buildProfileTimelineFieldToggles(),
                );

                const results = extractProfileTimelineTweetResults(json);
                let pageHadOlderTweet = false;
                let pageHadCollectableTweet = false;

                for (const result of results) {
                    if (isRetweetResult(result)) continue;
                    const author = getTweetResultAuthor(result);
                    if (author.restId && author.restId !== user.restId) continue;
                    if (tweetCreatedBefore(result, rangeStart)) {
                        pageHadOlderTweet = true;
                        continue;
                    }
                    const item = profileTweetRawItemFromResult(result, profile, { mode });
                    if (!item) continue;
                    const key = item.tweet_id || item.url;
                    if (!collected.has(key)) collected.set(key, item);
                    pageHadCollectableTweet = true;
                }

                if (collected.size === beforeSize) noNewPages++;
                else noNewPages = 0;
                if (noNewPages >= 3) break;

                if (rangeStart && pageHadOlderTweet && !pageHadCollectableTweet) olderRounds++;
                else olderRounds = 0;
                if (rangeStart && olderRounds >= 2) break;

                const nextCursor = extractBottomCursorFromProfileTimeline(json);
                if (!nextCursor || nextCursor === cursor) break;
                cursor = nextCursor;
            }

            return {
                profile,
                items: Array.from(collected.values()),
                source: operationName,
            };
        }

        // ─────────────────────────────────────────────
        // 消息桥接：业务路由位于可独立测试的 message_dispatcher.js。
        // ─────────────────────────────────────────────
        async function saveCapturePayload(data) {
            const resp = await localClient.request(`/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            });
            const parsed = await parseSaveResponse(resp);
            if (data._x2md_warning_code) {
                parsed.warning_code = data._x2md_warning_code;
                parsed.warning = data._x2md_warning || graphQLErrorMessage(data._x2md_warning_code);
            }
            return parsed;
        }

        let jobClient;
        const dispatchMessage = X2MDMessageDispatcher.createMessageDispatcher({
            getConfig: () => localClient.request(`/config`),
            enrich: (mode, data) => xEnrichment.enrich(mode, data),
            save: saveCapturePayload,
            applyCustomSavePath: applyCustomSavePathSelection,
            applyTranslationOverride: applyTranslationOverrideToData,
            translateTweet: fetchGrokTranslation,
            translateText: translatePlainTextToChinese,
            fetchProfileItems: fetchProfileItemsViaGraphQL,
            postProfileCapture: postProfileCapturePayload,
            pair: (code) => localClient.pair(code),
            getHistory: () => localClient.request(`/history`),
            historyAction: (data) => localClient.request(`/history/action`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
            }),
            updateConfig: (config) => localClient.request(`/config`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(config),
            }),
            getAutostart: () => localClient.request(`/autostart`),
            setAutostart: (enabled) => localClient.request(`/autostart`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ enabled }),
            }),
            ping: () => localClient.request(`/ping`, { auth: false }),
            openOptions: () => chrome.runtime.openOptionsPage(),
            extensionVersion: () => chrome.runtime.getManifest?.().version || "",
            jobs: {
                create: (...args) => jobClient.create(...args),
                list: () => jobClient.list(),
                detail: (id) => jobClient.detail(id),
                control: (...args) => jobClient.control(...args),
            },
        });

        jobClient = X2MDJobClient.createJobClient({
            request: (...args) => localClient.request(...args),
            processCapture: (data, job) => dispatchMessage({ action: job.type === "bookmarks" ? "save_tweet" : "process_profile_job_item", data }),
            alarms: chrome.alarms,
        });
        jobClient.installAlarm();
        jobClient.kick();

        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            dispatchMessage(message, sender).then(sendResponse);
            return true;
        });
    }

    root.X2MDBackgroundRuntime = { start };
})(typeof globalThis !== "undefined" ? globalThis : this);
