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
importScripts("translation_helpers.js");
importScripts("save_response.js");

const SERVER_BASE = "http://127.0.0.1:9527";
const TWITTER_BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
const GRAPHQL_DISCOVERY_CACHE = new Map();
const GRAPHQL_STORAGE_CACHE_KEY = typeof GRAPHQL_OPS_STORAGE_KEY === "string" ? GRAPHQL_OPS_STORAGE_KEY : "graphql_ops_v1";
const PLAIN_TEXT_TRANSLATE_CHUNK_SIZE = 2600;
const USER_BY_SCREEN_NAME_OPERATION_IDS = ["2qvSHpkWTMS9i0zJAwDNiA"];
const USER_TWEETS_OPERATION_IDS = ["hr4gzZONlq23okjU8fIe_A"];
const USER_ARTICLES_TWEETS_OPERATION_IDS = ["tC8Mkunj-1cqFwXmw0DQRg"];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function noteGraphQLError(options, code) {
    if (options?.errorSink && code && !options.errorSink.code) {
        options.errorSink.code = code;
        options.errorSink.message = graphQLErrorMessage(code);
    }
}


function chromeStorageGet(key) {
    return new Promise((resolve) => {
        try {
            if (typeof chrome === "undefined" || !chrome.storage?.local) return resolve(undefined);
            chrome.storage.local.get(key, (items) => resolve(items?.[key]));
        } catch (error) {
            resolve(undefined);
        }
    });
}

function chromeStorageSet(key, value) {
    return new Promise((resolve) => {
        try {
            if (typeof chrome === "undefined" || !chrome.storage?.local) return resolve(false);
            chrome.storage.local.set({ [key]: value }, () => resolve(true));
        } catch (error) {
            resolve(false);
        }
    });
}

async function readStoredGraphQLOperationIds() {
    const cached = normalizeGraphQLOperationCache(await chromeStorageGet(GRAPHQL_STORAGE_CACHE_KEY));
    return hasGraphQLOperationCache(cached) ? cached : { TweetDetail: [], TweetResultByRestId: [] };
}

