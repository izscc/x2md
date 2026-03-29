/**
 * background.js - X2MD Service Worker v1.5
 *
 * 获取完整推文的 3 层策略（依次降级）：
 *   1. Twitter GraphQL API (TweetDetail) — 携带 cookie，获取最完整数据
 *   2. Twitter oEmbed API — 公开接口，无需认证，可获取完整文字
 *   3. DOM 原始数据（content.js 采集到的）— 最后兜底
 *
 * 多目标保存：Obsidian (本地服务) / 飞书多维表格 / Notion Database / HTML文件
 */

importScripts("media_helpers.js");
importScripts("twitter_graphql.js");

// 调试日志开关：仅在开发时设为 true
const X2MD_DEBUG = false;
function debugLog(...args) { if (X2MD_DEBUG) console.log("[x2md]", ...args); }

let SERVER_BASE = "http://127.0.0.1:9527";

// 可同步到 chrome.storage.sync 的配置字段列表（去重定义）
const SYNC_FIELDS = [
    "filename_format", "max_filename_length",
    "enable_video_download", "video_duration_threshold", "show_site_save_icon",
    "enable_platform_folders", "download_images", "image_subfolder",
    "overwrite_existing",
    "enable_comments", "comments_display", "max_comments", "comment_floor_range",
    "discourse_domains", "embed_mode",
    "enable_wechat_video_channel",
    // 保存目标开关
    "save_to_obsidian", "save_to_feishu", "save_to_notion", "export_html",
    // 外观
    "theme",
    // 飞书 Bitable
    "feishu_api_domain", "feishu_app_id", "feishu_app_token", "feishu_table_id",
    "feishu_upload_md", "feishu_upload_html",
    // Notion Database
    "notion_database_id",
    "notion_prop_title", "notion_prop_url", "notion_prop_author",
    "notion_prop_tags", "notion_prop_saved_date", "notion_prop_type",
    // HTML 导出
    "html_export_folder",
    // 飞书一键复制
    "enable_copy_unlock",
];

// 从本地存储恢复用户自定义端口
chrome.storage.local.get("x2md_port", (data) => {
    if (data.x2md_port) SERVER_BASE = `http://127.0.0.1:${data.x2md_port}`;
});

// ── 高性能缓存层（Cache-First + Background Revalidate）──────────
// MV3 Service Worker 生命周期短暂，内存缓存易丢失，使用 chrome.storage.local 持久化
const CONFIG_CACHE_KEY = "x2md_config_cache";
const CONFIG_CACHE_TTL = 60 * 1000; // 60秒内直接使用缓存
let _configMemCache = null; // 内存快速缓存
let _configMemCacheTime = 0;

async function getCachedConfig() {
    // 内存缓存命中（最快路径）
    const now = Date.now();
    if (_configMemCache && (now - _configMemCacheTime) < CONFIG_CACHE_TTL) {
        return _configMemCache;
    }
    // 持久化缓存命中
    try {
        const stored = await chrome.storage.local.get(CONFIG_CACHE_KEY);
        const cached = stored[CONFIG_CACHE_KEY];
        if (cached && cached.data && (now - cached.time) < CONFIG_CACHE_TTL) {
            _configMemCache = cached.data;
            _configMemCacheTime = cached.time;
            return cached.data;
        }
    } catch { /* fall through */ }
    // 缓存未命中：从服务器获取
    return refreshConfigCache();
}

async function refreshConfigCache() {
    try {
        const resp = await fetch(`${SERVER_BASE}/config`, { signal: AbortSignal.timeout(3000) });
        if (resp.ok) {
            const data = await resp.json();
            const now = Date.now();
            _configMemCache = data;
            _configMemCacheTime = now;
            await chrome.storage.local.set({ [CONFIG_CACHE_KEY]: { data, time: now } });
            return data;
        }
    } catch { /* server offline */ }
    // 服务器不可达：返回过期缓存或 null
    try {
        const stored = await chrome.storage.local.get(CONFIG_CACHE_KEY);
        return stored[CONFIG_CACHE_KEY]?.data || null;
    } catch { return null; }
}

function invalidateConfigCache() {
    _configMemCache = null;
    _configMemCacheTime = 0;
    chrome.storage.local.remove(CONFIG_CACHE_KEY).catch(() => {});
}

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
        debugLog(" 已注册额外 Discourse 域名:", extraDomains);
    } catch (err) {
        console.warn("[x2md] 注册 Discourse 内容脚本失败:", err);
    }
}

// 启动时从缓存或服务器获取配置并注册额外域名
(async () => {
    try {
        const cfg = await getCachedConfig();
        if (cfg && cfg.discourse_domains) {
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
                signal: AbortSignal.timeout(8000),
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
                const scriptResp = await fetch(scriptUrl, { signal: AbortSignal.timeout(5000) });
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
                            debugLog(`Note 内容提取成功：title="${result.title.slice(0, 30)}" 长度=${result.content.length}`);
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
                signal: AbortSignal.timeout(10000),
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

    // 提取推文 hashtags
    const hashtags = [];
    const hashtagEntities = legacy.entities?.hashtags || [];
    for (const h of hashtagEntities) {
        if (h.text) hashtags.push(h.text);
    }
    // note_tweet 也可能有 hashtags
    if (noteTweetResult?.entity_set?.hashtags) {
        for (const h of noteTweetResult.entity_set.hashtags) {
            if (h.text && !hashtags.includes(h.text)) hashtags.push(h.text);
        }
    }

    return {
        text,
        images: Array.from(new Set(images)),
        videos: Array.from(new Set(videos)),
        videoDurations,
        author,
        handle,
        published,
        hashtags,
    };
}

// ─────────────────────────────────────────────
// 策略2：oEmbed API（公开接口，完整文字，但无图片）
// ─────────────────────────────────────────────
async function fetchViaOEmbed(tweetUrl) {
    try {
        const apiUrl = `https://publish.twitter.com/oembed?url=${encodeURIComponent(tweetUrl)}&omit_script=true`;
        const resp = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) });
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
    debugLog(" 开始获取完整推文：", tweetId);

    // 策略1：GraphQL API
    let apiResult = await fetchViaGraphQL(tweetId, {
        graphqlOperationIds: tweetData.graphql_operation_ids,
        pageUrl: tweetData.url,
    });

    // 策略2：oEmbed（GraphQL 失败时）
    if (!apiResult || !apiResult.text) {
        debugLog(" GraphQL 失败，尝试 oEmbed");
        apiResult = await fetchViaOEmbed(tweetData.url);
    }

    if (!apiResult) {
        debugLog(" 所有 API 均失败，使用 DOM 原始数据");
        return tweetData;
    }

    debugLog(`API 获取成功：text=${apiResult.text.slice(0, 50)} images=${apiResult.images.length}`);

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

// ═══════════════════════════════════════════════
// 通用工具：fetchWithRetry（429 退避 + 超时 + 友好错误）
// ═══════════════════════════════════════════════
async function fetchWithRetry(url, options = {}, maxRetries = 2) {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(url, { ...options, signal: controller.signal });
            clearTimeout(timeout);
            if (response.status === 429 && attempt < maxRetries) {
                const retryAfter = response.headers.get("Retry-After");
                const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : 1000 * Math.pow(2, attempt + 1);
                console.warn(`[x2md] API 429 限流，${waitTime}ms 后重试 (${attempt + 1}/${maxRetries})`);
                await new Promise(r => setTimeout(r, waitTime));
                continue;
            }
            return response;
        } catch (err) {
            clearTimeout(timeout);
            lastError = err;
            if (err.name === "AbortError") throw new Error("请求超时（30秒），请检查网络");
            if (attempt < maxRetries) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        }
    }
    throw new Error(lastError?.message || "网络请求失败");
}

