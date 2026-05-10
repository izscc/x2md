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
importScripts("twitter_graphql.js");
importScripts("translation_helpers.js");

const SERVER_BASE = "http://127.0.0.1:9527";
const TWITTER_BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const GRAPHQL_DISCOVERY_CACHE = new Map();
const PLAIN_TEXT_TRANSLATE_CHUNK_SIZE = 2600;

function hasDiscoveredOperationIds(ids) {
    return Array.isArray(ids?.TweetDetail) && ids.TweetDetail.length > 0 ||
        Array.isArray(ids?.TweetResultByRestId) && ids.TweetResultByRestId.length > 0;
}

function mergeDiscoveredOperationIds(primary = {}, secondary = {}) {
    return {
        TweetDetail: mergeOperationIds(primary.TweetDetail, secondary.TweetDetail),
        TweetResultByRestId: mergeOperationIds(primary.TweetResultByRestId, secondary.TweetResultByRestId),
    };
}

async function discoverGraphQLOperationIdsFromPage(pageUrl) {
    if (!pageUrl) return { TweetDetail: [], TweetResultByRestId: [] };

    let cacheKey = pageUrl;
    try {
        cacheKey = new URL(pageUrl).origin;
    } catch (error) { }

    const cached = GRAPHQL_DISCOVERY_CACHE.get(cacheKey);
    if (cached && hasDiscoveredOperationIds(cached)) {
        return cached;
    }

    try {
        const htmlResp = await fetch(pageUrl, {
            credentials: "include",
            headers: {
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "zh-cn",
            },
        });
        if (!htmlResp.ok) {
            return { TweetDetail: [], TweetResultByRestId: [] };
        }

        const html = await htmlResp.text();
        const scriptUrls = extractScriptUrlsFromHtml(html, pageUrl)
            .filter((url) => url.includes("abs.twimg.com") && url.endsWith(".js"))
            .sort((left, right) => {
                const leftMain = left.includes("/main.");
                const rightMain = right.includes("/main.");
                if (leftMain === rightMain) return 0;
                return leftMain ? -1 : 1;
            });

        let discovered = { TweetDetail: [], TweetResultByRestId: [] };

        for (const scriptUrl of scriptUrls) {
            const scriptResp = await fetch(scriptUrl);
            if (!scriptResp.ok) continue;

            const scriptText = await scriptResp.text();
            discovered = mergeDiscoveredOperationIds(
                discovered,
                extractGraphQLOperationIdsFromScriptText(scriptText),
            );

            if (hasDiscoveredOperationIds(discovered)) {
                GRAPHQL_DISCOVERY_CACHE.set(cacheKey, discovered);
                return discovered;
            }
        }
    } catch (error) {
        console.warn("[x2md] 自动探测 GraphQL operation id 失败：", error);
    }

    return { TweetDetail: [], TweetResultByRestId: [] };
}

// ─────────────────────────────────────────────
// 获取 Twitter Note 文章内容（通过后台 Tab 渲染提取）
// 1. 后台静默打开 /article/ 页面
// 2. 等待 twitterArticleRichTextView 渲染
// 3. executeScript 提取完整内容
// 4. 关闭 tab
// ─────────────────────────────────────────────
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

