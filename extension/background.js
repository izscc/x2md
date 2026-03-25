/**
 * background.js - X2MD Service Worker v1.3
 *
 * 获取完整推文的 3 层策略（依次降级）：
 *   1. Twitter GraphQL API (TweetDetail) — 携带 cookie，获取最完整数据
 *   2. Twitter oEmbed API — 公开接口，无需认证，可获取完整文字
 *   3. DOM 原始数据（content.js 采集到的）— 最后兜底
 */

importScripts("media_helpers.js");
importScripts("twitter_graphql.js");

let SERVER_BASE = "http://127.0.0.1:9527";

// 从本地存储恢复用户自定义端口
chrome.storage.local.get("x2md_port", (data) => {
    if (data.x2md_port) SERVER_BASE = `http://127.0.0.1:${data.x2md_port}`;
});

// 动态注册额外 Discourse 域名的内容脚本
async function registerDiscourseContentScripts(domains) {
    // 先移除旧的动态注册
    try {
        await chrome.scripting.unregisterContentScripts({ ids: ["x2md-discourse-extra"] });
    } catch { /* 不存在则忽略 */ }

    // 过滤掉已在 manifest 中声明的 linux.do
    const extraDomains = (domains || []).filter(d => d.toLowerCase() !== "linux.do");
    if (extraDomains.length === 0) return;

    const matches = extraDomains.map(d => `https://${d}/*`);
    try {
        // 先请求可选权限
        const granted = await chrome.permissions.request({ origins: matches }).catch(() => false);
        if (!granted) {
            console.warn("[x2md] 用户未授权额外域名权限:", extraDomains);
        }
        await chrome.scripting.registerContentScripts([{
            id: "x2md-discourse-extra",
            matches,
            js: ["dom_utils.js", "article_markdown.js", "discourse.js", "site_actions.js", "content.js"],
            runAt: "document_idle",
        }]);
        console.log("[x2md] 已注册额外 Discourse 域名:", extraDomains);
    } catch (err) {
        console.warn("[x2md] 注册 Discourse 内容脚本失败:", err);
    }
}

// 启动时从服务器获取配置并注册额外域名
(async () => {
    try {
        const resp = await fetch(`${SERVER_BASE}/config`, { signal: AbortSignal.timeout(3000) });
        const cfg = await resp.json();
        if (cfg.discourse_domains) {
            registerDiscourseContentScripts(cfg.discourse_domains);
        }
    } catch { /* 服务未启动，跳过 */ }
})();
const GRAPHQL_DISCOVERY_CACHE = new Map();
const _graphqlInflight = new Map();   // 防止并发重复请求同一 origin

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

    // 如果已有并发请求在执行，等待它的结果，避免重复请求
    if (_graphqlInflight.has(cacheKey)) {
        return _graphqlInflight.get(cacheKey);
    }

    const fetchPromise = (async () => {
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
    })();

    _graphqlInflight.set(cacheKey, fetchPromise);
    try {
        return await fetchPromise;
    } finally {
        _graphqlInflight.delete(cacheKey);
    }
}

