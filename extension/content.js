/**
 * content.js - X2MD 内容脚本 v1.4
 *
 * 职责简化：只负责
 *   1. 监听书签按钮点击（首页 Feed + 详情页 + X Article）
 *   2. 提取推文基础信息（URL、作者、发布时间）+ 当前可见的文字/图片（作为后备）
 *   3. 发给 background.js → Syndication API 获取完整内容
 *
 * 完整内容（解决"显示更多"截断、图片丢失）由 background.js 处理。
 */

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


function extractVisibleImageDescriptionText(root = document) {
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
    const visibleDescription = extractVisibleImageDescriptionText(document);
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

    const ctx = articleEl || document;

    // 从 article 内找 status URL
    const statusLinks = ctx.querySelectorAll('a[href*="/status/"]');
    for (const link of statusLinks) {
        const href = link.getAttribute("href");
        if (href && /\/[^/]+\/status\/\d+/.test(href)) {
            // 只保留 /user/status/id 部分，去掉 /analytics 等后缀
            const cleaned = href.match(/^(\/[^/]+\/status\/\d+)/)?.[1] || href;
            return {
                url: new URL(cleaned, location.origin).href,
                article: articleEl
            };
        }
    }

    // 详情页：从当前 URL 只取 /user/status/id 部分
    if (location.pathname.includes("/status/")) {
        const m = location.pathname.match(/^(\/[^/]+\/status\/\d+)/);
        const cleanPath = m ? m[1] : location.pathname;
        return { url: location.origin + cleanPath, article: articleEl };
    }

    return { url: "", article: articleEl };
}

// ─────────────────────────────────────────────
// Note/Article 页面 URL 判断（支持两种格式）
//   /i/article/xxx
//   /username/article/xxx
// ─────────────────────────────────────────────
function isNotePageUrl(pathname) {
    const pathway = pathname || location.pathname;
    return pathway.startsWith("/i/article") ||
        /^\/[^/]+\/article\//.test(pathway);
}

// ─────────────────────────────────────────────
// 检测是否是 Note 长文推文，返回文章链接
// ─────────────────────────────────────────────
function detectNoteUrl(article) {
    const ctx = article || document;
    // 找推文中指向 article 链接（两种格式均匹配）
    // 格式1: /i/article/{id}
    // 格式2: /{username}/article/{id}
    // 严格要求 /article/ 后是数字 ID，防止误匹配 /article/xxx/media/yyy
    const noteLinks = ctx.querySelectorAll('a[href*="/article/"]');
    for (const link of noteLinks) {
        const href = link.getAttribute("href") || "";
        // 只匹配 /article/{纯数字ID} 结尾，排除 /media/ 等子路径
        if (/\/(i\/article|[^/]+\/article)\/\d+$/.test(href)) {
            return new URL(href, location.origin).href;
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
        return location.href.split("?")[0];
    }
    return null;
}


function findFirstStatusUrl(container) {
    const links = container ? container.querySelectorAll('a[href*="/status/"]') : [];
    for (const link of links) {
        const href = link.getAttribute("href") || "";
        const match = href.match(/^(\/[^/]+\/status\/\d+)/);
        if (match) return new URL(match[1], location.origin).href;
    }
    return "";
}

function buildQuoteTweetPayload(quote) {
    if (!quote) return null;

    const cardTarget = getTwitterArticleCardTranslationTarget(quote);
    const text = (quote.querySelector?.('[data-testid="tweetText"]')?.innerText?.trim() || cardTarget?.text || "").trim();
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

    const url = findFirstStatusUrl(quote) || cardTarget?.url || "";
    if (!text && images.length === 0 && !url) return null;
    return { text, images, image_alt_texts, videos: [], url };
}

function extractRelatedTweetAfterArticleBasic(sourceUrl = "") {
    const body = getTwitterArticleBodyContainer(document);
    const articles = [...document.querySelectorAll('article, [role="article"]')];
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
    const ctx = article || document;

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
        const ctx = article || document;
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
    const hasNoteView = !!document.querySelector(
        '[data-testid="twitterArticleReadView"], [data-testid="twitterArticleRichTextView"]'
    );

    if (!isArticlePage && !hasNoteView) return null;

    // ── 标题：Twitter Note 专用 data-testid ───────────
    const titleEl =
        document.querySelector('[data-testid="twitter-article-title"]') ||
        document.querySelector('[data-testid="article-title"]') ||
        document.querySelector("h1");
    const articleTitle = titleEl ? titleEl.innerText.trim() : "";

    // ── 作者信息 ─────────────────────────────────────
    const { author, handle } = extractAuthorBasic(null);
    const timeEl = document.querySelector("time");
    const published = timeEl ? timeEl.getAttribute("datetime") : "";

    // ── 文章正文容器（优先完整阅读流，保留嵌入引用推文的原始位置）─
    // 严格限制：只尝试抓取 Note 核心流，决不回退到普通的 <article> 避免将转赞评抓入。
    const readContainer = document.querySelector('[data-testid="twitterArticleReadView"]');
    const bodyContainer =
        document.querySelector('[data-testid="twitterArticleRichTextView"]') ||
        document.querySelector('[data-testid="longformRichTextComponent"]') ||
        readContainer ||
        document.querySelector('[data-testid="article-content"]');

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
    let sourceUrl = location.href.split("?")[0];
    // 如果不是 /status/ 链接，从页面找推文来源
    if (!sourceUrl.includes("/status/")) {
        const statusLink = document.querySelector('a[href*="/status/"]');
        if (statusLink) {
            const href = statusLink.getAttribute("href");
            const m = href.match(/^(\/[^/]+\/status\/\d+)/);
            if (m) sourceUrl = new URL(m[1], location.origin).href;
        }
    }

    // ── 网页全局 MP4 提取与高清优选 (包含 React Fiber 深度探测) ──
    const allMp4s = document.documentElement.innerHTML.match(/https?:\/\/video\.twimg\.com\/[^"'\s\\]+?\.mp4(?:\?tag=\d+)?/g) || [];

    // 强制探测所有的 video 节点及其父元素的 React state，寻找被长文框架封闭的 MP4 直链
    const getReactPropsKey = (element) => Object.keys(element).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactFiber$'));
    document.querySelectorAll('video').forEach(video => {
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
        quote_tweet: extractQuoteTweetBasic(document) || extractRelatedTweetAfterArticleBasic(sourceUrl),
        graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
    };
}

// ─────────────────────────────────────────────
// 线程推文（仅详情页，且 Syndication API 成功后会被替换）
// ─────────────────────────────────────────────
function extractThreadBasic(firstArticle, mainHandle) {
    if (!location.pathname.includes("/status/")) return [];
    const articles = [...document.querySelectorAll("article, [role='article']")];
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
        for (const entry of performance.getEntriesByType("resource") || []) {
            if (entry && typeof entry.name === "string") {
                urls.push(entry.name);
            }
        }
    } catch (error) { }

    try {
        const html = document.documentElement?.innerHTML || "";
        const matches = html.match(/https?:\/\/x\.com\/i\/api\/graphql\/[A-Za-z0-9_-]+\/(?:TweetDetail|TweetResultByRestId)[^"'\\\s<]*/g) || [];
        urls.push(...matches);
    } catch (error) { }

    return extractGraphQLOperationIdsFromUrls(urls);
}

let runtimeConfig = null;

function requestRuntimeConfig() {
    if (runtimeConfig) {
        ensureFloatingSaveButton();
        ensureXProfileCaptureButton();
        return;
    }

    chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
        runtimeConfig = resp?.success ? (resp.config || {}) : {};
        ensureFloatingSaveButton();
        ensureXProfileCaptureButton();
    });
}

function captureLinuxDoPostElement(post) {
    if (!post) {
        showToast("未找到对应帖子内容", "error", 3500);
        return;
    }

    const topicTitle =
        document.querySelector("h1 a")?.innerText?.trim() ||
        document.querySelector("h1")?.innerText?.trim() ||
        document.title.replace(/\s*-\s*LINUX DO.*$/, "").trim();

    const data = extractLinuxDoPostData(post, {
        pageUrl: location.href,
        topicTitle,
    });

    if (!data || !data.article_content.trim()) {
        showToast("帖子内容提取失败", "error", 4000);
        return;
    }

    console.log("[x2md] LINUX DO 帖子：", { url: data.url, author: data.author, title: data.article_title });
    showToast("正在保存 LINUX DO 帖子…", "loading", null);
    sendToBackground(data);
}

function captureLinuxDoPost(btn) {
    captureLinuxDoPostElement(btn.closest?.("article[data-post-id]"));
}

function findCurrentLinuxDoPost() {
    const match = location.pathname.match(/^\/t\/[^/]+\/\d+\/(\d+)\/?$/);
    if (match) {
        const exactPost = document.getElementById(`post_${match[1]}`);
        if (exactPost) return exactPost;
    }
    return document.querySelector("article[data-post-id]");
}

/**
 * 飞书虚拟渲染应对：滚动收集所有 block 元素。
 * 飞书用 IntersectionObserver 按需渲染，视口外的 block 会被替换为 placeholder。
 * 我们通过滚动 .bear-web-x-container 逐步让每个区域进入视口，
 * 对每个出现的 block 按 data-block-id 去重收集，最终返回完整的 block 数组。
 */
async function scrollAndCollectFeishuBlocks() {
    const container = document.querySelector(".bear-web-x-container");
    if (!container) {
        console.log("[x2md] 未找到 .bear-web-x-container，跳过滚动收集");
        return null;
    }

    const seen = new Map(); // blockId -> DOM element (clone)
    const originalScrollTop = container.scrollTop;

    function collect() {
        const blocks = document.querySelectorAll("#docx .block[data-block-type]");
        for (const block of blocks) {
            const id = block.getAttribute("data-block-id");
            if (!id || seen.has(id)) continue;
            // 克隆节点以保留 DOM 状态（虚拟渲染会回收原节点）
            seen.set(id, block.cloneNode(true));
        }
    }

    const step = Math.max(container.clientHeight * 0.7, 300);
    const maxPos = container.scrollHeight;

    // 向下滚动收集
    collect();
    for (let pos = 0; pos <= maxPos + step; pos += step) {
        container.scrollTop = pos;
        await new Promise((r) => setTimeout(r, 80));
        collect();
    }
    container.scrollTop = maxPos;
    await new Promise((r) => setTimeout(r, 200));
    collect();

    // 回滚收集（确保首屏区域的 block 也被收集）
    for (let pos = maxPos; pos >= 0; pos -= step) {
        container.scrollTop = pos;
        await new Promise((r) => setTimeout(r, 60));
        collect();
    }

    // 恢复原始滚动位置
    container.scrollTop = originalScrollTop;

    console.log(`[x2md] 飞书滚动收集完成：${seen.size} unique blocks`);

    // 按 blockId 排序返回（blockId 在飞书中通常是递增的）
    const sorted = Array.from(seen.entries())
        .sort((a, b) => {
            const na = parseInt(a[0], 10);
            const nb = parseInt(b[0], 10);
            if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
            return a[0].localeCompare(b[0]);
        })
        .map((entry) => entry[1]);

    return sorted;
}

function captureFeishuDocument() {
    showToast("正在滚动页面加载全部内容…", "loading", null);

    scrollAndCollectFeishuBlocks().then((collectedBlocks) => {
        const pageUrl = location.href;
        const options = { pageUrl };

        let articleContent;
        if (collectedBlocks && collectedBlocks.length > 0) {
            articleContent = extractFeishuMarkdownFromBlocks(collectedBlocks, options);
        }

        // 如果滚动收集失败或结果不佳，回退到直接提取
        if (!articleContent || articleContent.length < 50) {
            const data = extractFeishuDocumentData(document, options);
            if (!data || !data.article_content.trim()) {
                showToast("飞书文档提取失败", "error", 4000);
                return;
            }
            console.log("[x2md] Feishu 文档（直接提取）：", { url: data.url, title: data.article_title });
            showToast("正在保存飞书文档…", "loading", null);
            sendToBackground(data);
            return;
        }

        const title = extractFeishuTitle(document);
        const author = extractFeishuAuthor(document);
        const data = {
            type: "article",
            url: cleanFeishuUrl(pageUrl),
            author,
            handle: "",
            author_url: "",
            published: extractFeishuUpdated(document),
            article_title: title,
            article_content: articleContent,
            images: [],
            videos: [],
            platform: "Feishu",
        };

        console.log("[x2md] Feishu 文档（滚动收集 " + collectedBlocks.length + " blocks）：", { url: data.url, title });
        showToast("正在保存飞书文档…", "loading", null);
        sendToBackground(data);
    });
}

function captureWechatArticle() {
    const data = extractWechatDocumentData(document, { pageUrl: location.href });
    if (!data || !data.article_content.trim()) {
        showToast("微信公众号文章提取失败", "error", 4000);
        return;
    }

    console.log("[x2md] WeChat 文章：", { url: data.url, author: data.author, title: data.article_title });
    showToast("正在保存微信公众号文章…", "loading", null);
    sendToBackground(data);
}

function handleFloatingSave(siteKey) {
    if (siteKey === "linux_do") {
        captureLinuxDoPostElement(findCurrentLinuxDoPost());
        return;
    }
    if (siteKey === "feishu") {
        captureFeishuDocument();
        return;
    }
    if (siteKey === "wechat") {
        captureWechatArticle();
    }
}

// ─────────────────────────────────────────────
// X/Twitter 页面内复制正文按钮
// ─────────────────────────────────────────────
const X_INLINE_COPY_BUTTON_CLASS = "__x2md_x_inline_copy_button";
const X_INLINE_TRANSLATE_BUTTON_CLASS = "__x2md_x_inline_translate_button";
const X_INLINE_TRANSLATION_BLOCK_CLASS = "__x2md_x_inline_translation_block";
const X_INLINE_ACTIONS_CONTAINER_CLASS = "__x2md_x_inline_actions_container";
const X_INLINE_TRANSLATION_STATUS_CLASS = "__x2md_x_inline_translation_status";
const X_AUTO_TRANSLATE_LONG_PRESS_MS = 650;
const X_AUTO_TRANSLATE_MAX_CONCURRENCY = 2;
const X_NATIVE_TRANSLATE_LABELS = [
    "显示翻译",
    "翻译帖子",
    "翻译推文",
    "translate post",
    "translate tweet",
];
const X_NATIVE_SHOW_ORIGINAL_LABELS = [
    "显示原文",
    "show original",
    "show original post",
    "show original tweet",
];
const X_COPY_ICON_URL = chrome.runtime.getURL("icons/copy_5304228.png");
const X_TRANSLATE_ICON_URL = chrome.runtime.getURL("icons/translate_16818360.png");
const X_GROK_BUTTON_SELECTORS = [
    'button[aria-label*="Grok"]',
    'button[aria-label*="grok"]',
    '[role="button"][aria-label*="Grok"]',
    '[role="button"][aria-label*="grok"]',
].join(", ");

let xAutoTranslateEnabled = false;
let xAutoTranslateScheduled = false;
const xAutoTranslateDoneKeys = new Set();
const xAutoTranslateQueuedKeys = new Set();
const xAutoTranslateQueue = [];
let xAutoTranslateActiveCount = 0;

function getLocalArticleTextForCopy(article) {
    if (isNotePageUrl()) {
        const source = getTwitterArticleTranslationSource(document);
        if (source.text) return source.text;
    }

    const ctx = article || document;
    const tweetText = ctx.querySelector('[data-testid="tweetText"]')?.innerText?.trim();
    if (tweetText) return stripLeadingReplyMentions(tweetText);

    const fallback = extractTweetTextBasic(ctx);
    return stripLeadingReplyMentions(fallback || "");
}

function getTwitterArticleBodyContainer(scope = document) {
    const ctx = scope || document;
    return ctx.querySelector?.('[data-testid="twitterArticleRichTextView"]') ||
        ctx.querySelector?.('[data-testid="longformRichTextComponent"]') ||
        ctx.querySelector?.('[data-testid="twitterArticleReadView"]') ||
        ctx.querySelector?.('[data-testid="article-content"]') ||
        null;
}

function getTwitterArticleTitleElement(scope = document) {
    const ctx = scope || document;
    return ctx.querySelector?.('[data-testid="twitter-article-title"], [data-testid="article-title"], h1') || null;
}

function getTwitterArticleTranslationSource(scope = document) {
    const ctx = scope || document;
    const bodyEl = getTwitterArticleBodyContainer(ctx) || getTwitterArticleBodyContainer(document);
    const mainScope = bodyEl?.closest?.('main, [role="main"]') || ctx;
    const titleEl = getTwitterArticleTitleElement(mainScope) || getTwitterArticleTitleElement(ctx);
    return buildArticleTranslationSource({
        title: titleEl?.innerText || "",
        body: bodyEl?.innerText || "",
    });
}

function isTwitterArticleTranslationScope(scope = document) {
    const ctx = scope || document;
    if (ctx !== document) {
        return !!getTwitterArticleBodyContainer(ctx);
    }
    return isNotePageUrl() || !!getTwitterArticleBodyContainer(document);
}

function findVisibleTranslationBlock(scope = document) {
    const ctx = scope || document;
    const block = ctx.querySelector?.(`.${X_INLINE_TRANSLATION_BLOCK_CLASS}`);
    if (!block || block.style.display === "none") return null;
    return block;
}

function getDisplayedTranslationContentForCopy(scope = document) {
    const override = getElementTranslationOverride(scope) || findDescendantTranslationOverride(scope);
    const overrideText = String(override?.text || override?.article_content || "").trim();
    if (overrideText) return { text: overrideText, html: plainTextToClipboardHtml(overrideText), source: "visible_translation" };

    const block = findVisibleTranslationBlock(scope);
    const text = block?.innerText?.trim() || "";
    if (!text) return null;
    return { text, html: plainTextToClipboardHtml(text), source: "visible_translation" };
}

function buildCopyContentPayload(article, triggerButton) {
    const ctx = article || document;
    const noteArticleUrl = detectNoteUrl(ctx);
    const { url: tweetUrl } = findTweetUrl(triggerButton || ctx);
    const localText = getLocalArticleTextForCopy(article);

    return {
        type: noteArticleUrl ? "note" : "tweet",
        url: tweetUrl || location.href.split("?")[0],
        note_article_url: noteArticleUrl || "",
        text: localText,
        graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
    };
}

function requestBackgroundCopyText(payload) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: "copy_content_text", data: payload }, (resp) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            if (!resp?.success || !resp.text) {
                reject(new Error(resp?.error || "empty copy text"));
                return;
            }
            resolve({ text: resp.text, markdown: resp.markdown || "", source: resp.source || "" });
        });
    });
}

