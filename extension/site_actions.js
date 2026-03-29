(function (globalScope) {
    const SITE_FLOATING_SAVE_BUTTON_ID = "__x2md_site_save_button";

    function isFloatingSaveIconEnabled(config = {}) {
        return config.show_site_save_icon !== false;
    }

    // 复用 discourse.js 的域名列表，避免双份存储不同步
    // getDiscourseDomains 由 discourse.js 通过全局/X2MD 导出
    function _getDiscourseDomainsList() {
        return (globalScope.X2MD?.getDiscourseDomains || globalScope.getDiscourseDomains || (() => ["linux.do"]))();
    }
    // 保留向后兼容（调用方可能仍调用此函数），但实际更新 discourse.js 的存储
    function setSiteDiscourseDomains(domains) {
        const setter = globalScope.X2MD?.setDiscourseDomains || globalScope.setDiscourseDomains;
        if (typeof setter === "function") setter(domains);
    }

    function detectFloatingSaveSite(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");

        // 检查所有已配置的 Discourse 域名（包括 linux.do 和自定义域名）
        if (_getDiscourseDomainsList().includes(hostname) && /^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(pathname)) {
            return hostname === "linux.do" ? "linux_do" : "discourse";
        }

        if ((hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com")) &&
            (/^\/wiki\/[^/]+/.test(pathname) || /^\/docx\/[^/]+/.test(pathname) ||
             /^\/docs\/[^/]+/.test(pathname) || /^\/minutes\/[^/]+/.test(pathname) ||
             /^\/sheets\/[^/]+/.test(pathname) || /^\/mindnotes\/[^/]+/.test(pathname))) {
            return "feishu";
        }

        if ((hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com")) &&
            /^\/messenger\b/.test(pathname)) {
            return "feishu_chat";
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

        if (siteKey === "feishu_chat") {
            return {
                label: "MD",
                title: "保存当前飞书聊天记录为 Markdown",
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
        detectFloatingSaveSite,
        getFloatingSaveSiteConfig,
        isFloatingSaveIconEnabled,
        setSiteDiscourseDomains,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    globalScope.X2MD = Object.assign(globalScope.X2MD || {}, exported);
    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