async function fetchNoteContent(articleUrl) {
    return new Promise((resolve) => {
        let tabId = null;
        let resolved = false;
        // 最终超时 15 秒
        const timeout = setTimeout(() => {
            if (!resolved) {
                resolved = true;
                if (tabId) chrome.tabs.remove(tabId).catch(() => { });
                console.warn("[x2md] Note tab 超时");
                resolve(null);
            }
        }, 15000);

        // 后台静默创建 tab（不激活，用户几乎感知不到）
        chrome.tabs.create(
            { url: articleUrl, active: false },
            (tab) => {
                if (chrome.runtime.lastError || !tab) {
                    clearTimeout(timeout);
                    resolve(null);
                    return;
                }
                tabId = tab.id;

                // 轮询等待页面完成渲染
                let retries = 0;
                const poll = () => {
                    if (resolved) return;
                    retries++;

                    chrome.scripting.executeScript(
                        {
                            target: { tabId },
                            func: () => {
                                // 检测文章容器是否已渲染
                                const container =
                                    document.querySelector('[data-testid="twitterArticleRichTextView"]') ||
                                    document.querySelector('[data-testid="longformRichTextComponent"]') ||
                                    document.querySelector('[data-testid="twitterArticleReadView"]');

                                if (!container || container.innerText.trim().length < 100) {
                                    return null; // 还没渲染好，返回给外层继续 setTimeout 轮询
                                }
                                // ── 标题 ────────────────────────────
                                const titleEl = document.querySelector('[data-testid="twitter-article-title"]')
                                    || document.querySelector('h1');
                                const title = titleEl ? titleEl.innerText.trim() : document.title.replace(/\s*[-|]\s*X\s*$/, '').trim();

                                let contentStr = "";
                                try {
                                    contentStr = extractArticleMarkdown(container);
                                } catch (e) {
                                    contentStr = container.innerText || "";
                                }

                                // ── 提取页面内所有的 MP4 真实链接并按 ID 分组求最高清 ──
                                const allMp4s = document.documentElement.innerHTML.match(/https?:\/\/video\.twimg\.com\/[^"'\s\\]+?\.mp4(?:\?tag=\d+)?/g) || [];
                                const cleanMp4s = allMp4s.map(url => url.replace(/\\/g, ''));
                                const videoMap = {};
                                for (const url of cleanMp4s) {
                                    const idMatch = url.match(/(?:amplify_video|ext_tw_video|tweet_video|video)\/(\d+)/);
                                    if (idMatch) {
                                        const vidId = idMatch[1];
                                        if (!videoMap[vidId]) videoMap[vidId] = [];
                                        videoMap[vidId].push(url);
                                    }
                                }

                                const extractedVideos = [];
                                // 对内容字符串里的占位符进行精准替换
                                contentStr = contentStr.replace(/\[\[VIDEO_HOLDER_(\d+)\]\]/g, (match, mediaId) => {
                                    const urls = videoMap[mediaId];
                                    if (urls && urls.length > 0) {
                                        let bestUrl = urls[0];
                                        let maxVal = 0;
                                        for (const u of urls) {
                                            const m = u.match(/(\d+)x(\d+)/);
                                            if (m) {
                                                const val = parseInt(m[1]) * parseInt(m[2]);
                                                if (val > maxVal) { maxVal = val; bestUrl = u; }
                                            }
                                        }
                                        extractedVideos.push(bestUrl);
                                        return `\n[MEDIA_VIDEO_URL:${bestUrl}]\n`;
                                    }
                                    return `\n[[VIDEO_HOLDER_${mediaId}]]\n`;
                                });

                                const finalVideos = Array.from(new Set(extractedVideos));

                                // ── 封面图补充（如有则放顶部） ─────────────────────────────
                                let coverImg = "";
                                document.querySelectorAll('[data-testid="tweetPhoto"] img').forEach(img => {
                                    if (img.closest('[data-testid="simpleTweet"]')) return;
                                    const src = img.src || '';
                                    if (src && src.includes('pbs.twimg.com') && !src.includes('profile_images')) {
                                        const u = new URL(src);
                                        u.searchParams.set('name', 'orig');
                                        if (!contentStr.includes(u.href)) coverImg += `![](${u.href})\n\n`;
                                    }
                                });

                                const plainText = [title, container.innerText || ""]
                                    .map((part) => String(part || "").trim())
                                    .filter(Boolean)
                                    .join("\n\n");

                                return { title, content: coverImg + contentStr, plainText, images: [], videos: finalVideos }; // 放开视频包裹以并入 payload
                            },
                        },
                        (results) => {
                            if (chrome.runtime.lastError) {
                                // tab 还没准备好，继续等待
                                if (retries < 20) {
                                    setTimeout(poll, 500);
                                } else {
                                    resolved = true;
                                    clearTimeout(timeout);
                                    chrome.tabs.remove(tabId).catch(() => { });
                                    resolve(null);
                                }
                                return;
                            }

                            const result = results?.[0]?.result;
                            if (!result) {
                                // 内容未就绪，继续轮询
                                if (retries < 20) {
                                    setTimeout(poll, 500);
                                } else {
                                    resolved = true;
                                    clearTimeout(timeout);
                                    chrome.tabs.remove(tabId).catch(() => { });
                                    resolve(null);
                                }
                                return;
                            }

                            // 提取成功
                            resolved = true;
                            clearTimeout(timeout);
                            chrome.tabs.remove(tabId).catch(() => { });
                            console.log(`[x2md] Note 内容提取成功：title="${result.title.slice(0, 30)}" 长度=${result.content.length}`);
                            resolve(result);
                        }
                    );
                };

                // 等待 tab 完成加载后开始轮询
                chrome.tabs.onUpdated.addListener(function listener(changedTabId, info) {
                    if (changedTabId === tabId && info.status === 'complete') {
                        chrome.tabs.onUpdated.removeListener(listener);
                        // 等额外 1.5 秒等 CSR 渲染
                        setTimeout(poll, 1500);
                    }
                });
            }
        );
    });
}


async function getCookieValue(name) {
    const cookies = await chrome.cookies.getAll({ domain: ".x.com", name });
    if (!cookies.length) {
        const fallback = await chrome.cookies.getAll({ domain: ".twitter.com", name });
        if (fallback.length) return fallback[0].value;
        return null;
    }
    return cookies[0].value;
}

// ─────────────────────────────────────────────
// 策略1：Twitter GraphQL API - TweetDetail
// 携带浏览器 cookie（需用户已登录 x.com）
// ─────────────────────────────────────────────
async function fetchViaGraphQL(tweetId, options = {}) {
    try {
        // 获取 CSRF token（ct0 cookie）
        const csrfToken = await getCookieValue("ct0");
        if (!csrfToken) {
            console.warn("[x2md] 未找到 ct0 cookie，跳过 GraphQL");
            return null;
        }
        let discoveredOperationIds = options.graphqlOperationIds || {};
        if (!hasDiscoveredOperationIds(discoveredOperationIds) && options.pageUrl) {
            discoveredOperationIds = await discoverGraphQLOperationIdsFromPage(options.pageUrl);
        }

        const headers = {
            "Authorization": `Bearer ${TWITTER_BEARER_TOKEN}`,
            "X-Csrf-Token": csrfToken,
            "Content-Type": "application/json",
            "x-twitter-active-user": "yes",
            "x-twitter-client-language": "zh-cn",
        };

        const plans = buildGraphQLRequestPlans(tweetId, {
            discoveredOperationIds,
        });

        for (const plan of plans) {
            const url = buildGraphQLUrl(plan);
            const resp = await fetch(url, {
                credentials: "include",
                headers,
            });

            if (!resp.ok) {
                console.warn(`[x2md] ${plan.operationName}(${plan.operationId}) 返回 ${resp.status}`);
                continue;
            }

            const json = await resp.json();
            const mainTweet = extractMainTweetResult(json, tweetId);
            if (!mainTweet) {
                console.warn(`[x2md] ${plan.operationName}(${plan.operationId}) 未找到目标推文`);
                continue;
            }

            const mainParsed = parseLegacyTweet(mainTweet, mainTweet.core?.user_results?.result?.legacy);
            if (!mainParsed) {
                continue;
            }

            const allTweets = extractTimelineTweets(json);
            const authorRestId = mainTweet.core?.user_results?.result?.rest_id;
            let threadParsed = [];

            if (authorRestId && allTweets.length > 0) {
                const sameAuthorTweets = allTweets.filter((result) =>
                    result.core?.user_results?.result?.rest_id === authorRestId &&
                    BigInt(result.legacy?.id_str || 0) > BigInt(tweetId)
                );
                sameAuthorTweets.sort((left, right) => BigInt(left.legacy?.id_str || 0) < BigInt(right.legacy?.id_str || 0) ? -1 : 1);

                for (const threadTweet of sameAuthorTweets) {
                    const parsed = parseLegacyTweet(threadTweet, threadTweet.core?.user_results?.result?.legacy, { stripLeadingReplyMentions: true });
                    if (parsed && (parsed.text || parsed.images.length || parsed.videos.length)) {
                        threadParsed.push(parsed);
                    }
                }
            }

            mainParsed.thread_tweets = threadParsed;
            mainParsed._graphql_source = `${plan.operationName}:${plan.operationId}`;
            return mainParsed;
        }

        console.warn("[x2md] 所有 GraphQL 候选请求均失败");
        return null;

    } catch (err) {
        console.error("[x2md] GraphQL API 异常：", err);
        return null;
    }
}


function unwrapTweetResult(result) {
    return result?.tweet || result;
}

function extractQuotedTweetResult(result) {
    const candidates = [
        result?.quoted_status_result?.result,
        result?.tweet?.quoted_status_result?.result,
        result?.quoted_status_result?.result?.tweet,
        result?.tweet?.quoted_status_result?.result?.tweet,
    ];
    for (const candidate of candidates) {
        const unwrapped = unwrapTweetResult(candidate);
        if (unwrapped?.legacy || unwrapped?.tweet?.legacy) return unwrapped;
    }
    return null;
}

function cleanLeadingReplyMentions(text) {
    return String(text || "")
        .replace(/^(?:\s*@\w{1,20})+\s*/u, "")
        .trimStart();
}


function removeQuotedTweetUrlFromText(text, quoteUrl) {
    const quoteId = String(quoteUrl || "").match(/\/status\/(\d+)/)?.[1];
    if (!quoteId) return text;
    let result = String(text || "");
    const markdownLinkPattern = new RegExp(`\\s*\\[[^\\]]*\\]\\([^)]*\\/status\\/${quoteId}[^)]*\\)\\s*$`, "i");
    result = result.replace(markdownLinkPattern, "");
    const plainUrlPattern = new RegExp(`\\s*https?:\\/\\/(?:x|twitter)\\.com\\/[^\\s)]+\\/status\\/${quoteId}[^\\s)]*\\s*$`, "i");
    result = result.replace(plainUrlPattern, "");
    return result.trimEnd();
}

// ─────────────────────────────────────────────
// 解析 GraphQL legacy tweet 对象
// ─────────────────────────────────────────────
function parseLegacyTweet(result, userLegacy, options = {}) {
    const tweet = unwrapTweetResult(result);
    const legacy = tweet?.legacy || result?.legacy || result?.tweet?.legacy;
    if (!legacy) return null;

    let text = "";
    // X 对于非常长的推文（非专有 article）会把全文存放在 note_tweet 中
    const noteTweetResult = tweet?.note_tweet?.note_tweet_results?.result || result.note_tweet?.note_tweet_results?.result || result.tweet?.note_tweet?.note_tweet_results?.result;
    if (noteTweetResult && noteTweetResult.text) {
        text = noteTweetResult.text;
    } else {
        text = legacy.full_text || legacy.text || "";
    }

    // 聚合并清理 t.co 链接（转换为 Markdown 格式）
    const urlEntities = [];
    if (legacy.entities?.urls) urlEntities.push(...legacy.entities.urls);
    if (noteTweetResult && noteTweetResult.entity_set?.urls) {
        urlEntities.push(...noteTweetResult.entity_set.urls);
    }

    for (const u of urlEntities) {
        if (u.url && u.expanded_url) {
            const display = u.display_url || u.expanded_url;
            // 使用 split join 处理全部匹配项以防多处重复
            text = text.split(u.url).join(`[${display}](${u.expanded_url})`);
        }
    }

    // 去掉末尾的残余 t.co 图片链接
    text = text.replace(/https:\/\/t\.co\/\S+$/gm, "").trimEnd();
    if (options.stripLeadingReplyMentions) {
        text = cleanLeadingReplyMentions(text);
    }

    // 提取图片与视频
    const images = [];
    const videos = [];
    const videoDurations = [];
    const media = [];
    if (legacy.extended_entities?.media) media.push(...legacy.extended_entities.media);
    else if (legacy.entities?.media) media.push(...legacy.entities.media);

    // 如果是加长版推文，图片等富媒体资源可能会被存储到 entity_set 中
    if (noteTweetResult && noteTweetResult.entity_set?.media) {
        media.push(...noteTweetResult.entity_set.media);
    }

    for (const m of media) {
        if (m.type === "photo" && m.media_url_https) {
            images.push(m.media_url_https + "?name=orig");
        } else if (m.type === "video" || m.type === "animated_gif") {
            if (m.media_url_https) {
                images.push(m.media_url_https + "?name=orig"); // 保存视频的缩略图作为备份或底图
            }
            const bestVariant = selectBestMp4Variant(m.video_info?.variants);
            if (bestVariant?.url) {
                videos.push(bestVariant.url);
                if (m.video_info?.duration_millis) {
                    videoDurations.push(m.video_info.duration_millis);
                }
            }
        }
    }

    const articleMedia = extractArticleMediaVideos(tweet || result);
    videos.push(...articleMedia.videos);
    videoDurations.push(...articleMedia.videoDurations);

    const author = userLegacy?.name || "";
    const handle = userLegacy?.screen_name ? "@" + userLegacy.screen_name : "";
    const published = legacy.created_at || "";

    const parsed = {
        text,
        images: Array.from(new Set(images)),
        videos: Array.from(new Set(videos)),
        videoDurations,
        author,
        handle,
        published,
    };

    if (!options.skipQuote) {
        const quotedResult = extractQuotedTweetResult(tweet || result);
        if (quotedResult) {
            const quoteUserLegacy = quotedResult.core?.user_results?.result?.legacy ||
                quotedResult.tweet?.core?.user_results?.result?.legacy;
            const quotedParsed = parseLegacyTweet(quotedResult, quoteUserLegacy, { skipQuote: true });
            if (quotedParsed && (quotedParsed.text || quotedParsed.images.length || quotedParsed.videos.length)) {
                const quotedLegacy = quotedResult.legacy || quotedResult.tweet?.legacy || {};
                const quotedHandle = quotedParsed.handle || (quoteUserLegacy?.screen_name ? "@" + quoteUserLegacy.screen_name : "");
                const quotedId = quotedLegacy.id_str || quotedResult.rest_id || quotedResult.tweet?.rest_id || "";
                parsed.quote_tweet = {
                    ...quotedParsed,
                    url: quotedHandle && quotedId ? `https://x.com/${quotedHandle.replace(/^@/, "")}/status/${quotedId}` : "",
                };
                parsed.text = removeQuotedTweetUrlFromText(parsed.text, parsed.quote_tweet.url);
            }
        }
    }

    return parsed;
}

// ─────────────────────────────────────────────
// 策略2：oEmbed API（公开接口，完整文字，但无图片）
// ─────────────────────────────────────────────
async function fetchViaOEmbed(tweetUrl) {
    try {
        const apiUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
        const resp = await fetch(apiUrl);
        if (!resp.ok) return null;
        const json = await resp.json();

        // service worker 没有 DOM，用正则提取 <p> 内文字
        const html = json.html || "";
        const pMatch = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
        const rawText = pMatch ? pMatch[1] : html;
        const text = rawText
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ")
            .replace(/pic\.twitter\.com\/\S+/g, "")
            .trim();

        return { text, images: [] };
    } catch (err) {
        console.error("[x2md] oEmbed API 异常：", err);
        return null;
    }
}

// ─────────────────────────────────────────────
// 主函数：获取完整推文数据
// ─────────────────────────────────────────────
async function fetchFullTweetData(tweetData) {
    const match = (tweetData.url || "").match(/\/status\/(\d+)/);
    if (!match) return tweetData;

    const tweetId = match[1];
    console.log("[x2md] 开始获取完整推文：", tweetId);

    // 策略1：GraphQL API
    let apiResult = await fetchViaGraphQL(tweetId, {
        graphqlOperationIds: tweetData.graphql_operation_ids,
        pageUrl: tweetData.url,
    });

    // 策略2：oEmbed（GraphQL 失败时）
    if (!apiResult || !apiResult.text) {
        console.log("[x2md] GraphQL 失败，尝试 oEmbed");
        apiResult = await fetchViaOEmbed(tweetData.url);
    }

    if (!apiResult) {
        console.log("[x2md] 所有 API 均失败，使用 DOM 原始数据");
        return tweetData;
    }

    console.log(`[x2md] API 获取成功：text=${apiResult.text.slice(0, 50)} images=${apiResult.images.length}`);

    return {
        ...tweetData,
        _api_fetched: true,
        text: apiResult.text || tweetData.text,
        images: (apiResult.images && apiResult.images.length > 0) ? apiResult.images : (tweetData.images || []),
        videos: apiResult.videos || (tweetData.videos || []),
        videoDurations: apiResult.videoDurations || (tweetData.videoDurations || []),
        author: apiResult.author || tweetData.author,
        handle: apiResult.handle || tweetData.handle,
        published: apiResult.published || tweetData.published,
        thread_tweets: apiResult.thread_tweets && apiResult.thread_tweets.length > 0 ? apiResult.thread_tweets : (tweetData.thread_tweets || []),
        quote_tweet: apiResult.quote_tweet || tweetData.quote_tweet || null,
    };
}

function normalizeArticleUrl(url) {
    return String(url || "").replace("twitter.com", "x.com");
}

function extractArticleUrlFromText(text) {
    const match = String(text || "").match(/https?:\/\/(?:x|twitter)\.com\/(?:i\/article|[^/]+\/article)\/\d+/i);
    return match ? normalizeArticleUrl(match[0]) : "";
}

function buildCopyPayloadFromNoteResult(noteResult, fallbackTitle = "") {
    if (!noteResult) return null;
    const title = String(noteResult.title || fallbackTitle || "").trim();
    const body = String(noteResult.plainText || noteResult.content || "")
        .replace(/!\[\]\([^)]*\)/g, "")
        .replace(/\[MEDIA_VIDEO_URL:[^\]]+\]/g, "")
        .trim();
    const text = !title ? body : (!body ? title : (body.startsWith(title) ? body : `${title}\n\n${body}`));

    const markdownBody = String(noteResult.content || "")
        .replace(/\[MEDIA_VIDEO_URL:[^\]]+\]/g, "")
        .trim();
    const markdown = title && markdownBody && !markdownBody.startsWith(`# ${title}`)
        ? `# ${title}\n\n${markdownBody}`
        : (markdownBody || title);

    return { text, markdown };
}