function hasInlineMarkdownLinks(text) {
    return /\[[^\]]+\]\(https?:\/\/[^)\s]+\)/.test(String(text || ""));
}

function markdownToClipboardPlainText(markdown) {
    return String(markdown || "")
        .replace(/!\[([^\]]*)\]\(https?:\/\/[^)\s]+\)/g, "$1")
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)\s]+\)/g, "$1")
        .replace(/^#{1,6}\s+/gm, "")
        .trim();
}

function normalizeRemoteCopyContent(remoteContent) {
    const text = String(remoteContent?.text || "").trim();
    const markdown = String(remoteContent?.markdown || "").trim();
    if (markdown) {
        return {
            text: text || markdownToClipboardPlainText(markdown),
            html: markdownToClipboardHtml(markdown),
            source: remoteContent.source || "remote",
        };
    }
    if (hasInlineMarkdownLinks(text)) {
        return {
            text: markdownToClipboardPlainText(text),
            html: markdownToClipboardHtml(text),
            source: remoteContent?.source || "remote",
        };
    }
    return {
        text,
        html: text ? plainTextToClipboardHtml(text) : "",
        source: remoteContent?.source || "remote",
    };
}

function isCopyScopeShowingTranslatedTweet(scope = document) {
    const target = getTranslationTarget(scope);
    if (!target || target.kind !== "tweet") return false;
    if (targetHasVisibleTranslation(target)) return true;
    return !!findNativeTwitterTranslationControl(scope, "original");
}

async function requestBackgroundTweetTranslationForCopy(payload) {
    const tweetId = extractTweetIdFromUrl(payload?.url || "");
    if (!tweetId) return null;
    const result = await requestBackgroundTweetTranslation({
        url: payload.url,
        tweetId,
    });
    const text = String(result?.translatedText || "").trim();
    if (!text) return null;
    return {
        text,
        html: plainTextToClipboardHtml(text),
        source: "tweet_translation_api",
    };
}

async function resolveContentForCopy(article, triggerButton) {
    const scope = article || document;
    await expandCollapsedTweetText(scope);

    const payload = buildCopyContentPayload(article, triggerButton);
    const visibleTranslation = getDisplayedTranslationContentForCopy(article || document) ||
        (article && article !== document ? getDisplayedTranslationContentForCopy(document) : null);

    if (isCopyScopeShowingTranslatedTweet(scope)) {
        try {
            const translatedContent = await requestBackgroundTweetTranslationForCopy(payload);
            if (translatedContent?.text) return translatedContent;
        } catch (error) {
            console.warn("[x2md] 后台提取 X 译文失败，回退当前显示译文：", error);
        }
        if (visibleTranslation?.text) return visibleTranslation;
    }

    if (visibleTranslation?.text) {
        return visibleTranslation;
    }

    if (payload.note_article_url || payload.url?.includes("/status/")) {
        try {
            const remoteContent = await requestBackgroundCopyText(payload);
            if (remoteContent?.text) {
                return normalizeRemoteCopyContent(remoteContent);
            }
        } catch (error) {
            console.warn("[x2md] 后台提取 X 正文失败，回退当前 DOM：", error);
        }
    }

    const text = payload.text || getLocalArticleTextForCopy(article);
    return { text, html: text ? plainTextToClipboardHtml(text) : "" };
}

function escapeHtml(value) {
    return String(value || "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function inlineMarkdownToHtml(text) {
    let html = escapeHtml(text);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    return html;
}

function plainTextToClipboardHtml(text) {
    return String(text || "")
        .split(/\n{2,}/)
        .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
        .join("\n");
}

function markdownToClipboardHtml(markdown) {
    const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
    const html = [];
    let paragraph = [];
    let list = [];
    let quote = [];
    let inCode = false;
    let codeLines = [];

    const flushParagraph = () => {
        if (!paragraph.length) return;
        html.push(`<p>${inlineMarkdownToHtml(paragraph.join("\n")).replace(/\n/g, "<br>")}</p>`);
        paragraph = [];
    };
    const flushList = () => {
        if (!list.length) return;
        html.push(`<ul>${list.map((item) => `<li>${inlineMarkdownToHtml(item)}</li>`).join("")}</ul>`);
        list = [];
    };
    const flushQuote = () => {
        if (!quote.length) return;
        html.push(`<blockquote>${quote.map((line) => `<p>${inlineMarkdownToHtml(line)}</p>`).join("")}</blockquote>`);
        quote = [];
    };
    const flushCode = () => {
        if (!codeLines.length) return;
        html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        codeLines = [];
    };
    const flushAll = () => {
        flushParagraph();
        flushList();
        flushQuote();
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (line.startsWith("```")) {
            if (inCode) {
                flushCode();
                inCode = false;
            } else {
                flushAll();
                inCode = true;
                codeLines = [];
            }
            continue;
        }
        if (inCode) {
            codeLines.push(rawLine);
            continue;
        }

        if (!line.trim()) {
            flushAll();
            continue;
        }

        const heading = line.match(/^(#{1,4})\s+(.+)$/);
        if (heading) {
            flushAll();
            const level = Math.min(heading[1].length, 4);
            html.push(`<h${level}>${inlineMarkdownToHtml(heading[2].trim())}</h${level}>`);
            continue;
        }

        const image = line.match(/^!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)$/);
        if (image) {
            flushAll();
            html.push(`<p><img src="${escapeHtml(image[2])}" alt="${escapeHtml(image[1])}"></p>`);
            continue;
        }

        const listItem = line.match(/^[-*]\s+(.+)$/);
        if (listItem) {
            flushParagraph();
            flushQuote();
            list.push(listItem[1]);
            continue;
        }

        const quoteLine = line.match(/^>\s?(.*)$/);
        if (quoteLine) {
            flushParagraph();
            flushList();
            quote.push(quoteLine[1]);
            continue;
        }

        flushList();
        flushQuote();
        paragraph.push(line);
    }

    if (inCode) flushCode();
    flushAll();
    return html.join("\n");
}

function copyHtmlViaSelection(html, text) {
    const container = document.createElement("div");
    container.contentEditable = "true";
    container.innerHTML = html || escapeHtml(text).replace(/\n/g, "<br>");
    Object.assign(container.style, {
        position: "fixed",
        top: "-9999px",
        left: "-9999px",
        opacity: "0",
        pointerEvents: "none",
    });
    document.body.appendChild(container);

    const range = document.createRange();
    range.selectNodeContents(container);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    const ok = document.execCommand("copy");
    selection.removeAllRanges();
    container.remove();
    if (!ok) throw new Error("copy command failed");
}

async function copyContentToClipboard(content) {
    const text = String(content?.text || "").trim();
    const html = String(content?.html || "").trim();
    if (!text) throw new Error("empty text");

    if (html && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
            new ClipboardItem({
                "text/html": new Blob([html], { type: "text/html" }),
                "text/plain": new Blob([text], { type: "text/plain" }),
            }),
        ]);
        return;
    }

    if (html) {
        copyHtmlViaSelection(html, text);
        return;
    }

    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }

    copyHtmlViaSelection("", text);
}

function extractTweetIdFromUrl(url) {
    return String(url || "").match(/\/status\/(\d+)/)?.[1] || "";
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function findExpandableTweetTextControls(scope = document) {
    const ctx = scope || document;
    const controls = [];
    for (const el of ctx.querySelectorAll?.('button, [role="button"]') || []) {
        if (el.closest(`.${X_INLINE_TRANSLATION_BLOCK_CLASS}`)) continue;
        const text = (el.innerText || el.textContent || el.getAttribute?.("aria-label") || "").trim();
        if (isExpandableTweetTextControl(text)) controls.push(el);
    }
    return controls;
}

async function expandCollapsedTweetText(scope = document) {
    const ctx = scope || document;
    const textRoot = ctx === document ? document.body : ctx;
    const beforeText = normalizeSpaces(textRoot?.innerText || textRoot?.textContent || "");
    const controls = findExpandableTweetTextControls(ctx);
    if (!controls.length) return 0;

    let clicked = 0;
    for (const control of controls.slice(0, 3)) {
        try {
            control.click();
            clicked++;
        } catch (error) { }
    }

    if (!clicked) return 0;

    const started = Date.now();
    while (Date.now() - started < 1200) {
        await delay(120);
        const afterText = normalizeSpaces(textRoot?.innerText || textRoot?.textContent || "");
        const remainingControls = findExpandableTweetTextControls(ctx).filter((el) => el.isConnected !== false);
        if (!remainingControls.length || afterText.length > beforeText.length + 8) break;
    }

    return clicked;
}

function normalizeControlText(text) {
    return normalizeSpaces(text || "").replace(/\s+/g, " ").trim();
}

function getTwitterControlText(el) {
    if (!el) return "";
    return normalizeControlText(el.innerText || el.textContent || el.getAttribute?.("aria-label") || "");
}

function matchesNativeTwitterTranslationLabel(text, mode = "translate") {
    const value = normalizeControlText(text);
    const lower = value.toLowerCase();
    const labels = mode === "original" ? X_NATIVE_SHOW_ORIGINAL_LABELS : X_NATIVE_TRANSLATE_LABELS;
    return labels.includes(value) || labels.includes(lower);
}

function findNativeTwitterTranslationControl(scope = document, mode = "translate") {
    const ctx = scope || document;
    const controls = ctx.querySelectorAll?.('button, [role="button"]') || [];
    for (const el of controls) {
        if (el.classList?.contains(X_INLINE_TRANSLATE_BUTTON_CLASS)) continue;
        if (el.closest?.(`.${X_INLINE_TRANSLATE_BUTTON_CLASS}, .${X_INLINE_ACTIONS_CONTAINER_CLASS}, .${X_INLINE_TRANSLATION_BLOCK_CLASS}`)) continue;
        if (el.closest?.('[data-testid="simpleTweet"]')) continue;

        const text = getTwitterControlText(el);
        if (matchesNativeTwitterTranslationLabel(text, mode)) return el;
    }
    return null;
}

function clearTranslationMark(el) {
    if (!el) return;
    delete el.__x2md_translation_override;
    el.removeAttribute?.("data-x2md-translated");
}

function clearNativeTwitterTranslationOverride(scope = document) {
    const target = getTranslationTarget(scope);
    if (target?.textEl?.__x2md_translation_override?.source === "twitter_native") {
        clearTranslationMark(target.textEl);
    }
}

function markNativeTwitterTranslation(scope = document) {
    const target = getTranslationTarget(scope);
    if (!target || target.kind !== "tweet" || !target.textEl || !target.text) return false;
    markElementTranslated(target.textEl, {
        type: "tweet",
        text: target.text,
        source: "twitter_native",
    });
    return true;
}

async function waitForNativeTwitterTranslationState(scope = document, mode = "original", timeoutMs = 6000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        if (findNativeTwitterTranslationControl(scope, mode)) return true;
        await delay(120);
    }
    return false;
}

async function showNativeTwitterTranslation(scope = document) {
    const target = getTranslationTarget(scope);
    if (!target || target.kind !== "tweet") return "";

    if (findNativeTwitterTranslationControl(scope, "original")) {
        markNativeTwitterTranslation(scope);
        return "cached";
    }

    const nativeTranslateButton = findNativeTwitterTranslationControl(scope, "translate");
    if (!nativeTranslateButton) return "";

    nativeTranslateButton.click();
    const translated = await waitForNativeTwitterTranslationState(scope, "original");
    if (!translated) return "";

    return markNativeTwitterTranslation(scope) ? "translated" : "";
}

async function toggleNativeTwitterTranslation(scope = document) {
    const target = getTranslationTarget(scope);
    if (!target || target.kind !== "tweet") return "";

    const showOriginalButton = findNativeTwitterTranslationControl(scope, "original");
    if (showOriginalButton) {
        showOriginalButton.click();
        await waitForNativeTwitterTranslationState(scope, "translate", 3000);
        clearNativeTwitterTranslationOverride(scope);
        return "original";
    }

    return await showNativeTwitterTranslation(scope);
}

function findMainTweetTextElement(article, options = {}) {
    const ctx = article || document;
    for (const el of ctx.querySelectorAll('[data-testid="tweetText"]')) {
        if (!options.includeQuote && el.closest('[data-testid="simpleTweet"]')) continue;
        if (!options.includeQuote && el.closest('[data-x2md-quote-container="1"]')) continue;
        if (el.closest(`.${X_INLINE_TRANSLATION_BLOCK_CLASS}`)) continue;
        return el;
    }
    return null;
}

function isQuoteTweetLabel(text) {
    return /^(?:引用|Quote)$/i.test(normalizeSpaces(text || ""));
}

function findQuoteContainerFromLabel(labelEl, root) {
    let current = labelEl?.parentElement || null;
    while (current && current !== root && current !== document.body) {
        const text = normalizeSpaces(current.innerText || current.textContent || "");
        const rect = getVisibleRect(current);
        const hasQuoteContent = !!current.querySelector?.('[data-testid="User-Name"], [data-testid="tweetText"]') ||
            !!findTwitterArticleCardContainer(current);
        if (rect && rect.width > 220 && rect.height > 40 && hasQuoteContent && !current.matches?.('article[data-testid="tweet"]')) {
            current.setAttribute?.("data-x2md-quote-container", "1");
            return current;
        }
        if (text.length > 2000) break;
        current = current.parentElement;
    }
    return null;
}

