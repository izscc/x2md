/** X Bookmarks/Profile batch capture collection and transient UI. */

function isTwitterLikePage(locationLike = location) {
    const hostname = String(locationLike?.hostname || "").toLowerCase();
    return hostname === "x.com" || hostname.endsWith(".x.com") ||
        hostname === "twitter.com" || hostname.endsWith(".twitter.com");
}

function collectUniqueStatusUrls(root = document) {
    const urls = [];
    const seen = new Set();
    const links = Array.from(root?.querySelectorAll?.('a[href*="/status/"]') || []);
    for (const link of links) {
        const href = link.getAttribute?.("href") || link.href || "";
        const match = String(href).match(/(?:https?:\/\/(?:x|twitter)\.com)?\/([^/?#]+)\/status\/(\d+)/i);
        if (!match || seen.has(match[2])) continue;
        seen.add(match[2]);
        urls.push(`https://x.com/${match[1]}/status/${match[2]}`);
    }
    return urls;
}

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
        profileUrl: `${locationLike.origin}/${handle}`,
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

function getXProfileCaptureRangeStart(settings = getXProfileCaptureSettings(), now = new Date()) {
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
        if (resp.job) {
            showToast(`${mode === "articles" ? "文章" : "推文"}任务已创建：${resp.found_count || 0} 项，可关闭页面后继续`, "success", 6500);
            return;
        }
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

const X_BOOKMARKS_TOOLBAR_ID = "__x2md_bookmarks_toolbar";
let xBookmarksExportState = null;
let xBookmarksPollTimer = null;

function sendBookmarksJobMessage(message) {
    return new Promise((resolve) => {
        chrome.runtime.sendMessage(message, (resp) => resolve(resp || { success: false, error: "扩展无响应" }));
    });
}

async function collectBookmarksToLimit(limit) {
    let urls = collectUniqueStatusUrls(document);
    let unchanged = 0;
    while (urls.length < limit && unchanged < 3) {
        const before = urls.length;
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        await new Promise((resolve) => setTimeout(resolve, 900));
        urls = collectUniqueStatusUrls(document);
        unchanged = urls.length === before ? unchanged + 1 : 0;
    }
    return urls.slice(0, limit);
}

async function refreshBookmarksJob(id) {
    const response = await sendBookmarksJobMessage({ action: "get_capture_job", id });
    if (response?.success && response.job) xBookmarksExportState = response.job;
    updateBookmarksToolbarStatus();
}

function pollBookmarksJob(id) {
    clearInterval(xBookmarksPollTimer);
    refreshBookmarksJob(id);
    xBookmarksPollTimer = setInterval(async () => {
        await refreshBookmarksJob(id);
        if (["completed", "failed", "cancelled"].includes(xBookmarksExportState?.status)) clearInterval(xBookmarksPollTimer);
    }, 1000);
}

async function recoverBookmarksJob() {
    const response = await sendBookmarksJobMessage({ action: "list_capture_jobs" });
    const latest = (response?.jobs || []).filter((job) => job.type === "bookmarks").sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    if (latest) pollBookmarksJob(latest.id);
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
    const counts = state.counts || {};
    if (status) status.textContent = `${state.status}${state.pause_reason ? ` (${state.pause_reason})` : ""} · 完成 ${(counts.saved || 0) + (counts.updated || 0)}/${counts.total || 0} · 跳过 ${counts.skipped || 0} · 失败 ${counts.failed || 0}`;
    if (pause) {
        pause.disabled = ["completed", "failed", "cancelled"].includes(state.status);
        pause.textContent = state.status === "paused" ? "继续" : "暂停";
    }
    if (retry) retry.disabled = state.status !== "failed" || !(counts.failed > 0);
}

async function runBookmarksExport(urls) {
    const items = urls.map((url) => ({ id: url.match(/\/status\/(\d+)/)?.[1], payload: { type: "tweet", url, text: "", images: [], thread_tweets: [] } }));
    const response = await sendBookmarksJobMessage({ action: "create_capture_job", job_type: "bookmarks", items, metadata: { source: "x-bookmarks" } });
    if (!response?.success || !response.job) {
        showToast(response?.error || "无法创建书签任务", "error", 5000);
        return;
    }
    xBookmarksExportState = response.job;
    pollBookmarksJob(response.job.id);
    showToast(`已创建 ${urls.length} 项书签任务`, "success", 3500);
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
            <input data-x2md-role="bookmarks-limit" aria-label="继续加载书签数量上限" type="number" min="1" max="500" value="100" style="width:64px;" />
            <button type="button" aria-label="继续加载并导出书签" data-x2md-role="bookmarks-load-export">加载到上限</button>
            <button type="button" aria-label="暂停或继续 X2MD 书签导出" data-x2md-role="bookmarks-pause" disabled>暂停</button>
            <button type="button" aria-label="取消 X2MD 书签导出" data-x2md-role="bookmarks-cancel">取消</button>
            <button type="button" aria-label="重试失败的 X2MD 书签导出" data-x2md-role="bookmarks-retry" disabled>重试失败</button>
            <button type="button" aria-label="打开 X2MD 桌面任务中心" data-x2md-role="bookmarks-center">任务中心</button>
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
        toolbar.querySelector('[data-x2md-role="bookmarks-load-export"]').addEventListener("click", async () => {
            const input = toolbar.querySelector('[data-x2md-role="bookmarks-limit"]');
            const limit = Math.min(500, Math.max(1, Number.parseInt(input.value, 10) || 100));
            input.value = String(limit);
            const urls = await collectBookmarksToLimit(limit);
            if (urls.length) runBookmarksExport(urls);
        });
        toolbar.querySelector('[data-x2md-role="bookmarks-pause"]').addEventListener("click", async () => {
            if (!xBookmarksExportState) return;
            const command = xBookmarksExportState.status === "paused" ? "resume" : "pause";
            await sendBookmarksJobMessage({ action: "control_capture_job", id: xBookmarksExportState.id, command });
            refreshBookmarksJob(xBookmarksExportState.id);
        });
        toolbar.querySelector('[data-x2md-role="bookmarks-cancel"]').addEventListener("click", async () => {
            if (!xBookmarksExportState) return;
            await sendBookmarksJobMessage({ action: "control_capture_job", id: xBookmarksExportState.id, command: "cancel" });
            refreshBookmarksJob(xBookmarksExportState.id);
        });
        toolbar.querySelector('[data-x2md-role="bookmarks-retry"]').addEventListener("click", async () => {
            if (!xBookmarksExportState) return;
            await sendBookmarksJobMessage({ action: "control_capture_job", id: xBookmarksExportState.id, command: "retry" });
            pollBookmarksJob(xBookmarksExportState.id);
        });
        toolbar.querySelector('[data-x2md-role="bookmarks-center"]').addEventListener("click", () => sendBookmarksJobMessage({ action: "open_options" }));
        (document.querySelector("main") || document.body).prepend(toolbar);
        recoverBookmarksJob();
    }
    updateBookmarksToolbarStatus();
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = {
        collectUniqueStatusUrls,
        collectVisibleProfileArticles,
        collectVisibleProfileTweets,
        getTwitterProfileContext,
        getXProfileCaptureRangeStart,
        isTwitterLikePage,
    };
}
