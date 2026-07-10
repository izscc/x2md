(function (globalScope) {
    function cleanupTwitterDisplayUrlLineBreaks(text) {
        return String(text || "").replace(
            /(^|[^\w])https?:\/\/[ \t]*\n[ \t]*((?:www\.)?[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}(?:\/[^\s]*)?)/g,
            "$1$2",
        );
    }

    function normalizeSpaces(text) {
        return cleanupTwitterDisplayUrlLineBreaks(String(text || "").replace(/\u00a0/g, " "))
            .replace(/[ \t]+\n/g, "\n")
            .trim();
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



    function normalizeXArticleUrlForCompare(url) {
        const match = String(url || "").replace("twitter.com", "x.com").match(/(?:https?:\/\/)?(?:www\.)?x\.com\/(?:i\/article|[^/]+\/(?:article|status))\/(\d+)/i);
        return match ? match[1] : "";
    }

    function isSameXArticleUrl(left, right) {
        const leftId = normalizeXArticleUrlForCompare(left);
        const rightId = normalizeXArticleUrlForCompare(right);
        return !!leftId && leftId === rightId;
    }

    function stripXArticleLinksFromText(text, articleUrl) {
        if (!articleUrl) return normalizeSpaces(text || "");
        const articleLinkPattern = /(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/(?:i\/article|[^/\s)]+\/article)\/\d+(?:[^\s)]*)?/ig;
        let result = String(text || "");
        result = result.replace(/\[([^\]]*)\]\((https?:\/\/(?:x|twitter)\.com\/(?:i\/article|[^/)]+\/article)\/\d+[^)]*)\)/ig, (match, label, href) => {
            return isSameXArticleUrl(href, articleUrl) || isSameXArticleUrl(label, articleUrl) ? "" : match;
        });
        result = result.replace(articleLinkPattern, (match) => isSameXArticleUrl(match, articleUrl) ? "" : match);
        return normalizeSpaces(result).replace(/^[-–—:：|｜\s]+/, "").trim();
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
        markdownToClipboardHtml,
        plainTextToClipboardHtml,
        inlineMarkdownToHtml,
        escapeHtml,
        markdownToClipboardPlainText,
        hasInlineMarkdownLinks,
        buildArticleTranslationSource,
        cleanupTwitterDisplayUrlLineBreaks,
        isExpandableTweetTextControl,
        normalizeSpaces,
        stripXArticleLinksFromText,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