function findQuoteTweetContainer(scope = document) {
    const ctx = scope || document;
    const simple = ctx.querySelector?.('[data-testid="simpleTweet"]');
    if (simple) {
        simple.setAttribute?.("data-x2md-quote-container", "1");
        return simple;
    }

    for (const el of ctx.querySelectorAll?.("span, div") || []) {
        if (!isQuoteTweetLabel(el.innerText || el.textContent || "")) continue;
        const quote = findQuoteContainerFromLabel(el, ctx);
        if (quote) return quote;
    }
    return null;
}

function findQuoteTweetTranslationTarget(scope = document) {
    const quote = findQuoteTweetContainer(scope);
    if (!quote) return null;
    const textEl = findMainTweetTextElement(quote, { includeQuote: true });
    if (!textEl) return null;
    const text = stripLeadingReplyMentions(textEl.innerText || "");
    if (!text) return null;

    return {
        kind: "quote_tweet",
        scope: quote,
        quoteEl: quote,
        insertAfter: textEl,
        originalEls: [textEl],
        textEl,
        text,
        url: findFirstStatusUrl(quote),
        tweetId: extractTweetIdFromUrl(findFirstStatusUrl(quote)),
    };
}

function isTwitterArticleCardLabel(text) {
    return /^(?:X\s*)?文章$|^Article$/i.test(normalizeSpaces(text || ""));
}

function getVisibleRect(el) {
    const rect = el?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return rect;
}

function meaningfulArticleCardText(el) {
    const text = normalizeSpaces(el?.innerText || el?.textContent || "");
    if (!text || text.length < 2) return "";
    if (isTwitterArticleCardLabel(text)) return "";
    if (/^(?:Download|⊘|🖋️|\d+|[\d.,]+万|[\d.,]+k)$/i.test(text)) return "";
    return text;
}

function elementHasDivergentTextChild(el, ownText) {
    for (const child of Array.from(el?.children || [])) {
        if (child.tagName !== "DIV") continue;
        const childText = meaningfulArticleCardText(child);
        if (childText && childText !== ownText) return true;
    }
    return false;
}

function findTwitterArticleCardContainer(scope = document) {
    const ctx = scope || document;
    const candidates = [];

    for (const el of ctx.querySelectorAll?.("div") || []) {
        if (el.closest?.('[data-testid="User-Name"], [role="group"], [data-testid="tweetText"]')) continue;
        const text = normalizeSpaces(el.innerText || "");
        const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
        if (lines.length < 3 || !isTwitterArticleCardLabel(lines[0])) continue;
        const rect = getVisibleRect(el);
        if (!rect || rect.width < 220 || rect.height < 80) continue;
        candidates.push({ el, area: rect.width * rect.height });
    }

    candidates.sort((left, right) => left.area - right.area);
    return candidates[0]?.el || null;
}

function findTwitterArticleCardTextBlocks(cardEl) {
    if (!cardEl) return [];

    const blocks = [];
    const seen = new Set();
    for (const el of cardEl.querySelectorAll?.("div") || []) {
        if (el.closest?.(`.${X_INLINE_TRANSLATION_BLOCK_CLASS}`)) continue;
        const text = meaningfulArticleCardText(el);
        if (!text || text.length < 6) continue;
        if (text === meaningfulArticleCardText(cardEl)) continue;
        if (elementHasDivergentTextChild(el, text)) continue;

        const rect = getVisibleRect(el);
        if (!rect) continue;
        if (seen.has(text)) continue;
        seen.add(text);
        blocks.push({ el, text, top: rect.top, left: rect.left });
    }

    blocks.sort((left, right) => left.top === right.top ? left.left - right.left : left.top - right.top);
    return blocks.map((item) => item.el).slice(0, 2);
}

function getTwitterArticleCardTranslationTarget(scope = document) {
    const ctx = scope || document;
    const cardEl = findTwitterArticleCardContainer(ctx);
    const blocks = findTwitterArticleCardTextBlocks(cardEl);
    if (!cardEl || !blocks.length) return null;

    const titleEl = blocks[0] || null;
    const bodyEl = blocks[1] || null;
    const articleTitle = meaningfulArticleCardText(titleEl);
    const articleBody = meaningfulArticleCardText(bodyEl);
    const text = [articleTitle, articleBody].filter(Boolean).join("\n\n");
    if (!text) return null;

    return {
        kind: "article_card",
        scope: ctx,
        cardEl,
        insertAfter: bodyEl || titleEl || cardEl,
        originalEls: [titleEl, bodyEl].filter(Boolean),
        titleEl,
        bodyEl,
        articleTitle,
        articleBody,
        text,
        url: findFirstStatusUrl(cardEl) || findFirstStatusUrl(ctx),
        tweetId: extractTweetIdFromUrl(findFirstStatusUrl(cardEl) || findFirstStatusUrl(ctx)),
    };
}

function getTranslationTarget(scope = document) {
    const ctx = scope || document;
    if (isTwitterArticleTranslationScope(ctx)) {
        const bodyEl = getTwitterArticleBodyContainer(document);
        const mainScope = bodyEl?.closest?.('main, [role="main"]') || document;
        const titleEl = getTwitterArticleTitleElement(mainScope);
        if (bodyEl) {
            const source = getTwitterArticleTranslationSource(document);
            return {
                kind: "article",
                scope: document,
                insertAfter: titleEl || bodyEl,
                originalEls: [titleEl, bodyEl].filter(Boolean),
                titleEl,
                bodyEl,
                articleTitle: source.title,
                articleBody: source.body,
                text: source.text,
            };
        }
    }

    const tweetTextEl = findMainTweetTextElement(ctx);
    if (tweetTextEl) {
        return {
            kind: "tweet",
            scope: ctx,
            insertAfter: tweetTextEl,
            originalEls: [tweetTextEl],
            textEl: tweetTextEl,
            text: stripLeadingReplyMentions(tweetTextEl.innerText || ""),
        };
    }

    const articleCardTarget = getTwitterArticleCardTranslationTarget(ctx);
    if (articleCardTarget) return articleCardTarget;

    return null;
}

function markElementTranslated(el, override) {
    if (!el || !override) return;
    el.__x2md_translation_override = override;
    el.setAttribute?.("data-x2md-translated", "1");
}

function getElementTranslationOverride(el) {
    let current = el;
    while (current && current !== document.documentElement) {
        if (current.__x2md_translation_override) return current.__x2md_translation_override;
        current = current.parentElement;
    }
    return null;
}

function findDescendantTranslationOverride(scope) {
    const translated = scope?.querySelector?.('[data-x2md-translated="1"]');
    return translated?.__x2md_translation_override || null;
}

function restoreTranslatedElement(el) {
    if (!el || el.__x2md_original_html === undefined) return false;
    el.innerHTML = el.__x2md_original_html;
    delete el.__x2md_original_html;
    delete el.__x2md_translation_override;
    el.removeAttribute?.("data-x2md-translated");
    return true;
}

function replaceElementTextWithTranslation(el, translatedText, override) {
    if (!el || !translatedText) return false;
    if (el.__x2md_original_html === undefined) {
        el.__x2md_original_html = el.innerHTML;
    }
    el.innerHTML = escapeHtml(translatedText).replace(/\n/g, "<br>");
    markElementTranslated(el, override || { type: "tweet", text: translatedText });
    return true;
}

function sanitizeTwitterNativeTranslationHtml(html) {
    const source = String(html || "").trim();
    if (!source) return "";

    const template = document.createElement("template");
    template.innerHTML = source;

    const allowedTags = new Set(["SPAN", "A", "IMG", "BR", "B", "STRONG", "I", "EM", "S"]);
    const allowedAttrs = {
        SPAN: new Set(["class", "dir", "aria-hidden"]),
        A: new Set(["class", "dir", "href", "rel", "target", "role", "aria-hidden", "style"]),
        IMG: new Set(["class", "alt", "src", "title", "draggable", "aria-hidden"]),
        BR: new Set([]),
        B: new Set(["class"]),
        STRONG: new Set(["class"]),
        I: new Set(["class"]),
        EM: new Set(["class"]),
        S: new Set(["class"]),
    };

    const cleanNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return;
        if (node.nodeType !== Node.ELEMENT_NODE) {
            node.remove();
            return;
        }

        if (!allowedTags.has(node.tagName)) {
            node.replaceWith(document.createTextNode(node.textContent || ""));
            return;
        }

        const tagAttrs = allowedAttrs[node.tagName] || new Set();
        for (const attr of Array.from(node.attributes || [])) {
            if (!tagAttrs.has(attr.name)) {
                node.removeAttribute(attr.name);
                continue;
            }
            if ((attr.name === "href" || attr.name === "src") && !/^https?:\/\//i.test(attr.value)) {
                node.removeAttribute(attr.name);
            }
            if (attr.name === "style" && !/^color:\s*rgb\(29,\s*155,\s*240\);?$/i.test(attr.value.trim())) {
                node.removeAttribute(attr.name);
            }
        }

        for (const child of Array.from(node.childNodes)) cleanNode(child);
    };

    for (const child of Array.from(template.content.childNodes)) cleanNode(child);
    return template.innerHTML.trim();
}

function decodeHtmlEntities(text) {
    const textarea = document.createElement("textarea");
    textarea.innerHTML = String(text || "");
    return textarea.value;
}

function escapeRegExp(text) {
    return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function uniqueNonEmpty(values) {
    return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeInlineLinkText(text) {
    return String(text || "").replace(/\s+/g, "");
}

function makeLooseInlineTextPattern(text) {
    const compact = normalizeInlineLinkText(text);
    if (!compact) return "";
    return compact
        .split("")
        .map((char) => escapeRegExp(char))
        .join("\\s*");
}

function cleanupTranslationMentionLineBreaks(text, descriptors = []) {
    let result = String(text || "");
    const mentions = descriptors
        .filter((item) => item.type === "mention")
        .map((item) => item.displayText)
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);

    for (const mention of mentions) {
        const pattern = makeLooseInlineTextPattern(mention);
        if (!pattern) continue;
        result = result.replace(new RegExp(`\\n\\s*(${pattern})\\s*\\n`, "gi"), " $1 ");
        result = result.replace(new RegExp(`\\n\\s*(${pattern})(?=[\\s\\u3000，,。.！!？?；;：:])`, "gi"), " $1");
        result = result.replace(new RegExp(`([\\s\\u3000，,。.！!？?；;：:])(${pattern})\\s*\\n`, "gi"), "$1$2 ");
    }

    return result
        .replace(/[ \t]+\n/g, "\n")
        .replace(/\n[ \t]+/g, "\n")
        .replace(/[ \t]{2,}/g, " ");
}

function buildOriginalTweetLinkDescriptors(tweetTextEl) {
    const descriptors = [];
    for (const anchor of tweetTextEl?.querySelectorAll?.("a[href]") || []) {
        const href = anchor.href || "";
        const rawHref = anchor.getAttribute("href") || "";
        let absoluteRawHref = rawHref;
        try {
            absoluteRawHref = new URL(rawHref, location.origin).href;
        } catch (error) { }

        const visibleText = normalizeSpaces(anchor.innerText || anchor.textContent || "");
        const compactVisibleText = normalizeInlineLinkText(visibleText);
        const isMentionOrHash = /^[@#]/.test(visibleText);
        const isUrlLike = /^https?:\/\//i.test(href) || /^https?:\/\//i.test(absoluteRawHref) || href.includes("t.co/");

        const candidates = uniqueNonEmpty([
            href,
            absoluteRawHref,
            href.replace(/^http:\/\//i, "https://"),
            absoluteRawHref.replace(/^http:\/\//i, "https://"),
            isMentionOrHash ? visibleText : "",
            isUrlLike ? compactVisibleText : "",
        ]).sort((left, right) => right.length - left.length);

        if (!candidates.length) continue;

        const clone = anchor.cloneNode(true);
        clone.setAttribute("href", href || absoluteRawHref);
        clone.setAttribute("rel", "noopener noreferrer nofollow");
        clone.setAttribute("target", "_blank");

        descriptors.push({
            candidates,
            html: sanitizeTwitterNativeTranslationHtml(clone.outerHTML),
            displayText: visibleText,
            type: isMentionOrHash ? "mention" : (isUrlLike ? "url" : "link"),
        });
    }
    return descriptors.filter((item) => item.html);
}

function buildNativeLikeTweetTranslationHtml(translatedText, originalTweetTextEl) {
    let text = decodeHtmlEntities(translatedText)
        .replace(/\r\n/g, "\n")
        .trim();
    if (!text) return { text: "", html: "" };

    const descriptors = buildOriginalTweetLinkDescriptors(originalTweetTextEl);
    text = cleanupTranslationMentionLineBreaks(text, descriptors);

    const tokens = [];
    for (const descriptor of descriptors) {
        for (const candidate of descriptor.candidates) {
            if (!candidate) continue;
            const token = `\uE000${tokens.length}\uE001`;
            const pattern = descriptor.type === "mention"
                ? makeLooseInlineTextPattern(candidate)
                : escapeRegExp(candidate);
            const re = new RegExp(pattern, "g");
            if (!re.test(text)) continue;
            text = text.replace(re, token);
            tokens.push({ token, html: descriptor.html });
            break;
        }
    }

    let html = escapeHtml(text).replace(/\n/g, "<br>");
    for (const item of tokens) {
        html = html.split(item.token).join(item.html);
    }

    return {
        text: text.replace(/\uE000\d+\uE001/g, (token) => {
            const item = tokens.find((entry) => entry.token === token);
            if (!item) return "";
            const template = document.createElement("template");
            template.innerHTML = item.html;
            return template.content.textContent || "";
        }).trim(),
        html,
    };
}

function replaceElementWithNativeTranslation(el, translation, override) {
    const translatedText = String(translation?.text || "").trim();
    if (!el || !translatedText) return false;
    if (el.__x2md_original_html === undefined) {
        el.__x2md_original_html = el.innerHTML;
    }

    const safeHtml = sanitizeTwitterNativeTranslationHtml(translation.html);
    el.innerHTML = safeHtml || escapeHtml(translatedText).replace(/\n/g, "<br>");
    markElementTranslated(el, override || { type: "tweet", text: translatedText, source: "twitter_native" });
    return true;
}

function showOriginalTranslationTargets(scope = document) {
    const target = getTranslationTarget(scope);
    if (!target) return false;

    if (target.kind === "article") {
        let restored = false;
        if (target.titleEl) restored = restoreTranslatedElement(target.titleEl) || restored;
        for (const block of getArticleTranslatableTextBlocks(target.bodyEl)) {
            restored = restoreTranslatedElement(block) || restored;
        }
        if (target.bodyEl) {
            delete target.bodyEl.__x2md_translation_override;
            target.bodyEl.removeAttribute?.("data-x2md-translated");
        }
        return restored;
    }

    if (target.kind === "article_card") {
        let restored = false;
        if (target.titleEl) restored = restoreTranslatedElement(target.titleEl) || restored;
        if (target.bodyEl) restored = restoreTranslatedElement(target.bodyEl) || restored;
        if (target.cardEl) {
            delete target.cardEl.__x2md_translation_override;
            target.cardEl.removeAttribute?.("data-x2md-translated");
        }
        return restored;
    }

    if (target.kind === "quote_tweet") {
        let restored = restoreTranslatedElement(target.textEl);
        if (target.quoteEl) {
            delete target.quoteEl.__x2md_translation_override;
            target.quoteEl.removeAttribute?.("data-x2md-translated");
        }
        return restored;
    }

    return restoreTranslatedElement(target.textEl);
}

function targetHasVisibleTranslation(target) {
    if (!target) return false;
    if (target.kind === "article") {
        if (target.titleEl?.__x2md_translation_override) return true;
        return getArticleTranslatableTextBlocks(target.bodyEl).some((block) => !!block.__x2md_translation_override);
    }
    if (target.kind === "article_card") {
        return !!target.titleEl?.__x2md_translation_override || !!target.bodyEl?.__x2md_translation_override;
    }
    if (target.kind === "quote_tweet") {
        return !!target.textEl?.__x2md_translation_override;
    }
    return !!target.textEl?.__x2md_translation_override;
}

function toggleExistingInlineTranslation(scope = document) {
    const target = getTranslationTarget(scope);
    if (!target || !targetHasVisibleTranslation(target)) return "";
    showOriginalTranslationTargets(scope);
    return "original";
}

function requestBackgroundTweetTranslation(payload) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: "translate_tweet", data: payload }, (resp) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            if (!resp?.success || !resp.translatedText) {
                reject(new Error(resp?.error || "empty translation"));
                return;
            }
            resolve({ translatedText: resp.translatedText, tweetId: resp.tweetId || payload.tweetId || "" });
        });
    });
}