// ═══════════════════════════════════════════════
// 飞书多维表格 API
// ═══════════════════════════════════════════════
const FEISHU_API_DOMAINS = {
    feishu: "https://open.feishu.cn",
    lark: "https://open.larksuite.com",
};

let feishuTokenCache = { feishu: { token: null, expireAt: 0 }, lark: { token: null, expireAt: 0 } };

async function getFeishuAccessToken(appId, appSecret, apiDomain) {
    const domainKey = apiDomain === "lark" ? "lark" : "feishu";
    const cached = feishuTokenCache[domainKey];
    if (cached.token && cached.expireAt > Date.now()) return cached.token;

    const baseUrl = FEISHU_API_DOMAINS[domainKey];
    const resp = await fetchWithRetry(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    }, 1);

    const data = await resp.json();
    if (data.code !== 0 || !data.tenant_access_token) {
        if (data.code === 10003 || data.code === 10014) throw new Error("飞书 App ID 或 App Secret 无效");
        throw new Error(`飞书认证失败: ${data.msg || "未知错误"} (code: ${data.code})`);
    }

    feishuTokenCache[domainKey] = { token: data.tenant_access_token, expireAt: Date.now() + (data.expire - 300) * 1000 };
    return data.tenant_access_token;
}

function classifyFeishuError(code, msg) {
    if (code === 1254043 || code === 1254044) return "飞书多维表格不存在或无权限，请检查 App Token 和 Table ID";
    if (code === 1254001) return "飞书 Token 已过期";
    if (code === 1254607) return "数据表不存在，请检查 table_id（以 tbl 开头）";
    if (code === 99991668 || code === 99991672) return "飞书 API 请求过于频繁，请稍后重试";
    return `飞书操作失败 (${code}): ${msg}`;
}

async function searchFeishuRecord(baseUrl, appToken, tableId, token, title) {
    try {
        const resp = await fetchWithRetry(`${baseUrl}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
                field_names: ["标题"],
                filter: { conjunction: "and", conditions: [{ field_name: "标题", operator: "is", value: [title] }] },
                page_size: 1,
            }),
        }, 1);
        const data = await resp.json();
        return data.code === 0 && data.data?.items?.length > 0 ? data.data.items[0] : null;
    } catch { return null; }
}

async function createFeishuRecord(baseUrl, appToken, tableId, token, fields) {
    const resp = await fetchWithRetry(`${baseUrl}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
    }, 1);
    const data = await resp.json();
    if (data.code !== 0) throw new Error(classifyFeishuError(data.code, data.msg));
    return data;
}