// ─────────────────────────────────────────────
// 获取 Twitter Note 文章内容（通过后台 Tab 渲染提取）
// 1. 后台静默打开 /article/ 页面
// 2. 等待 twitterArticleRichTextView 渲染
// 3. executeScript 提取完整内容
// 4. 关闭 tab
// ─────────────────────────────────────────────
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
                                    const src = img.src || '';
                                    if (src && src.includes('pbs.twimg.com') && !src.includes('profile_images')) {
                                        const u = new URL(src);
                                        u.searchParams.set('name', 'orig');
                                        if (!contentStr.includes(u.href)) coverImg += `![](${u.href})\n\n`;
                                    }
                                });

                                return { title, content: coverImg + contentStr, images: [], videos: finalVideos }; // 放开视频包裹以并入 payload
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

                // 等待 tab 完成加载后开始轮询（含超时自动清理防止泄漏）
                const tabTimeout = setTimeout(() => {
                    chrome.tabs.onUpdated.removeListener(listener);
                    if (!resolved) poll(); // 超时后仍尝试轮询一次（但先检查 resolved 防止竞态）
                }, 12000);
                function listener(changedTabId, info) {
                    if (changedTabId === tabId && (info.status === 'complete' || info.status === 'error')) {
                        chrome.tabs.onUpdated.removeListener(listener);
                        clearTimeout(tabTimeout);
                        if (info.status === 'complete') {
                            setTimeout(poll, 1500);
                        } else {
                            poll(); // error 状态也尝试一次
                        }
                    }
                }
                chrome.tabs.onUpdated.addListener(listener);
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
            "Authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
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
                    const parsed = parseLegacyTweet(threadTweet, threadTweet.core?.user_results?.result?.legacy);
                    if (parsed && (parsed.text || parsed.images.length || parsed.videos.length)) {
                        threadParsed.push(parsed);
                    }
                }
            }

            mainParsed.thread_tweets = threadParsed;
            mainParsed._graphql_source = `${plan.operationName}:${plan.operationId}`;

            // ── 收集非作者回复（评论功能）──
            if (authorRestId && allTweets.length > 0) {
                const replyTweets = allTweets.filter((result) =>
                    result.core?.user_results?.result?.rest_id !== authorRestId
                );
                if (replyTweets.length > 0) {
                    mainParsed._replyTweets = replyTweets.map((rt, idx) => {
                        const userLegacy = rt.core?.user_results?.result?.legacy;
                        const parsed = parseLegacyTweet(rt, userLegacy);
                        return {
                            floor: idx + 2,
                            author: parsed?.author || userLegacy?.name || "匿名",
                            handle: parsed?.handle || (userLegacy?.screen_name ? `@${userLegacy.screen_name}` : ""),
                            content: parsed?.text || "",
                            published: parsed?.published || "",
                            images: parsed?.images || [],
                        };
                    });
                }
            }

            return mainParsed;
        }

        console.warn("[x2md] 所有 GraphQL 候选请求均失败");
        return null;

    } catch (err) {
        console.error("[x2md] GraphQL API 异常：", err);
        return null;
    }
}

// ─────────────────────────────────────────────
// 解析 GraphQL legacy tweet 对象
// ─────────────────────────────────────────────
function parseLegacyTweet(result, userLegacy) {
    const legacy = result.legacy || result.tweet?.legacy;
    if (!legacy) return null;

    let text = "";
    // X 对于非常长的推文（非专有 article）会把全文存放在 note_tweet 中
    const noteTweetResult = result.note_tweet?.note_tweet_results?.result || result.tweet?.note_tweet?.note_tweet_results?.result;
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

    const articleMedia = extractArticleMediaVideos(result);
    videos.push(...articleMedia.videos);
    videoDurations.push(...articleMedia.videoDurations);

    const author = userLegacy?.name || "";
    const handle = userLegacy?.screen_name ? "@" + userLegacy.screen_name : "";
    const published = legacy.created_at || "";

    return {
        text,
        images: Array.from(new Set(images)),
        videos: Array.from(new Set(videos)),
        videoDurations,
        author,
        handle,
        published,
    };
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
    };
}