function requestBackgroundTextTranslation(payload) {
    return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: "translate_text", data: payload }, (resp) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
                return;
            }
            if (!resp?.success || !resp.translatedText) {
                reject(new Error(resp?.error || "empty translation"));
                return;
            }
            resolve({ translatedText: resp.translatedText });
        });
    });
}

function createNativeLikeTranslationBlock(target) {
    if (!target?.insertAfter?.parentElement) return null;
    let block = target.insertAfter.parentElement.querySelector?.(`:scope > .${X_INLINE_TRANSLATION_BLOCK_CLASS}`);
    if (block) return block;

    block = document.createElement("div");
    block.className = X_INLINE_TRANSLATION_BLOCK_CLASS;
    Object.assign(block.style, {
        marginTop: "0px",
        marginBottom: "0px",
        color: "rgb(83, 100, 113)",
        fontSize: "13px",
        lineHeight: "1.35",
        whiteSpace: "pre-wrap",
    });

    block.innerHTML = `<div data-x2md-role="translated-status" class="${X_INLINE_TRANSLATION_STATUS_CLASS}" style="display:none;color:rgb(83,100,113);font-size:13px;line-height:1.35;"></div>`;
    target.insertAfter.insertAdjacentElement("afterend", block);
    return block;
}

function setInlineTranslationStatus(scope, message) {
    const target = getTranslationTarget(scope);
    if (!target) return false;
    const block = createNativeLikeTranslationBlock(target);
    const statusEl = block?.querySelector('[data-x2md-role="translated-status"]');
    if (!statusEl) return false;
    statusEl.textContent = message || "";
    statusEl.style.display = message ? "block" : "none";
    block.style.display = message ? "block" : "none";
    return true;
}

function clearInlineTranslationStatus(scope) {
    const target = getTranslationTarget(scope);
    const block = target?.insertAfter?.parentElement?.querySelector?.(`:scope > .${X_INLINE_TRANSLATION_BLOCK_CLASS}`);
    if (block) block.remove();
}

function articleBlockText(block) {
    return String(block?.innerText || block?.textContent || "").trim();
}

function isArticleTextBlockCandidate(el, bodyEl) {
    if (!el || el.nodeType !== 1 || !bodyEl?.contains?.(el)) return false;
    if (el.closest?.('[data-testid="simpleTweet"], article[data-testid="tweet"], [data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"], [data-testid="User-Name"]')) return false;
    if (el.querySelector?.('img, video, [data-testid="simpleTweet"], article[data-testid="tweet"], [data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"]')) return false;
    const text = articleBlockText(el);
    if (!text || text.length < 2) return false;
    if (/^(想发布自己的文章|升级为\s*Premium|Want to publish your own article)/i.test(text)) return false;
    return true;
}

function getArticleTextLeafBlocks(bodyEl) {
    if (!bodyEl || typeof document.createTreeWalker !== "function") return [];
    const blocks = [];
    const seen = new Set();
    const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const text = String(node.textContent || "").trim();
            if (text.length < 2) return NodeFilter.FILTER_REJECT;
            const parent = node.parentElement;
            if (!parent || !bodyEl.contains(parent)) return NodeFilter.FILTER_REJECT;
            if (!isArticleTextBlockCandidate(parent, bodyEl)) return NodeFilter.FILTER_SKIP;
            return NodeFilter.FILTER_ACCEPT;
        },
    });

    while (walker.nextNode()) {
        const parent = walker.currentNode.parentElement;
        const block = parent?.closest?.('div[dir="auto"], div[lang], p, li, blockquote, h1, h2, h3, h4, h5, h6, span') || parent;
        if (!block || seen.has(block) || !isArticleTextBlockCandidate(block, bodyEl)) continue;
        seen.add(block);
        blocks.push(block);
    }
    return blocks;
}

