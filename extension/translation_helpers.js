(function (globalScope) {
    function normalizeSpaces(text) {
        return String(text || "").replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").trim();
    }

    function isExpandableTweetTextControl(text) {
        const value = normalizeSpaces(text).replace(/\s+/g, " ").toLowerCase();
        if (!value) return false;
        if (/reply|replies|回复|评论|load more|查看更多/.test(value)) return false;
        return value === "show more" || value === "显示更多";
    }

    function buildArticleTranslationSource(parts = {}) {
        const title = normalizeSpaces(parts.title || "");
        const body = normalizeSpaces(parts.body || "");
        return {
            title,
            body,
            text: [title, body].filter(Boolean).join("\n\n"),
        };
    }

    function clonePlainData(data = {}) {
        try {
            return JSON.parse(JSON.stringify(data || {}));
        } catch (error) {
            return { ...(data || {}) };
        }
    }

    function applyTranslationOverrideToData(data = {}) {
        const result = clonePlainData(data);
        if (!result.prefer_translated_content || !result.translation_override) return result;

        const override = result.translation_override || {};
        const overrideType = String(override.type || "").toLowerCase();

        if (overrideType === "article" || result.type === "article") {
            const translatedTitle = normalizeSpaces(override.article_title || override.title || "");
            const translatedContent = normalizeSpaces(override.article_content || override.content || override.text || "");
            if (translatedTitle) result.article_title = translatedTitle;
            if (translatedContent) result.article_content = translatedContent;
            if (translatedTitle || translatedContent) result.type = "article";
            return result;
        }

        const translatedText = normalizeSpaces(override.text || override.article_content || "");
        if (translatedText) result.text = translatedText;
        return result;
    }

    const exported = {
        applyTranslationOverrideToData,
        buildArticleTranslationSource,
        isExpandableTweetTextControl,
        normalizeSpaces,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