async function writeStoredGraphQLOperationIds(ids) {
    const normalized = normalizeGraphQLOperationCache(ids);
    if (!hasGraphQLOperationCache(normalized)) return;
    await chromeStorageSet(GRAPHQL_STORAGE_CACHE_KEY, {
        TweetDetail: normalized.TweetDetail,
        TweetResultByRestId: normalized.TweetResultByRestId,
        updated_at: Date.now(),
    });
}

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
                await writeStoredGraphQLOperationIds(discovered);
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

                                const extractionContainer = container;
                                let contentStr = "";
                                try {
                                    contentStr = extractArticleMarkdown(extractionContainer);
                                } catch (e) {
                                    contentStr = extractionContainer.innerText || "";
                                }

                                function normalizeArticleImageUrl(src) {
                                    if (!src || !String(src).includes("pbs.twimg.com")) return "";
                                    if (String(src).includes("profile_images") || String(src).includes("emoji")) return "";
                                    try {
                                        const url = new URL(src);
                                        url.searchParams.set("name", "orig");
                                        return url.href;
                                    } catch (error) {
                                        return src;
                                    }
                                }

                                function collectArticleImages(root) {
                                    const urls = [];
                                    const seen = new Set();
                                    const scope = root || document;
                                    scope.querySelectorAll("img").forEach(img => {
                                        if (img.closest('[data-testid="videoComponent"]')) return;
                                        const candidates = [img.currentSrc, img.src, img.getAttribute("src")].filter(Boolean);
                                        const srcset = img.getAttribute("srcset") || "";
                                        if (srcset) {
                                            candidates.push(...srcset.split(",").map(part => part.trim().split(/\s+/)[0]).filter(Boolean));
                                        }
                                        for (const candidate of candidates) {
                                            if (String(candidate).includes("video_thumb")) continue;
                                            const normalized = normalizeArticleImageUrl(candidate);
                                            if (!normalized || seen.has(normalized)) continue;
                                            seen.add(normalized);
                                            urls.push(normalized);
                                        }
                                    });
                                    return urls;
                                }

                                const articleImages = collectArticleImages(container);

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

                                // 只允许正文容器内的图片作为兜底列表，避免把 status 卡片预览图整体前置。
                                const finalImages = Array.from(new Set(articleImages));
                                const existingMarkdown = contentStr;
                                const missingImages = finalImages.filter(imageUrl => {
                                    const bareUrl = imageUrl.split("?")[0];
                                    return !existingMarkdown.includes(imageUrl) && !existingMarkdown.includes(bareUrl);
                                });
                                if (missingImages.length > 0) {
                                    contentStr = `${contentStr.trim()}\n\n${missingImages.map(url => `![](${url})`).join("\n\n")}`.trim();
                                }

                                const plainText = [title, container.innerText || ""]
                                    .map((part) => String(part || "").trim())
                                    .filter(Boolean)
                                    .join("\n\n");

                                return { title, content: contentStr, plainText, images: finalImages, videos: finalVideos }; // 放开视频包裹以并入 payload
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
            noteGraphQLError(options, "AUTH_REQUIRED");
            return null;
        }
        let discoveredOperationIds = options.graphqlOperationIds || {};
        if (!hasDiscoveredOperationIds(discoveredOperationIds)) {
            discoveredOperationIds = await readStoredGraphQLOperationIds();
        }
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
            let resp = null;
            for (let attempt = 0; attempt < 4; attempt += 1) {
                resp = await fetch(url, {
                    credentials: "include",
                    headers,
                });

                if (resp.status !== 429 || attempt === 3) break;

                const delayMs = getGraphQLRetryDelayMs(resp, attempt);
                console.warn(`[x2md] ${plan.operationName}(${plan.operationId}) 被限流，${delayMs}ms 后重试 (${attempt + 1}/3)`);
                await sleep(delayMs);
            }

            if (!resp.ok) {
                const code = classifyGraphQLHttpStatus(resp.status);
                noteGraphQLError(options, code);
                console.warn(`[x2md] ${plan.operationName}(${plan.operationId}) 返回 ${resp.status} (${code})`);
                if (code === "AUTH_REQUIRED" || code === "RATE_LIMITED") break;
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


function normalizeTwitterMediaUrl(url) {
    if (!url || !String(url).includes("pbs.twimg.com")) return String(url || "");
    try {
        const parsed = new URL(url);
        parsed.searchParams.set("name", "orig");
        return parsed.href;
    } catch (error) {
        return String(url).replace(/name=[^&]+/, "name=orig");
    }
}

function normalizeAltText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function isMeaningfulImageAltText(value) {
    const alt = normalizeAltText(value);
    if (!alt) return false;
    return !new Set([
        "image", "photo", "picture", "article cover image",
        "图片", "照片", "图像", "封面图片", "文章封面图片",
    ]).has(alt.toLowerCase());
}

function mergeImageAltTextMaps(...maps) {
    const result = {};
    for (const map of maps) {
        if (!map || typeof map !== "object") continue;
        for (const [url, altText] of Object.entries(map)) {
            const normalizedUrl = normalizeTwitterMediaUrl(url);
            const normalizedAlt = normalizeAltText(altText);
            if (normalizedUrl && isMeaningfulImageAltText(normalizedAlt) && !result[normalizedUrl]) {
                result[normalizedUrl] = normalizedAlt;
            }
        }
    }
    return result;
}

function readMediaAltText(media) {
    return normalizeAltText(
        media?.ext_alt_text ||
        media?.ext?.alt_text ||
        media?.accessibility_label ||
        media?.accessibilityLabel ||
        ""
    );
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
    const imageAltTexts = {};
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
            const imageUrl = normalizeTwitterMediaUrl(m.media_url_https);
            images.push(imageUrl);
            const altText = readMediaAltText(m);
            if (isMeaningfulImageAltText(altText)) imageAltTexts[imageUrl] = altText;
        } else if (m.type === "video" || m.type === "animated_gif") {
            if (m.media_url_https) {
                const imageUrl = normalizeTwitterMediaUrl(m.media_url_https);
                images.push(imageUrl); // 保存视频的缩略图作为备份或底图
                const altText = readMediaAltText(m);
                if (isMeaningfulImageAltText(altText)) imageAltTexts[imageUrl] = altText;
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
    const graphqlArticle = extractArticleMarkdownFromGraphQL(tweet || result);

    const author = userLegacy?.name || "";
    const handle = userLegacy?.screen_name ? "@" + userLegacy.screen_name : "";
    const published = legacy.created_at || "";

    const parsed = {
        text,
        images: Array.from(new Set(images)),
        image_alt_texts: imageAltTexts,
        videos: Array.from(new Set(videos)),
        videoDurations,
        author,
        handle,
        published,
        x_article_api: graphqlArticle,
        poll_data: extractPollFromTweetResult(tweet || result),
        community_notes: extractCommunityNotesFromTweetResult(tweet || result),
        link_card: extractLinkCardFromTweetResult(tweet || result),
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
    const graphQLError = {};
    let apiResult = await fetchViaGraphQL(tweetId, {
        graphqlOperationIds: tweetData.graphql_operation_ids,
        pageUrl: tweetData.url,
        errorSink: graphQLError,
    });

    // 策略2：oEmbed（GraphQL 失败时）
    if (!apiResult || !apiResult.text) {
        console.log("[x2md] GraphQL 失败，尝试 oEmbed");
        apiResult = await fetchViaOEmbed(tweetData.url);
    }

    if (!apiResult) {
        console.log("[x2md] 所有 API 均失败，使用 DOM 原始数据");
        return graphQLError.code ? { ...tweetData, _x2md_warning_code: graphQLError.code, _x2md_warning: graphQLError.message } : tweetData;
    }

    console.log(`[x2md] API 获取成功：text=${apiResult.text.slice(0, 50)} images=${apiResult.images.length}`);

    return {
        ...tweetData,
        _api_fetched: true,
        text: apiResult.text || tweetData.text,
        images: (apiResult.images && apiResult.images.length > 0) ? apiResult.images : (tweetData.images || []),
        image_alt_texts: mergeImageAltTextMaps(tweetData.image_alt_texts, apiResult.image_alt_texts),
        videos: apiResult.videos || (tweetData.videos || []),
        videoDurations: apiResult.videoDurations || (tweetData.videoDurations || []),
        author: apiResult.author || tweetData.author,
        handle: apiResult.handle || tweetData.handle,
        published: apiResult.published || tweetData.published,
        thread_tweets: apiResult.thread_tweets && apiResult.thread_tweets.length > 0 ? apiResult.thread_tweets : (tweetData.thread_tweets || []),
        quote_tweet: apiResult.quote_tweet || tweetData.quote_tweet || null,
        x_article_api: apiResult.x_article_api || tweetData.x_article_api || null,
    };
}

function normalizeArticleUrl(url) {
    return String(url || "").replace("twitter.com", "x.com");
}

function normalizeArticleToStatusUrl(url) {
    const normalized = normalizeArticleUrl(url).split("?")[0].replace(/\/$/, "");
    const match = normalized.match(/^https?:\/\/x\.com\/([^/]+)\/article\/(\d+)$/i);
    if (!match) return "";
    return `https://x.com/${match[1]}/status/${match[2]}`;
}

function isXArticleUrl(url) {
    return /\/(?:i\/article|[^/]+\/article)\/\d+(?:$|[?#/])/.test(String(url || ""));
}

function isXStatusUrl(url) {
    return /\/status\/\d+(?:$|[?#/])/.test(String(url || ""));
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

function hasMarkdownCodeFence(content) {
    return /```[\s\S]*?```/.test(String(content || ""));
}

function countMarkdownImages(content) {
    return Array.from(String(content || "").matchAll(/!\[[^\]]*\]\((https?:\/\/pbs\.twimg\.com\/media\/[^)]+)\)/g)).length;
}

function extractMarkdownCodeFences(content) {
    return Array.from(String(content || "").matchAll(/```[\s\S]*?```/g), (match) => match[0]);
}

function mergeMissingCodeFences(content, sourceContent) {
    let merged = String(content || "");
    for (const fence of extractMarkdownCodeFences(sourceContent)) {
        if (merged.includes(fence)) continue;
        const firstCodeLine = fence.split("\n").find((line, index) => index > 0 && line.trim() && line.trim() !== "```") || "";
        if (firstCodeLine && merged.includes(firstCodeLine.trim())) continue;
        merged = `${merged.trim()}\n\n${fence}`.trim();
    }
    return merged;
}

async function enrichArticleContentFromStatusApi(data = {}) {
    if (data.type !== "article" || !String(data.url || "").includes("/status/")) return data;
    try {
        const apiData = await fetchFullTweetData({
            ...data,
            type: "tweet",
            url: data.url,
        });
        const apiArticle = apiData.x_article_api;
        if (!apiArticle?.content) return data;

        const currentContent = String(data.article_content || data.content || "").trim();
        const apiContent = String(apiArticle.content || "").trim();
        const currentImageCount = countMarkdownImages(currentContent);
        const apiImageCount = countMarkdownImages(apiContent);
        const shouldPreferApi =
            !currentContent ||
            (!hasMarkdownCodeFence(currentContent) && hasMarkdownCodeFence(apiContent)) ||
            apiImageCount > currentImageCount ||
            apiContent.length > currentContent.length * 1.15;

        const nextContent = shouldPreferApi
            ? apiContent
            : mergeMissingCodeFences(currentContent, apiContent);

        return {
            ...data,
            article_title: apiArticle.title || data.article_title || data.title || "Untitled",
            article_content: nextContent,
            images: Array.from(new Set([...(data.images || []), ...(apiArticle.images || []), ...(apiData.images || [])])),
            image_alt_texts: mergeImageAltTextMaps(data.image_alt_texts, apiData.image_alt_texts, apiArticle.image_alt_texts),
            videos: Array.from(new Set([...(data.videos || []), ...(apiArticle.videos || []), ...(apiData.videos || [])])),
            published: apiArticle.published || data.published || apiData.published || "",
        };
    } catch (error) {
        console.warn("[x2md] Article 接口补全失败，保留当前页面提取结果：", error);
        return data;
    }
}

async function resolveCopyContentText(copyData = {}) {
    let articleUrl = normalizeArticleUrl(copyData.note_article_url || copyData.article_url || "");
    let enrichedData = copyData;

    if (!articleUrl && copyData.url && copyData.url.includes("/status/")) {
        enrichedData = await fetchFullTweetData(copyData);
        articleUrl = extractArticleUrlFromText(enrichedData.text);
    }

    if (articleUrl) {
        const statusUrl = normalizeArticleToStatusUrl(articleUrl);
        const noteResult = enrichedData.x_article_api ||
            (statusUrl ? await fetchNoteContent(statusUrl) : null) ||
            await fetchNoteContent(articleUrl);
        const payload = buildCopyPayloadFromNoteResult(noteResult, enrichedData.text || copyData.text || "");
        if (payload?.text) return { ...payload, source: "x_article", articleUrl, statusUrl };
    }

    const text = String(enrichedData.text || copyData.text || "").trim();
    return { text, source: "tweet" };
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

async function enrichProfileTweetForBatch(tweetData) {
    let data = await fetchFullTweetData(tweetData || {});
    data = applyTranslationOverrideToData(data);
    return {
        ...data,
        type: "tweet",
        tweet_id: data.tweet_id || String(data.url || "").match(/\/status\/(\d+)/)?.[1] || "",
    };
}

async function fetchProfileArticleForBatch(articleData = {}) {
    const rawArticleUrl = normalizeArticleUrl(articleData.article_url || "");
    const rawUrl = normalizeArticleUrl(articleData.url || "");
    let articleUrl = rawArticleUrl || (isXArticleUrl(rawUrl) ? rawUrl : "");
    const statusFromArticle = normalizeArticleToStatusUrl(articleUrl || rawUrl);
    let sourceTweetUrl = normalizeArticleUrl(
        articleData.tweet_url ||
        articleData.status_url ||
        (isXStatusUrl(rawUrl) ? rawUrl : "") ||
        statusFromArticle
    );
    let enrichedData = articleData;

    if (sourceTweetUrl) {
        enrichedData = await fetchFullTweetData({
            ...articleData,
            type: "tweet",
            url: sourceTweetUrl,
        });
        articleUrl = articleUrl || extractArticleUrlFromText(enrichedData.text);
    }

    // 优先使用 GraphQL 中的 Article 富文本，避免额外打开后台标签；失败再走渲染兜底。
    let noteResult = enrichedData.x_article_api || null;
    if (!noteResult || !noteResult.content) {
        noteResult = sourceTweetUrl ? await fetchNoteContent(sourceTweetUrl) : null;
    }
    if ((!noteResult || !noteResult.content) && articleUrl) {
        noteResult = await fetchNoteContent(articleUrl);
    }
    if (!noteResult || !noteResult.content) {
        return null;
    }
    const finalUrl = sourceTweetUrl || articleUrl;
    return {
        ...enrichedData,
        type: "article",
        url: finalUrl,
        article_url: articleUrl || rawArticleUrl || "",
        source_tweet_url: sourceTweetUrl,
        article_title: noteResult.title || enrichedData.article_title || enrichedData.title || "Untitled",
        article_content: noteResult.content,
        text: noteResult.plainText || "",
        images: noteResult.images || [],
        videos: noteResult.videos || [],
        published: noteResult.published || enrichedData.published || articleData.published || "",
    };
}

async function postProfileCapturePayload(payload) {
    const resp = await fetch(`${SERVER_BASE}/profile-capture`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    return await resp.json();
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
                        const article = await fetchProfileArticleForBatch(item);
                        if (article) items.push(article);
                    }
                } else {
                    for (const item of rawItems) {
                        items.push(await enrichProfileTweetForBatch(item));
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

                if (data.type === "note" && data.note_article_url) {
                    // 长文 Note：后台打开 tab，等待渲染后提取完整内容
                    console.log("[x2md] 处理 Note（后台 tab 方案）：", data.note_article_url);

                    // 【关键修复】即使是解析长文，也必须对母推文本身调用 GraphQL 获取其自带的高清视频或原图，防止富媒体遗失！
                    let enrichedData = await fetchFullTweetData(data);

                    const noteStatusUrl = normalizeArticleToStatusUrl(data.note_article_url);
                    const noteResult = enrichedData.x_article_api ||
                        (noteStatusUrl ? await fetchNoteContent(noteStatusUrl) : null) ||
                        await fetchNoteContent(data.note_article_url);
                    if (noteResult && noteResult.content) {
                        // 剔除已被内联插入成功的外联原图，其余在数组末尾透传以防丢失
                        const mergedImages = [];
                        for (const img of [...(enrichedData.images || []), ...(noteResult.images || [])]) {
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
                            images: Array.from(new Set(mergedImages)),
                            image_alt_texts: mergeImageAltTextMaps(data.image_alt_texts, enrichedData.image_alt_texts, noteResult.image_alt_texts),
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

                        const articleStatusUrl = normalizeArticleToStatusUrl(articleUrl);
                        const noteResult = data.x_article_api ||
                            (articleStatusUrl ? await fetchNoteContent(articleStatusUrl) : null) ||
                            await fetchNoteContent(articleUrl);
                        if (noteResult && noteResult.content) {
                            // 同样去除已被内联插入的长文明图
                            const mergedImages = [];
                            for (const img of [...(data.images || []), ...(noteResult.images || [])]) {
                                const cleanImg = img.split('?')[0];
                                if (!noteResult.content.includes(cleanImg)) {
                                    mergedImages.push(img);
                                }
                            }

                            let prefix = "";
                            const textWithoutUrl = stripXArticleLinksFromText(data.text || "", articleUrl);
                            if (textWithoutUrl) {
                                prefix = textWithoutUrl + "\n\n---\n\n";
                            }

                            data = {
                                ...data,
                                type: "article",
                                // 如果 noteResult.title 不存在或为空，则采用推文原始内容的首行作为备用标题，避免生成带 untitled 名称的文件
                                article_title: noteResult.title || (data.text ? data.text.trim().split('\n')[0].replace(/https?:\/\/\S+/g, '').replace(/[\n\t]/g, '').slice(0, 50).trim() : "Untitled"),
                                article_content: prefix + noteResult.content,
                                images: Array.from(new Set(mergedImages)),
                                image_alt_texts: mergeImageAltTextMaps(data.image_alt_texts, noteResult.image_alt_texts),
                            };
                        } else {
                            data.text = data.text + `\n\n📔 完整长文：${articleUrl}`;
                        }
                    }
                }

                data = await enrichArticleContentFromStatusApi(data);
                const articleContentBeforeTranslation = String(data.article_content || data.content || "");
                data = applyTranslationOverrideToData(data);
                if (data.type === "article" && articleContentBeforeTranslation) {
                    data.article_content = mergeMissingCodeFences(data.article_content || data.content || "", articleContentBeforeTranslation);
                }

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
                    data.image_alt_texts = mergeImageAltTextMaps(data.image_alt_texts, apiData.image_alt_texts);
                }
                // ----------------------------------------------------

                // --------- 视频时长检测与二次确认拦截 ---------
                let enableVideoDownload = true;
                let durationThresholdMin = 5;
                let cfg = {};
                try {
                    const cfgResp = await fetch(`${SERVER_BASE}/config`);
                    cfg = await cfgResp.json();
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

                const resp = await fetch(`${SERVER_BASE}/save`, {
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

    if (message.action === "get_autostart") {
        (async () => {
            try {
                const resp = await fetch(`${SERVER_BASE}/autostart`);
                const json = await resp.json();
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
                const resp = await fetch(`${SERVER_BASE}/autostart`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ enabled: !!message.enabled })
                });
                const json = await resp.json();
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
                const resp = await fetch(`${SERVER_BASE}/ping`, {
                    signal: AbortSignal.timeout(2000)
                });
                const json = await resp.json();
                sendResponse({
                    online: json.status === "ok",
                    version: json.version || "",
                    port: new URL(SERVER_BASE).port || "9527",
                });
            } catch {
                sendResponse({ online: false });
            }
        })();
        return true;
    }
});