function getArticleTranslatableTextBlocks(bodyEl) {
    if (!bodyEl) return [];
    const selectors = [
        '.public-DraftStyleDefault-block',
        '[data-block="true"]',
        'div[dir="auto"]',
        'div[lang]',
        'p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    ].join(',');
    let blocks = Array.from(bodyEl.querySelectorAll?.(selectors) || [])
        .filter((el) => isArticleTextBlockCandidate(el, bodyEl));

    if (!blocks.length) {
        blocks = Array.from(bodyEl.children || [])
            .filter((el) => isArticleTextBlockCandidate(el, bodyEl));
    }

    if (!blocks.length) {
        blocks = getArticleTextLeafBlocks(bodyEl);
    }

    return blocks.filter((el, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.contains?.(el)));
}

async function translateArticleInPlace(target) {
    const titleText = String(target.articleTitle || "").trim();
    const bodyBlocks = getArticleTranslatableTextBlocks(target.bodyEl);
    const translatedParts = [];
    let translatedTitle = "";

    if (titleText && target.titleEl) {
        const titleResult = await requestBackgroundTextTranslation({
            text: titleText,
            url: location.href.split("?")[0],
            type: "x_article_title",
        });
        translatedTitle = titleResult.translatedText || "";
        if (translatedTitle) {
            replaceElementTextWithTranslation(target.titleEl, translatedTitle, {
                type: "article_title",
                article_title: translatedTitle,
            });
        }
    }

    for (const block of bodyBlocks) {
        const original = articleBlockText(block);
        if (!original) continue;
        const result = await requestBackgroundTextTranslation({
            text: original,
            url: location.href.split("?")[0],
            type: "x_article_block",
        });
        const translated = result.translatedText || "";
        if (!translated) continue;
        replaceElementTextWithTranslation(block, translated, {
            type: "article_block",
            text: translated,
        });
        translatedParts.push(translated);
    }

    const translatedBody = translatedParts.join("\n\n").trim();
    const translatedText = [translatedTitle, translatedBody].filter(Boolean).join("\n\n");
    const articleOverride = {
        type: "article",
        article_title: translatedTitle,
        article_content: translatedBody || translatedTitle,
        text: translatedText,
    };
    if (target.titleEl) markElementTranslated(target.titleEl, articleOverride);
    if (target.bodyEl) markElementTranslated(target.bodyEl, articleOverride);
    clearInlineTranslationStatus(document);
    return !!translatedText;
}

function splitNativeArticleCardTranslation(translatedText) {
    const parts = String(translatedText || "")
        .replace(/\r\n/g, "\n")
        .split(/\n{2,}|\n/)
        .map((part) => normalizeSpaces(part))
        .filter(Boolean);
    if (!parts.length) return { title: "", body: "" };

    let droppedLeadingUrl = false;
    while (parts.length && isUrlOnlyText(parts[0])) {
        parts.shift();
        droppedLeadingUrl = true;
    }
    if (!parts.length) return { title: "", body: "" };

    if (droppedLeadingUrl) {
        return {
            title: "",
            body: parts.join("\n").trim(),
        };
    }

    return {
        title: parts[0] || "",
        body: parts.slice(1).join("\n").trim(),
    };
}

function isUrlOnlyText(text) {
    return /^https?:\/\/\S+$/i.test(normalizeSpaces(text || ""));
}

async function translateArticleCardInPlace(target, options = {}) {
    if (!target?.titleEl && !target?.bodyEl) return false;

    const originalTitle = String(target.articleTitle || "").trim();
    const originalBody = String(target.articleBody || "").trim();
    let translatedTitle = "";
    let translatedBody = "";

    const { url: scopeTweetUrl } = findTweetUrl(target.scope);
    const tweetUrl = target.url || scopeTweetUrl || findFirstStatusUrl(target.scope);
    const tweetId = target.tweetId || extractTweetIdFromUrl(tweetUrl);
    if (tweetId && !options.skipNativeTweetTranslation) {
        try {
            const nativeResult = await requestBackgroundTweetTranslation({ url: tweetUrl, tweetId });
            const split = splitNativeArticleCardTranslation(nativeResult.translatedText || "");
            if (split.title && !isUrlOnlyText(split.title) && (!originalTitle || split.title !== originalTitle)) translatedTitle = split.title;
            if (split.body && (!originalBody || split.body !== originalBody)) translatedBody = split.body;
        } catch (error) {
            console.warn("[x2md] Article 卡片原生翻译失败，回退文本翻译：", error);
        }
    }

    if (!translatedTitle && originalTitle && target.titleEl) {
        const result = await requestBackgroundTextTranslation({
            text: originalTitle,
            url: tweetUrl || location.href.split("?")[0],
            type: "x_article_card_title",
        });
        translatedTitle = result.translatedText || "";
    }

    if (!translatedBody && originalBody && target.bodyEl) {
        const result = await requestBackgroundTextTranslation({
            text: originalBody,
            url: tweetUrl || location.href.split("?")[0],
            type: "x_article_card_summary",
        });
        translatedBody = result.translatedText || "";
    }

    const override = {
        type: "article_card",
        article_title: translatedTitle,
        article_content: translatedBody,
        text: [translatedTitle, translatedBody].filter(Boolean).join("\n\n"),
        source: "twitter_article_card",
    };

    let rendered = false;
    if (translatedTitle && target.titleEl) {
        rendered = replaceElementTextWithTranslation(target.titleEl, translatedTitle, override) || rendered;
    }
    if (translatedBody && target.bodyEl) {
        rendered = replaceElementTextWithTranslation(target.bodyEl, translatedBody, override) || rendered;
    }
    if (rendered && target.cardEl) markElementTranslated(target.cardEl, override);
    clearInlineTranslationStatus(target.scope);
    return rendered;
}

async function translateTweetTextTargetInPlace(target, options = {}) {
    if (!target?.textEl || !target.text) return false;

    const tweetUrl = target.url || "";
    const tweetId = target.tweetId || extractTweetIdFromUrl(tweetUrl);
    let translatedText = "";
    let translatedHtml = "";

    if (tweetId) {
        try {
            const result = await requestBackgroundTweetTranslation({ url: tweetUrl, tweetId });
            if (result.translatedText) {
                const nativeLike = buildNativeLikeTweetTranslationHtml(result.translatedText, target.textEl);
                translatedText = nativeLike.text || result.translatedText || "";
                translatedHtml = nativeLike.html || "";
            }
        } catch (error) {
            console.warn("[x2md] 推文翻译失败，回退普通文本翻译：", error);
        }
    }

    if (!translatedText) {
        const result = await requestBackgroundTextTranslation({
            text: target.text,
            url: tweetUrl || location.href.split("?")[0],
            type: options.type || "x_tweet",
        });
        translatedText = result.translatedText || "";
    }

    if (!translatedText) return false;

    const override = {
        type: options.overrideType || "tweet",
        text: translatedText,
        source: translatedHtml ? "twitter_native" : "",
    };
    const rendered = translatedHtml
        ? replaceElementWithNativeTranslation(target.textEl, { text: translatedText, html: translatedHtml }, override)
        : replaceElementTextWithTranslation(target.textEl, translatedText, override);

    if (rendered && target.quoteEl) markElementTranslated(target.quoteEl, override);
    return rendered;
}

async function translateQuoteTweetInPlace(scope = document) {
    const target = findQuoteTweetTranslationTarget(scope);
    if (!target || targetHasVisibleTranslation(target)) return false;
    return await translateTweetTextTargetInPlace(target, {
        type: "x_quote_tweet",
        overrideType: "quote_tweet",
    });
}

async function translateEmbeddedArticleCardInPlace(scope = document) {
    const target = getTwitterArticleCardTranslationTarget(scope);
    if (!target || targetHasVisibleTranslation(target)) return false;

    // 当同一条推文同时包含正文和文章卡片时，X 原生推文翻译接口优先返回正文译文；
    // 直接拿它拆分会把正文第一句误写进卡片标题。此时卡片标题/摘要改为逐段翻译。
    const hasPrimaryTweetText = !!findMainTweetTextElement(scope);
    return await translateArticleCardInPlace(target, {
        skipNativeTweetTranslation: hasPrimaryTweetText,
    });
}

async function translateEmbeddedTargetsInPlace(scope = document) {
    let rendered = false;
    rendered = await translateQuoteTweetInPlace(scope) || rendered;
    rendered = await translateEmbeddedArticleCardInPlace(scope) || rendered;
    return rendered;
}

function renderInlineTranslation(scope, translation) {
    const target = getTranslationTarget(scope);
    if (!target || !translation) return false;

    const translatedText = typeof translation === "string" ? translation : translation.text;
    if (!translatedText) return false;

    if (target.kind === "tweet") {
        if (translation.source === "twitter_native_api" || translation.html) {
            return replaceElementWithNativeTranslation(target.textEl, {
                text: translatedText,
                html: translation.html || "",
            }, translation.override || { type: "tweet", text: translatedText, source: "twitter_native" });
        }
        return replaceElementTextWithTranslation(target.textEl, translatedText, typeof translation === "string"
            ? { type: "tweet", text: translatedText }
            : translation.override || { type: "tweet", text: translatedText });
    }

    return false;
}

function getTranslationOverrideForSave(scope = document) {
    const ctx = scope || document;

    if (ctx === document && isTwitterArticleTranslationScope(document)) {
        const target = getTranslationTarget(document);
        if (targetHasVisibleTranslation(target)) {
            const articleTitle = target.titleEl?.innerText?.trim() || target.articleTitle || "";
            let articleContent = "";
            try {
                articleContent = target.bodyEl ? extractArticleMarkdown(target.bodyEl) : "";
            } catch (error) {
                articleContent = getArticleTranslatableTextBlocks(target.bodyEl)
                    .map((block) => block.innerText?.trim() || "")
                    .filter(Boolean)
                    .join("\n\n");
            }
            const text = [articleTitle, articleContent].filter(Boolean).join("\n\n");
            if (text) {
                return {
                    type: "article",
                    article_title: articleTitle,
                    article_content: articleContent,
                    text,
                };
            }
        }
    }

    const nativeTarget = getTranslationTarget(ctx);
    if (nativeTarget?.kind === "tweet" && findNativeTwitterTranslationControl(ctx, "original")) {
        const nativeText = String(nativeTarget.text || "").trim();
        if (nativeText) {
            return {
                type: "tweet",
                text: nativeText,
                source: "twitter_native",
            };
        }
    }

    const elementOverride = getElementTranslationOverride(ctx) || findDescendantTranslationOverride(ctx);
    if (elementOverride) return elementOverride;

    const block = findVisibleTranslationBlock(ctx) ||
        (ctx !== document ? findVisibleTranslationBlock(document) : null);
    const override = block?.__x2md_translation_override;
    if (!override) return null;
    const text = String(override.text || override.article_content || "").trim();
    const title = String(override.article_title || "").trim();
    if (!text && !title) return null;
    return override;
}

function withVisibleTranslationOverride(data, scope = document) {
    const override = getTranslationOverrideForSave(scope);
    if (!override) return data;
    return applyTranslationOverrideToData({
        ...data,
        prefer_translated_content: true,
        translation_override: override,
    });
}

async function translateScopeInline(scope = document, options = {}) {
    const requestedScope = scope || document;
    const targetScope = requestedScope === document && isTwitterArticleTranslationScope(document)
        ? document
        : requestedScope;
    if (!options.force) {
        const currentTarget = getTranslationTarget(targetScope);
        if (targetHasVisibleTranslation(currentTarget)) {
            const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
            return embeddedRendered ? "translated" : "cached";
        }
        if (currentTarget?.kind === "tweet" && findNativeTwitterTranslationControl(targetScope, "original")) {
            markNativeTwitterTranslation(targetScope);
            const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
            return embeddedRendered ? "translated" : "cached";
        }
    }

    await expandCollapsedTweetText(targetScope);
    const target = getTranslationTarget(targetScope);
    if (!target?.text) return "missing";

    setInlineTranslationStatus(targetScope, "正在翻译…");

    if (target.kind === "article") {
        const mainRendered = await translateArticleInPlace(target);
        const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
        return (mainRendered || embeddedRendered) ? "translated" : "missing";
    }

    if (target.kind === "article_card") {
        const mainRendered = await translateArticleCardInPlace(target);
        const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
        return (mainRendered || embeddedRendered) ? "translated" : "missing";
    }

    const nativeState = await showNativeTwitterTranslation(targetScope);
    if (nativeState) {
        const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
        clearInlineTranslationStatus(targetScope);
        return (nativeState === "cached" && !embeddedRendered) ? "cached" : "translated";
    }

    const { url: tweetUrl } = findTweetUrl(targetScope);
    let fallbackUrl = "";
    if (location.pathname.includes("/status/")) {
        const statusPath = location.pathname.match(/^(\/[^/]+\/status\/\d+)/)?.[1] || "";
        if (statusPath) fallbackUrl = location.origin + statusPath;
    }
    const resolvedTweetUrl = tweetUrl || fallbackUrl || findFirstStatusUrl(targetScope);
    const tweetId = extractTweetIdFromUrl(resolvedTweetUrl);
    let translatedText = "";
    let translatedHtml = "";
    let translationSource = "";
    if (tweetId) {
        try {
            const result = await requestBackgroundTweetTranslation({ url: resolvedTweetUrl, tweetId });
            if (result.translatedText) {
                const nativeLike = buildNativeLikeTweetTranslationHtml(result.translatedText, target.textEl);
                translatedText = nativeLike.text || result.translatedText || "";
                translatedHtml = nativeLike.html || "";
                translationSource = "twitter_native_api";
            }
        } catch (error) {
            console.warn("[x2md] Grok 翻译失败，回退普通文本翻译：", error);
        }
    }
    if (!translatedText) {
        const result = await requestBackgroundTextTranslation({
            text: target.text,
            url: resolvedTweetUrl || location.href.split("?")[0],
            type: "x_tweet",
        });
        translatedText = result.translatedText || "";
    }
    if (!translatedText) return "missing";
    const rendered = renderInlineTranslation(targetScope, {
        text: translatedText,
        html: translatedHtml,
        source: translationSource,
        override: { type: "tweet", text: translatedText, source: translationSource ? "twitter_native" : "" },
    });
    const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
    clearInlineTranslationStatus(targetScope);
    return (rendered || embeddedRendered) ? "translated" : "missing";
}

function getAutoTranslateKey(scope = document) {
    if ((!scope || scope === document) && isTwitterArticleTranslationScope(document)) {
        return `article:${location.href.split("?")[0]}`;
    }
    let currentStatusUrl = "";
    if (location.pathname.includes("/status/")) {
        const statusPath = location.pathname.match(/^(\/[^/]+\/status\/\d+)/)?.[1] || "";
        if (statusPath) currentStatusUrl = `${location.origin}${statusPath}`;
    }
    const statusUrl = findFirstStatusUrl(scope) || currentStatusUrl;
    const id = extractTweetIdFromUrl(statusUrl);
    return id ? `tweet:${id}` : "";
}

function enqueueAutoTranslateScope(scope = document) {
    const key = getAutoTranslateKey(scope);
    if (!key || xAutoTranslateDoneKeys.has(key) || xAutoTranslateQueuedKeys.has(key)) return;
    xAutoTranslateQueuedKeys.add(key);
    xAutoTranslateQueue.push({ key, scope });
    drainAutoTranslateQueue();
}

function drainAutoTranslateQueue() {
    while (xAutoTranslateActiveCount < X_AUTO_TRANSLATE_MAX_CONCURRENCY && xAutoTranslateQueue.length) {
        const item = xAutoTranslateQueue.shift();
        xAutoTranslateActiveCount++;
        translateScopeInline(item.scope, { force: false, auto: true })
            .then((state) => {
                if (state === "translated" || state === "cached") xAutoTranslateDoneKeys.add(item.key);
            })
            .catch((error) => {
                console.warn("[x2md] 自动翻译失败：", error);
            })
            .finally(() => {
                xAutoTranslateQueuedKeys.delete(item.key);
                xAutoTranslateActiveCount--;
                drainAutoTranslateQueue();
            });
    }
}

function scheduleAutoTranslateLoadedContent() {
    if (!xAutoTranslateEnabled || xAutoTranslateScheduled || !isTwitterLikePage()) return;
    xAutoTranslateScheduled = true;
    setTimeout(() => {
        xAutoTranslateScheduled = false;
        if (!xAutoTranslateEnabled) return;
        if (isTwitterArticleTranslationScope(document)) {
            enqueueAutoTranslateScope(document);
        }
        document.querySelectorAll("article, [role='article']").forEach((article) => {
            if (isTwitterArticleTranslationScope(article)) return;
            enqueueAutoTranslateScope(article);
        });
    }, 250);
}

function enableAutoTranslateMode() {
    if (!isTwitterDetailOrArticlePage()) {
        showToast("请先进入推文详情页或文章页再长按自动翻译", "error", 3200);
        return;
    }
    xAutoTranslateEnabled = true;
    showToast("已开启自动翻译：正在处理正文和已加载评论…", "loading", 2600);
    scheduleAutoTranslateLoadedContent();
}

function buildTwitterInlineTranslateButton(referenceButton) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${referenceButton?.className || ""} ${X_INLINE_TRANSLATE_BUTTON_CLASS}`.trim();
    btn.setAttribute("aria-label", "显示翻译");
    btn.title = "显示翻译";
    btn.innerHTML = `
        <div dir="ltr" style="display:flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;line-height:32px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;">
                <img src="${X_TRANSLATE_ICON_URL}" alt="" aria-hidden="true" style="width:20px;height:20px;display:block;object-fit:contain;" />
            </span>
        </div>
    `;
    btn.style.marginRight = "4px";
    btn.style.flexShrink = "0";
    btn.addEventListener("mouseenter", () => {
        const span = btn.querySelector("span");
        if (span) span.style.background = "rgba(29, 155, 240, .10)";
    });
    btn.addEventListener("mouseleave", () => {
        const span = btn.querySelector("span");
        if (span) span.style.background = "transparent";
    });
    let longPressTimer = null;
    const clearLongPressTimer = () => {
        if (longPressTimer) clearTimeout(longPressTimer);
        longPressTimer = null;
    };
    btn.addEventListener("pointerdown", (event) => {
        clearLongPressTimer();
        btn.__x2md_long_press_fired = false;
        longPressTimer = setTimeout(() => {
            btn.__x2md_long_press_fired = true;
            try {
                event.preventDefault();
                event.stopPropagation();
            } catch (error) { }
            enableAutoTranslateMode();
        }, X_AUTO_TRANSLATE_LONG_PRESS_MS);
    }, true);
    ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
        btn.addEventListener(eventName, clearLongPressTimer, true);
    });
    btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        clearLongPressTimer();
        if (btn.__x2md_long_press_fired) {
            btn.__x2md_long_press_fired = false;
            return;
        }
        const fixedActions = btn.closest(`.${X_INLINE_ACTIONS_CONTAINER_CLASS}`);
        const article = fixedActions ? document : (btn.closest("article, [role='article']") || document);
        const nativeState = await toggleNativeTwitterTranslation(article);
        if (nativeState) {
            showToast(nativeState === "original" ? "已显示原文" : "翻译已显示", "success", 1600);
            return;
        }

        const existingState = toggleExistingInlineTranslation(article);
        if (existingState) {
            showToast(existingState === "original" ? "已显示原文" : "翻译已显示", "success", 1600);
            return;
        }

        showToast("正在获取翻译…", "loading", null);
        try {
            const state = await translateScopeInline(article, { force: true });
            if (state !== "translated" && state !== "cached") {
                showToast("译文已获取，但未找到插入位置", "error", 3500);
                return;
            }
            showToast("翻译已显示", "success", 2200);
        } catch (error) {
            console.error("[x2md] 翻译失败：", error);
            showToast("翻译失败，请点进推文后重试", "error", 4500);
        }
    }, true);
    return btn;
}

function buildTwitterInlineCopyButton(referenceButton) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `${referenceButton?.className || ""} ${X_INLINE_COPY_BUTTON_CLASS}`.trim();
    btn.setAttribute("aria-label", "复制正文");
    btn.title = "复制这条推文或文章的正文";
    btn.innerHTML = `
        <div dir="ltr" style="display:flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;line-height:32px;">
            <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;">
                <img src="${X_COPY_ICON_URL}" alt="" aria-hidden="true" style="width:19px;height:19px;display:block;object-fit:contain;" />
            </span>
        </div>
    `;
    btn.style.marginRight = "4px";
    btn.style.flexShrink = "0";
    btn.addEventListener("mouseenter", () => {
        const span = btn.querySelector("span");
        if (span) span.style.background = "rgba(29, 155, 240, .10)";
    });
    btn.addEventListener("mouseleave", () => {
        const span = btn.querySelector("span");
        if (span) span.style.background = "transparent";
    });
    btn.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        const article = btn.closest("article, [role='article']") || document;
        showToast("正在提取正文…", "loading", null);
        try {
            const content = await resolveContentForCopy(article, btn);
            if (!content?.text) {
                showToast("未找到可复制的正文", "error", 3500);
                return;
            }
            await copyContentToClipboard(content);
            showToast(content.html ? "正文已复制（含格式）" : "正文已复制", "success", 2200);
        } catch (error) {
            console.error("[x2md] 复制正文失败：", error);
            showToast("复制失败，请重试", "error", 3500);
        }
    }, true);
    return btn;
}

function ensureTwitterInlineCopyButtons() {
    if (!isTwitterLikePage()) {
        document.querySelectorAll(`.${X_INLINE_COPY_BUTTON_CLASS}`).forEach((btn) => btn.remove());
        document.querySelectorAll(`.${X_INLINE_ACTIONS_CONTAINER_CLASS}`).forEach((el) => el.remove());
        return;
    }

    document.querySelectorAll("article, [role='article']").forEach((article) => {
        const grokButton = article.querySelector(X_GROK_BUTTON_SELECTORS);
        if (!grokButton || !grokButton.parentElement) return;

        let copyButton = article.querySelector(`.${X_INLINE_COPY_BUTTON_CLASS}`);
        if (!copyButton) {
            copyButton = buildTwitterInlineCopyButton(grokButton);
            grokButton.parentElement.insertBefore(copyButton, grokButton);
        }

        if (!article.querySelector(`.${X_INLINE_TRANSLATE_BUTTON_CLASS}`)) {
            const translateButton = buildTwitterInlineTranslateButton(grokButton);
            copyButton.insertAdjacentElement("afterend", translateButton);
        }
    });

    if (isNotePageUrl() && !document.querySelector(`.${X_INLINE_COPY_BUTTON_CLASS}`)) {
        const grokButton = document.querySelector(X_GROK_BUTTON_SELECTORS);
        if (grokButton?.parentElement) {
            const copyButton = buildTwitterInlineCopyButton(grokButton);
            const translateButton = buildTwitterInlineTranslateButton(grokButton);
            grokButton.parentElement.insertBefore(copyButton, grokButton);
            copyButton.insertAdjacentElement("afterend", translateButton);
            return;
        }

        let container = document.querySelector(`.${X_INLINE_ACTIONS_CONTAINER_CLASS}`);
        if (!container) {
            container = document.createElement("div");
            container.className = X_INLINE_ACTIONS_CONTAINER_CLASS;
            Object.assign(container.style, {
                position: "fixed",
                top: "72px",
                right: "18px",
                zIndex: "2147483646",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "rgba(255,255,255,.86)",
                borderRadius: "999px",
                boxShadow: "0 4px 16px rgba(0,0,0,.10)",
                backdropFilter: "blur(8px)",
            });
            const copyButton = buildTwitterInlineCopyButton(null);
            const translateButton = buildTwitterInlineTranslateButton(null);
            container.append(copyButton, translateButton);
            document.body.appendChild(container);
        }
    }
}

// ─────────────────────────────────────────────
// 书签按钮监听
// ─────────────────────────────────────────────
const BOOKMARK_SELECTORS = [
    '[data-testid="bookmark"]',
    '[data-testid="removeBookmark"]',
    '[aria-label="Bookmark"]',
    '[aria-label="书签"]',
    '[aria-label="Add Bookmark"]',
    '[aria-label="Remove Bookmark"]',
].join(", ");

const X_CUSTOM_SAVE_MENU_ID = "__x2md_x_custom_save_menu";
const X_CUSTOM_SAVE_MENU_MAX_CHARS = 5;
let xCustomSaveMenuHideTimer = null;

function getCustomSavePathEntries() {
    const entries = Array.isArray(runtimeConfig?.custom_save_paths) ? runtimeConfig.custom_save_paths : [];
    return entries
        .map((entry, index) => ({
            index,
            name: String(entry?.name || "").trim(),
            path: String(entry?.path || "").trim(),
        }))
        .filter((entry) => entry.name && entry.path);
}

function truncateCustomSaveTitle(title) {
    return Array.from(String(title || "").trim()).slice(0, X_CUSTOM_SAVE_MENU_MAX_CHARS).join("");
}

function ensureCustomSaveMenu() {
    let menu = document.getElementById(X_CUSTOM_SAVE_MENU_ID);
    if (menu) return menu;

    menu = document.createElement("div");
    menu.id = X_CUSTOM_SAVE_MENU_ID;
    Object.assign(menu.style, {
        position: "fixed",
        zIndex: "2147483647",
        width: "fit-content",
        minWidth: "86px",
        maxWidth: "148px",
        padding: "6px",
        borderRadius: "16px",
        border: "1px solid rgba(255,255,255,.48)",
        background: "rgba(246,246,246,.72)",
        boxShadow: "0 18px 44px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.52)",
        backdropFilter: "saturate(180%) blur(22px)",
        WebkitBackdropFilter: "saturate(180%) blur(22px)",
        display: "none",
        opacity: "0",
        transform: "translateY(-4px) scale(.98)",
        transformOrigin: "top center",
        transition: "opacity .14s ease, transform .14s ease",
        pointerEvents: "auto",
        fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
    });
    menu.addEventListener("mouseenter", () => {
        clearTimeout(xCustomSaveMenuHideTimer);
    });
    menu.addEventListener("mouseleave", scheduleHideCustomSaveMenu);
    document.body.appendChild(menu);
    return menu;
}

function scheduleHideCustomSaveMenu() {
    clearTimeout(xCustomSaveMenuHideTimer);
    xCustomSaveMenuHideTimer = setTimeout(() => {
        const menu = document.getElementById(X_CUSTOM_SAVE_MENU_ID);
        if (!menu) return;
        menu.style.opacity = "0";
        menu.style.transform = "translateY(-4px) scale(.98)";
        setTimeout(() => {
            if (menu.style.opacity === "0") menu.style.display = "none";
        }, 160);
    }, 180);
}

function showCustomSaveMenu(btn) {
    const entries = getCustomSavePathEntries();
    if (!entries.length) return;

    clearTimeout(xCustomSaveMenuHideTimer);
    const menu = ensureCustomSaveMenu();
    menu.textContent = "";

    const visibleTitles = entries.map((entry) => truncateCustomSaveTitle(entry.name));
    const maxTitleLength = Math.max(1, ...visibleTitles.map((title) => Array.from(title).length));
    const menuWidth = Math.min(148, Math.max(86, 32 + maxTitleLength * 18));
    menu.style.width = `${menuWidth}px`;

    entries.forEach((entry, index) => {
        const item = document.createElement("button");
        item.type = "button";
        item.textContent = visibleTitles[index];
        item.title = entry.name === visibleTitles[index] ? entry.path : `${entry.name} · ${entry.path}`;
        Object.assign(item.style, {
            display: "block",
            width: "100%",
            border: "none",
            borderRadius: "11px",
            background: "transparent",
            color: "#1d1d1f",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: "600",
            lineHeight: "1.2",
            textAlign: "center",
            padding: "8px 10px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            letterSpacing: ".01em",
        });
        item.addEventListener("mouseenter", () => {
            item.style.background = "rgba(0, 122, 255, .16)";
        });
        item.addEventListener("mouseleave", () => {
            item.style.background = "transparent";
        });
        item.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            menu.style.display = "none";
            if (!isBookmarkButtonAlreadySaved(btn)) {
                btn.__x2md_skip_next_default_bookmark_save = true;
                btn.click();
                setTimeout(() => {
                    if (btn.__x2md_skip_next_default_bookmark_save) {
                        btn.__x2md_skip_next_default_bookmark_save = false;
                    }
                }, 0);
            }
            setTimeout(() => {
                captureAndSend(btn, {
                    customSavePath: {
                        index: entry.index,
                        name: entry.name,
                    },
                });
            }, 400);
        }, true);
        menu.appendChild(item);
    });

    menu.style.visibility = "hidden";
    menu.style.display = "block";
    const rect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const centeredLeft = rect.left + rect.width / 2 - menuRect.width / 2;
    const left = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, centeredLeft));
    let top = rect.bottom + 8;
    if (top + menuRect.height > window.innerHeight - 8) {
        top = rect.top - menuRect.height - 8;
    }
    top = Math.max(8, Math.min(window.innerHeight - menuRect.height - 8, top));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.visibility = "visible";
    requestAnimationFrame(() => {
        menu.style.opacity = "1";
        menu.style.transform = "translateY(0) scale(1)";
    });
}

function isBookmarkButtonAlreadySaved(btn) {
    const testId = btn?.getAttribute?.("data-testid") || "";
    const aria = btn?.getAttribute?.("aria-label") || "";
    return testId === "removeBookmark" ||
        /remove bookmark/i.test(aria) ||
        aria.includes("移除书签") ||
        aria.includes("取消书签");
}

function attachBookmarkListener(btn) {
    if (btn.__x2md_bound) return;
    btn.__x2md_bound = true;
    btn.addEventListener("mouseenter", () => showCustomSaveMenu(btn), true);
    btn.addEventListener("mouseleave", scheduleHideCustomSaveMenu, true);
    btn.addEventListener("click", () => {
        if (btn.__x2md_skip_next_default_bookmark_save) {
            btn.__x2md_skip_next_default_bookmark_save = false;
            return;
        }
        setTimeout(() => captureAndSend(btn), 400);
    }, true);
}

// ─────────────────────────────────────────────
// 主流程：捕获 → 组装基础数据 → 发给 background
// ─────────────────────────────────────────────
function captureAndSend(btn, options = {}) {
    showToast("正在获取完整推文内容…", "loading", null);

    const attachCustomSavePath = (data) => {
        if (!options.customSavePath) return data;
        return {
            ...data,
            x2md_custom_save_path: {
                index: options.customSavePath.index,
                name: options.customSavePath.name,
            },
        };
    };

    // ── 当前在独立的 Note 文章页面（/i/article/xxx 或 /username/article/xxx）──
    if (isNotePageUrl()) {
        // 等待内容渲染完成（最多 5 秒），因为 Twitter Note 是 CSR 渲染
        const waitForArticle = (retries = 0) => {
            const isReady = !!document.querySelector(
                '[data-testid="twitterArticleRichTextView"], [data-testid="twitterArticleReadView"]'
            );
            if (isReady || retries >= 10) {
                const articleData = detectAndExtractArticle();
                if (articleData && articleData.article_content.trim()) {
                    showToast("已识别为 X Article，正在保存…", "loading", null);
                    sendToBackground(attachCustomSavePath(withVisibleTranslationOverride(articleData, document)));
                } else {
                    showToast("未能提取文章内容，请稍后重试", "error", 4000);
                }
            } else {
                setTimeout(() => waitForArticle(retries + 1), 500);
            }
        };
        waitForArticle();
        return;
    }

    // ── 找推文 URL（首页 Feed 和详情页均适用）────────
    const { url: tweetUrl, article } = findTweetUrl(btn);

    if (!tweetUrl) {
        showToast("未找到推文链接，请进入推文详情页再试", "error", 4000);
        return;
    }

    const { author, handle } = extractAuthorBasic(article);
    const timeEl = article ? article.querySelector("time") : document.querySelector("time");
    const published = timeEl ? timeEl.getAttribute("datetime") : "";
    const images = extractImages(article || document);
    const image_alt_texts = extractImageAltTexts(article || document);

    // ── Note 长文推文检测 ─────────────────────────────
    const noteArticleUrl = detectNoteUrl(article);
    if (noteArticleUrl) {
        console.log("[x2md] 检测到 Note 推文，文章链接：", noteArticleUrl);
        showToast("检测到长文 Note，正在提取内容…", "loading", null);

        try {
            // 优先：在当前页面查找内嵌文章内容（推文详情页会渲染 Note 预览）
            const inlineArticle = detectAndExtractArticle();
            if (inlineArticle && inlineArticle.article_content && inlineArticle.article_content.trim().length > 50) {
                console.log("[x2md] 当前页面已有内嵌文章内容，直接保存");
                sendToBackground(attachCustomSavePath(withVisibleTranslationOverride({
                    ...inlineArticle,
                    url: tweetUrl,       // 用原始推文链接（/status/xxx）作为源
                    author: inlineArticle.author || author,
                    handle: inlineArticle.handle || handle,
                    published: inlineArticle.published || published,
                    images: inlineArticle.images, // 透传已经过去重的剩余外部图
                    image_alt_texts: { ...image_alt_texts, ...(inlineArticle.image_alt_texts || {}) },
                    graphql_operation_ids: inlineArticle.graphql_operation_ids || extractDiscoveredGraphQLOperationIds(),
                }, document)));
                return;
            }
        } catch (extractErr) {
            console.error("[x2md] 内嵌文提取异常：", extractErr);
            // 虽然出现异常，我们依旧交接给 background 让它起用第二道防线：静默 tab 开启抓取，避免假死
        }

        // 降级：让 background 尝试 fetch（可能得到空壳），最终降级为摘要+链接
        console.log("[x2md] 当前页面无内嵌内容，由 background 处理");
        sendToBackground(attachCustomSavePath(withVisibleTranslationOverride({
            type: "note",
            url: tweetUrl,
            note_article_url: noteArticleUrl,
            author, handle, published, images, image_alt_texts,
            text: extractTweetTextBasic(article),
            thread_tweets: [],
            graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
        }, article || document)));
        return;
    }

    // ── 普通推文 ──────────────────────────────────────
    const text = extractTweetTextBasic(article);
    const thread_tweets = extractThreadBasic(article, handle);
    const quote_tweet = extractQuoteTweetBasic(article);

    console.log("[x2md] 普通推文：", { handle, url: tweetUrl, text: text.slice(0, 40), hasQuote: !!quote_tweet });
    sendToBackground(attachCustomSavePath(withVisibleTranslationOverride({
        author,
        handle,
        text,
        published,
        url: tweetUrl,
        images,
        image_alt_texts,
        quote_tweet,
        thread_tweets,
        type: "tweet",
        graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
    }, article || document)));
}

function sendToBackground(data) {
    chrome.runtime.sendMessage({ action: "save_tweet", data }, (resp) => {
        if (chrome.runtime.lastError) {
            console.error("[x2md] 扩展通信失败：", chrome.runtime.lastError);
            showToast("扩展通信失败，请重试", "error", 4000);
            return;
        }

        // 处理视频超时警告拦截
        if (resp && resp.require_video_confirm && resp.payload) {
            const yes = window.confirm(`发现这篇推文中包含长达 ${resp.durationMin} 分钟的超长视频。\n\n点击“确定”：一并下载大体积视频文件并保存\n点击“取消”：跳过视频，仅保存图文`);
            resp.payload.download_video = yes;
            resp.payload.video_confirmed = true;

            showToast(yes ? "指令已下达，正在连同长视频一并下载..." : "视频已剥离，正在光速脱水图文...");

            chrome.runtime.sendMessage({ action: "force_save_tweet", data: resp.payload }, (finalResp) => {
                handleSaveResponse(finalResp);
            });
            return;
        }

        handleSaveResponse(resp);
    });
}

function handleSaveResponse(resp) {
    if (resp && resp.success) {
        let savedName = "";
        if (resp.result?.saved?.[0]) {
            const parts = resp.result.saved[0].split("/");
            savedName = parts[parts.length - 1].replace(/\.md$/, "");
            if (savedName.length > 28) savedName = savedName.slice(0, 28) + "…";
        }
        const warning = resp.warning ? `\n⚠️ ${String(resp.warning).slice(0, 36)}` : "";
        showToast("已保存到 Obsidian" + (savedName ? `\n📄 ${savedName}` : "") + warning, "success", warning ? 6500 : 4500);
    } else {
        const errMsg = resp?.result?.errors?.[0] || resp?.error || "未知错误";
        const code = resp?.code || resp?.error_code || resp?.result?.code || resp?.result?.error_code;
        const prefix = code ? `${code}：` : "";
        showToast(`保存失败：${prefix}${String(errMsg).slice(0, 40)}`, "error", 5000);
    }
}

// ─────────────────────────────────────────────
// X 博主主页 / Articles 批量抓取
// ─────────────────────────────────────────────
const X_PROFILE_CAPTURE_BUTTON_ID = "__x2md_x_profile_capture_button";
const X_PROFILE_CAPTURE_MENU_ID = "__x2md_x_profile_capture_menu";
const X_PROFILE_CAPTURE_RESERVED_PATHS = new Set([
    "home", "explore", "notifications", "messages", "i", "search", "settings",
    "compose", "login", "logout", "signup", "jobs", "tos", "privacy", "download",
]);
let xProfileCaptureMenuHideTimer = null;
let xProfileCaptureRunning = false;
let xProfileCaptureProgress = "";

function updateXProfileCaptureButtonState() {
    const btn = document.getElementById(X_PROFILE_CAPTURE_BUTTON_ID);
    if (!btn) return;
    btn.disabled = xProfileCaptureRunning;
    btn.textContent = xProfileCaptureRunning ? "⏳" : "🐾";
    btn.title = xProfileCaptureRunning ? (xProfileCaptureProgress || "X2MD 正在批量抓取") : "X2MD 批量抓取博主内容";
    btn.style.cursor = xProfileCaptureRunning ? "wait" : "pointer";
    btn.style.opacity = xProfileCaptureRunning ? ".72" : "1";
}

function isXProfileCaptureEnabled(config = {}) {
    return config.show_x_profile_capture_button !== false;
}

function getTwitterProfileContext(locationLike = location) {
    if (!isTwitterLikePage(locationLike)) return null;
    const parts = String(locationLike.pathname || "").replace(/\/+$/, "").split("/").filter(Boolean);
    if (!parts.length) return null;
    const handle = parts[0];
    const lower = handle.toLowerCase();
    if (!/^[A-Za-z0-9_]{1,20}$/.test(handle) || X_PROFILE_CAPTURE_RESERVED_PATHS.has(lower)) return null;
    if (parts[1] === "status" || parts[1] === "article") return null;
    if (parts.length > 2) return null;
    const tab = parts[1] || "posts";
    if (!["posts", "articles"].includes(tab)) return null;
    return {
        handle,
        tab,
        isArticles: tab === "articles",
        profileUrl: `${location.origin}/${handle}`,
    };
}

function getProfileDisplayName() {
    const userName = document.querySelector('[data-testid="UserName"]')?.innerText?.trim();
    if (userName) {
        const first = userName.split("\n").map((line) => line.trim()).find(Boolean);
        if (first && !first.startsWith("@")) return first;
    }
    const title = document.title.replace(/\s*\/\s*X\s*$/, "").replace(/\s*-\s*X\s*$/, "").trim();
    const match = title.match(/^(.+?)\s*\(@/);
    if (match) return match[1].trim();
    return "";
}

function getXProfileCaptureSettings() {
    const range = String(runtimeConfig?.profile_capture_range || "today");
    const days = Math.max(1, parseInt(runtimeConfig?.profile_capture_custom_days, 10) || 7);
    return { range, days };
}

function getXProfileCaptureMenuSelectValue(settings = getXProfileCaptureSettings()) {
    if (settings.range !== "days") return settings.range;
    if ([7, 10, 30].includes(settings.days)) return `days:${settings.days}`;
    return "custom";
}

function getXProfileCaptureSettingsFromMenu(menu) {
    const select = menu?.querySelector?.('[data-x2md-role="profile-capture-range"]');
    const customInput = menu?.querySelector?.('[data-x2md-role="profile-capture-days"]');
    const value = select?.value || getXProfileCaptureMenuSelectValue();
    if (value === "all" || value === "month" || value === "today") {
        return { range: value, days: Math.max(1, parseInt(runtimeConfig?.profile_capture_custom_days, 10) || 7) };
    }
    if (value.startsWith("days:")) {
        return { range: "days", days: Math.max(1, parseInt(value.split(":")[1], 10) || 7) };
    }
    return {
        range: "days",
        days: Math.max(1, parseInt(customInput?.value, 10) || 1),
    };
}

function getXProfileCaptureRangeLabel(settings = getXProfileCaptureSettings()) {
    if (settings.range === "month") return "本月";
    if (settings.range === "all") return "全部";
    if (settings.range === "days") return `最近 ${settings.days} 天`;
    return "当日";
}

function getXProfileCaptureRangeStart(settings = getXProfileCaptureSettings()) {
    const now = new Date();
    if (settings.range === "all") return null;
    if (settings.range === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
    if (settings.range === "days") return new Date(now.getTime() - settings.days * 24 * 60 * 60 * 1000);
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function normalizeXUrl(url) {
    try {
        const u = new URL(url, location.origin);
        u.hostname = "x.com";
        u.search = "";
        u.hash = "";
        return u.href.replace(/\/$/, "");
    } catch {
        return String(url || "").split("?")[0].replace("twitter.com", "x.com").replace(/\/$/, "");
    }
}

function parseProfileStatusLink(article, profileHandle) {
    const handleLower = String(profileHandle || "").toLowerCase();
    const timeLink = article.querySelector("time")?.closest?.('a[href*="/status/"]');
    const candidates = timeLink ? [timeLink] : Array.from(article.querySelectorAll('a[href*="/status/"]'));
    for (const link of candidates) {
        const href = link.getAttribute("href") || link.href || "";
        const match = href.match(/\/([^/?#]+)\/status\/(\d+)/);
        if (!match) continue;
        if (match[1].toLowerCase() !== handleLower) continue;
        return {
            url: normalizeXUrl(`https://x.com/${match[1]}/status/${match[2]}`),
            tweetId: match[2],
        };
    }
    return null;
}