async function resolveCopyContentText(copyData = {}) {
    let articleUrl = normalizeArticleUrl(copyData.note_article_url || copyData.article_url || "");
    let enrichedData = copyData;

    if (!articleUrl && copyData.url && copyData.url.includes("/status/")) {
        enrichedData = await fetchFullTweetData(copyData);
        articleUrl = extractArticleUrlFromText(enrichedData.text);
    }

    if (articleUrl) {
        const noteResult = await fetchNoteContent(articleUrl);
        const payload = buildCopyPayloadFromNoteResult(noteResult, enrichedData.text || copyData.text || "");
        if (payload?.text) return { ...payload, source: "x_article", articleUrl };
    }

    const text = String(enrichedData.text || copyData.text || "").trim();
    return { text, source: "tweet" };
}

// ─────────────────────────────────────────────
// 消息处理
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === "save_tweet") {
        (async () => {
            try {
                let data = message.data;

                if (data.type === "note" && data.note_article_url) {
                    // 长文 Note：后台打开 tab，等待渲染后提取完整内容
                    console.log("[x2md] 处理 Note（后台 tab 方案）：", data.note_article_url);

                    // 【关键修复】即使是解析长文，也必须对母推文本身调用 GraphQL 获取其自带的高清视频或原图，防止富媒体遗失！
                    let enrichedData = await fetchFullTweetData(data);

                    const noteResult = await fetchNoteContent(data.note_article_url);
                    if (noteResult && noteResult.content) {
                        // 剔除已被内联插入成功的外联原图，其余在数组末尾透传以防丢失
                        const mergedImages = [];
                        for (const img of (enrichedData.images || [])) {
                            const cleanImg = img.split('?')[0];
                            if (!noteResult.content.includes(cleanImg)) {
                                mergedImages.push(img);
                            }
                        }
                        data = {
                            ...enrichedData,
                            type: "article",
                            article_title: noteResult.title || enrichedData.text?.slice(0, 50) || "Note",
                            article_content: noteResult.content,
                            images: mergedImages,
                            url: enrichedData.url,  // 保留 /status/ 链接作为源
                        };
                    } else {
                        // 获取失败：降级为推文摘要 + 文章链接
                        console.warn("[x2md] Note 内容获取失败，降级为摘要");
                        data = {
                            ...data,
                            type: "tweet",
                            text: (data.text || "") + `\n\n📔 完整长文：${data.note_article_url}`,
                        };
                    }
                } else if (data.type === "tweet" && data.url && data.url.includes("/status/")) {
                    // 普通推文：通过 API 获取完整内容
                    data = await fetchFullTweetData(data);

                    // 【核心修复】检查 API 获取后的完整内容中，是否包含 /article/ 长文链接
                    // 这个用于解决原本只是短推文加上内嵌长文的情况，因为 t.co 被解析后会转化为明传的文章链接
                    const articleMatch = data.text && data.text.match(/https?:\/\/(x|twitter)\.com\/(i\/article|[^/]+\/article)\/\d+/i);
                    if (articleMatch) {
                        const articleUrl = articleMatch[0].replace("twitter.com", "x.com");
                        console.log("[x2md] 在推文提取文本中发现长文(Note)链接，切换提取模式：", articleUrl);

                        const noteResult = await fetchNoteContent(articleUrl);
                        if (noteResult && noteResult.content) {
                            // 同样去除已被内联插入的长文明图
                            const mergedImages = [];
                            for (const img of (data.images || [])) {
                                const cleanImg = img.split('?')[0];
                                if (!noteResult.content.includes(cleanImg)) {
                                    mergedImages.push(img);
                                }
                            }

                            let prefix = "";
                            const cleanText = data.text.trim();
                            if (cleanText !== articleUrl && cleanText !== "") {
                                // 去除文本中的长文卡片 URL，以免重叠
                                const textWithoutUrl = cleanText.replace(articleUrl, "").trim();
                                if (textWithoutUrl) {
                                    prefix = textWithoutUrl + "\n\n---\n\n";
                                }
                            }

                            data = {
                                ...data,
                                type: "article",
                                // 如果 noteResult.title 不存在或为空，则采用推文原始内容的首行作为备用标题，避免生成带 untitled 名称的文件
                                article_title: noteResult.title || (data.text ? data.text.trim().split('\n')[0].replace(/https?:\/\/\S+/g, '').replace(/[\n\t]/g, '').slice(0, 50).trim() : "Untitled"),
                                article_content: prefix + noteResult.content,
                                images: mergedImages,
                            };
                        } else {
                            data.text = data.text + `\n\n📔 完整长文：${articleUrl}`;
                        }
                    }
                }

                data = applyTranslationOverrideToData(data);

                // --------- 统一填补长文专栏中的遗留视频占位符 ---------
                let contentToFix = data.article_content || data.content || "";
                if (contentToFix.includes("[[VIDEO_HOLDER_")) {
                    console.log("[x2md] 检测到长文包含未解析的视频占位符，尝试通过 GraphQL 兜底获取");

                    let apiData = data;
                    if (!data._api_fetched && data.url && data.url.includes("/status/")) {
                        apiData = await fetchFullTweetData(data);
                    }

                    let finalVideos = data.videos || [];
                    if (apiData.videos) finalVideos.push(...apiData.videos);
                    if (data.noteResultVideos) finalVideos.push(...data.noteResultVideos);

                    const filledContent = fillArticleVideoPlaceholders(contentToFix, finalVideos);
                    const extractedVideoUrls = Array.from(
                        filledContent.matchAll(/\[MEDIA_VIDEO_URL:(.+?)\]/g),
                        (match) => match[1],
                    );
                    contentToFix = filledContent;

                    if (data.article_content) data.article_content = contentToFix;
                    else data.content = contentToFix;

                    data.videos = Array.from(new Set([...(data.videos || []), ...extractedVideoUrls]));

                    if (apiData.videoDurations) {
                        data.videoDurations = data.videoDurations || [];
                        data.videoDurations.push(...apiData.videoDurations);
                    }
                    if (apiData.images) {
                        data.images = Array.from(new Set([...(data.images || []), ...apiData.images]));
                    }
                }
                // ----------------------------------------------------

                // --------- 视频时长检测与二次确认拦截 ---------
                let enableVideoDownload = true;
                let durationThresholdMin = 5;
                try {
                    const cfgResp = await fetch(`${SERVER_BASE}/config`);
                    const cfg = await cfgResp.json();
                    enableVideoDownload = cfg.enable_video_download !== false;
                    durationThresholdMin = cfg.video_duration_threshold || 5;
                } catch (e) { console.warn("[x2md] 获取配置失败，使用默认视频设置", e); }

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

                const resp = await fetch(`${SERVER_BASE}/save`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });
                const json = await resp.json();
                sendResponse({ success: json.success !== false, result: json });

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
                const result = await resolveCopyContentText(message.data || {});
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
                const resp = await fetch(`${SERVER_BASE}/save`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(data)
                });
                const json = await resp.json();
                sendResponse({ success: json.success !== false, result: json });
            } catch (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            }
        })();
        return true;
    }

    if (message.action === "get_config") {
        (async () => {
            try {
                const resp = await fetch(`${SERVER_BASE}/config`);
                const cfg = await resp.json();
                sendResponse({ success: true, config: cfg });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "update_config") {
        (async () => {
            try {
                const resp = await fetch(`${SERVER_BASE}/config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(message.config)
                });
                const json = await resp.json();
                sendResponse({ success: json.success !== false, config: json.config });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "ping") {
        (async () => {
            try {
                const resp = await fetch(`${SERVER_BASE}/ping`, {
                    signal: AbortSignal.timeout(2000)
                });
                const json = await resp.json();
                sendResponse({ online: json.status === "ok" });
            } catch {
                sendResponse({ online: false });
            }
        })();
        return true;
    }
});
