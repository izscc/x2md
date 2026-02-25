/**
 * background.js - X2MD Service Worker v1.3
 *
 * 获取完整推文的 3 层策略（依次降级）：
 *   1. Twitter GraphQL API (TweetDetail) — 携带 cookie，获取最完整数据
 *   2. Twitter oEmbed API — 公开接口，无需认证，可获取完整文字
 *   3. DOM 原始数据（content.js 采集到的）— 最后兜底
 */

const SERVER_BASE = "http://127.0.0.1:9527";

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

                                // ── 深度遍历 DOM 还原 Markdown 及排版位置 ────────────
                                function convertToMarkdown(element) {
                                    if (element.nodeType === 3) return element.textContent; // TEXT_NODE
                                    if (element.nodeType !== 1) return ""; // ELEMENT_NODE

                                    if (element.closest('[data-testid="twitter-article-title"]')) return "";
                                    if (element.closest('[data-testid="User-Name"]')) return "";

                                    const tag = element.tagName.toLowerCase();
                                    if (tag === "video") {
                                        const poster = element.getAttribute("poster") || "";
                                        const m = poster.match(/(?:video_thumb|tweet_video_thumb|amplify_video_thumb)\/(\d+)\//);
                                        if (m) {
                                            return `\n[[VIDEO_HOLDER_${m[1]}]]\n`;
                                        }
                                    }
                                    if (tag === "img") {
                                        const src = element.src || "";
                                        if (element.closest('[data-testid="videoComponent"]') || src.includes("video_thumb")) {
                                            const m = src.match(/(?:video_thumb|tweet_video_thumb|amplify_video_thumb)\/(\d+)\//);
                                            if (m) {
                                                return `\n[[VIDEO_HOLDER_${m[1]}]]\n`;
                                            }
                                        }
                                        if (src.includes("emoji")) return element.alt || "";
                                        if (src && src.includes("pbs.twimg.com") && !src.includes("profile_images")) {
                                            try {
                                                const u = new URL(src);
                                                u.searchParams.set("name", "orig");
                                                return `\n![](${u.href})\n`;
                                            } catch (e) {
                                                return `\n![](${src})\n`;
                                            }
                                        }
                                        return "";
                                    }
                                    if (tag === "svg" || tag === "script" || tag === "style") return "";
                                    if (tag === "br") return "\n";
                                    if (tag === "hr") return "\n---\n";

                                    if (tag === "pre") {
                                        const code = element.innerText || element.textContent || "";
                                        return `\n\`\`\`\n${code}\n\`\`\`\n`;
                                    }

                                    let md = "";
                                    for (const child of element.childNodes) {
                                        md += convertToMarkdown(child);
                                    }

                                    let isBlock = ["p", "div", "section", "article", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6"].includes(tag);

                                    if (tag === "h1") md = `\n# ${md.trim()}\n`;
                                    else if (tag === "h2") md = `\n## ${md.trim()}\n`;
                                    else if (tag === "h3") md = `\n### ${md.trim()}\n`;
                                    else if (tag === "h4" || tag === "h5" || tag === "h6") md = `\n#### ${md.trim()}\n`;
                                    else if (tag === "blockquote") {
                                        const linesArr = md.trim().split('\n').filter(l => l.trim() !== '');
                                        md = '\n' + linesArr.map(l => '> ' + l).join('\n') + '\n';
                                    }
                                    else if (tag === "li") md = `\n- ${md.trim()}\n`;
                                    else if (isBlock) md = `\n${md}\n`;

                                    return md;
                                }

                                let contentStr = "";
                                try {
                                    contentStr = convertToMarkdown(container);
                                    contentStr = contentStr.replace(/\n{3,}/g, '\n\n').trim();
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
                                    return `\n🎞️ [视频/GIF]\n`;
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
async function fetchViaGraphQL(tweetId) {
    try {
        // 获取 CSRF token（ct0 cookie）
        const csrfToken = await getCookieValue("ct0");
        if (!csrfToken) {
            console.warn("[x2md] 未找到 ct0 cookie，跳过 GraphQL");
            return null;
        }

        const variables = JSON.stringify({
            focalTweetId: tweetId,
            referrer: "home",
            count: 20,
            includePromotedContent: false,
            withCommunity: true,
            withQuickPromoteEligibilityTweetFields: false,
            withBirdwatchNotes: false,
            withVoice: false,
        });

        const features = JSON.stringify({
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
        });

        const url = `https://x.com/i/api/graphql/` +
            `nBS-WpgA6ZG0CyNHD517JQ/TweetDetail` +
            `?variables=${encodeURIComponent(variables)}&features=${encodeURIComponent(features)}`;

        const resp = await fetch(url, {
            credentials: "include",
            headers: {
                "Authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
                "X-Csrf-Token": csrfToken,
                "Content-Type": "application/json",
                "x-twitter-active-user": "yes",
                "x-twitter-client-language": "zh-cn",
            }
        });

        if (!resp.ok) {
            console.warn(`[x2md] GraphQL 返回 ${resp.status}`);
            return null;
        }

        const json = await resp.json();

        // 遍历 timeline entries 找目标推文及其可能包含的长串跟帖(Thread)
        const instructions = json?.data?.threaded_conversation_with_injections_v2?.instructions || [];

        let allTweets = [];
        for (const instr of instructions) {
            if (instr.type !== "TimelineAddEntries") continue;
            for (const entry of (instr.entries || [])) {
                if (entry.entryId && entry.entryId.startsWith("tweet-")) {
                    const res = entry?.content?.itemContent?.tweet_results?.result;
                    if (res) allTweets.push(res);
                } else if (entry.entryId && entry.entryId.startsWith("conversationthread-")) {
                    for (const item of (entry.content?.items || [])) {
                        const res = item?.item?.itemContent?.tweet_results?.result;
                        if (res) allTweets.push(res);
                    }
                }
            }
        }

        let mainTweet = null;
        for (const res of allTweets) {
            if ((res.rest_id || res.tweet?.rest_id) === tweetId || (res.legacy && res.legacy.id_str === tweetId)) {
                mainTweet = res;
                break;
            }
        }

        if (!mainTweet) {
            console.warn("[x2md] GraphQL 响应中未找到目标推文");
            return null;
        }

        const mainParsed = parseLegacyTweet(mainTweet, mainTweet.core?.user_results?.result?.legacy);
        if (!mainParsed) return null;

        // 提取 Thread 并按 ID 排序（时间顺序，确保是同一作者在这条推文后发的跟帖）
        const authorRestId = mainTweet.core?.user_results?.result?.rest_id;
        let threadParsed = [];
        if (authorRestId) {
            const sameAuthorTweets = allTweets.filter(res =>
                res.core?.user_results?.result?.rest_id === authorRestId &&
                BigInt(res.legacy?.id_str || 0) > BigInt(tweetId)
            );
            // 按照推文发布时间(id_str的大小)进行正向升序
            sameAuthorTweets.sort((a, b) => (BigInt(a.legacy?.id_str || 0) < BigInt(b.legacy?.id_str || 0) ? -1 : 1));

            for (const st of sameAuthorTweets) {
                const parsed = parseLegacyTweet(st, st.core?.user_results?.result?.legacy);
                if (parsed && (parsed.text || parsed.images.length || parsed.videos.length)) {
                    threadParsed.push(parsed);
                }
            }
        }

        mainParsed.thread_tweets = threadParsed;
        return mainParsed;

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
            if (m.video_info && m.video_info.variants) {
                // 筛选出真实的 MP4 文件并挑选最高码率（最高清）的独立链接
                const mp4Variants = m.video_info.variants.filter(v => v.content_type === "video/mp4" && typeof v.bitrate !== "undefined");
                if (mp4Variants.length > 0) {
                    mp4Variants.sort((a, b) => b.bitrate - a.bitrate);
                    videos.push(mp4Variants[0].url);
                    if (m.video_info.duration_millis) {
                        videoDurations.push(m.video_info.duration_millis);
                    }
                }
            }
        }
    }

    const author = userLegacy?.name || "";
    const handle = userLegacy?.screen_name ? "@" + userLegacy.screen_name : "";
    const published = legacy.created_at || "";

    return { text, images, videos, videoDurations, author, handle, published };
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
    let apiResult = await fetchViaGraphQL(tweetId);

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

                    let extractedVideoUrls = [];
                    contentToFix = contentToFix.replace(/\[\[VIDEO_HOLDER_(\d+)\]\]/g, (match, mediaId) => {
                        const bestUrl = finalVideos.find(v => v.includes(`/${mediaId}/`));
                        if (bestUrl) {
                            extractedVideoUrls.push(bestUrl);
                            return `\n[MEDIA_VIDEO_URL:${bestUrl}]\n`;
                        }
                        return `\n🎞️ [推特媒体：视频/GIF由于隐藏过深提取失败]\n`;
                    });

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

    if (message.action === "force_save_tweet") {
        (async () => {
            try {
                const data = message.data;
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