async function updateFeishuRecord(baseUrl, appToken, tableId, token, recordId, fields) {
    const resp = await fetchWithRetry(`${baseUrl}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
    }, 1);
    const data = await resp.json();
    if (data.code !== 0) throw new Error(classifyFeishuError(data.code, data.msg));
    return data;
}

async function uploadFeishuFile(baseUrl, token, blob, filename) {
    const formData = new FormData();
    formData.append("file_type", "stream");
    formData.append("file_name", filename);
    formData.append("file", blob, filename);
    const resp = await fetchWithRetry(`${baseUrl}/open-apis/drive/v1/medias/upload_all`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
    }, 1);
    const data = await resp.json();
    if (data.code !== 0 || !data.data?.file_token) throw new Error(classifyFeishuError(data.code || -1, data.msg || "文件上传失败"));
    return data.data.file_token;
}

function sanitizeFeishuFilename(name) {
    return (name || "untitled").replace(/[<>:"/\\|?*\x00-\x1f]/g, "").substring(0, 80);
}

function sanitizeFeishuTextContent(content) {
    if (!content || typeof content !== "string") return "";
    let s = content
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
        .replace(/[\u200B-\u200D\uFEFF\u2028\u2029]/g, "")
        .replace(/\r\n/g, "\n").replace(/\r/g, "\n")
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, (_, alt) => alt.trim() ? `[图片: ${alt.trim()}]` : "")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]+/g, " ")
        .replace(/^ +| +$/gm, "");
    if (s.length > 100000) s = s.substring(0, 99900) + "\n\n... (内容过长，已截断)";
    return s;
}

async function handleSaveToFeishu(data, _retried) {
    // 前置验证：必填字段
    if (!data.feishu_app_id || !data.feishu_app_secret) {
        return { success: false, error: "飞书 App ID 或 App Secret 未配置", target: "feishu" };
    }
    if (!data.feishu_app_token || !data.feishu_table_id) {
        return { success: false, error: "飞书 App Token 或 Table ID 未配置", target: "feishu" };
    }

    const baseUrl = FEISHU_API_DOMAINS[data.feishu_api_domain] || FEISHU_API_DOMAINS.feishu;
    try {
        const token = await getFeishuAccessToken(data.feishu_app_id, data.feishu_app_secret, data.feishu_api_domain);
        const title = data.article_title || data.title || (data.text || "").slice(0, 50) || "Untitled";
        const existing = await searchFeishuRecord(baseUrl, data.feishu_app_token, data.feishu_table_id, token, title);

        let mdToken = null, htmlToken = null;
        if (data.feishu_upload_md && data.markdown) {
            const blob = new Blob([data.markdown], { type: "text/markdown; charset=utf-8" });
            mdToken = await uploadFeishuFile(baseUrl, token, blob, `${sanitizeFeishuFilename(title)}.md`);
        }
        if (data.feishu_upload_html && data.htmlContent) {
            const blob = new Blob([data.htmlContent], { type: "text/html; charset=utf-8" });
            htmlToken = await uploadFeishuFile(baseUrl, token, blob, `${sanitizeFeishuFilename(title)}.html`);
        }

        // 上传图片到飞书（最多10张，避免超时）
        const imageTokens = [];
        const images = Array.isArray(data.images) ? data.images.slice(0, 10) : [];
        for (let i = 0; i < images.length; i++) {
            try {
                const imgUrl = images[i];
                if (!imgUrl || !imgUrl.startsWith("http")) continue;
                const imgResp = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
                if (!imgResp.ok) continue;
                const imgBlob = await imgResp.blob();
                const ext = (imgUrl.match(/\.(jpe?g|png|gif|webp|svg)/i) || [".jpg"])[0];
                const imgName = `${sanitizeFeishuFilename(title)}_img_${i + 1}${ext.startsWith(".") ? ext : "." + ext}`;
                const imgToken = await uploadFeishuFile(baseUrl, token, imgBlob, imgName);
                if (imgToken) imageTokens.push({ file_token: imgToken });
            } catch (_) { /* 单张图片失败不影响整体 */ }
        }

        // 构建字段（与 FEISHU_REQUIRED_FIELDS 7 个必需字段对齐）
        const tags = Array.isArray(data.tags) ? data.tags : [];
        const commentCount = Array.isArray(data.comments) ? data.comments.length : 0;
        const fields = {
            "标题": title,
            "链接": { link: data.url || "", text: data.url || "" },
            "作者": data.author || "",    // 单选字段：飞书单选传字符串即可，不存在的选项会自动创建
            "分类": data.platform || (data.type === "article" ? "文章" : data.type === "thread" ? "Thread" : "推文"),
            "标签": tags.join("、"),
            "保存时间": Date.now(),
            "评论数": commentCount,
        };
        if (mdToken) fields["附件"] = [{ file_token: mdToken }];
        if (htmlToken) fields["HTML附件"] = [{ file_token: htmlToken }];
        if (imageTokens.length > 0) fields["图片"] = imageTokens;

        if (existing) {
            await updateFeishuRecord(baseUrl, data.feishu_app_token, data.feishu_table_id, token, existing.record_id, fields);
            return { success: true, action: "updated", target: "feishu" };
        } else {
            await createFeishuRecord(baseUrl, data.feishu_app_token, data.feishu_table_id, token, fields);
            return { success: true, action: "created", target: "feishu" };
        }
    } catch (err) {
        if (!_retried && err.message && (err.message.includes("Token 已过期") || err.message.includes("token expired") || err.message.includes("1254001"))) {
            const domainKey = data.feishu_api_domain === "lark" ? "lark" : "feishu";
            feishuTokenCache[domainKey] = { token: null, expireAt: 0 };
            return handleSaveToFeishu(data, true);
        }
        return { success: false, error: err.message, target: "feishu" };
    }
}

// 飞书字段类型映射
const FEISHU_FIELD_TYPES = {
    TEXT: 1,        // 文本
    NUMBER: 2,      // 数字
    SELECT: 3,      // 单选
    DATE: 5,        // 日期
    URL: 15,        // 超链接
    ATTACHMENT: 17, // 附件
};

// 飞书多维表格必需字段（7 个）
const FEISHU_REQUIRED_FIELDS = [
    { name: "标题", type: FEISHU_FIELD_TYPES.TEXT, desc: "文本" },
    { name: "链接", type: FEISHU_FIELD_TYPES.URL, desc: "超链接" },
    { name: "作者", type: FEISHU_FIELD_TYPES.TEXT, desc: "文本" },
    { name: "分类", type: FEISHU_FIELD_TYPES.TEXT, desc: "文本" },
    { name: "标签", type: FEISHU_FIELD_TYPES.TEXT, desc: "文本" },
    { name: "保存时间", type: FEISHU_FIELD_TYPES.DATE, desc: "日期" },
    { name: "评论数", type: FEISHU_FIELD_TYPES.NUMBER, desc: "数字" },
];

function getFeishuFieldTypeName(typeCode) {
    const map = { 1: "文本", 2: "数字", 3: "单选", 4: "多选", 5: "日期", 7: "复选框", 11: "人员", 13: "电话", 15: "超链接", 17: "附件", 18: "单向关联", 21: "查找引用", 22: "公式", 23: "双向关联" };
    return map[typeCode] || `未知(${typeCode})`;
}

async function createFeishuField(baseUrl, appToken, tableId, token, fieldName, fieldType) {
    const resp = await fetchWithRetry(`${baseUrl}/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/fields`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ field_name: fieldName, type: fieldType }),
    }, 1);
    const result = await resp.json();
    if (result.code !== 0) throw new Error(`创建字段「${fieldName}」失败: ${result.msg}`);
    return result.data?.field;
}

async function handleTestFeishu(data) {
    const baseUrl = FEISHU_API_DOMAINS[data.feishu_api_domain] || FEISHU_API_DOMAINS.feishu;
    try {
        // 步骤1: 获取 token
        const token = await getFeishuAccessToken(data.feishu_app_id, data.feishu_app_secret, data.feishu_api_domain);

        // 步骤2: 获取表格字段列表
        const resp = await fetchWithRetry(`${baseUrl}/open-apis/bitable/v1/apps/${data.feishu_app_token}/tables/${data.feishu_table_id}/fields`, {
            headers: { Authorization: `Bearer ${token}` },
        }, 1);
        const result = await resp.json();
        if (result.code !== 0) throw new Error(`表格访问失败: ${result.msg}`);

        const existingFields = result.data?.items || [];
        const fieldMap = {};
        existingFields.forEach(f => {
            fieldMap[f.field_name] = { type: f.type, typeName: getFeishuFieldTypeName(f.type) };
        });

        // 步骤3: 构建完整字段列表（7个基础 + 1个条件字段）
        const requiredFields = [...FEISHU_REQUIRED_FIELDS];
        if (data.feishu_upload_md) {
            requiredFields.push({ name: "附件", type: FEISHU_FIELD_TYPES.ATTACHMENT, desc: "附件" });
        } else {
            requiredFields.push({ name: "正文", type: FEISHU_FIELD_TYPES.TEXT, desc: "文本" });
        }

        // 步骤4: 验证字段配置
        const missingFields = [];
        const wrongTypeFields = [];

        requiredFields.forEach(required => {
            const existing = fieldMap[required.name];
            if (!existing) {
                missingFields.push(required);
            } else if (existing.type !== required.type) {
                wrongTypeFields.push({
                    name: required.name,
                    expected: required.desc,
                    actual: existing.typeName,
                });
            }
        });

        // 步骤4: 如果有缺失字段，自动创建
        const createdFields = [];
        if (missingFields.length > 0) {
            for (const field of missingFields) {
                try {
                    await createFeishuField(baseUrl, data.feishu_app_token, data.feishu_table_id, token, field.name, field.type);
                    createdFields.push(field.name);
                } catch (e) {
                    // 自动创建失败时记录但不中断
                    console.warn(`[x2md] 自动创建飞书字段「${field.name}」失败:`, e.message);
                }
            }
        }

        // 步骤5: 测试访问记录
        const recordsResp = await fetchWithRetry(`${baseUrl}/open-apis/bitable/v1/apps/${data.feishu_app_token}/tables/${data.feishu_table_id}/records?page_size=1`, {
            headers: { Authorization: `Bearer ${token}` },
        }, 1);
        const recordsData = await recordsResp.json();
        const recordCount = recordsData.data?.total || 0;

        // 构建结果消息
        const domainName = data.feishu_api_domain === "lark" ? "Lark 国际版" : "飞书国内版";
        const allFieldNames = existingFields.map(f => f.field_name);
        const remainingMissing = missingFields.filter(f => !createdFields.includes(f.name));

        let message = `连接成功！\n\n`;
        message += `配置信息：\n`;
        message += `  API 版本：${domainName}\n`;
        message += `  应用认证：通过\n`;
        message += `  表格访问：正常\n`;
        message += `  现有记录：${recordCount} 条\n\n`;

        if (createdFields.length > 0) {
            message += `已自动创建缺失字段（${createdFields.length}个）：\n`;
            message += `  ${createdFields.join("、")}\n\n`;
        }

        if (wrongTypeFields.length > 0) {
            message += `字段类型不匹配（${wrongTypeFields.length}个）：\n`;
            wrongTypeFields.forEach(f => {
                message += `  「${f.name}」期望: ${f.expected}, 实际: ${f.actual}\n`;
            });
            message += `请在飞书多维表格中修正字段类型。\n\n`;
        }

        if (remainingMissing.length > 0) {
            message += `仍缺失字段（${remainingMissing.length}个，自动创建失败）：\n`;
            remainingMissing.forEach(f => {
                message += `  「${f.name}」(类型: ${f.desc})\n`;
            });
            message += `请手动在飞书多维表格中创建。\n\n`;
        }

        if (wrongTypeFields.length === 0 && remainingMissing.length === 0) {
            message += `字段验证通过（${FEISHU_REQUIRED_FIELDS.length}个必需字段）\n`;
        }

        message += `\n当前表格字段：${allFieldNames.concat(createdFields).join("、")}`;

        return {
            success: wrongTypeFields.length === 0 && remainingMissing.length === 0,
            message,
            fieldCount: allFieldNames.length + createdFields.length,
            fields: allFieldNames.concat(createdFields),
            createdFields,
            missingFields: remainingMissing.map(f => f.name),
            wrongTypeFields: wrongTypeFields.map(f => f.name),
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ═══════════════════════════════════════════════
// Notion Database API
// ═══════════════════════════════════════════════
const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

async function notionFetch(endpoint, token, options = {}) {
    const resp = await fetchWithRetry(`${NOTION_API_BASE}${endpoint}`, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
            ...(options.headers || {}),
        },
    }, 1);
    let data;
    try { data = await resp.json(); } catch { throw new Error(`Notion API 响应格式错误 (${resp.status})`); }
    if (!resp.ok) {
        if (resp.status === 401) throw new Error("Notion Token 无效或已过期");
        if (resp.status === 403) throw new Error("Notion 无权访问，请确认 Integration 已连接到 Database");
        if (resp.status === 404) throw new Error("Notion Database 不存在，请检查 Database ID");
        throw new Error(`Notion API 错误 (${resp.status}): ${data.message || JSON.stringify(data)}`);
    }
    return data;
}

async function searchNotionByUrl(databaseId, token, url, urlPropName) {
    try {
        const data = await notionFetch(`/databases/${databaseId}/query`, token, {
            method: "POST",
            body: JSON.stringify({ filter: { property: urlPropName || "链接", url: { equals: url } }, page_size: 1 }),
        });
        return data.results?.length > 0 ? data.results[0] : null;
    } catch { return null; }
}

function buildNotionProperties(d) {
    const pm = d.propMapping || {};
    const props = {};
    if (pm.title) props[pm.title] = { title: [{ text: { content: d.title || "" } }] };
    if (pm.url) props[pm.url] = { url: d.url || "" };
    if (pm.author) props[pm.author] = { rich_text: [{ text: { content: d.author || "" } }] };
    if (pm.tags && d.tags?.length > 0) props[pm.tags] = { multi_select: d.tags.map(t => ({ name: t })) };
    if (pm.savedDate) props[pm.savedDate] = { date: { start: new Date().toISOString().split("T")[0] } };
    if (pm.type) props[pm.type] = { select: { name: d.type || "推文" } };
    if (pm.commentCount) {
        const count = Array.isArray(d.comments) ? d.comments.length : (typeof d.commentCount === "number" ? d.commentCount : 0);
        props[pm.commentCount] = { number: count };
    }
    return props;
}

function parseNotionRichText(text) {
    if (!text) return [{ type: "text", text: { content: "" } }];
    if (text.length > 2000) {
        const chunks = [];
        for (let i = 0; i < text.length; i += 2000) chunks.push({ type: "text", text: { content: text.substring(i, i + 2000) } });
        return chunks;
    }
    const richText = [];
    const regex = /(\*\*(.{1,500}?)\*\*|\*(.{1,500}?)\*|`(.{1,500}?)`|~~(.{1,500}?)~~|\[([^\]]{1,300})\]\(([^)]{1,500})\)|([^*`~\[]+))/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        if (match[2]) richText.push({ type: "text", text: { content: match[2] }, annotations: { bold: true } });
        else if (match[3]) richText.push({ type: "text", text: { content: match[3] }, annotations: { italic: true } });
        else if (match[4]) richText.push({ type: "text", text: { content: match[4] }, annotations: { code: true } });
        else if (match[5]) richText.push({ type: "text", text: { content: match[5] }, annotations: { strikethrough: true } });
        else if (match[6] && match[7]) richText.push({ type: "text", text: { content: match[6], link: { url: match[7] } } });
        else if (match[8]) richText.push({ type: "text", text: { content: match[8] } });
    }
    return richText.length > 0 ? richText.filter(rt => rt.text.content.length > 0) : [{ type: "text", text: { content: text } }];
}