function isProfileRetweetArticle(article) {
    const social = article.querySelector('[data-testid="socialContext"]')?.innerText || "";
    return /(reposted|retweeted|repost|retweet|转发|转帖|已转发|已转帖)/i.test(social);
}

function collectVisibleProfileTweets(profile, rangeStart) {
    const found = [];
    let reachedOlderThanRange = false;
    const seenInScan = new Set();
    const articles = document.querySelectorAll('article[data-testid="tweet"], article[role="article"]');
    for (const article of articles) {
        if (isProfileRetweetArticle(article)) continue;
        const status = parseProfileStatusLink(article, profile.handle);
        if (!status || seenInScan.has(status.tweetId)) continue;
        seenInScan.add(status.tweetId);

        const timeEl = article.querySelector("time");
        const published = timeEl?.getAttribute("datetime") || "";
        const publishedDate = published ? new Date(published) : null;
        if (rangeStart && publishedDate && publishedDate < rangeStart) {
            reachedOlderThanRange = true;
            continue;
        }

        const { author, handle } = extractAuthorBasic(article);
        const tweetHandle = handle || `@${profile.handle}`;
        if (tweetHandle.replace(/^@/, "").toLowerCase() !== profile.handle.toLowerCase()) continue;

        found.push({
            type: "tweet",
            tweet_id: status.tweetId,
            url: status.url,
            author: author || profile.displayName || profile.handle,
            handle: tweetHandle,
            author_url: profile.profileUrl,
            published,
            text: extractTweetTextBasic(article),
            images: extractImages(article),
            image_alt_texts: extractImageAltTexts(article),
            quote_tweet: extractQuoteTweetBasic(article),
            thread_tweets: extractThreadBasic(article, tweetHandle),
            graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
        });
    }
    return { tweets: found, reachedOlderThanRange };
}