// ─────────────────────────────────────────────
// 消息处理
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    if (message.action === "save_tweet") {
        (async () => {
            const serverBase = SERVER_BASE;   // 快照，防止并发修改
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
                            videos: [...(enrichedData.videos || []), ...(noteResult.videos || [])],
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
                                videos: [...(data.videos || []), ...(noteResult.videos || [])],
                            };
                        } else {
                            data.text = data.text + `\n\n📔 完整长文：${articleUrl}`;
                        }
                    }
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
                    // noteResult.videos 已在上方合并到 data.videos，无需额外处理

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

                // --------- 获取服务端配置 ---------
                let enableVideoDownload = true;
                let durationThresholdMin = 5;
                let cfg = {};
                try {
                    const cfgResp = await fetch(`${serverBase}/config`);
                    if (!cfgResp.ok) throw new Error(`HTTP ${cfgResp.status}`);
                    cfg = await cfgResp.json();
                    enableVideoDownload = cfg.enable_video_download !== false;
                    durationThresholdMin = cfg.video_duration_threshold || 5;
                } catch (e) { console.warn("[x2md] 获取配置失败，使用默认设置", e); }

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
                    // 二次确认：content.js 会设置 download_video，但防御性兜底
                    if (data.download_video === undefined) data.download_video = true;
                } else {
                    // 如果本身就不含任何视频（但为了防止键位缺失赋予默认状态）
                    data.download_video = true;
                }
                // ---------------------------------------------

                // ── 注入评论/回复数据（如果配置开启且有回复）──
                if (cfg.enable_comments && data._replyTweets && data._replyTweets.length > 0) {
                    data.comments = data._replyTweets;
                    delete data._replyTweets;
                } else {
                    delete data._replyTweets;
                }

                const resp = await fetch(`${serverBase}/save`, {
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
        return true;
    }

    if (message.action === "force_save_tweet") {
        (async () => {
            const serverBase = SERVER_BASE;   // 快照
            try {
                const data = message.data;

                // 填充遗留的视频占位符（与 save_tweet 保持一致）
                let contentToFix = data.article_content || data.content || "";
                if (contentToFix.includes("[[VIDEO_HOLDER_")) {
                    const filledContent = fillArticleVideoPlaceholders(contentToFix, data.videos || []);
                    const extractedVideoUrls = Array.from(
                        filledContent.matchAll(/\[MEDIA_VIDEO_URL:(.+?)\]/g),
                        (match) => match[1],
                    );
                    if (data.article_content) data.article_content = filledContent;
                    else data.content = filledContent;
                    data.videos = Array.from(new Set([...(data.videos || []), ...extractedVideoUrls]));
                }

                const resp = await fetch(`${serverBase}/save`, {
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
            const serverBase = SERVER_BASE;   // 快照
            try {
                const resp = await fetch(`${serverBase}/config`);
                const cfg = await resp.json();
                // 如果开启了同步，用 sync 中的扩展配置覆盖（save_paths 等本地专属字段不同步）
                const syncData = await chrome.storage.sync.get("x2md_sync").catch(() => ({}));
                if (syncData.x2md_sync && syncData.x2md_sync.sync_enabled) {
                    const synced = syncData.x2md_sync;
                    const SYNC_FIELDS = ["filename_format", "max_filename_length",
                        "enable_video_download", "video_duration_threshold", "show_site_save_icon",
                        "enable_platform_folders", "download_images", "image_subfolder",
                        "overwrite_existing",
                        "enable_comments", "comments_display", "max_comments", "comment_floor_range",
                        "discourse_domains", "embed_mode"];
                    for (const k of SYNC_FIELDS) {
                        if (synced[k] !== undefined) cfg[k] = synced[k];
                    }
                    cfg.sync_enabled = true;
                }
                // 缓存端口到 local storage，下次启动时无需先请求服务即可使用正确端口
                if (cfg.port) {
                    chrome.storage.local.set({ x2md_port: cfg.port });
                    SERVER_BASE = `http://127.0.0.1:${cfg.port}`;
                }
                sendResponse({ success: true, config: cfg });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "update_config") {
        (async () => {
            const serverBase = SERVER_BASE;   // 快照
            try {
                const resp = await fetch(`${serverBase}/config`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(message.config)
                });
                const json = await resp.json();
                // 如果开启了同步，将可同步字段写入 chrome.storage.sync
                if (message.config.sync_enabled) {
                    const SYNC_FIELDS = ["filename_format", "max_filename_length",
                        "enable_video_download", "video_duration_threshold", "show_site_save_icon",
                        "enable_platform_folders", "download_images", "image_subfolder",
                        "overwrite_existing",
                        "enable_comments", "comments_display", "max_comments", "comment_floor_range",
                        "discourse_domains", "embed_mode"];
                    const toSync = { sync_enabled: true };
                    for (const k of SYNC_FIELDS) {
                        if (message.config[k] !== undefined) toSync[k] = message.config[k];
                    }
                    await chrome.storage.sync.set({ x2md_sync: toSync }).catch(() => {});
                } else if (message.config.sync_enabled === false) {
                    await chrome.storage.sync.remove("x2md_sync").catch(() => {});
                }
                // 更新端口缓存
                if (message.config.port) {
                    chrome.storage.local.set({ x2md_port: message.config.port });
                    SERVER_BASE = `http://127.0.0.1:${message.config.port}`;
                }
                // 更新 Discourse 域名动态注册
                if (message.config.discourse_domains) {
                    registerDiscourseContentScripts(message.config.discourse_domains);
                }
                sendResponse({ success: json.success !== false, config: json.config });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "get_sync_status") {
        (async () => {
            try {
                const data = await chrome.storage.sync.get("x2md_sync");
                sendResponse({ enabled: !!(data.x2md_sync && data.x2md_sync.sync_enabled) });
            } catch {
                sendResponse({ enabled: false });
            }
        })();
        return true;
    }

    if (message.action === "ping") {
        (async () => {
            const serverBase = SERVER_BASE;   // 快照
            try {
                const resp = await fetch(`${serverBase}/ping`, {
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