function mapNotionLanguage(lang) {
    const map = { js: "javascript", ts: "typescript", py: "python", rb: "ruby", sh: "bash", yml: "yaml", md: "markdown", jsx: "javascript", tsx: "typescript" };
    const lower = (lang || "").toLowerCase();
    return map[lower] || lower || "plain text";
}

function convertMarkdownToNotionBlocks(markdown) {
    if (!markdown) return [];
    const blocks = [];
    const cleanMd = markdown.replace(/^---\n[\s\S]*?\n---\n*/, "");
    const lines = cleanMd.split("\n");
    let i = 0, inCodeBlock = false, codeContent = "", codeLanguage = "";

    while (i < lines.length) {
        const line = lines[i];
        if (line.startsWith("```")) {
            if (!inCodeBlock) { inCodeBlock = true; codeLanguage = line.slice(3).trim() || "plain text"; codeContent = ""; }
            else {
                inCodeBlock = false;
                blocks.push({ type: "code", code: { rich_text: [{ type: "text", text: { content: codeContent.trimEnd() } }], language: mapNotionLanguage(codeLanguage) } });
            }
            i++; continue;
        }
        if (inCodeBlock) { codeContent += line + "\n"; i++; continue; }
        if (line.trim() === "") { i++; continue; }
        if (/^---+$/.test(line.trim())) { blocks.push({ type: "divider", divider: {} }); i++; continue; }
        if (line.startsWith("# ")) { blocks.push({ type: "heading_1", heading_1: { rich_text: parseNotionRichText(line.slice(2)) } }); i++; continue; }
        if (line.startsWith("## ")) { blocks.push({ type: "heading_2", heading_2: { rich_text: parseNotionRichText(line.slice(3)) } }); i++; continue; }
        if (line.startsWith("### ")) { blocks.push({ type: "heading_3", heading_3: { rich_text: parseNotionRichText(line.slice(4)) } }); i++; continue; }

        // 视频占位符 [MEDIA_VIDEO_URL:xxx] → video 或 embed 块
        const videoPlaceholder = line.match(/^\[MEDIA_VIDEO_URL:(https?:\/\/[^\]]+)\]$/);
        if (videoPlaceholder) {
            const vUrl = videoPlaceholder[1];
            if (/\.(mp4|webm|mov)(\?|$)/i.test(vUrl)) {
                blocks.push({ type: "video", video: { type: "external", external: { url: vUrl } } });
            } else {
                blocks.push({ type: "embed", embed: { url: vUrl } });
            }
            i++; continue;
        }

        const imgMatch = line.match(/^!\[([^\]]*)\]\(([^)]+)\)/);
        if (imgMatch && !imgMatch[2].startsWith("data:")) {
            blocks.push({ type: "image", image: { type: "external", external: { url: imgMatch[2] } } }); i++; continue;
        }
        if (line.startsWith("> ")) {
            let quoteText = line.slice(2);
            while (i + 1 < lines.length && lines[i + 1].startsWith("> ")) { i++; quoteText += "\n" + lines[i].slice(2); }
            blocks.push({ type: "quote", quote: { rich_text: parseNotionRichText(quoteText) } }); i++; continue;
        }
        // Checkbox / Todo: - [x] 或 - [ ]
        const todoMatch = line.match(/^[-*+] \[([ xX])\] (.+)/);
        if (todoMatch) {
            blocks.push({ type: "to_do", to_do: { rich_text: parseNotionRichText(todoMatch[2]), checked: todoMatch[1].toLowerCase() === "x" } }); i++; continue;
        }
        if (line.match(/^[-*+] /)) {
            blocks.push({ type: "bulleted_list_item", bulleted_list_item: { rich_text: parseNotionRichText(line.replace(/^[-*+] /, "")) } }); i++; continue;
        }
        if (line.match(/^\d+\. /)) {
            blocks.push({ type: "numbered_list_item", numbered_list_item: { rich_text: parseNotionRichText(line.replace(/^\d+\. /, "")) } }); i++; continue;
        }
        // 表格
        if (line.includes("|") && line.trim().startsWith("|")) {
            const tableRows = [];
            let maxRows = 200;
            while (i < lines.length && lines[i].includes("|") && lines[i].trim().startsWith("|") && maxRows-- > 0) {
                const row = lines[i].trim();
                if (!/^[|\-:\s]+$/.test(row)) {
                    tableRows.push(row.split("|").filter(c => c.trim() !== "").map(c => c.trim()));
                }
                i++;
            }
            if (tableRows.length > 0) {
                const tableWidth = Math.max(...tableRows.map(r => r.length));
                blocks.push({
                    type: "table", table: {
                        table_width: tableWidth, has_column_header: true, has_row_header: false,
                        children: tableRows.map(row => ({
                            type: "table_row", table_row: {
                                cells: Array.from({ length: tableWidth }, (_, idx) => [{ type: "text", text: { content: row[idx] || "" } }]),
                            },
                        })),
                    },
                });
            }
            continue;
        }
        // <details> → toggle
        if (line.startsWith("<details>")) {
            let summaryText = "", toggleContent = "";
            i++;
            while (i < lines.length && !lines[i].startsWith("</details>")) {
                if (lines[i].startsWith("<summary>")) summaryText = lines[i].replace(/<\/?summary>/g, "").replace(/<\/?b>/g, "").trim();
                else toggleContent += lines[i] + "\n";
                i++;
            }
            blocks.push({ type: "toggle", toggle: { rich_text: parseNotionRichText(summaryText || "详情"), children: [{ type: "paragraph", paragraph: { rich_text: parseNotionRichText(toggleContent.trim()) } }] } });
            i++; continue;
        }
        // <iframe> → embed（支持视频/地图等嵌入内容）
        const iframeMatch = line.match(/<iframe[^>]+src="([^"]+)"/);
        if (iframeMatch) { blocks.push({ type: "embed", embed: { url: iframeMatch[1] } }); i++; continue; }
        // 裸 URL → bookmark
        if (/^https?:\/\/\S+$/.test(line.trim())) { blocks.push({ type: "bookmark", bookmark: { url: line.trim() } }); i++; continue; }
        // 普通段落
        blocks.push({ type: "paragraph", paragraph: { rich_text: parseNotionRichText(line) } });
        i++;
    }
    return blocks;
}

