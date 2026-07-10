/** Unified CaptureDocumentV1 wrapper for non-X web sites. */
(function (globalScope) {
    const normalize = globalScope.normalizeCaptureDocumentV1 ||
        (typeof require === "function" ? require("../capture_contract.js").normalizeCaptureDocumentV1 : null);

    const PLATFORM_BY_LEGACY_NAME = {
        "LINUX DO": "linuxdo",
        Feishu: "feishu",
        WeChat: "wechat",
    };

    function captureLegacyWebDocument(data, options = {}) {
        if (!data || !String(data.article_content || "").trim()) return null;
        const media = [
            ...(data.images || []).map((url) => ({ kind: "image", url })),
            ...(data.videos || []).map((url) => ({ kind: "video", url })),
        ];
        return normalize({
            schema_version: 1,
            source: {
                platform: PLATFORM_BY_LEGACY_NAME[data.platform],
                url: data.url,
                canonical_url: data.url,
                captured_at: options.capturedAt || new Date().toISOString(),
            },
            content: {
                type: "web-article",
                title: data.article_title,
                markdown: data.article_content,
                author: { name: data.author, handle: data.handle, url: data.author_url },
                published_at: data.published,
            },
            media,
            diagnostics: { capture_path: options.capturePath || "web-dom" },
        });
    }

    function siteAdapters() {
        return {
            linux_do: globalScope.linuxDoCaptureAdapter,
            feishu: globalScope.feishuCaptureAdapter,
            wechat: globalScope.wechatCaptureAdapter,
        };
    }

    async function capture(siteKey, context = {}) {
        const adapter = context.adapter || siteAdapters()[siteKey];
        if (!adapter?.capture) throw new Error(`unsupported web capture site: ${siteKey}`);
        const document = await adapter.capture(context);
        return document ? normalize(document) : null;
    }

    function normalizeForSave(document) {
        const capture = normalize(document);
        if (capture.content.type !== "web-article") throw new Error("normalize expects a web CaptureDocumentV1");
        const displayPlatforms = { linuxdo: "LINUX DO", feishu: "Feishu", wechat: "WeChat" };
        return {
            type: "article",
            url: capture.source.url,
            author: capture.content.author?.name || "",
            handle: capture.content.author?.handle || "",
            author_url: capture.content.author?.url || "",
            published: capture.content.published_at || "",
            article_title: capture.content.title || "",
            article_content: capture.content.markdown || "",
            images: capture.media.filter((item) => item.kind === "image").map((item) => item.url),
            videos: capture.media.filter((item) => item.kind !== "image").map((item) => item.url),
            platform: displayPlatforms[capture.source.platform],
        };
    }

    const webCaptureAdapter = { capture, normalize: normalizeForSave };
    const exported = { captureLegacyWebDocument, webCaptureAdapter };
    Object.assign(globalScope, exported);
    if (typeof module !== "undefined" && module.exports) module.exports = exported;
})(typeof globalThis !== "undefined" ? globalThis : this);