async function scrollAndCollectProfileTweets(profile, options = {}) {
    const settings = options.settings || getXProfileCaptureSettings();
    const rangeStart = getXProfileCaptureRangeStart(settings);
    const maxScrolls = settings.range === "all" ? 260 : 90;
    const originalY = window.scrollY;
    const collected = new Map();
    let noNewRounds = 0;
    let olderRounds = 0;

    for (let round = 0; round < maxScrolls; round++) {
        const beforeSize = collected.size;
        const scan = collectVisibleProfileTweets(profile, rangeStart);
        for (const tweet of scan.tweets) {
            if (!collected.has(tweet.tweet_id)) collected.set(tweet.tweet_id, tweet);
        }

        if (collected.size !== beforeSize) {
            noNewRounds = 0;
            showToast(`正在扫描主页推文…已发现 ${collected.size} 条`, "loading", null);
        } else {
            noNewRounds++;
        }

        if (rangeStart && scan.reachedOlderThanRange) olderRounds++;
        else olderRounds = 0;
        if (rangeStart && olderRounds >= 2) break;
        if (noNewRounds >= 5) break;

        const previousBottom = window.scrollY + window.innerHeight;
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
        await new Promise((resolve) => setTimeout(resolve, 950));
        const nextBottom = window.scrollY + window.innerHeight;
        if (Math.abs(nextBottom - previousBottom) < 8 && noNewRounds >= 2) break;
    }

    if (!options.keepScrollPosition) {
        window.scrollTo({ top: originalY, behavior: "auto" });
    }
    return Array.from(collected.values());
}

function extractProfileArticleUrl(container) {
    const links = container ? container.querySelectorAll('a[href*="/article/"]') : [];
    for (const link of links) {
        const href = link.getAttribute("href") || link.href || "";
        const match = href.match(/\/(?:i\/article|[^/]+\/article)\/(\d+)(?:$|[?#])/);
        if (match) return normalizeXUrl(new URL(href, location.origin).href);
    }
    return "";
}

function extractProfileArticleCardTitle(container, fallbackText = "") {
    const lines = (container?.innerText || fallbackText || "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.find((line) =>
        !line.startsWith("@") &&
        !/^(\d+[Kk万]?|·|Reply|Repost|Like|View|Download|回复|转发|喜欢|查看|显示更多|关注|正在关注)/.test(line)
    ) || "";
}

function collectVisibleProfileArticles(profile) {
    const found = [];
    const seen = new Set();
    const pushArticle = (articleData) => {
        const key = articleData.article_url || articleData.tweet_url || articleData.url;
        if (!key || seen.has(key)) return;
        seen.add(key);
        found.push(articleData);
    };

    document.querySelectorAll('article[data-testid="tweet"], article[role="article"]').forEach((article) => {
        if (isProfileRetweetArticle(article)) return;
        const status = parseProfileStatusLink(article, profile.handle);
        const directArticleUrl = extractProfileArticleUrl(article);
        if (!status && !directArticleUrl) return;

        const { author, handle } = extractAuthorBasic(article);
        const articleHandle = handle || `@${profile.handle}`;
        if (articleHandle.replace(/^@/, "").toLowerCase() !== profile.handle.toLowerCase()) return;

        const timeEl = article.querySelector("time");
        pushArticle({
            type: "article",
            url: directArticleUrl || status.url,
            article_url: directArticleUrl,
            tweet_url: status?.url || "",
            tweet_id: status?.tweetId || "",
            article_title: extractProfileArticleCardTitle(article),
            author: author || profile.displayName || profile.handle,
            handle: articleHandle,
            author_url: profile.profileUrl,
            published: timeEl?.getAttribute("datetime") || "",
            graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
        });
    });

    document.querySelectorAll('a[href*="/article/"]').forEach((link) => {
        const href = link.getAttribute("href") || link.href || "";
        const match = href.match(/\/(?:i\/article|[^/]+\/article)\/(\d+)(?:$|[?#])/);
        if (!match) return;
        const url = normalizeXUrl(new URL(href, location.origin).href);
        if (!url) return;
        const card = link.closest('article, [data-testid="cellInnerDiv"]') || link.parentElement;
        const timeEl = card?.querySelector?.("time");
        pushArticle({
            type: "article",
            url,
            article_url: url,
            tweet_url: card ? (parseProfileStatusLink(card, profile.handle)?.url || "") : "",
            article_title: extractProfileArticleCardTitle(card, link.innerText),
            author: profile.displayName || profile.handle,
            handle: `@${profile.handle}`,
            author_url: profile.profileUrl,
            published: timeEl?.getAttribute("datetime") || "",
        });
    });
    return found;
}

async function scrollAndCollectProfileArticles(profile) {
    const originalY = window.scrollY;
    const collected = new Map();
    let noNewRounds = 0;
    for (let round = 0; round < 120; round++) {
        const beforeSize = collected.size;
        for (const article of collectVisibleProfileArticles(profile)) {
            if (!collected.has(article.url)) collected.set(article.url, article);
        }
        if (collected.size !== beforeSize) {
            noNewRounds = 0;
            showToast(`正在扫描文章列表…已发现 ${collected.size} 篇`, "loading", null);
        } else {
            noNewRounds++;
        }
        if (noNewRounds >= 5) break;
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "auto" });
        await new Promise((resolve) => setTimeout(resolve, 950));
    }
    window.scrollTo({ top: originalY, behavior: "auto" });
    return Array.from(collected.values());
}

function sendProfileCapturePayload(payload) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "batch_profile_capture", data: payload }, (resp) => {
            if (chrome.runtime.lastError) {
                resolve({ success: false, error: chrome.runtime.lastError.message });
                return;
            }
            resolve(resp || { success: false, error: "批量抓取无响应" });
        });
    });
}

function handleProfileCaptureResponse(resp, mode) {
    xProfileCaptureRunning = false;
    xProfileCaptureProgress = "";
    updateXProfileCaptureButtonState();
    if (resp?.success) {
        const result = resp.result || {};
        const savedCount = result.saved?.length || 0;
        const skipped = result.skipped || 0;
        const foundCount = Number(resp.found_count ?? resp.enriched_count ?? 0);
        if (!foundCount && !savedCount && !skipped) {
            showToast(mode === "articles" ? "未发现可抓取文章" : "未发现符合范围的原创推文", "error", 4500);
            return;
        }
        showToast(
            `${mode === "articles" ? "文章" : "推文"}抓取完成：新增 ${savedCount} 个文件，跳过 ${skipped} 条已抓取内容`,
            "success",
            6500,
        );
    } else {
        showToast(`批量抓取失败：${String(resp?.error || resp?.result?.error || "未知错误").slice(0, 60)}`, "error", 6500);
    }
}

async function startXProfileCapture(options = {}) {
    if (xProfileCaptureRunning) {
        showToast("批量抓取仍在进行，请稍候…", "loading", 3000);
        return;
    }
    const context = getTwitterProfileContext();
    if (!context) {
        showToast("请先打开 X 博主主页或 Articles 页面", "error", 4000);
        return;
    }

    xProfileCaptureRunning = true;
    xProfileCaptureProgress = "准备抓取…";
    updateXProfileCaptureButtonState();
    const profile = {
        handle: context.handle,
        displayName: getProfileDisplayName() || context.handle,
        profileUrl: context.profileUrl,
    };
    const settings = options.settings || getXProfileCaptureSettings();
    const mode = context.isArticles ? "articles" : "tweets";
    const rangeLabel = mode === "articles" ? "全部文章" : getXProfileCaptureRangeLabel(settings);

    try {
        xProfileCaptureProgress = mode === "articles" ? "正在抓取文章…" : `正在抓取推文（${rangeLabel}）…`;
        updateXProfileCaptureButtonState();
        showToast(mode === "articles" ? "正在通过接口抓取博主文章…" : `正在通过接口抓取博主推文（${rangeLabel}）…`, "loading", null);
        const resp = await sendProfileCapturePayload({
            mode,
            profile,
            range: settings.range,
            days: settings.days,
            range_label: rangeLabel,
            force_full: !!options.forceFull,
            items: [],
        });
        handleProfileCaptureResponse(resp, mode);
    } catch (error) {
        xProfileCaptureRunning = false;
        xProfileCaptureProgress = "";
        updateXProfileCaptureButtonState();
        showToast(`批量抓取失败：${String(error?.message || error).slice(0, 60)}`, "error", 6500);
    }
}

function ensureXProfileCaptureMenu() {
    let menu = document.getElementById(X_PROFILE_CAPTURE_MENU_ID);
    if (menu) return menu;
    menu = document.createElement("div");
    menu.id = X_PROFILE_CAPTURE_MENU_ID;
    Object.assign(menu.style, {
        position: "fixed",
        zIndex: "2147483647",
        minWidth: "300px",
        padding: "8px",
        borderRadius: "16px",
        border: "1px solid rgba(207,217,222,.9)",
        background: "rgba(255,255,255,.96)",
        boxShadow: "0 8px 28px rgba(15,20,25,.18)",
        color: "rgb(15,20,25)",
        display: "none",
        opacity: "0",
        transform: "translateY(-4px) scale(.98)",
        transformOrigin: "top right",
        transition: "opacity .14s ease, transform .14s ease",
        fontFamily: "TwitterChirp, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    });
    menu.addEventListener("mouseenter", () => clearTimeout(xProfileCaptureMenuHideTimer));
    menu.addEventListener("mouseleave", scheduleHideXProfileCaptureMenu);
    document.body.appendChild(menu);
    return menu;
}

function scheduleHideXProfileCaptureMenu() {
    clearTimeout(xProfileCaptureMenuHideTimer);
    xProfileCaptureMenuHideTimer = setTimeout(() => {
        const menu = document.getElementById(X_PROFILE_CAPTURE_MENU_ID);
        if (!menu) return;
        menu.style.opacity = "0";
        menu.style.transform = "translateY(-4px) scale(.98)";
        setTimeout(() => {
            if (menu.style.opacity === "0") menu.style.display = "none";
        }, 160);
    }, 180);
}

function addProfileCaptureMenuItem(menu, label, subLabel, onClick, options = {}) {
    const item = document.createElement("button");
    item.type = "button";
    Object.assign(item.style, {
        display: "block",
        width: "100%",
        border: "none",
        borderRadius: "12px",
        background: "transparent",
        color: options.danger ? "rgb(244,33,46)" : "rgb(15,20,25)",
        cursor: "pointer",
        textAlign: "left",
        padding: "10px 12px",
        fontSize: "15px",
        fontWeight: "700",
    });
    item.innerHTML = `<div>${label}</div>${subLabel ? `<div style="font-size:12px;font-weight:500;color:rgb(83,100,113);margin-top:2px;">${subLabel}</div>` : ""}`;
    item.addEventListener("mouseenter", () => { item.style.background = "rgba(15,20,25,.06)"; });
    item.addEventListener("mouseleave", () => { item.style.background = "transparent"; });
    item.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        menu.style.display = "none";
        onClick();
    });
    menu.appendChild(item);
}

function addProfileCaptureRangeControl(menu, settings, context, subtitleEl, mount = menu) {
    const row = document.createElement("div");
    Object.assign(row.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: mount === menu ? "0 12px 10px" : "0",
        width: context.isArticles ? "118px" : "184px",
    });

    const select = document.createElement("select");
    select.dataset.x2mdRole = "profile-capture-range";
    Object.assign(select.style, {
        flex: "1",
        height: "34px",
        border: "1px solid rgba(207,217,222,.95)",
        borderRadius: "10px",
        background: "#fff",
        color: "rgb(15,20,25)",
        fontSize: "13px",
        fontWeight: "700",
        padding: "0 8px",
        outline: "none",
        cursor: context.isArticles ? "not-allowed" : "pointer",
    });

    const options = context.isArticles
        ? [{ value: "all", label: "全部文章" }]
        : [
            { value: "today", label: "当日" },
            { value: "days:7", label: "最近 7 天" },
            { value: "days:10", label: "最近 10 天" },
            { value: "days:30", label: "最近 30 天" },
            { value: "month", label: "当月" },
            { value: "all", label: "全部" },
            { value: "custom", label: "自定义天数" },
        ];

    for (const optionConfig of options) {
        const option = document.createElement("option");
        option.value = optionConfig.value;
        option.textContent = optionConfig.label;
        select.appendChild(option);
    }
    select.value = context.isArticles ? "all" : getXProfileCaptureMenuSelectValue(settings);
    select.disabled = context.isArticles;

    const customInput = document.createElement("input");
    customInput.dataset.x2mdRole = "profile-capture-days";
    customInput.type = "number";
    customInput.min = "1";
    customInput.max = "3650";
    customInput.value = settings.range === "days" ? String(settings.days) : "10";
    Object.assign(customInput.style, {
        width: "74px",
        height: "32px",
        border: "1px solid rgba(207,217,222,.95)",
        borderRadius: "10px",
        background: "#fff",
        color: "rgb(15,20,25)",
        fontSize: "13px",
        fontWeight: "700",
        padding: "0 8px",
        outline: "none",
        display: select.value === "custom" ? "block" : "none",
    });

    const sync = () => {
        customInput.style.display = select.value === "custom" ? "block" : "none";
        const current = context.isArticles ? { range: "all", days: 1 } : getXProfileCaptureSettingsFromMenu(menu);
        subtitleEl.textContent = `${context.isArticles ? "博主文章" : "博主推文"} · ${context.isArticles ? "全部文章" : getXProfileCaptureRangeLabel(current)}`;
    };
    select.addEventListener("change", sync);
    customInput.addEventListener("input", sync);
    select.addEventListener("click", (event) => event.stopPropagation());
    customInput.addEventListener("click", (event) => event.stopPropagation());

    row.append(select, customInput);
    mount.appendChild(row);
    sync();
}