async function clearNotionPageChildren(pageId, token) {
    try {
        let hasMore = true, startCursor;
        while (hasMore) {
            const params = startCursor ? `?start_cursor=${startCursor}` : "";
            const data = await notionFetch(`/blocks/${pageId}/children${params}`, token, { method: "GET" });
            for (const block of (data.results || [])) {
                try { await notionFetch(`/blocks/${block.id}`, token, { method: "DELETE" }); } catch {}
            }
            hasMore = data.has_more;
            startCursor = data.next_cursor;
        }
    } catch {}
}

async function appendNotionBlocksBatched(pageId, token, blocks) {
    for (let i = 0; i < blocks.length; i += 100) {
        await notionFetch(`/blocks/${pageId}/children`, token, {
            method: "PATCH",
            body: JSON.stringify({ children: blocks.slice(i, i + 100) }),
        });
    }
}

async function handleSaveToNotion(data) {
    // 前置验证
    if (!data.notion_token) {
        return { success: false, error: "Notion API Token 未配置", target: "notion" };
    }
    if (!data.notion_database_id) {
        return { success: false, error: "Notion Database ID 未配置", target: "notion" };
    }
    try {
        const pm = {
            title: data.notion_prop_title || "标题",
            url: data.notion_prop_url || "链接",
            author: data.notion_prop_author || "作者",
            tags: data.notion_prop_tags || "",
            savedDate: data.notion_prop_saved_date || "",
            type: data.notion_prop_type || "",
            commentCount: data.notion_prop_comment_count || "",
        };
        const title = data.article_title || data.title || (data.text || "").slice(0, 50) || "Untitled";
        const content = data.article_content || data.markdown || data.text || "";
        const existing = await searchNotionByUrl(data.notion_database_id, data.notion_token, data.url, pm.url);
        const properties = buildNotionProperties({ ...data, title, propMapping: pm, tags: data.hashtags || data.tags || [] });
        const blocks = convertMarkdownToNotionBlocks(content);

        if (existing) {
            await clearNotionPageChildren(existing.id, data.notion_token);
            await appendNotionBlocksBatched(existing.id, data.notion_token, blocks);
            await notionFetch(`/pages/${existing.id}`, data.notion_token, { method: "PATCH", body: JSON.stringify({ properties }) });
            return { success: true, action: "updated", target: "notion" };
        } else {
            const page = await notionFetch("/pages", data.notion_token, {
                method: "POST",
                body: JSON.stringify({ parent: { database_id: data.notion_database_id }, properties, children: blocks.slice(0, 100) }),
            });
            if (!page || !page.id) throw new Error("Notion 创建页面成功但未返回 page.id");
            if (blocks.length > 100) await appendNotionBlocksBatched(page.id, data.notion_token, blocks.slice(100));
            return { success: true, action: "created", target: "notion" };
        }
    } catch (err) {
        return { success: false, error: err.message, target: "notion" };
    }
}

