(function (globalScope) {
    const SITE_FLOATING_SAVE_BUTTON_ID = "__x2md_site_save_button";

    function isFloatingSaveIconEnabled(config = {}) {
        return config.show_site_save_icon !== false;
    }

    // 可配置 Discourse 域名列表，运行时从配置注入
    let _siteDiscourseDomains = ["linux.do"];
    function setSiteDiscourseDomains(domains) {
        if (Array.isArray(domains) && domains.length > 0) {
            _siteDiscourseDomains = domains.map(d => d.toLowerCase().trim()).filter(Boolean);
        }
    }

    function detectFloatingSaveSite(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");

        // 检查所有已配置的 Discourse 域名（包括 linux.do 和自定义域名）
        if (_siteDiscourseDomains.includes(hostname) && /^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(pathname)) {
            return hostname === "linux.do" ? "linux_do" : "discourse";
        }

        if ((hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com")) &&
            (/^\/wiki\/[^/]+/.test(pathname) || /^\/docx\/[^/]+/.test(pathname) ||
             /^\/docs\/[^/]+/.test(pathname) || /^\/minutes\/[^/]+/.test(pathname) ||
             /^\/sheets\/[^/]+/.test(pathname) || /^\/mindnotes\/[^/]+/.test(pathname))) {
            return "feishu";
        }

        if (hostname === "mp.weixin.qq.com" && /^\/s(\/|$|\?)/.test(pathname)) {
            return "wechat";
        }

        return null;
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

        if (siteKey === "discourse") {
            return {
                label: "MD",
                title: "保存当前 Discourse 内容为 Markdown",
                background: "#f97316",
                shadow: "rgba(249, 115, 22, 0.35)",
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
        detectFloatingSaveSite,
        getFloatingSaveSiteConfig,
        isFloatingSaveIconEnabled,
        setSiteDiscourseDomains,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
