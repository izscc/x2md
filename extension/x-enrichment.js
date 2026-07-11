/** X enrichment and GraphQL orchestration. Loaded as a classic MV3 worker script. */
(function (root) {
    "use strict";

    const TWITTER_BEARER_TOKEN = "AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA";
    const GRAPHQL_DISCOVERY_CACHE = new Map();
    const GRAPHQL_STORAGE_CACHE_KEY = typeof GRAPHQL_OPS_STORAGE_KEY === "string" ? GRAPHQL_OPS_STORAGE_KEY : "graphql_ops_v1";

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function formatExpandedUrlMarkdown(value) {
    const url = String(value || "").trim();
    if (!/^https?:\/\//i.test(url)) return url;
    return `[${url.replace(/^https?:\/\//i, "")}](${url})`;
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

            const contentState = getTweetContentState(mainTweet);
            if (contentState.state !== "available") {
                noteGraphQLError(options, contentState.code, contentState.message);
                return { text: "", images: [], videos: [], content_state: contentState.state, _x2md_warning_code: contentState.code, _x2md_warning: contentState.message };
            }

            const mainParsed = parseLegacyTweet(mainTweet, mainTweet.core?.user_results?.result?.legacy);
            if (!mainParsed) {
                continue;
            }
            mainParsed.content_state = contentState.state;

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

    const retweetedResult = legacy.retweeted_status_result?.result || tweet?.retweeted_status_result?.result;
    if (retweetedResult) {
        const retweetedUserLegacy = retweetedResult.core?.user_results?.result?.legacy || retweetedResult.tweet?.core?.user_results?.result?.legacy;
        const repostParsed = parseLegacyTweet(retweetedResult, retweetedUserLegacy, { ...options, quoteDepth: options.quoteDepth || 0 });
        if (repostParsed) {
            return {
                ...repostParsed,
                repost: true,
                repost_author: repostParsed.author || retweetedUserLegacy?.name || "",
                repost_source_text: repostParsed.text || "",
            };
        }
    }

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
            // 使用 split join 处理全部匹配项以防多处重复
            text = text.split(u.url).join(formatExpandedUrlMarkdown(u.expanded_url));
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
            const quoteDepth = Number(options.quoteDepth || 0) + 1;
            const quotedParsed = parseLegacyTweet(quotedResult, quoteUserLegacy, { skipQuote: quoteDepth >= 2, quoteDepth });
            if (quotedParsed && (quotedParsed.text || quotedParsed.images.length || quotedParsed.videos.length)) {
                const quotedLegacy = quotedResult.legacy || quotedResult.tweet?.legacy || {};
                const quotedHandle = quotedParsed.handle || (quoteUserLegacy?.screen_name ? "@" + quoteUserLegacy.screen_name : "");
                const quotedId = quotedLegacy.id_str || quotedResult.rest_id || quotedResult.tweet?.rest_id || "";
                parsed.quote_tweet = {
                    ...quotedParsed,
                    url: quotedHandle && quotedId ? `https://x.com/${quotedHandle.replace(/^@/, "")}/status/${quotedId}` : "",
                };
                const filteredMedia = removeTweetImagesIncludedInQuote(parsed.images, parsed.quote_tweet, parsed.image_alt_texts);
                parsed.images = filteredMedia.images;
                parsed.image_alt_texts = filteredMedia.image_alt_texts;
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
    const result = await orchestrateTweetFallback(tweetData, {
        graphql: fetchViaGraphQL,
        oembed: fetchViaOEmbed,
    });
    return result.data;
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



async function enrichCaptureData(input) {
    let data = input;
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
    return data;
}
    async function orchestrateTweetFallback(tweetData, adapters) {
        const match = String(tweetData?.url || "").match(/\/status\/(\d+)/);
        if (!match) return { data: tweetData, source: "dom", warningCode: "" };
        const errorSink = {};
        let result = await adapters.graphql(match[1], {
            graphqlOperationIds: tweetData.graphql_operation_ids,
            pageUrl: tweetData.url,
            errorSink,
        });
        let source = "graphql";
        if (!result || !result.text) {
            result = await adapters.oembed(tweetData.url);
            source = "oembed";
        }
        if (!result) {
            const data = errorSink.code
                ? { ...tweetData, _x2md_warning_code: errorSink.code, _x2md_warning: errorSink.message }
                : tweetData;
            return { data, source: "dom", warningCode: errorSink.code || "" };
        }
        return { data: mergeTweetResult(tweetData, result), source, warningCode: "" };
    }

    function mergeTweetResult(tweetData, apiResult) {
        return {
            ...tweetData,
            _api_fetched: true,
            text: apiResult.text || tweetData.text,
            images: mergeTweetImagesWithDomFallback(apiResult.images, tweetData.images),
            image_alt_texts: mergeImageAltTextMaps(tweetData.image_alt_texts, apiResult.image_alt_texts),
            videos: apiResult.videos || (tweetData.videos || []),
            videoDurations: apiResult.videoDurations || (tweetData.videoDurations || []),
            author: apiResult.author || tweetData.author,
            handle: apiResult.handle || tweetData.handle,
            published: apiResult.published || tweetData.published,
            thread_tweets: apiResult.thread_tweets?.length ? apiResult.thread_tweets : (tweetData.thread_tweets || []),
            quote_tweet: apiResult.quote_tweet || tweetData.quote_tweet || null,
            x_article_api: apiResult.x_article_api || tweetData.x_article_api || null,
            poll_data: apiResult.poll_data || tweetData.poll_data || null,
            community_notes: apiResult.community_notes || tweetData.community_notes || null,
            link_card: apiResult.link_card || tweetData.link_card || null,
        };
    }

    async function enrich(kind, value) {
        switch (kind) {
            case "tweet": return fetchFullTweetData(value);
            case "capture": return enrichCaptureData(value);
            case "note": return fetchNoteContent(value);
            case "status-article": return enrichArticleContentFromStatusApi(value);
            case "copy": return resolveCopyContentText(value);
            case "profile-tweet": return enrichProfileTweetForBatch(value);
            case "profile-article": return fetchProfileArticleForBatch(value);
            default: throw new Error(`Unknown X enrichment kind: ${kind}`);
        }
    }

    const api = { enrich, orchestrateTweetFallback, formatExpandedUrlMarkdown };
    root.X2MDXEnrichment = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
