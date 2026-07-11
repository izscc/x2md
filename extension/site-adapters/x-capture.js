/** X single-item DOM capture adapter. No I/O, GraphQL requests, or UI side effects. */
(function () {
let activeDocument = globalThis.document;
let activeLocation = globalThis.location;
let activePerformance = globalThis.performance;
// ─────────────────────────────────────────────
// 图片辅助（用于 DOM 级后备数据）
// ─────────────────────────────────────────────
function normalizeImageUrl(url) {
    if (!url || !url.includes("pbs.twimg.com")) return url;
    try {
        const u = new URL(url);
        u.searchParams.set("name", "orig");
        return u.toString();
    } catch {
        return url.replace(/name=[^&]+/, "name=orig");
    }
}

function getMeaningfulAltText(img) {
    const alt = (img?.alt || img?.getAttribute?.("alt") || "").replace(/\s+/g, " ").trim();
    if (!alt) return "";
    if (typeof isMeaningfulImageAlt === "function" && !isMeaningfulImageAlt(alt)) return "";
    return alt;
}

function collectImageAltText(map, rawUrl, img) {
    if (!rawUrl) return;
    const normalized = normalizeImageUrl(rawUrl);
    const alt = getMeaningfulAltText(img);
    if (normalized && alt) map[normalized] = alt;
}


function extractVisibleImageDescriptionText(root = activeDocument) {
    const candidates = Array.from(root.querySelectorAll?.('[role="dialog"], [aria-modal="true"], div') || []);
    for (const el of candidates) {
        const text = (el.innerText || el.textContent || "").split("\n").map((line) => line.trim()).filter(Boolean);
        const labelIndex = text.findIndex((line) => /^(图片描述|图像描述|Image description)$/i.test(line));
        if (labelIndex < 0) continue;
        const body = text.slice(labelIndex + 1)
            .filter((line) => !/^@\w{1,20}$/.test(line) && !/^(关闭|Close|ALT)$/i.test(line))
            .join("\n")
            .trim();
        if (body.length > 8) return body;
    }
    return "";
}

function extractImageAltTexts(container) {
    if (!container) return {};
    const result = {};
    container.querySelectorAll("img").forEach(img => {
        if (img.closest('[data-testid="simpleTweet"]')) return;
        const src = img.src || img.getAttribute("src") || "";
        if (src.includes("pbs.twimg.com") &&
            !src.includes("profile_images") &&
            !src.includes("emoji")) {
            collectImageAltText(result, src, img);
        }
        const srcset = img.getAttribute("srcset") || "";
        if (srcset) {
            srcset.split(",").map(s => s.trim().split(/\s+/)[0]).forEach(u => {
                if (u.includes("pbs.twimg.com") && !u.includes("profile_images") && !u.includes("emoji")) {
                    collectImageAltText(result, u, img);
                }
            });
        }
    });
    const visibleDescription = extractVisibleImageDescriptionText(activeDocument);
    if (visibleDescription) result.__x2md_fallback_alt = visibleDescription;
    return result;
}

function extractImages(container) {
    if (!container) return [];
    const imgs = new Set();

    // ── 优先：Twitter 明确的图片容器 ─────────────
    // 推文图片
    container.querySelectorAll('[data-testid="tweetPhoto"] img').forEach(img => {
        if (img.closest('[data-testid="simpleTweet"]')) return;
        const src = img.src || img.getAttribute("src") || "";
        if (src && !src.includes("profile_images") && !src.includes("emoji")) {
            imgs.add(normalizeImageUrl(src));
        }
        // 也从 srcset 取最高分辨率
        const srcset = img.getAttribute("srcset") || "";
        if (srcset) {
            const best = srcset.split(",").map(s => s.trim().split(/\s+/))
                .sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0];
            if (best && best[0]) imgs.add(normalizeImageUrl(best[0]));
        }
    });

    // 视频封面（videoPlayer / videoComponent）
    container.querySelectorAll('[data-testid="videoComponent"] video, [data-testid="videoPlayer"] video').forEach(v => {
        if (v.poster && !v.poster.includes("profile_images")) imgs.add(normalizeImageUrl(v.poster));
    });

    // 推文卡片缩略图（link preview / product card）
    container.querySelectorAll('[data-testid*="card"] img, [data-testid*="Card"] img').forEach(img => {
        if (img.closest('[data-testid="simpleTweet"]')) return;
        const src = img.src || img.getAttribute("src") || "";
        if (src && !src.includes("profile_images") && !src.includes("emoji")) {
            imgs.add(normalizeImageUrl(src));
        }
    });

    // ── 通用 fallback：所有 pbs.twimg.com 图片全量提取（彻底防止漏网之鱼） ───
    container.querySelectorAll("img").forEach(img => {
        if (img.closest('[data-testid="simpleTweet"]')) return;
        const src = img.src || img.getAttribute("src") || "";
        if (src.includes("pbs.twimg.com") &&
            !src.includes("profile_images") &&
            !src.includes("emoji")) {
            imgs.add(normalizeImageUrl(src));
        }
        const srcset = img.getAttribute("srcset") || "";
        if (srcset) {
            srcset.split(",").map(s => s.trim().split(/\s+/)[0]).forEach(u => {
                if (u.includes("pbs.twimg.com") && !u.includes("profile_images") && !u.includes("emoji")) {
                    imgs.add(normalizeImageUrl(u));
                }
            });
        }
    });

    return Array.from(imgs);
}

// ─────────────────────────────────────────────
// 推文 URL 提取（关键：从书签按钮找到推文链接）
// ─────────────────────────────────────────────
function findTweetUrl(btn) {
    // 向上找包含 article 的容器
    let el = btn;
    let depth = 0;
    let articleEl = null;
    while (el && depth < 25) {
        if (el.tagName === "ARTICLE" || el.getAttribute?.("role") === "article") {
            articleEl = el;
            break;
        }
        el = el.parentElement;
        depth++;
    }

    // X may replace the clicked bookmark button before the delayed capture runs.
    // On a status detail page, recover the matching article instead of falling
    // back to the first status link in the document (often the thread root).
    if (!articleEl && activeLocation.pathname.includes("/status/")) {
        const currentPath = activeLocation.pathname.match(/^(\/[^/]+\/status\/\d+)/)?.[1] || "";
        if (currentPath) {
            articleEl = [...activeDocument.querySelectorAll("article, [role='article']")].find((article) =>
                [...article.querySelectorAll('a[href*="/status/"]')].some((link) => {
                    const href = link.getAttribute("href") || "";
                    return href === currentPath || href.startsWith(`${currentPath}/`) || href.startsWith(`${currentPath}?`);
                })
            ) || null;
        }
    }

    const ctx = articleEl || activeDocument;

    // 从 article 内找 status URL
    const statusLinks = ctx.querySelectorAll('a[href*="/status/"]');
    for (const link of statusLinks) {
        const href = link.getAttribute("href");
        if (href && /\/[^/]+\/status\/\d+/.test(href)) {
            // 只保留 /user/status/id 部分，去掉 /analytics 等后缀
            const cleaned = href.match(/^(\/[^/]+\/status\/\d+)/)?.[1] || href;
            return {
                url: new URL(cleaned, activeLocation.origin).href,
                article: articleEl
            };
        }
    }

    // 详情页：从当前 URL 只取 /user/status/id 部分
    if (activeLocation.pathname.includes("/status/")) {
        const m = activeLocation.pathname.match(/^(\/[^/]+\/status\/\d+)/);
        const cleanPath = m ? m[1] : activeLocation.pathname;
        return { url: activeLocation.origin + cleanPath, article: articleEl };
    }

    return { url: "", article: articleEl };
}

// ─────────────────────────────────────────────
// Note/Article 页面 URL 判断（支持两种格式）
//   /i/article/xxx
//   /username/article/xxx
// ─────────────────────────────────────────────
function isNotePageUrl(pathname) {
    const pathway = pathname || activeLocation.pathname;
    return pathway.startsWith("/i/article") ||
        /^\/[^/]+\/article\//.test(pathway);
}

// ─────────────────────────────────────────────
// 检测是否是 Note 长文推文，返回文章链接
// ─────────────────────────────────────────────
function detectNoteUrl(article) {
    const ctx = article || activeDocument;
    // 找推文中指向 article 链接（两种格式均匹配）
    // 格式1: /i/article/{id}
    // 格式2: /{username}/article/{id}
    // 严格要求 /article/ 后是数字 ID，防止误匹配 /article/xxx/media/yyy
    const noteLinks = ctx.querySelectorAll('a[href*="/article/"]');
    for (const link of noteLinks) {
        const href = link.getAttribute("href") || "";
        // 只匹配 /article/{纯数字ID} 结尾，排除 /media/ 等子路径
        if (/\/(i\/article|[^/]+\/article)\/\d+$/.test(href)) {
            return new URL(href, activeLocation.origin).href;
        }
    }

    // 增强判定：有时卡片中仅使用 t.co 链接，但在显示文本中为真正的 article URL
    const allLinks = ctx.querySelectorAll('a');
    for (const link of allLinks) {
        const text = link.innerText || "";
        const href = link.href || "";
        const match = text.match(/x\.com\/(i\/article|[^/]+\/article)\/\d+/) || href.match(/x\.com\/(i\/article|[^/]+\/article)\/\d+/);
        if (match) {
            return `https://${match[0]}`;
        }
    }

    // 如果当前页面就是 article 页面
    if (isNotePageUrl()) {
        return activeLocation.href.split("?")[0];
    }
    return null;
}


function findFirstStatusUrl(container) {
    const links = container ? container.querySelectorAll('a[href*="/status/"]') : [];
    for (const link of links) {
        const href = link.getAttribute("href") || "";
        const match = href.match(/^(\/[^/]+\/status\/\d+)/);
        if (match) return new URL(match[1], activeLocation.origin).href;
    }
    return "";
}

function buildQuoteTweetPayload(quote) {
    if (!quote) return null;

    const text = (quote.querySelector?.('[data-testid="tweetText"]')?.innerText?.trim() || "").trim();
    const images = [];
    const image_alt_texts = {};
    quote.querySelectorAll?.('[data-testid="tweetPhoto"] img, img').forEach((img) => {
        const src = img.src || img.getAttribute("src") || "";
        if (!src.includes("pbs.twimg.com") || src.includes("profile_images") || src.includes("emoji")) return;
        const parentLink = img.closest('a[href*="/status/"]');
        const quoteUrl = findFirstStatusUrl(quote);
        const quoteId = quoteUrl.match(/\/status\/(\d+)/)?.[1] || "";
        const parentHref = parentLink?.getAttribute("href") || "";
        if (quoteId && parentHref && !parentHref.includes(`/status/${quoteId}`)) return;
        const normalized = normalizeImageUrl(src);
        if (!images.includes(normalized)) images.push(normalized);
        collectImageAltText(image_alt_texts, src, img);
    });

    const url = findFirstStatusUrl(quote);
    if (!text && images.length === 0 && !url) return null;
    return { text, images, image_alt_texts, videos: [], url };
}

function extractRelatedTweetAfterArticleBasic(sourceUrl = "") {
    const body = activeDocument.querySelector(
        '[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"], ' +
        '[data-testid="twitterArticleReadView"], [data-testid="article-content"]'
    );
    const articles = [...activeDocument.querySelectorAll('article, [role="article"]')];
    const sourceId = sourceUrl.match(/\/status\/(\d+)/)?.[1] || "";
    const startIndex = Math.max(0, articles.findIndex((item) => item.contains(body)));

    for (const item of articles.slice(startIndex + 1, startIndex + 4)) {
        const url = findFirstStatusUrl(item);
        if (!url || (sourceId && url.includes(`/status/${sourceId}`))) continue;
        const payload = buildQuoteTweetPayload(item);
        if (payload) return payload;
    }
    return null;
}

function extractQuoteTweetBasic(article) {
    const quote = article?.querySelector?.('[data-testid="simpleTweet"]');
    return buildQuoteTweetPayload(quote);
}

// ─────────────────────────────────────────────
// 作者信息（基础后备）
// ─────────────────────────────────────────────
function extractAuthorBasic(article) {
    let author = "", handle = "";
    const ctx = article || activeDocument;

    const nameEl = ctx.querySelector('[data-testid="User-Name"]');
    if (nameEl) {
        for (const span of nameEl.querySelectorAll("span")) {
            const txt = span.textContent.trim();
            if (txt.startsWith("@") && !handle) handle = txt;
            else if (txt && !txt.startsWith("@") && !author &&
                !txt.includes("·") && txt.length < 50) author = txt;
        }
    }

    // fallback：从 status 链接提取 handle
    if (!handle) {
        const statusLink = ctx.querySelector('a[href*="/status/"]');
        if (statusLink) {
            const m = statusLink.getAttribute("href").match(/^\/([^/]+)\/status\//);
            if (m) handle = "@" + m[1];
        }
    }

    return { author, handle };
}

// ─────────────────────────────────────────────
// 推文文字（后备：Syndication API 失败时使用）
// ─────────────────────────────────────────────
function stripLeadingReplyMentions(text) {
    return String(text || "").replace(/^(?:\s*@\w{1,20})+\s*/u, "").trimStart();
}

function extractTweetTextBasic(article) {
    const selectors = [
        '[data-testid="tweetText"]',
        'div[lang]',
        'div[dir="auto"]',
    ];
    for (const sel of selectors) {
        const ctx = article || activeDocument;
        const els = ctx.querySelectorAll(sel);
        for (const el of els) {
            // 跳过 User-Name 容器内的内容
            if (el.closest('[data-testid="User-Name"]')) continue;
            const text = el.innerText.trim();
            if (text && text.length > 5) return text;
        }
    }
    return "";
}

// ─────────────────────────────────────────────
// X Article 检测与内容提取
// ─────────────────────────────────────────────
function detectAndExtractArticle() {
    // ── 触发条件：在 /i/article/ 页面，或页面包含 Note 的主容器 ──
    const isArticlePage = isNotePageUrl();
    const hasNoteView = !!activeDocument.querySelector(
        '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"]'
    );

    if (!isArticlePage && !hasNoteView) return null;

    // ── 标题：Twitter Note 专用 data-testid ───────────
    const titleEl =
        activeDocument.querySelector('[data-testid="twitter-article-title"]') ||
        activeDocument.querySelector('[data-testid="article-title"]') ||
        activeDocument.querySelector("h1");
    const articleTitle = titleEl ? titleEl.innerText.trim() : "";

    // ── 作者信息 ─────────────────────────────────────
    const { author, handle } = extractAuthorBasic(null);
    const timeEl = activeDocument.querySelector("time");
    const published = timeEl ? timeEl.getAttribute("datetime") : "";

    // ── 文章正文容器（优先完整阅读流，保留嵌入引用推文的原始位置）─
    // 严格限制：只尝试抓取 Note 核心流，决不回退到普通的 <article> 避免将转赞评抓入。
    const readContainer = activeDocument.querySelector('[data-testid="twitterArticleReadView"]');
    const bodyContainer =
        activeDocument.querySelector('[data-testid="twitterArticleRichTextView"]') ||
        activeDocument.querySelector('[data-testid="longformRichTextComponent"]') ||
        readContainer ||
        activeDocument.querySelector('[data-testid="article-content"]');

    if (!bodyContainer) return null; // 无法定位专有正文容器时直接放弃，让背景去真实页面解析

    const extractionContainer = readContainer || bodyContainer;
    let article_content = "";
    try {
        article_content = extractArticleMarkdown(extractionContainer);
        if (!article_content) {
            article_content = extractionContainer.innerText.trim().slice(0, 5000);
        }
    } catch (e) {
        console.error("[x2md] DFS提取失败: ", e);
        article_content = extractionContainer.innerText.trim().slice(0, 5000);
    }

    // ── 源 URL：Note 页面 → 找关联的 /status/ 链接 ─
    let sourceUrl = activeLocation.href.split("?")[0];
    // 如果不是 /status/ 链接，从页面找推文来源
    if (!sourceUrl.includes("/status/")) {
        const statusLink = activeDocument.querySelector('a[href*="/status/"]');
        if (statusLink) {
            const href = statusLink.getAttribute("href");
            const m = href.match(/^(\/[^/]+\/status\/\d+)/);
            if (m) sourceUrl = new URL(m[1], activeLocation.origin).href;
        }
    }

    // ── 网页全局 MP4 提取与高清优选 (包含 React Fiber 深度探测) ──
    const allMp4s = activeDocument.documentElement.innerHTML.match(/https?:\/\/video\.twimg\.com\/[^"'\s\\]+?\.mp4(?:\?tag=\d+)?/g) || [];

    // 强制探测所有的 video 节点及其父元素的 React state，寻找被长文框架封闭的 MP4 直链
    const getReactPropsKey = (element) => Object.keys(element).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
    activeDocument.querySelectorAll('video').forEach(video => {
        let currentElement = video;
        let maxDepth = 15;
        while (currentElement && maxDepth > 0) {
            const propKey = getReactPropsKey(currentElement);
            if (propKey) {
                try {
                    const strProps = JSON.stringify(currentElement[propKey] || {});
                    const matches = strProps.match(/https?:\/\/video\.twimg\.com\/[^\s"',\\]+?\.mp4[^\s"',\\]*/g) || [];
                    allMp4s.push(...matches);
                } catch (e) { }
            }
            currentElement = currentElement.parentElement;
            maxDepth--;
        }
    });

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

    // 合并相邻相同的视频占位符（避免 video 和 img 双触发产生重复）
    article_content = article_content.replace(/(?:\[\[VIDEO_HOLDER_(\d+)\]\]\s*)+/g, '\n[[VIDEO_HOLDER_$1]]\n');

    article_content = article_content.replace(/\[\[VIDEO_HOLDER_(\d+)\]\]/g, (match, mediaId) => {
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
        return `\n[[VIDEO_HOLDER_${mediaId}]]\n`; // 未在 DOM 层面找到 MP4 时，保留原始占位符交给 background 通过 API 去补拿
    });
    const finalVideos = Array.from(new Set(extractedVideos));

    // 只从长文正文容器补充未内联的图片。不要扫描整条推文卡片，
    // 否则 status 页的预览/母贴图片会被挪到正文开头，破坏 Article 原始顺序。
    const extractedImages = [];
    bodyContainer.querySelectorAll('img').forEach(img => {
        const src = img.src || '';

        if (src.includes('pbs.twimg.com') && !src.includes('profile_images') && !src.includes('emoji')) {
            const cleanImg = src.split('?')[0];
            if (!article_content.includes(cleanImg) && !extractedImages.find(u => u.includes(cleanImg))) {
                try {
                    const u = new URL(src);
                    u.searchParams.set('name', 'orig');
                    extractedImages.push(u.href);
                } catch (e) {
                    extractedImages.push(src);
                }
            }
        }
    });

    return {
        type: "article",
        url: sourceUrl,
        author,
        handle,
        published,
        article_title: articleTitle,
        article_content: article_content,
        images: extractedImages,
        image_alt_texts: extractImageAltTexts(bodyContainer),
        videos: finalVideos,
        quote_tweet: extractQuoteTweetBasic(activeDocument) || extractRelatedTweetAfterArticleBasic(sourceUrl),
        graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
    };
}

// ─────────────────────────────────────────────
// 线程推文（仅详情页，且 Syndication API 成功后会被替换）
// ─────────────────────────────────────────────
function extractThreadBasic(firstArticle, mainHandle) {
    if (!activeLocation.pathname.includes("/status/")) return [];
    const articles = [...activeDocument.querySelectorAll("article, [role='article']")];
    const idx = articles.indexOf(firstArticle);
    if (idx === -1) return [];
    const thread = [];
    for (let i = idx + 1; i < articles.length; i++) {
        const art = articles[i];
        const { handle } = extractAuthorBasic(art);
        if (handle && handle !== mainHandle) break;
        const text = stripLeadingReplyMentions(extractTweetTextBasic(art));
        const images = extractImages(art);
        if (text || images.length) thread.push({ text, images });
    }
    return thread;
}

function extractDiscoveredGraphQLOperationIds() {
    const urls = [];

    try {
        for (const entry of activePerformance.getEntriesByType("resource") || []) {
            if (entry && typeof entry.name === "string") {
                urls.push(entry.name);
            }
        }
    } catch (error) { }

    try {
        const html = activeDocument.documentElement?.innerHTML || "";
        const matches = html.match(/https?:\/\/x\.com\/i\/api\/graphql\/[A-Za-z0-9_-]+\/(?:TweetDetail|TweetResultByRestId)[^"'\\\s<]*/g) || [];
        urls.push(...matches);
    } catch (error) { }

    return extractGraphQLOperationIdsFromUrls(urls);
}

function capture(context = {}) {
    const previous = { document: activeDocument, location: activeLocation, performance: activePerformance };
    activeDocument = context.document || globalThis.document;
    activeLocation = context.location || globalThis.location;
    activePerformance = context.performance || globalThis.performance;
    try {
        if (!activeDocument || !activeLocation) throw new Error("X capture context requires document and location");
        const capturedAt = context.capturedAt || new Date().toISOString();
        const operationIds = context.graphqlOperationIds || extractDiscoveredGraphQLOperationIds();
        let legacy;

        if (isNotePageUrl(activeLocation.pathname)) {
            legacy = detectAndExtractArticle();
            if (!legacy) return null;
        } else {
            const found = findTweetUrl(context.trigger);
            if (!found.url) return null;
            const article = found.article;
            const { author, handle } = extractAuthorBasic(article);
            const published = (article?.querySelector("time") || activeDocument.querySelector("time"))?.getAttribute("datetime") || "";
            const images = extractImages(article || activeDocument);
            const imageAltTexts = extractImageAltTexts(article || activeDocument);
            const noteArticleUrl = detectNoteUrl(article);
            if (noteArticleUrl) {
                const inline = detectAndExtractArticle();
                legacy = inline && String(inline.article_content || "").trim().length > 50
                    ? { ...inline, url: found.url, author: inline.author || author, handle: inline.handle || handle,
                        published: inline.published || published, image_alt_texts: { ...imageAltTexts, ...(inline.image_alt_texts || {}) } }
                    : { type: "note", url: found.url, note_article_url: noteArticleUrl, author, handle, published,
                        images, image_alt_texts: imageAltTexts, text: extractTweetTextBasic(article), thread_tweets: [] };
            } else {
                const thread = extractThreadBasic(article, handle);
                legacy = { type: "tweet", url: found.url, author, handle, published,
                    text: extractTweetTextBasic(article), images, image_alt_texts: imageAltTexts,
                    quote_tweet: extractQuoteTweetBasic(article), thread_tweets: thread };
            }
        }

        const sourceId = String(legacy.url || "").match(/\/(?:status|article)\/(\d+)/)?.[1];
        const media = [
            ...(legacy.images || []).map((url) => ({ kind: "image", url, ...(legacy.image_alt_texts?.[url] ? { alt: legacy.image_alt_texts[url] } : {}) })),
            ...(legacy.videos || []).map((url) => ({ kind: "video", url })),
        ];
        const relations = {};
        if (legacy.quote_tweet) relations.quote = legacy.quote_tweet;
        if (Array.isArray(legacy.thread_tweets) && legacy.thread_tweets.length) relations.thread = legacy.thread_tweets;
        const contentType = legacy.type === "article" || legacy.type === "note"
            ? "article"
            : (relations.thread ? "thread" : "tweet");
        return {
            schema_version: 1,
            source: { platform: "x", url: legacy.url, canonical_url: legacy.url, ...(sourceId ? { source_id: sourceId } : {}), captured_at: capturedAt },
            content: {
                type: contentType,
                ...(legacy.article_title ? { title: legacy.article_title } : {}),
                ...(legacy.text ? { text: legacy.text } : {}),
                ...(legacy.article_content ? { markdown: legacy.article_content } : {}),
                ...((legacy.author || legacy.handle) ? { author: { ...(legacy.author ? { name: legacy.author } : {}), ...(legacy.handle ? { handle: legacy.handle } : {}) } } : {}),
                ...(legacy.published ? { published_at: legacy.published } : {}),
            },
            media,
            ...(Object.keys(relations).length ? { relations } : {}),
            diagnostics: { capture_path: legacy.type === "article" || legacy.type === "note" ? "x-dom-article" : "x-dom-tweet", graphql_operation_ids: operationIds },
            ...(legacy.note_article_url ? { x_note_article_url: legacy.note_article_url } : {}),
        };
    } finally {
        activeDocument = previous.document;
        activeLocation = previous.location;
        activePerformance = previous.performance;
    }
}

function normalize(document) {
    if (!document || document.schema_version !== 1 || document.source?.platform !== "x") {
        throw new Error("normalize expects an X CaptureDocumentV1");
    }
    const images = document.media.filter((item) => item.kind === "image").map((item) => item.url);
    const videos = document.media.filter((item) => item.kind !== "image").map((item) => item.url);
    const imageAltTexts = Object.fromEntries(document.media.filter((item) => item.kind === "image" && item.alt).map((item) => [item.url, item.alt]));
    const legacy = {
        type: document.content.type === "article" ? (document.x_note_article_url && !document.content.markdown ? "note" : "article") : "tweet",
        url: document.source.url,
        ...(document.x_note_article_url ? { note_article_url: document.x_note_article_url } : {}),
        ...(document.content.title ? { article_title: document.content.title } : {}),
        ...(document.content.markdown ? { article_content: document.content.markdown } : {}),
        author: document.content.author?.name || "",
        handle: document.content.author?.handle || "",
        text: document.content.text || "",
        published: document.content.published_at || "",
        images,
        image_alt_texts: imageAltTexts,
        videos,
        quote_tweet: document.relations?.quote || null,
        thread_tweets: document.relations?.thread || [],
        graphql_operation_ids: document.diagnostics?.graphql_operation_ids || {},
    };
    if (document.preferences?.custom_save_path_name) {
        legacy.x2md_custom_save_path = { name: document.preferences.custom_save_path_name };
    }
    return legacy;
}

const adapter = { capture, normalize };
globalThis.xCaptureAdapter = adapter;
// Temporary global aliases for non-save X features; captureAndSend uses only the adapter entrypoint.
Object.assign(globalThis, { normalizeImageUrl, extractImageAltTexts, extractImages, findTweetUrl, isNotePageUrl,
    detectNoteUrl, extractQuoteTweetBasic, extractAuthorBasic, stripLeadingReplyMentions, extractTweetTextBasic,
    detectAndExtractArticle, extractThreadBasic, extractDiscoveredGraphQLOperationIds });
if (typeof module !== "undefined" && module.exports) module.exports = adapter;
})();