async function handleTestNotion(data) {
    try {
        const database = await notionFetch(`/databases/${data.notion_database_id}`, data.notion_token, { method: "GET" });
        const props = database.properties || {};
        const missing = [];
        const expectedFields = [
            { key: "notion_prop_title", default: "标题", type: "title", label: "Title" },
            { key: "notion_prop_url", default: "链接", type: "url", label: "URL" },
            { key: "notion_prop_author", default: "作者", type: "rich_text", label: "Text" },
            { key: "notion_prop_tags", default: "标签", type: "multi_select", label: "Multi Select" },
            { key: "notion_prop_saved_date", default: "保存日期", type: "date", label: "Date" },
            { key: "notion_prop_type", default: "类型", type: "select", label: "Select" },
            { key: "notion_prop_comment_count", default: "评论数", type: "number", label: "Number" },
        ];
        for (const field of expectedFields) {
            const name = data[field.key] || field.default;
            if (!name) continue;
            const prop = props[name];
            if (!prop) {
                missing.push(`"${name}" (需要 ${field.label} 类型)`);
            } else if (prop.type !== field.type) {
                missing.push(`"${name}" (期望 ${field.label}, 实际 ${prop.type})`);
            }
        }
        return { success: true, databaseTitle: database.title?.[0]?.plain_text || "未命名", propertyCount: Object.keys(props).length, missingProperties: missing };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

// ═══════════════════════════════════════════════
// Markdown → HTML 简易转换（用于 HTML 导出和飞书 HTML 附件）
// ═══════════════════════════════════════════════
function convertMarkdownToHtml(md) {
    if (!md) return "";
    // 截断保护：超过 500KB 的 Markdown 只转换前 500KB
    const MAX_MD_LEN = 500000;
    let html = md.length > MAX_MD_LEN ? md.slice(0, MAX_MD_LEN) + "\n\n---\n\n（内容过长，已截断）" : md;

    // [MEDIA_VIDEO_URL:xxx] 占位符 → 视频播放器或嵌入 iframe
    html = html.replace(/\[MEDIA_VIDEO_URL:([^\]]+)\]/g, (_, url) => {
        if (!url.startsWith("http")) return `<p><em>[视频]</em></p>`;
        if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) {
            return `<p><video controls src="${url}" style="max-width:100%"></video></p>`;
        }
        // YouTube, Twitter 等嵌入内容用 iframe
        if (/youtube\.com|youtu\.be|twitter\.com|x\.com|bilibili\.com/i.test(url)) {
            return `<p><iframe src="${url}" width="100%" height="400" frameborder="0" allowfullscreen></iframe></p>`;
        }
        return `<p><a href="${url}" target="_blank">[视频链接]</a></p>`;
    });
    // Obsidian wiki-link 嵌入 ![[filename]] → 提示文字（HTML 无法访问本地 vault 文件）
    html = html.replace(/!\[\[([^\]]+)\]\]/g, (_, filename) => {
        const ext = filename.split(".").pop().toLowerCase();
        if (["mp4", "webm", "mov"].includes(ext)) return `<p><em>[视频: ${filename}]</em></p>`;
        if (["mp3", "wav", "ogg", "m4a"].includes(ext)) return `<p><em>[音频: ${filename}]</em></p>`;
        return `<p><em>[图片: ${filename}]</em></p>`;
    });
    // 代码块（```lang ... ```）—— 先修复未关闭的代码块
    const openFences = (html.match(/```/g) || []).length;
    if (openFences % 2 !== 0) html += "\n```";
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        return `<pre><code class="language-${lang || "text"}">${escaped}</code></pre>`;
    });
    // 行内代码
    html = html.replace(/`([^`\n]+)`/g, (_, code) => `<code>${code.replace(/</g, "&lt;")}</code>`);
    // 图片（必须在链接之前）
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1">');
    // 链接
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    // 标题（h1-h6，从 h6 向上匹配避免误匹配）
    html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
    html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
    html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
    html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");
    // 粗体 / 斜体 / 删除线
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");
    // 引用块（逐行标记再合并）
    html = html.replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>");
    html = html.replace(/<\/blockquote>\n<blockquote>/g, "<br>");
    // 任务列表（Obsidian 格式：- [x] / - [ ]）
    html = html.replace(/^[-*+]\s+\[x\]\s+(.+)$/gm, '<li class="task-list-item"><input type="checkbox" checked disabled> $1</li>');
    html = html.replace(/^[-*+]\s+\[ \]\s+(.+)$/gm, '<li class="task-list-item"><input type="checkbox" disabled> $1</li>');
    // 有序列表（必须在无序列表之前，防止 <li> 被无序列表二次匹配）
    html = html.replace(/^(\d+)\.\s+(.+)$/gm, '<li data-ol="$1">$2</li>');
    // 无序列表
    html = html.replace(/^[-*+]\s+(.+)$/gm, "<li>$1</li>");
    // 包裹连续 <li> 为 <ul>（区分有序和无序）
    html = html.replace(/((?:<li data-ol="\d+">.*<\/li>\n?)+)/g, (match) => {
        return "<ol>" + match.replace(/ data-ol="\d+"/g, "") + "</ol>";
    });
    html = html.replace(/((?:<li[ >].*<\/li>\n?)+)/g, (match) => {
        if (match.startsWith("<ol>")) return match; // 已处理的有序列表
        return "<ul>" + match + "</ul>";
    });
    // 分割线
    html = html.replace(/^---+$/gm, "<hr>");
    // 表格
    html = html.replace(/^(\|.+\|)\n\|[\s:|-]+\|\n((?:\|.+\|\n?)*)/gm, (_, headerRow, bodyRows) => {
        const headers = headerRow.split("|").filter(c => c.trim()).map(c => `<th>${c.trim()}</th>`).join("");
        const rows = bodyRows.trim().split("\n").filter(Boolean).map(row => {
            const cells = row.split("|").filter(c => c.trim()).map(c => `<td>${c.trim()}</td>`).join("");
            return `<tr>${cells}</tr>`;
        }).join("");
        return `<table><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>`;
    });
    // iframe 保留（已有 HTML 标签行不包裹 <p>）
    // 段落：非空非 HTML 标签行包裹 <p>
    html = html.replace(/^(?!<[a-z/]|$)(.+)$/gm, "<p>$1</p>");
    // 清理多余空行
    html = html.replace(/\n{3,}/g, "\n\n");
    return html;
}

// ═══════════════════════════════════════════════
// HTML 文件导出（base64 data URL，Service Worker 兼容）
// ═══════════════════════════════════════════════
async function handleDownloadHtml(data) {
    try {
        const rawContent = data.article_content || data.text || "";
        // 将 Markdown 转换为 HTML（而非直接塞入 body）
        const bodyHtml = convertMarkdownToHtml(rawContent);
        const title = data.article_title || data.title || "untitled";
        const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        const safeUrl = (data.url || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        const safeAuthor = (data.author || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
        const folder = data.html_export_folder ? data.html_export_folder.replace(/\/+$/, "") + "/" : "";
        const safeName = sanitizeFeishuFilename(title) || "untitled";
        const filename = `${folder}${safeName}.html`;

        const fullHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
body{max-width:800px;margin:2em auto;padding:0 1em;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;line-height:1.7;color:#333;background:#fff}
h1{font-size:1.6em;border-bottom:1px solid #eee;padding-bottom:.3em}
h2{font-size:1.3em;margin-top:1.5em}
h3{font-size:1.1em;margin-top:1.2em}
img{max-width:100%;height:auto;border-radius:4px;margin:.5em 0}
pre{background:#f6f8fa;padding:1em;overflow-x:auto;border-radius:6px;border:1px solid #e1e4e8;font-size:.9em}
code{background:#f0f0f0;padding:.15em .4em;border-radius:3px;font-size:.9em}
pre code{background:transparent;padding:0}
blockquote{border-left:4px solid #dfe2e5;margin:1em 0;padding:.5em 1em;color:#666;background:#fafafa}
a{color:#0969da;text-decoration:none}
a:hover{text-decoration:underline}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #d0d7de;padding:.5em .8em;text-align:left}
th{background:#f6f8fa;font-weight:600}
hr{border:none;border-top:1px solid #d0d7de;margin:1.5em 0}
ul,ol{padding-left:1.5em}
li{margin:.3em 0}
.meta{color:#666;font-size:.9em;margin-bottom:1.5em}
.meta a{color:#0969da}
del{color:#999}
</style></head>
<body>
<h1>${safeTitle}</h1>
<div class="meta">
<p><strong>来源：</strong><a href="${safeUrl}">${safeUrl}</a></p>
${safeAuthor ? `<p><strong>作者：</strong>${safeAuthor}</p>` : ""}
${data.published ? `<p><strong>日期：</strong>${data.published}</p>` : ""}
</div>
<hr>
${bodyHtml}
</body></html>`;

        const base64 = btoa(unescape(encodeURIComponent(fullHtml)));
        // Chrome data URL 下载上限约 2MB，超过则改用 Blob URL
        const DATA_URL_LIMIT = 2 * 1024 * 1024;
        let downloadUrl;
        if (base64.length > DATA_URL_LIMIT) {
            // Service Worker 中没有 URL.createObjectURL，降级为截断警告
            // 实际场景中 500KB Markdown（convertMarkdownToHtml 已截断）生成的 HTML base64 约 700KB-1MB，一般不会超
            return { success: false, error: "HTML 内容过大（超过 2MB），无法导出为文件", target: "html" };
        }
        downloadUrl = `data:text/html;base64,${base64}`;

        return new Promise(resolve => {
            chrome.downloads.download({ url: downloadUrl, filename, saveAs: false, conflictAction: "overwrite" }, downloadId => {
                if (chrome.runtime.lastError) resolve({ success: false, error: chrome.runtime.lastError.message, target: "html" });
                else resolve({ success: true, downloadId, target: "html" });
            });
        });
    } catch (err) {
        return { success: false, error: err.message, target: "html" };
    }
}

