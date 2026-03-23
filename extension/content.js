/**
 * content.js - X2MD 内容脚本 v1.3
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

function extractImages(container) {
    if (!container) return [];
    const imgs = new Set();

    // ── 优先：Twitter 明确的图片容器 ─────────────
    // 推文图片
    container.querySelectorAll('[data-testid="tweetPhoto"] img').forEach(img => {
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
        const src = img.src || img.getAttribute("src") || "";
        if (src && !src.includes("profile_images") && !src.includes("emoji")) {
            imgs.add(normalizeImageUrl(src));
        }
    });

    // ── 通用 fallback：所有 pbs.twimg.com 图片全量提取（彻底防止漏网之鱼） ───
    container.querySelectorAll("img").forEach(img => {
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

    // ── 文章正文容器（优先 Twitter Note 专用 testid）─
    // 严格限制：只尝试抓取 Note 核心流，决不回退到普通的 <article> 避免将转赞评抓入。
    const bodyContainer =
        document.querySelector('[data-testid="twitterArticleRichTextView"]') ||
        document.querySelector('[data-testid="longformRichTextComponent"]') ||
        document.querySelector('[data-testid="twitterArticleReadView"]') ||
        document.querySelector('[data-testid="article-content"]');

    if (!bodyContainer) return null; // 无法定位专有正文容器时直接放弃，让背景去真实页面解析

    let article_content = "";
    try {
        article_content = extractArticleMarkdown(bodyContainer);
        if (!article_content) {
            article_content = bodyContainer.innerText.trim().slice(0, 5000);
        }
    } catch (e) {
        console.error("[x2md] DFS提取失败: ", e);
        article_content = bodyContainer.innerText.trim().slice(0, 5000);
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

    // ── 封面图全局搜集附加 ──
    // 很多文章的首图其实是在推文上方，或者是特定的 article-cover
    let coverImg = "";
    document.querySelectorAll('[data-testid="tweetPhoto"] img, img[alt="Article cover image"]').forEach(img => {
        const src = img.src || '';
        if (src && src.includes('pbs.twimg.com') && !src.includes('profile_images')) {
            const cleanSrc = src.split('?')[0];
            const u = new URL(src);
            u.searchParams.set('name', 'orig');
            if (!article_content.includes(cleanSrc) && !coverImg.includes(u.href)) {
                coverImg += `![](${u.href})\n\n`;
            }
        }
    });

    article_content = coverImg + article_content;

    // 从富文本层级以及整体推文获取图片比对去重（确保首字母/剩余插图不丢失图片）
    const extractedImages = [];
    document.querySelectorAll('[data-testid="twitterArticleRichTextView"] img, img').forEach(img => {
        const src = img.src || '';
        const parent = img.closest('[data-testid="tweetPhoto"], [data-testid="article-cover-image"]');
        if (parent) return; // 已经在封面中处理了

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
        videos: finalVideos,
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
        const text = extractTweetTextBasic(art);
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
        return;
    }

    chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
        runtimeConfig = resp?.success ? (resp.config || {}) : {};
        ensureFloatingSaveButton();
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

    const seen = new Map();
    const originalScrollTop = container.scrollTop;

    function collect() {
        const blocks = document.querySelectorAll("#docx .block[data-block-type]");
        for (const block of blocks) {
            const id = block.getAttribute("data-block-id");
            if (!id || seen.has(id)) continue;
            seen.set(id, block.cloneNode(true));
        }
    }

    const step = Math.max(container.clientHeight * 0.6, 400);

    // 向下滚动收集 — 动态跟踪 scrollHeight，直到确认到底
    collect();
    let pos = 0;
    let stuckCount = 0;
    while (stuckCount < 3) {
        pos += step;
        container.scrollTop = pos;
        await new Promise((r) => setTimeout(r, 100));
        collect();
        // 检查是否真的滚到了（scrollHeight 可能在增长）
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (container.scrollTop >= maxScroll - 10) {
            stuckCount++;
            // scrollHeight 可能因为新渲染而增长，给它一点时间
            await new Promise((r) => setTimeout(r, 150));
            // 更新 pos 到当前实际位置，防止 scrollHeight 增长后漏掉
            pos = container.scrollTop;
        } else {
            stuckCount = 0;
        }
    }

    // 回滚收集（补漏首屏区域 block）
    for (let p = container.scrollHeight; p >= 0; p -= step) {
        container.scrollTop = p;
        await new Promise((r) => setTimeout(r, 60));
        collect();
    }

    container.scrollTop = originalScrollTop;
    console.log(`[x2md] 飞书滚动收集完成：${seen.size} unique blocks`);

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

function attachBookmarkListener(btn) {
    if (btn.__x2md_bound) return;
    btn.__x2md_bound = true;
    btn.addEventListener("click", () => {
        setTimeout(() => captureAndSend(btn), 400);
    }, true);
}

// ─────────────────────────────────────────────
// 主流程：捕获 → 组装基础数据 → 发给 background
// ─────────────────────────────────────────────
function captureAndSend(btn) {
    showToast("正在获取完整推文内容…", "loading", null);

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
                    sendToBackground(articleData);
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
                sendToBackground({
                    ...inlineArticle,
                    url: tweetUrl,       // 用原始推文链接（/status/xxx）作为源
                    author: inlineArticle.author || author,
                    handle: inlineArticle.handle || handle,
                    published: inlineArticle.published || published,
                    images: inlineArticle.images, // 透传已经过去重的剩余外部图
                    graphql_operation_ids: inlineArticle.graphql_operation_ids || extractDiscoveredGraphQLOperationIds(),
                });
                return;
            }
        } catch (extractErr) {
            console.error("[x2md] 内嵌文提取异常：", extractErr);
            // 虽然出现异常，我们依旧交接给 background 让它起用第二道防线：静默 tab 开启抓取，避免假死
        }

        // 降级：让 background 尝试 fetch（可能得到空壳），最终降级为摘要+链接
        console.log("[x2md] 当前页面无内嵌内容，由 background 处理");
        sendToBackground({
            type: "note",
            url: tweetUrl,
            note_article_url: noteArticleUrl,
            author, handle, published, images,
            text: extractTweetTextBasic(article),
            thread_tweets: [],
            graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
        });
        return;
    }

    // ── 普通推文 ──────────────────────────────────────
    const text = extractTweetTextBasic(article);
    const thread_tweets = extractThreadBasic(article, handle);

    console.log("[x2md] 普通推文：", { handle, url: tweetUrl, text: text.slice(0, 40) });
    sendToBackground({
        author,
        handle,
        text,
        published,
        url: tweetUrl,
        images,
        thread_tweets,
        type: "tweet",
        graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
    });
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
        showToast("已保存到 Obsidian" + (savedName ? `\n📄 ${savedName}` : ""), "success", 4500);
    } else {
        const errMsg = resp?.result?.errors?.[0] || resp?.error || "未知错误";
        showToast(`保存失败：${String(errMsg).slice(0, 40)}`, "error", 5000);
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

    // 按钮已存在且 siteKey 未变 → 跳过更新，避免 MutationObserver 死循环
    if (btn && btn.dataset.siteKey === siteKey) {
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
    btn.style.background = siteConfig.background;
    btn.style.boxShadow = `0 10px 24px ${siteConfig.shadow}`;
}

// ─────────────────────────────────────────────
// MutationObserver：监听动态加载的推文
// ─────────────────────────────────────────────
function bindAll() {
    document.querySelectorAll(BOOKMARK_SELECTORS).forEach(attachBookmarkListener);
    ensureFloatingSaveButton();
}

let _bindAllTimer = null;
function bindAllDebounced() {
    if (_bindAllTimer) return;
    _bindAllTimer = setTimeout(() => {
        _bindAllTimer = null;
        bindAll();
    }, 200);
}

document.addEventListener("click", (event) => {
    if (!isLinuxDoTopicPage()) return;
    const btn = event.target?.closest?.(LINUX_DO_LIKE_SELECTOR);
    if (!btn) return;
    setTimeout(() => captureLinuxDoPost(btn), 250);
}, true);

const observer = new MutationObserver(bindAllDebounced);
observer.observe(document.body, { childList: true, subtree: true });
requestRuntimeConfig();
bindAll();

console.log("[x2md] 内容脚本已加载 v1.3");
