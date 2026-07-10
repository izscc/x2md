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
// 书签按钮监听
// ─────────────────────────────────────────────
const BOOKMARK_SELECTORS = [
    '[data-testid="bookmark"]',
    '[data-testid="removeBookmark"]',
    '[aria-label="Bookmark"]',
    '[aria-label="书签"]',
    '[aria-label="Add Bookmark"]',
    '[aria-label="添加书签"]',
    '[aria-label="Remove Bookmark"]',
    '[aria-label="移除书签"]',
    '[aria-label="取消书签"]',
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
    return getBookmarkButtonAction(btn) === "remove";
}

function attachBookmarkListener(btn) {
    if (btn.__x2md_bound) return;
    btn.__x2md_bound = true;
    btn.addEventListener("mouseenter", () => showCustomSaveMenu(btn), true);
    btn.addEventListener("mouseleave", scheduleHideCustomSaveMenu, true);
    bindBookmarkSaveListener(btn, () => captureAndSend(btn), {
        shouldSkip: () => {
            if (!btn.__x2md_skip_next_default_bookmark_save) return false;
            btn.__x2md_skip_next_default_bookmark_save = false;
            return true;
        },
    });
}

// ─────────────────────────────────────────────
// 主流程：捕获 → 组装基础数据 → 发给 background
// ─────────────────────────────────────────────
function captureAndSend(btn, options = {}) {
    showToast("正在获取完整推文内容…", "loading", null);
    captureUi.setButtonState(btn, "loading", "X2MD 正在保存");
    const sendCapture = (data) => sendToBackground(data, { button: btn });

    const performCapture = () => {
        let captureDocument;
        try {
            captureDocument = xCaptureAdapter.capture({ document, location, trigger: btn });
        } catch (error) {
            console.error("[x2md] X DOM 提取异常：", error);
        }
        if (!captureDocument) {
            showToast(isNotePageUrl() ? "未能提取文章内容，请稍后重试" : "未找到推文链接，请进入推文详情页再试", "error", 4000);
            captureUi.setButtonState(btn, "failed", "X2MD：提取失败");
            return;
        }
        if (options.customSavePath?.name) {
            captureDocument.preferences = { ...captureDocument.preferences, custom_save_path_name: options.customSavePath.name };
        }
        let payload = xCaptureAdapter.normalize(captureDocument);
        if (options.customSavePath) payload.x2md_custom_save_path = { ...options.customSavePath };
        const scope = btn?.closest?.("article, [role='article']") || document;
        payload = X2MDXTranslationUI.applyVisibleTranslationOverride(payload, scope);
        showToast(captureDocument.content.type === "article" ? "已识别为 X Article，正在保存…" : "正在保存 X 内容…", "loading", null);
        sendCapture(payload);
    };

    if (!isNotePageUrl()) {
        performCapture();
        return;
    }
    const waitForArticle = (retries = 0) => {
        const ready = !!document.querySelector('[data-testid="twitterArticleRichTextView"], [data-testid="twitterArticleReadView"]');
        if (ready || retries >= 10) performCapture();
        else setTimeout(() => waitForArticle(retries + 1), 500);
    };
    waitForArticle();
}

function sendToBackground(data, uiContext = {}) {
    chrome.runtime.sendMessage({ action: "save_tweet", data }, async (resp) => {
        if (chrome.runtime.lastError) {
            console.error("[x2md] 扩展通信失败：", chrome.runtime.lastError);
            handleSaveResponse({
                success: false,
                outcome: "failed",
                error: { message: "扩展通信失败，请重试", retryable: true },
            }, {
                ...uiContext,
                captureDocument: data,
                retry: () => sendToBackground(data, uiContext),
            });
            return;
        }

        // 处理视频超时警告拦截
        if (resp && resp.require_video_confirm && resp.payload) {
            const yes = await captureUi.confirmLongVideo({ durationMin: resp.durationMin });
            resp.payload.download_video = yes;
            resp.payload.video_confirmed = true;

            showToast(yes ? "指令已下达，正在连同长视频一并下载..." : "视频已剥离，正在光速脱水图文...");

            chrome.runtime.sendMessage({ action: "force_save_tweet", data: resp.payload }, (finalResp) => {
                handleSaveResponse(finalResp, {
                    ...uiContext,
                    captureDocument: resp.payload,
                    retry: () => sendToBackground(resp.payload, uiContext),
                });
            });
            return;
        }

        handleSaveResponse(resp, {
            ...uiContext,
            captureDocument: data,
            retry: () => sendToBackground(data, uiContext),
        });
    });
}

function handleSaveResponse(resp, context = {}) {
    const result = resp?.result?.outcome
        ? { ...resp.result, success: resp.success !== false }
        : resp;
    const view = captureUi.showSaveResult(result, context);
    captureUi.setButtonState(context.button, view.state, `X2MD：${view.title}`);
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
// Capture UI（toast / modal / result action / button state）
// ─────────────────────────────────────────────
const captureUi = createCaptureUi();

function showToast(message, type = "loading", duration = null) {
    captureUi.showToast(message, type === "success" ? "saved" : type === "error" ? "failed" : type, duration);
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
        X2MDXTranslationUI.mount();
        X2MDXTranslationUI.schedule();
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
