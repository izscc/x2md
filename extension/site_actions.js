(function (globalScope) {
    const SITE_FLOATING_SAVE_BUTTON_ID = "__x2md_site_save_button";

    function isFloatingSaveIconEnabled(config = {}) {
        return config.show_site_save_icon !== false;
    }

    function detectFloatingSaveSite(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");

        if (hostname === "linux.do" && /^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(pathname)) {
            return "linux_do";
        }

        if (hostname.endsWith(".feishu.cn") && (/^\/wiki\/[^/]+/.test(pathname) || /^\/docx\/[^/]+/.test(pathname))) {
            return "feishu";
        }

        if (hostname === "mp.weixin.qq.com" && /^\/s(\/|$|\?)/.test(pathname)) {
            return "wechat";
        }

        return null;
    }

    function isXBookmarksPage(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");
        const isX = hostname === "x.com" || hostname.endsWith(".x.com") || hostname === "twitter.com" || hostname.endsWith(".twitter.com");
        return isX && /^\/i\/bookmarks\/?$/.test(pathname);
    }

    function collectUniqueStatusUrls(root = globalScope.document) {
        const urls = [];
        const seen = new Set();
        const links = Array.from(root?.querySelectorAll?.('a[href*="/status/"]') || []);
        for (const link of links) {
            const href = link.getAttribute?.("href") || link.href || "";
            const match = String(href).match(/(?:https?:\/\/(?:x|twitter)\.com)?\/([^/?#]+)\/status\/(\d+)/i);
            if (!match) continue;
            const key = match[2];
            if (seen.has(key)) continue;
            seen.add(key);
            urls.push(`https://x.com/${match[1]}/status/${match[2]}`);
        }
        return urls;
    }

    function getFloatingSaveSiteConfig(siteKey) {
        if (siteKey === "linux_do") {
            return {
                label: "MD",
                title: "保存当前 LINUX DO 内容为 Markdown",
                background: "#f97316",
                shadow: "rgba(249, 115, 22, 0.35)",
            };
        }

        if (siteKey === "feishu") {
            return {
                label: "MD",
                title: "保存当前飞书文档为 Markdown",
                background: "#1677ff",
                shadow: "rgba(22, 119, 255, 0.35)",
            };
        }

        if (siteKey === "wechat") {
            return {
                label: "MD",
                title: "保存当前微信公众号文章为 Markdown",
                background: "#07c160",
                shadow: "rgba(7, 193, 96, 0.35)",
            };
        }

        return null;
    }

    const exported = {
        SITE_FLOATING_SAVE_BUTTON_ID,
        collectUniqueStatusUrls,
        detectFloatingSaveSite,
        getFloatingSaveSiteConfig,
        isFloatingSaveIconEnabled,
        isXBookmarksPage,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
