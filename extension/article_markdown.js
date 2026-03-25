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

    function shouldSkipElement(element) {
        return safeClosest(element, '[data-testid="twitter-article-title"]') ||
            safeClosest(element, '[data-testid="User-Name"]');
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
                try {
                    const url = new URL(src);
                    url.searchParams.set("name", "orig");
                    return `\n![](${url.href})\n`;
                } catch (error) {
                    return `\n![](${src})\n`;
                }
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
        else if (tag === "h4") markdown = `\n#### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        else if (tag === "h5") markdown = `\n##### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        else if (tag === "h6") markdown = `\n###### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        else if (tag === "blockquote") {
            const lines = markdown.trim().split("\n").filter((line) => line.trim() !== "");
            markdown = "\n" + lines.map((line) => "> " + line).join("\n") + "\n";
        } else if (tag === "li") {
            const parentTag = (element.parentElement?.tagName || "").toLowerCase();
            if (parentTag === "ol") {
                const idx = Array.from(element.parentElement.children).indexOf(element) + 1;
                markdown = `\n${idx}. ${markdown.trim()}\n`;
            } else {
                markdown = `\n- ${markdown.trim()}\n`;
            }
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
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
