/**
 * background.js - X2MD Service Worker v1.4
 *
 * 获取完整推文的 3 层策略（依次降级）：
 *   1. Twitter GraphQL API (TweetDetail) — 携带 cookie，获取最完整数据
 *   2. Twitter oEmbed API — 公开接口，无需认证，可获取完整文字
 *   3. DOM 原始数据（content.js 采集到的）— 最后兜底
 */

importScripts("media_helpers.js");
importScripts("twitter_graphql.js");
importScripts("x-enrichment.js");
importScripts("translation_helpers.js");
importScripts("save_response.js");
importScripts("local_client.js");

const localClient = X2MDLocalClient.createLocalClient();
const xEnrichment = X2MDXEnrichment;
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
// 消息处理
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === "batch_profile_capture") {
        (async () => {
            try {
                const payload = message.data || {};
                let batchConfig = {};
                try {
                    const cfgResp = await localClient.request(`/config`);
                    batchConfig = cfgResp;
                } catch {}
                const mode = payload.mode === "articles" ? "articles" : "tweets";
                let rawItems = Array.isArray(payload.items) ? payload.items : [];
                let profile = payload.profile || {};
                let profileSource = "dom";
                if (!rawItems.length && (profile.handle || payload.handle)) {
                    const fetched = await fetchProfileItemsViaGraphQL({
                        ...payload,
                        mode,
                    });
                    rawItems = fetched.items || [];
                    profile = fetched.profile || profile;
                    profileSource = fetched.source || "graphql";
                    console.log(`[x2md] 博主批量接口抓取：mode=${mode} source=${profileSource} items=${rawItems.length}`);
                }
                const items = [];

                if (mode === "articles") {
                    for (const item of rawItems) {
                        const article = await xEnrichment.enrich("profile-article", item);
                        if (article && batchConfig.enable_video_download === false) article.videos = [];
                        if (article) items.push(article);
                    }
                } else {
                    for (const item of rawItems) {
                        const tweet = await xEnrichment.enrich("profile-tweet", item);
                        if (batchConfig.enable_video_download === false) {
                            tweet.videos = [];
                            tweet.videoDurations = [];
                        }
                        items.push(tweet);
                    }
                }

                const result = await postProfileCapturePayload({
                    ...payload,
                    profile,
                    mode,
                    items,
                });
                sendResponse({
                    success: result.success !== false,
                    result,
                    found_count: rawItems.length,
                    enriched_count: items.length,
                    source: profileSource,
                });
            } catch (err) {
                console.error("[x2md] 博主批量抓取失败：", err);
                sendResponse({ success: false, error: err.message || String(err) });
            }
        })();
        return true;
    }

    if (message.action === "open_options") {
        chrome.runtime.openOptionsPage();
        sendResponse({ success: true });
        return false;
    }

    if (message.action === "save_tweet") {
        (async () => {
            try {
                let data = message.data;

                data = await xEnrichment.enrich("capture", data);

                // --------- 视频时长检测与二次确认拦截 ---------
                let enableVideoDownload = true;
                let durationThresholdMin = 5;
                let cfg = {};
                try {
                    const cfgResp = await localClient.request(`/config`);
                    cfg = cfgResp;
                    enableVideoDownload = cfg.enable_video_download !== false;
                    durationThresholdMin = cfg.video_duration_threshold || 5;
                } catch (e) { console.warn("[x2md] 获取配置失败，使用默认视频设置", e); }

                data = applyCustomSavePathSelection(data, cfg);

                const allVideos = [...(data.videos || [])];
                const allDurations = [...(data.videoDurations || [])];
                if (data.thread_tweets) {
                    for (const tw of data.thread_tweets) {
                        if (tw.videos) allVideos.push(...tw.videos);
                        if (tw.videoDurations) allDurations.push(...tw.videoDurations);
                    }
                }

                // data.video_confirmed 为真代表是来自前端弹窗确认后的二次提交，跳过拦截
                if (enableVideoDownload && allVideos.length > 0 && !data.video_confirmed) {
                    const maxDurationMs = Math.max(0, ...allDurations);
                    const maxDurationMin = maxDurationMs / 1000 / 60;

                    if (maxDurationMin > durationThresholdMin) {
                        console.log(`[x2md] 发现超长视频 (${maxDurationMin.toFixed(1)} > ${durationThresholdMin} min)，要求前台确认`);
                        sendResponse({
                            require_video_confirm: true,
                            durationMin: maxDurationMin.toFixed(1),
                            payload: data
                        });
                        return; // 终止当前保存流程，等待 content.js 确认后重新发送通讯
                    } else {
                        data.download_video = true;
                    }
                } else if (!enableVideoDownload) {
                    data.download_video = false;
                } else if (data.video_confirmed) {
                    // 如果二次确认识别到强制保留
                    // 注意由于 confirm 环节 content.js 会带过来用户的选择赋值
                    // 即有可能是 true 或 false ，无需再动
                } else {
                    // 如果本身就不含任何视频（但为了防止键位缺失赋予默认状态）
                    data.download_video = true;
                }
                // ---------------------------------------------

                const resp = await localClient.request(`/save`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });
                const parsed = await parseSaveResponse(resp);
                if (data._x2md_warning_code) {
                    parsed.warning_code = data._x2md_warning_code;
                    parsed.warning = data._x2md_warning || graphQLErrorMessage(data._x2md_warning_code);
                }
                sendResponse(parsed);

            } catch (err) {
                console.error("[x2md] 后台处理或请求失败：", err);
                sendResponse({ success: false, error: err.message || String(err) });
            }
        })();
        // 必须返回 true 以保持消息通道开启，否则 async 块内部的 sendResponse 将因为通道关闭而失败，产生 content 侧一直 Loading
        return true;
    }

    if (message.action === "translate_tweet") {
        (async () => {
            try {
                const rawId = message.data?.tweetId || String(message.data?.url || "").match(/\/status\/(\d+)/)?.[1] || "";
                const result = await fetchGrokTranslation(rawId);
                sendResponse({
                    success: true,
                    translatedText: result.translatedText,
                    tweetId: result.tweetId,
                    error: "",
                });
            } catch (err) {
                console.error("[x2md] 获取推文翻译失败：", err);
                sendResponse({ success: false, error: err.message || String(err) });
            }
        })();
        return true;
    }

    if (message.action === "translate_text") {
        (async () => {
            try {
                const sourceText = String(message.data?.text || "").trim();
                const translatedText = await translatePlainTextToChinese(sourceText);
                sendResponse({
                    success: true,
                    translatedText,
                    error: "",
                });
            } catch (err) {
                console.error("[x2md] 文本翻译失败：", err);
                sendResponse({ success: false, error: err.message || String(err) });
            }
        })();
        return true;
    }

    if (message.action === "copy_content_text") {
        (async () => {
            try {
                const result = await xEnrichment.enrich("copy", message.data || {});
                sendResponse({ success: !!result.text, ...result });
            } catch (err) {
                console.error("[x2md] 复制正文提取失败：", err);
                sendResponse({ success: false, error: err.message || String(err) });
            }
        })();
        return true;
    }

    if (message.action === "force_save_tweet") {
        (async () => {
            try {
                const data = applyTranslationOverrideToData(message.data || {});
                const resp = await localClient.request(`/save`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });
                const parsed = await parseSaveResponse(resp);
                if (data._x2md_warning_code) {
                    parsed.warning_code = data._x2md_warning_code;
                    parsed.warning = data._x2md_warning || graphQLErrorMessage(data._x2md_warning_code);
                }
                sendResponse(parsed);
            } catch (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            }
        })();
        return true;
    }

    if (message.action === "pair") {
        (async () => {
            try {
                const json = await localClient.pair(message.code);
                sendResponse({ success: Boolean(json.token), error: json.error });
            } catch (err) {
                sendResponse({ success: false, error: err.message, error_code: err.code });
            }
        })();
        return true;
    }

    if (message.action === "get_config") {
        (async () => {
            try {
                const resp = await localClient.request(`/config`);
                sendResponse({ success: true, config: resp });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "get_history") {
        (async () => {
            try {
                const resp = await localClient.request(`/history`);
                const json = resp;
                sendResponse({ success: json.success !== false, history: json.history || [] });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "update_config") {
        (async () => {
            try {
                const resp = await localClient.request(`/config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(message.config)
                });
                const json = resp;
                sendResponse({ success: json.success !== false, config: json.config });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "get_autostart") {
        (async () => {
            try {
                const resp = await localClient.request(`/autostart`);
                const json = resp;
                sendResponse({ success: json.success !== false, enabled: !!json.enabled });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "set_autostart") {
        (async () => {
            try {
                const resp = await localClient.request(`/autostart`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: !!message.enabled })
                });
                const json = resp;
                sendResponse({ success: json.success !== false, enabled: !!json.enabled, error: json.error });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "ping") {
        (async () => {
            try {
                const resp = await localClient.request(`/ping`, {
                    auth: false,
                });
                const json = resp;
                sendResponse({
                    online: json.status === "ok",
                    version: json.version || "",
                    min_extension_version: json.min_extension_version || "",
                    extension_version: chrome.runtime.getManifest?.().version || "",
                    port: "9527",
                });
            } catch {
                sendResponse({ online: false });
            }
        })();
        return true;
    }
});