// ═══════════════════════════════════════════════
// 多目标保存分发（save_tweet / force_save_tweet 共用）
// ═══════════════════════════════════════════════
async function dispatchMultiTargetSave(data, serverBase, existingCfg = null) {
    // 获取完整配置（如果调用方已获取过，则复用，避免重复请求）
    let cfg = existingCfg || {};
    if (!existingCfg) {
        try {
            const cfgResp = await fetch(`${serverBase}/config`, { signal: AbortSignal.timeout(3000) });
            if (cfgResp.ok) cfg = await cfgResp.json();
            try {
                const syncData = await chrome.storage.sync.get("x2md_sync");
                if (syncData.x2md_sync) Object.assign(cfg, syncData.x2md_sync);
            } catch {}
        } catch {}
    }

    const saveResults = [];
    const saveToObsidian = cfg.save_to_obsidian !== false;
    const saveToFeishu = !!cfg.save_to_feishu;
    const saveToNotion = !!cfg.save_to_notion;
    const exportHtml = !!cfg.export_html;

    // 边界：所有保存目标都未启用
    if (!saveToObsidian && !saveToFeishu && !saveToNotion && !exportHtml) {
        return { success: false, results: [], error: "未启用任何保存目标，请在设置中至少开启一个（Obsidian/飞书/Notion/HTML）" };
    }

    // 1. Obsidian
    if (saveToObsidian) {
        try {
            const resp = await fetch(`${serverBase}/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data),
                signal: AbortSignal.timeout(30000),
            });
            const json = await resp.json();
            saveResults.push({ target: "obsidian", success: json.success !== false, result: json });
        } catch (obsErr) {
            saveResults.push({ target: "obsidian", success: false, error: obsErr.message });
        }
    }

    // 2. 补全 markdown / htmlContent 字段（在浅拷贝上操作，不污染调用方的 data）
    const enriched = { ...data };
    const markdownContent = enriched.article_content || enriched.text || "";
    if (!enriched.markdown && markdownContent) enriched.markdown = markdownContent;
    if (!enriched.htmlContent && markdownContent) enriched.htmlContent = convertMarkdownToHtml(markdownContent);

    // 3. 飞书 / Notion / HTML 并行（使用 enriched 确保含 markdown/htmlContent）
    const parallelTasks = [];
    if (saveToFeishu && cfg.feishu_app_id && cfg.feishu_app_secret) {
        parallelTasks.push(
            handleSaveToFeishu({
                ...enriched,
                feishu_app_id: cfg.feishu_app_id,
                feishu_app_secret: cfg.feishu_app_secret,
                feishu_app_token: cfg.feishu_app_token,
                feishu_table_id: cfg.feishu_table_id,
                feishu_api_domain: cfg.feishu_api_domain,
                feishu_upload_md: cfg.feishu_upload_md,
                feishu_upload_html: cfg.feishu_upload_html,
            }).catch(e => ({ success: false, error: e.message, target: "feishu" }))
        );
    }
    if (saveToNotion && cfg.notion_token && cfg.notion_database_id) {
        parallelTasks.push(
            handleSaveToNotion({
                ...enriched,
                notion_token: cfg.notion_token,
                notion_database_id: cfg.notion_database_id,
                notion_prop_title: cfg.notion_prop_title,
                notion_prop_url: cfg.notion_prop_url,
                notion_prop_author: cfg.notion_prop_author,
                notion_prop_tags: cfg.notion_prop_tags,
                notion_prop_saved_date: cfg.notion_prop_saved_date,
                notion_prop_type: cfg.notion_prop_type,
                notion_prop_comment_count: cfg.notion_prop_comment_count,
            }).catch(e => ({ success: false, error: e.message, target: "notion" }))
        );
    }
    if (exportHtml) {
        parallelTasks.push(
            handleDownloadHtml({ ...enriched, html_export_folder: cfg.html_export_folder || "X2MD导出" })
                .catch(e => ({ success: false, error: e.message, target: "html" }))
        );
    }

    if (parallelTasks.length > 0) {
        saveResults.push(...await Promise.all(parallelTasks));
    }

    // 汇总
    const anySuccess = saveResults.some(r => r.success);
    const errors = saveResults.filter(r => !r.success);
    return {
        success: anySuccess,
        results: saveResults,
        error: errors.length > 0 ? errors.map(e => `[${e.target}] ${e.error}`).join("; ") : undefined,
    };
}

// ─────────────────────────────────────────────
// 消息处理
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 安全校验：仅接受来自本扩展的消息（content scripts 或 popup/options 页面）
    if (!sender || (sender.id !== chrome.runtime.id)) {
        sendResponse({ success: false, error: "Unauthorized sender" });
        return false;
    }

    if (message.action === "save_tweet") {
        (async () => {
            const serverBase = SERVER_BASE;   // 快照，防止并发修改
            // 整体超时保护：防止 MV3 service worker 被杀后 callback 永远不返回
            const OVERALL_TIMEOUT = 60000; // 60 秒整体超时
            const timeoutId = setTimeout(() => {
                console.error("[x2md] save_tweet 整体超时（60s），强制返回错误");
                sendResponse({ success: false, error: "操作超时，请检查网络连接和本地服务是否正常运行" });
            }, OVERALL_TIMEOUT);
            try {
                let data = message.data;

                if (data.type === "note" && data.note_article_url) {
                    // 长文 Note：后台打开 tab，等待渲染后提取完整内容
                    debugLog(" 处理 Note（后台 tab 方案）：", data.note_article_url);

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
                        debugLog(" 在推文提取文本中发现长文(Note)链接，切换提取模式：", articleUrl);

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
                    debugLog(" 检测到长文包含未解析的视频占位符，尝试通过 GraphQL 兜底获取");

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

                // --------- 获取服务端配置 + 同步配置合并 ---------
                let enableVideoDownload = true;
                let durationThresholdMin = 5;
                let cfg = {};
                try {
                    const cfgResp = await fetch(`${serverBase}/config`, { signal: AbortSignal.timeout(3000) });
                    if (!cfgResp.ok) throw new Error(`HTTP ${cfgResp.status}`);
                    cfg = await cfgResp.json();
                    // 合并 chrome.storage.sync 中的扩展配置
                    try {
                        const syncData = await chrome.storage.sync.get("x2md_sync");
                        if (syncData.x2md_sync) {
                            Object.assign(cfg, syncData.x2md_sync);
                        }
                    } catch {}
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
                        debugLog(`发现超长视频 (${maxDurationMin.toFixed(1)} > ${durationThresholdMin} min)，要求前台确认`);
                        clearTimeout(timeoutId);
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

                // ── 多目标保存分发（复用共享函数，传入已获取的 cfg 避免重复请求）──
                const dispatchResult = await dispatchMultiTargetSave(data, serverBase, cfg);
                clearTimeout(timeoutId);
                sendResponse(dispatchResult);

            } catch (err) {
                clearTimeout(timeoutId);
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

                // 多目标保存分发（与 save_tweet 一致，由共享函数自行获取配置）
                const dispatchResult = await dispatchMultiTargetSave(data, serverBase);
                sendResponse(dispatchResult);
            } catch (err) {
                sendResponse({ success: false, error: err.message || String(err) });
            }
        })();
        return true;
    }

    if (message.action === "get_config") {
        (async () => {
            try {
                const cfg = await getCachedConfig();
                if (!cfg) throw new Error("无法获取配置（服务端可能未启动）");
                // 如果开启了同步，用 sync 中的扩展配置覆盖（save_paths 等本地专属字段不同步）
                const syncData = await chrome.storage.sync.get("x2md_sync").catch(() => ({}));
                if (syncData.x2md_sync && syncData.x2md_sync.sync_enabled) {
                    const synced = syncData.x2md_sync;
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
                    body: JSON.stringify(message.config),
                    signal: AbortSignal.timeout(5000),
                });
                const json = await resp.json();
                // 如果开启了同步，将可同步字段写入 chrome.storage.sync
                if (message.config.sync_enabled) {
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
                // 使配置缓存失效（下次获取走服务器）
                invalidateConfigCache();
                sendResponse({ success: json.success !== false, config: json.config });
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    if (message.action === "reset_config") {
        (async () => {
            try {
                const resp = await fetch(`${SERVER_BASE}/config/reset`, { method: "POST", signal: AbortSignal.timeout(3000) });
                const json = await resp.json();
                await chrome.storage.sync.remove("x2md_sync").catch(() => {});
                invalidateConfigCache();
                sendResponse({ success: json.success !== false });
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

    // ── 飞书连接测试 ──
    if (message.action === "test_feishu") {
        (async () => {
            try {
                const result = await handleTestFeishu(message.data || {});
                sendResponse(result);
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ── Notion 连接测试 ──
    if (message.action === "test_notion") {
        (async () => {
            try {
                const result = await handleTestNotion(message.data || {});
                sendResponse(result);
            } catch (err) {
                sendResponse({ success: false, error: err.message });
            }
        })();
        return true;
    }

    // ── 保存到飞书 ──
    if (message.action === "save_to_feishu") {
        (async () => {
            try {
                const result = await handleSaveToFeishu(message.data || {});
                sendResponse(result);
            } catch (err) {
                sendResponse({ success: false, error: err.message, target: "feishu" });
            }
        })();
        return true;
    }

    // ── 保存到 Notion ──
    if (message.action === "save_to_notion") {
        (async () => {
            try {
                const result = await handleSaveToNotion(message.data || {});
                sendResponse(result);
            } catch (err) {
                sendResponse({ success: false, error: err.message, target: "notion" });
            }
        })();
        return true;
    }

    // ── HTML 文件导出 ──
    if (message.action === "download_html") {
        (async () => {
            try {
                const result = await handleDownloadHtml(message.data || {});
                sendResponse(result);
            } catch (err) {
                sendResponse({ success: false, error: err.message, target: "html" });
            }
        })();
        return true;
    }
});
