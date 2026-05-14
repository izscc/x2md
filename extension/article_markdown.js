(function (globalScope) {
    const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
    const ALWAYS_BLOCK_TAGS = new Set(["section", "article", "blockquote", "ul", "ol", "li", "hr", "pre"]);
    const CODE_LANGUAGE_PATTERN = /^[a-z0-9][a-z0-9+._#-]{0,29}$/;
    const CODE_LANGUAGE_LABELS = new Set([
        "base", "bash", "bat", "batch", "c", "c#", "c++", "cfg", "clojure", "conf", "cpp",
        "css", "csv", "diff", "dockerfile", "elixir", "fish", "f#", "go", "graphql", "haskell",
        "html", "ini", "java", "javascript", "json", "json5", "jsx", "kotlin", "less", "lua",
        "makefile", "markdown", "md", "mermaid", "objc", "objective-c", "patch", "perl", "php",
        "plaintext", "powershell", "ps1", "py", "python", "rb", "ruby", "rs", "rust", "scss",
        "sh", "shell", "sql", "svg", "swift", "toml", "ts", "tsx", "typescript", "txt", "xml",
        "yaml", "yml", "zsh",
    ]);

    function safeGetComputedStyle(element, options = {}) {
        try {
            if (typeof options.getComputedStyle === "function") {
                return options.getComputedStyle(element) || {};
            }
            if (typeof window !== "undefined" && typeof window.getComputedStyle === "function") {
                return window.getComputedStyle(element) || {};
            }
        } catch (error) { }
        return {};
    }

    function isBoldElement(element, options = {}) {
        const tag = getTagName(element);
        if (tag === "b" || tag === "strong") return true;
        if (tag !== "span") return false;

        const style = safeGetComputedStyle(element, options);
        const fontWeight = style.fontWeight;
        const numericWeight = parseInt(fontWeight, 10);
        return fontWeight === "bold" || Number.isFinite(numericWeight) && numericWeight >= 700;
    }

    function isBlockElement(element, options = {}) {
        const tag = getTagName(element);
        if (!tag) return false;
        if (ALWAYS_BLOCK_TAGS.has(tag) || HEADING_TAGS.has(tag)) return true;
        if (tag === "p") return true;
        if (tag !== "div") return false;

        const dataBlock = safeGetAttribute(element, "data-block");
        if (dataBlock === "true") return true;

        const className = String(element?.className || "");
        if (className.includes("public-DraftStyleDefault-block")) return true;

        const style = safeGetComputedStyle(element, options);
        const display = String(style.display || "").toLowerCase();
        if (!display) return false;
        return !display.startsWith("inline");
    }

    const TWITTER_ACTION_TESTIDS = new Set([
        "reply", "retweet", "like", "bookmark", "removeBookmark", "share",
        "app-text-transition-container", "placementTracking",
    ]);

    function isTwitterEmbeddedTweet(element) {
        const testId = safeGetAttribute(element, "data-testid");
        if (testId === "simpleTweet") return true;
        return getTagName(element) === "article" &&
            testId === "tweet" &&
            !!safeClosest(element, '[data-testid="twitterArticleRichTextView"], [data-testid="longformRichTextComponent"]');
    }

    function shouldSkipElement(element) {
        const testId = safeGetAttribute(element, "data-testid");
        if (TWITTER_ACTION_TESTIDS.has(testId)) return true;

        const href = safeGetAttribute(element, "href") || "";
        if (/\/status\/\d+\/analytics(?:$|[?#])/.test(href)) return true;

        const text = getNodeText(element).trim();
        if (text === "Download") return true;
        if (/^(想发布自己的文章|Want to publish your own article)/i.test(text) ||
            /^升级为\s*Premium$/i.test(text)) return true;

        return safeClosest(element, '[data-testid="twitter-article-title"]') ||
            safeClosest(element, '[data-testid="User-Name"]');
    }

    function walkElementTree(root, visitor) {
        if (!root || root.nodeType !== 1) return;
        visitor(root);
        for (const child of Array.from(root.childNodes || [])) {
            walkElementTree(child, visitor);
        }
    }

    function cleanTwitterStatusUrl(href) {
        if (!href) return "";
        const match = String(href).match(/(?:https?:\/\/(?:x|twitter)\.com)?(\/[^/]+\/status\/\d+)/i);
        if (!match) return "";
        return `https://x.com${match[1]}`;
    }

    function normalizeTwitterImageUrl(src) {
        if (!src || !String(src).includes("pbs.twimg.com")) return "";
        if (String(src).includes("profile_images") || String(src).includes("emoji")) return "";
        try {
            const url = new URL(src);
            url.searchParams.set("name", "orig");
            return url.href;
        } catch (error) {
            return src;
        }
    }


    function normalizeAltText(value) {
        return String(value || "")
            .replace(/\s+/g, " ")
            .trim();
    }

    function isMeaningfulImageAlt(value) {
        const alt = normalizeAltText(value);
        if (!alt) return false;
        const genericLabels = new Set([
            "image", "photo", "picture", "article cover image",
            "图片", "照片", "图像", "封面图片", "文章封面图片",
        ]);
        return !genericLabels.has(alt.toLowerCase());
    }

    function formatImageAltFence(altText, quotePrefix = "") {
        if (!isMeaningfulImageAlt(altText)) return "";
        const alt = normalizeAltText(altText).replace(/```/g, "``\u200b`");
        return `\n${quotePrefix}\`\`\`\n${quotePrefix}${alt}\n${quotePrefix}\`\`\``;
    }

    function formatTwitterImageMarkdown(src, altText = "") {
        let imageUrl = src;
        try {
            const url = new URL(src);
            url.searchParams.set("name", "orig");
            imageUrl = url.href;
        } catch (error) { }

        return `\n![](${imageUrl})${formatImageAltFence(altText)}\n`;
    }

    function formatTwitterEmbeddedTweet(element) {
        const statusUrls = [];
        walkElementTree(element, (node) => {
            if (getTagName(node) !== "a") return;
            const cleanUrl = cleanTwitterStatusUrl(safeGetAttribute(node, "href") || "");
            if (cleanUrl && !statusUrls.includes(cleanUrl)) statusUrls.push(cleanUrl);
        });
        const primaryStatusUrl = statusUrls[0] || "";
        const primaryStatusId = primaryStatusUrl.match(/\/status\/(\d+)/)?.[1] || "";

        let tweetText = "";
        walkElementTree(element, (node) => {
            if (tweetText) return;
            if (safeGetAttribute(node, "data-testid") === "tweetText") {
                tweetText = getNodeText(node).trim();
            }
        });

        const images = [];
        const imageAltTexts = {};
        walkElementTree(element, (node) => {
            if (getTagName(node) !== "img") return;
            const imgUrl = normalizeTwitterImageUrl(node.src || safeGetAttribute(node, "src") || "");
            if (!imgUrl) return;

            // Nested quoted tweets/cards carry their own status id in the photo link.
            // Keep only media attached to the top-level embedded tweet.
            const parentLink = safeClosest(node, 'a[href*="/status/"]');
            const parentHref = parentLink ? safeGetAttribute(parentLink, "href") || "" : "";
            if (primaryStatusId && parentHref && !parentHref.includes(`/status/${primaryStatusId}`)) return;

            if (!images.includes(imgUrl)) images.push(imgUrl);
            const altText = normalizeAltText(node.alt || safeGetAttribute(node, "alt") || "");
            if (isMeaningfulImageAlt(altText)) imageAltTexts[imgUrl] = altText;
        });

        if (!tweetText && images.length === 0 && !primaryStatusUrl) return "";

        const lines = ["> [!quote] 引用推文"];
        if (tweetText) {
            for (const line of tweetText.split("\n")) {
                lines.push(line.trim() ? `> ${line}` : ">");
            }
        }
        for (const image of images) {
            lines.push(">", `> ![](${image})`);
            const altFence = formatImageAltFence(imageAltTexts[image], "> ");
            if (altFence) lines.push(altFence);
        }
        if (primaryStatusUrl) lines.push(">", `> 原文：${primaryStatusUrl}`);
        return `\n${lines.join("\n")}\n`;
    }

    function formatCodeFence(code, language = "") {
        const infoString = String(language || "").trim();
        return `\n\`\`\`${infoString}\n${code}\n\`\`\`\n`;
    }

    function normalizeCodeLanguageLabel(node) {
        const text = getNodeText(node).replace(/\s+/g, " ").trim().toLowerCase();
        if (!text || !CODE_LANGUAGE_PATTERN.test(text)) return "";
        if (!CODE_LANGUAGE_LABELS.has(text)) return "";
        return text;
    }

    function findNextSignificantChildIndex(children, startIndex) {
        for (let index = startIndex; index < children.length; index++) {
            const child = children[index];
            if (!child) continue;
            if (child.nodeType === 3 && !(child.textContent || "").trim()) continue;
            if (child.nodeType !== 1 && child.nodeType !== 3) continue;
            return index;
        }
        return -1;
    }

    function extractCodeBlockInfo(node) {
        if (!node) return null;
        if (node.nodeType === 1 && getTagName(node) === "pre") {
            return {
                code: node.innerText || node.textContent || "",
            };
        }
        if (node.nodeType !== 1) return null;

        const significantChildren = [];
        for (const child of node.childNodes || []) {
            if (!child) continue;
            if (child.nodeType === 3 && !(child.textContent || "").trim()) continue;
            if (child.nodeType !== 1 && child.nodeType !== 3) continue;
            significantChildren.push(child);
        }

        if (significantChildren.length !== 1) return null;
        return extractCodeBlockInfo(significantChildren[0]);
    }

    function convertChildNodesToMarkdown(element, options = {}) {
        const children = Array.from(element.childNodes || []);
        let markdown = "";

        for (let index = 0; index < children.length; index++) {
            const child = children[index];
            const language = normalizeCodeLanguageLabel(child);

            if (language) {
                const nextIndex = findNextSignificantChildIndex(children, index + 1);
                const nextCodeBlock = nextIndex >= 0 ? extractCodeBlockInfo(children[nextIndex]) : null;
                if (nextCodeBlock) {
                    markdown += formatCodeFence(nextCodeBlock.code, language);
                    index = nextIndex;
                    continue;
                }
            }

            markdown += convertArticleElementToMarkdown(child, options);
        }

        return markdown;
    }

    function convertArticleElementToMarkdown(element, options = {}) {
        if (!element) return "";
        if (element.nodeType === 3) return element.textContent || "";
        if (element.nodeType !== 1) return "";
        if (isTwitterEmbeddedTweet(element)) return formatTwitterEmbeddedTweet(element, options);
        if (shouldSkipElement(element)) return "";

        const tag = getTagName(element);

        if (tag === "video") {
            const poster = safeGetAttribute(element, "poster") || "";
            const match = poster.match(/(?:video_thumb|tweet_video_thumb|amplify_video_thumb)\/(\d+)\//);
            if (match) return `\n[[VIDEO_HOLDER_${match[1]}]]\n`;
        }

        if (tag === "img") {
            const src = element.src || "";
            if (safeClosest(element, '[data-testid="videoComponent"]') || src.includes("video_thumb")) {
                const match = src.match(/(?:video_thumb|tweet_video_thumb|amplify_video_thumb)\/(\d+)\//);
                if (match) return `\n[[VIDEO_HOLDER_${match[1]}]]\n`;
            }
            if (src.includes("emoji")) return element.alt || "";
            if (src && src.includes("pbs.twimg.com") && !src.includes("profile_images")) {
                return formatTwitterImageMarkdown(src, element.alt || safeGetAttribute(element, "alt") || "");
            }
            return "";
        }

        if (tag === "svg" || tag === "script" || tag === "style") return "";
        if (tag === "br") return "\n";
        if (tag === "hr") return "\n---\n";

        if (tag === "pre") {
            const code = element.innerText || element.textContent || "";
            return formatCodeFence(code);
        }

        let markdown = convertChildNodesToMarkdown(element, options);

        if (tag === "a") {
            const href = safeGetAttribute(element, "href") || "";
            const text = markdown.trim();
            if (!href || !text) return markdown;
            if (text.includes("![](") || text.includes("[MEDIA_VIDEO_URL:") || text.includes("[[VIDEO_HOLDER_")) {
                return markdown;
            }
            return `[${text}](${href})`;
        }

        if (isBoldElement(element, options) && markdown.trim()) {
            markdown = `**${markdown.replace(/\*\*/g, "")}**`;
        }

        if (tag === "h1") markdown = `\n# ${markdown.replace(/\*\*/g, "").trim()}\n`;
        else if (tag === "h2") markdown = `\n## ${markdown.replace(/\*\*/g, "").trim()}\n`;
        else if (tag === "h3") markdown = `\n### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        else if (tag === "h4" || tag === "h5" || tag === "h6") markdown = `\n#### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        else if (tag === "blockquote") {
            const lines = markdown.trim().split("\n").filter((line) => line.trim() !== "");
            markdown = "\n" + lines.map((line) => "> " + line).join("\n") + "\n";
        } else if (tag === "li") {
            markdown = `\n- ${markdown.trim()}\n`;
        } else if (isBlockElement(element, options)) {
            markdown = `\n${markdown}\n`;
        }

        return markdown;
    }

    function extractArticleMarkdown(container, options = {}) {
        const markdown = convertArticleElementToMarkdown(container, options);
        return markdown.replace(/\n{3,}/g, "\n\n").trim();
    }

    const exported = {
        convertArticleElementToMarkdown,
        extractArticleMarkdown,
        isBlockElement,
        isBoldElement,
        isMeaningfulImageAlt,
        formatImageAltFence,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