function showXProfileCaptureMenu(btn) {
    const context = getTwitterProfileContext();
    if (!context) return;
    clearTimeout(xProfileCaptureMenuHideTimer);
    const menu = ensureXProfileCaptureMenu();
    menu.textContent = "";

    const settings = getXProfileCaptureSettings();
    const modeLabel = context.isArticles ? "博主文章" : "博主推文";
    const rangeLabel = context.isArticles ? "全部文章" : getXProfileCaptureRangeLabel(settings);
    const title = document.createElement("div");
    title.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:8px 12px 10px;"><div style="min-width:0;"><div style="font-size:15px;font-weight:800;padding:0 0 4px;">🐾 X2MD 批量抓取</div><div data-x2md-role="profile-capture-subtitle" style="font-size:12px;color:rgb(83,100,113);padding:0;">${modeLabel} · ${rangeLabel}</div></div><div data-x2md-role="profile-capture-control"></div></div>`;
    menu.appendChild(title);
    const subtitleEl = title.querySelector('[data-x2md-role="profile-capture-subtitle"]');
    const controlEl = title.querySelector('[data-x2md-role="profile-capture-control"]');
    addProfileCaptureRangeControl(menu, settings, context, subtitleEl, controlEl);

    addProfileCaptureMenuItem(menu, "开始抓取", "自动跳过本地记录中已抓取的推文/文章", () => {
        startXProfileCapture({ forceFull: false, settings: getXProfileCaptureSettingsFromMenu(menu) });
    });
    addProfileCaptureMenuItem(menu, "重新完整抓取", "不按本地记录跳过，适合重建 Markdown 文件", () => {
        startXProfileCapture({ forceFull: true, settings: getXProfileCaptureSettingsFromMenu(menu) });
    }, { danger: true });
    addProfileCaptureMenuItem(menu, "打开设置", "修改时间范围和保存路径", () => {
        chrome.runtime.sendMessage({ action: "open_options" });
    });

    menu.style.visibility = "hidden";
    menu.style.display = "block";
    const rect = btn.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, rect.right - menuRect.width));
    let top = rect.bottom + 8;
    if (top + menuRect.height > window.innerHeight - 8) top = rect.top - menuRect.height - 8;
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, top)}px`;
    menu.style.visibility = "visible";
    requestAnimationFrame(() => {
        menu.style.opacity = "1";
        menu.style.transform = "translateY(0) scale(1)";
    });
}

function ensureXProfileCaptureButton() {
    const context = getTwitterProfileContext();
    const enabled = isXProfileCaptureEnabled(runtimeConfig || {});
    let btn = document.getElementById(X_PROFILE_CAPTURE_BUTTON_ID);
    if (!context || !enabled) {
        btn?.remove();
        return;
    }

    const tablist = document.querySelector('[role="tablist"]');
    if (!btn) {
        btn = document.createElement("button");
        btn.id = X_PROFILE_CAPTURE_BUTTON_ID;
        btn.type = "button";
        btn.textContent = "🐾";
        btn.title = "X2MD 批量抓取博主内容";
        btn.setAttribute("aria-label", "X2MD 批量抓取博主内容");
        btn.setAttribute("aria-live", "polite");
        Object.assign(btn.style, {
            width: "44px",
            height: "44px",
            minWidth: "44px",
            border: "none",
            borderRadius: "999px",
            background: "transparent",
            color: "rgb(29,155,240)",
            fontSize: "20px",
            cursor: "pointer",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background .15s ease, transform .15s ease",
            zIndex: "9",
        });
        btn.addEventListener("mouseenter", () => {
            clearTimeout(xProfileCaptureMenuHideTimer);
            btn.style.background = "rgba(29,155,240,.1)";
            btn.style.transform = "translateY(-1px)";
            if (!xProfileCaptureRunning) showXProfileCaptureMenu(btn);
        });
        btn.addEventListener("mouseleave", () => {
            btn.style.background = "transparent";
            btn.style.transform = "translateY(0)";
            scheduleHideXProfileCaptureMenu();
        });
        btn.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!xProfileCaptureRunning) showXProfileCaptureMenu(btn);
        });
    }

    if (tablist) {
        updateXProfileCaptureButtonState();
        if (btn.parentElement !== tablist) tablist.appendChild(btn);
        Object.assign(btn.style, { position: "relative", top: "", right: "", boxShadow: "none" });
    } else if (btn.parentElement !== document.body) {
        updateXProfileCaptureButtonState();
        document.body.appendChild(btn);
        Object.assign(btn.style, {
            position: "fixed",
            top: "148px",
            right: "24px",
            boxShadow: "0 8px 20px rgba(15,20,25,.16)",
            background: "rgba(255,255,255,.92)",
        });
    }
}

// ─────────────────────────────────────────────
// Toast（三阶段：loading / success / error）
// ─────────────────────────────────────────────
const TOAST_COLORS = {
    loading: { bg: "#1d9bf0", shadow: "rgba(29,155,240,.4)" },
    success: { bg: "#00ba7c", shadow: "rgba(0,186,124,.4)" },
    error: { bg: "#f4212e", shadow: "rgba(244,33,46,.4)" },
};

function getToast() {
    let t = document.getElementById("__x2md_toast");
    if (!t) {
        t = document.createElement("div");
        t.id = "__x2md_toast";
        Object.assign(t.style, {
            position: "fixed", bottom: "24px", right: "24px",
            minWidth: "220px", maxWidth: "340px",
            padding: "12px 18px", borderRadius: "12px",
            fontSize: "14px", fontWeight: "600", color: "#fff",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
            lineHeight: "1.5", zIndex: "2147483647",
            boxShadow: "0 8px 24px rgba(0,0,0,.35)",
            transition: "opacity .3s ease, transform .3s ease",
            opacity: "0", transform: "translateY(8px)", pointerEvents: "none",
        });
        document.body.appendChild(t);
    }
    return t;
}

function showToast(message, type = "loading", duration = null) {
    const t = getToast();
    const c = TOAST_COLORS[type] || TOAST_COLORS.loading;
    const icons = { loading: "⏳", success: "✅", error: "❌" };
    t.style.background = c.bg;
    t.style.boxShadow = `0 8px 24px ${c.shadow}`;
    t.innerHTML = `<span style="margin-right:8px">${icons[type]}</span>${message}`;
    t.style.opacity = "1";
    t.style.transform = "translateY(0)";
    clearTimeout(t.__timer);
    if (duration !== null) {
        t.__timer = setTimeout(() => {
            t.style.opacity = "0";
            t.style.transform = "translateY(8px)";
        }, duration);
    }
}

function ensureFloatingSaveButton() {
    const siteKey = detectFloatingSaveSite();
    const enabled = isFloatingSaveIconEnabled(runtimeConfig || {});
    let btn = document.getElementById(SITE_FLOATING_SAVE_BUTTON_ID);

    if (!siteKey || !enabled) {
        btn?.remove();
        return;
    }

    const siteConfig = getFloatingSaveSiteConfig(siteKey);
    if (!siteConfig) {
        btn?.remove();
        return;
    }

    if (!btn) {
        btn = document.createElement("button");
        btn.id = SITE_FLOATING_SAVE_BUTTON_ID;
        btn.type = "button";
        Object.assign(btn.style, {
            position: "fixed",
            top: "96px",
            right: "24px",
            width: "42px",
            height: "42px",
            border: "none",
            borderRadius: "999px",
            color: "#fff",
            fontSize: "12px",
            fontWeight: "700",
            letterSpacing: ".04em",
            cursor: "pointer",
            zIndex: "2147483646",
            boxShadow: "0 10px 24px rgba(0,0,0,.18)",
            transition: "transform .15s ease, opacity .15s ease",
        });
        btn.addEventListener("mouseenter", () => {
            btn.style.transform = "translateY(-1px)";
        });
        btn.addEventListener("mouseleave", () => {
            btn.style.transform = "translateY(0)";
        });
        btn.addEventListener("click", () => handleFloatingSave(btn.dataset.siteKey));
        document.body.appendChild(btn);
    }

    btn.dataset.siteKey = siteKey;
    btn.textContent = siteConfig.label;
    btn.title = siteConfig.title;
    btn.setAttribute("aria-label", siteConfig.title);
    btn.style.background = siteConfig.background;
    btn.style.boxShadow = `0 10px 24px ${siteConfig.shadow}`;
}

function ensureX2MDA11yStyle() {
    if (document.getElementById("__x2md_a11y_style")) return;
    const style = document.createElement("style");
    style.id = "__x2md_a11y_style";
    style.textContent = `button[id^="__x2md"], #__x2md_bookmarks_toolbar button { outline: none; } button[id^="__x2md"]:focus-visible, #__x2md_bookmarks_toolbar button:focus-visible { outline: 3px solid #1d9bf0; outline-offset: 2px; }`;
    document.documentElement.appendChild(style);
}

// ─────────────────────────────────────────────
// MutationObserver：监听动态加载的推文
// ─────────────────────────────────────────────
const X_BOOKMARKS_TOOLBAR_ID = "__x2md_bookmarks_toolbar";
let xBookmarksExportState = null;

function sendBookmarkSaveMessage(data) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "save_tweet", data }, (resp) => resolve(resp || { success: false, error: "扩展无响应" }));
    });
}

function updateBookmarksToolbarStatus() {
    const toolbar = document.getElementById(X_BOOKMARKS_TOOLBAR_ID);
    if (!toolbar) return;
    const status = toolbar.querySelector('[data-x2md-role="bookmarks-status"]');
    const pause = toolbar.querySelector('[data-x2md-role="bookmarks-pause"]');
    const retry = toolbar.querySelector('[data-x2md-role="bookmarks-retry"]');
    const state = xBookmarksExportState;
    if (!state) {
        if (status) status.textContent = "可导出当前已加载书签";
        if (pause) pause.disabled = true;
        if (retry) retry.disabled = true;
        return;
    }
    if (status) status.textContent = `进度 ${state.index}/${state.urls.length} · 成功 ${state.success} · 跳过 ${state.skipped} · 失败 ${state.failed.length}`;
    if (pause) {
        pause.disabled = state.done || state.cancelled;
        pause.textContent = state.paused ? "继续" : "暂停";
    }
    if (retry) retry.disabled = state.running || !state.failed.length;
}

async function runBookmarksExport(urls) {
    const state = {
        urls,
        index: 0,
        success: 0,
        skipped: 0,
        failed: [],
        paused: false,
        cancelled: false,
        running: true,
        done: false,
    };
    xBookmarksExportState = state;
    updateBookmarksToolbarStatus();

    while (state.index < state.urls.length) {
        if (state.cancelled) break;
        if (state.paused) {
            await new Promise((resolve) => setTimeout(resolve, 250));
            continue;
        }

        const url = state.urls[state.index];
        const resp = await sendBookmarkSaveMessage({ type: "tweet", url, text: "", images: [], thread_tweets: [] });
        if (resp?.success) state.success += 1;
        else if (resp?.result?.skipped || resp?.skipped) state.skipped += 1;
        else state.failed.push(url);
        state.index += 1;
        updateBookmarksToolbarStatus();
    }

    state.running = false;
    state.done = true;
    updateBookmarksToolbarStatus();
    showToast(state.cancelled ? "书签导出已取消" : `书签导出完成：成功 ${state.success}，失败 ${state.failed.length}`, state.failed.length ? "error" : "success", 5000);
}

function ensureBookmarksToolbar() {
    if (!isXBookmarksPage()) {
        document.getElementById(X_BOOKMARKS_TOOLBAR_ID)?.remove();
        return;
    }

    let toolbar = document.getElementById(X_BOOKMARKS_TOOLBAR_ID);
    if (!toolbar) {
        toolbar = document.createElement("div");
        toolbar.id = X_BOOKMARKS_TOOLBAR_ID;
        toolbar.innerHTML = `
            <strong style="font-size:13px;">X2MD 书签导出</strong>
            <span data-x2md-role="bookmarks-status" style="font-size:12px;color:rgb(83,100,113);">可导出当前已加载书签</span>
            <button type="button" aria-label="X2MD 导出当前已加载书签" data-x2md-role="bookmarks-export">导出可见</button>
            <button type="button" aria-label="暂停或继续 X2MD 书签导出" data-x2md-role="bookmarks-pause" disabled>暂停</button>
            <button type="button" aria-label="取消 X2MD 书签导出" data-x2md-role="bookmarks-cancel">取消</button>
            <button type="button" aria-label="重试失败的 X2MD 书签导出" data-x2md-role="bookmarks-retry" disabled>重试失败</button>
        `;
        Object.assign(toolbar.style, {
            position: "sticky",
            top: "0",
            zIndex: "2147483646",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            padding: "10px 12px",
            margin: "8px",
            borderRadius: "16px",
            background: "rgba(255,255,255,.92)",
            boxShadow: "0 8px 28px rgba(0,0,0,.12)",
            backdropFilter: "blur(18px)",
        });
        toolbar.querySelectorAll("button").forEach((button) => {
            Object.assign(button.style, {
                border: "1px solid rgba(15,20,25,.16)",
                borderRadius: "999px",
                background: "#fff",
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: "12px",
                fontWeight: "700",
            });
        });
        toolbar.querySelector('[data-x2md-role="bookmarks-export"]').addEventListener("click", () => {
            const urls = collectUniqueStatusUrls(document);
            if (!urls.length) {
                showToast("当前页面还没有已加载书签", "error", 4000);
                return;
            }
            runBookmarksExport(urls);
        });
        toolbar.querySelector('[data-x2md-role="bookmarks-pause"]').addEventListener("click", () => {
            if (!xBookmarksExportState) return;
            xBookmarksExportState.paused = !xBookmarksExportState.paused;
            updateBookmarksToolbarStatus();
        });
        toolbar.querySelector('[data-x2md-role="bookmarks-cancel"]').addEventListener("click", () => {
            if (xBookmarksExportState) xBookmarksExportState.cancelled = true;
            updateBookmarksToolbarStatus();
        });
        toolbar.querySelector('[data-x2md-role="bookmarks-retry"]').addEventListener("click", () => {
            const failed = xBookmarksExportState?.failed || [];
            if (failed.length) runBookmarksExport(failed);
        });
        (document.querySelector("main") || document.body).prepend(toolbar);
    }
    updateBookmarksToolbarStatus();
}

function isTwitterLikePage(locationLike = location) {
    const hostname = String(locationLike?.hostname || "").toLowerCase();
    return hostname === "x.com" || hostname.endsWith(".x.com") ||
        hostname === "twitter.com" || hostname.endsWith(".twitter.com");
}

function isTwitterDetailOrArticlePage() {
    return isNotePageUrl() || location.pathname.includes("/status/");
}

function bindAll() {
    ensureX2MDA11yStyle();
    // 关键性能修复：书签按钮只存在于 X/Twitter。
    // 之前在 linux.do / 微信公众号页面的每次 DOM mutation 都会全页扫描一组
    // Twitter 选择器；这两个站点本身会高频动态更新 DOM，导致扩展开启后页面卡死。
    if (isTwitterLikePage()) {
        document.querySelectorAll(BOOKMARK_SELECTORS).forEach(attachBookmarkListener);
        ensureTwitterInlineCopyButtons();
        scheduleAutoTranslateLoadedContent();
        ensureXProfileCaptureButton();
        ensureBookmarksToolbar();
    }
    ensureFloatingSaveButton();
}

let bindScheduled = false;
function scheduleBindAll() {
    if (bindScheduled) return;
    bindScheduled = true;
    const run = () => {
        bindScheduled = false;
        bindAll();
    };
    if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(run);
    } else {
        setTimeout(run, 100);
    }
}

document.addEventListener("click", (event) => {
    if (!isLinuxDoTopicPage()) return;
    const btn = event.target?.closest?.(LINUX_DO_LIKE_SELECTOR);
    if (!btn) return;
    setTimeout(() => captureLinuxDoPost(btn), 250);
}, true);

const observer = new MutationObserver(scheduleBindAll);
observer.observe(document.body, { childList: true, subtree: true });
requestRuntimeConfig();
bindAll();

console.log("[x2md] 内容脚本已加载 v1.4");
