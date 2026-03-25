(function (globalScope) {
    const LINUX_DO_HOST = "linux.do";
    const LINUX_DO_LIKE_SELECTOR = "button.btn-toggle-reaction-like.reaction-button";
    const HEADING_TAGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
    const BLOCK_TAGS = new Set(["p", "div", "section", "article", "blockquote", "ul", "ol", "li", "pre"]);

    function resolveLinuxDoUrl(url, pageUrl = "") {
        const raw = String(url || "").trim();
        if (!raw) return "";
        if (/^(data|blob|javascript):/i.test(raw)) return "";
        try {
            if (pageUrl) {
                return new URL(raw, pageUrl).href;
            }
            return new URL(raw).href;
        } catch (error) {
            return raw;
        }
    }

    function cleanLinuxDoPostUrl(url) {
        if (!url) return "";
        try {
            const parsed = new URL(url);
            parsed.search = "";
            parsed.hash = "";
            return parsed.href;
        } catch (error) {
            return String(url).replace(/[?#].*$/, "");
        }
    }

    function isLinuxDoTopicPage(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");
        return hostname === LINUX_DO_HOST && /^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(pathname);
    }

    function buildLinuxDoPostTitle(topicTitle, postNumber, username) {
        const cleanTopicTitle = String(topicTitle || "").trim() || "LINUX DO 帖子";
        if (!postNumber || postNumber === 1) {
            return cleanTopicTitle;
        }
        const authorPart = String(username || "").trim();
        return authorPart ? `${cleanTopicTitle} - ${authorPart} #${postNumber}` : `${cleanTopicTitle} #${postNumber}`;
    }

    function normalizeCodeLanguage(element) {
        const className = String(element?.className || "");
        const match = className.match(/\blanguage-([A-Za-z0-9+._#-]{1,30})\b/i);
        return match ? match[1].toLowerCase() : "";
    }

    function shouldSkipLinuxDoElement(element) {
        const classList = getClassList(element);
        const tag = getTagName(element);
        return classList.includes("anchor") ||
            classList.includes("cooked-selection-barrier") ||
            classList.includes("codeblock-button-wrapper") ||
            classList.includes("meta") && !!safeClosest(element, "a.lightbox") ||
            tag === "svg" ||
            tag === "script" ||
            tag === "style";
    }

    function formatCodeFence(code, language = "") {
        return `\n\`\`\`${language}\n${code}\n\`\`\`\n`;
    }

    function convertLinuxDoNodeToMarkdown(node, options = {}) {
        if (!node) return "";
        if (node.nodeType === 3) return node.textContent || "";
        if (node.nodeType !== 1) return "";
        if (shouldSkipLinuxDoElement(node)) return "";

        const tag = getTagName(node);

        if (tag === "img") {
            const classList = getClassList(node);
            if (classList.includes("emoji") || String(node.src || "").includes("/emoji/")) {
                return node.alt || "";
            }
            const lightboxHref = safeGetAttribute(safeClosest(node, "a.lightbox[href]"), "href") || "";
            const src = lightboxHref || node.currentSrc || node.src || safeGetAttribute(node, "src") || "";
            const resolved = resolveLinuxDoUrl(src, options.pageUrl);
            const alt = (node.alt || "").replace(/[\[\]]/g, "");
            return resolved ? `\n![${alt}](${resolved})\n` : "";
        }

        if (tag === "br") return "\n";
        if (tag === "hr") return "\n---\n";

        if (tag === "pre") {
            let codeNode = null;
            for (const child of node.childNodes || []) {
                if (child?.nodeType === 1 && getTagName(child) === "code") {
                    codeNode = child;
                    break;
                }
            }
            const source = codeNode || node;
            const code = source.innerText || source.textContent || "";
            return formatCodeFence(code, normalizeCodeLanguage(codeNode));
        }

        let markdown = "";
        for (const child of node.childNodes || []) {
            markdown += convertLinuxDoNodeToMarkdown(child, options);
        }

        if (tag === "a") {
            const href = resolveLinuxDoUrl(safeGetAttribute(node, "href") || "", options.pageUrl);
            const text = markdown.trim();
            if (!href || !text) return markdown;
            if (text.includes("![](")) return markdown;
            return `[${text}](${href})`;
        }

        if ((tag === "strong" || tag === "b") && markdown.trim()) {
            markdown = `**${markdown.replace(/\*\*/g, "")}**`;
        }

        if ((tag === "em" || tag === "i") && markdown.trim()) {
            markdown = `*${markdown.trim()}*`;
        }

        if ((tag === "del" || tag === "s") && markdown.trim()) {
            markdown = `~~${markdown.trim()}~~`;
        }

        if (tag === "h1") return `\n# ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h2") return `\n## ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h3") return `\n### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h4") return `\n#### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h5") return `\n##### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h6") return `\n###### ${markdown.replace(/\*\*/g, "").trim()}\n`;

        if (tag === "blockquote") {
            const lines = markdown.trim().split("\n").filter((line) => line.trim() !== "");
            return "\n" + lines.map((line) => `> ${line}`).join("\n") + "\n";
        }

        if (tag === "li") {
            const parentTag = getTagName(node.parentElement);
            if (parentTag === "ol") {
                const idx = Array.from(node.parentElement.children).indexOf(node) + 1;
                return `\n${idx}. ${markdown.trim()}\n`;
            }
            return `\n- ${markdown.trim()}\n`;
        }

        if (BLOCK_TAGS.has(tag) || HEADING_TAGS.has(tag)) {
            return `\n${markdown}\n`;
        }

        return markdown;
    }

    function extractLinuxDoMarkdown(container, options = {}) {
        const markdown = convertLinuxDoNodeToMarkdown(container, options);
        return markdown.replace(/\n{3,}/g, "\n\n").trim();
    }

    function extractLinuxDoPublished(post) {
        const relativeDate = post?.querySelector?.(".post-date .relative-date");
        const timestamp = safeGetAttribute(relativeDate, "data-time");
        if (timestamp && /^\d+$/.test(timestamp)) {
            try {
                return new Date(Number(timestamp)).toISOString();
            } catch (error) { }
        }
        return safeGetAttribute(relativeDate, "title") ||
            safeGetAttribute(post?.querySelector?.("a.post-date"), "title") ||
            "";
    }

    function extractLinuxDoPostData(post, options = {}) {
        if (!post) return null;

        const cooked = post.querySelector?.(".cooked");
        const articleContent = extractLinuxDoMarkdown(cooked, { pageUrl: options.pageUrl });
        if (!articleContent) return null;

        const userLink = post.querySelector?.(".topic-meta-data .names [data-user-card], .topic-avatar .main-avatar[data-user-card], .names a[data-user-card]");
        const username = safeGetAttribute(userLink, "data-user-card") || "";
        const author = getNodeText(userLink).trim() || username || "unknown";
        const authorUrl = resolveLinuxDoUrl(safeGetAttribute(userLink, "href") || (username ? `/u/${username}` : ""), options.pageUrl);

        const postLink = post.querySelector?.("a.post-date");
        const postUrl = cleanLinuxDoPostUrl(resolveLinuxDoUrl(safeGetAttribute(postLink, "href") || options.pageUrl || "", options.pageUrl));
        const postNumberMatch = String(post.id || postUrl).match(/(?:post_|\/)(\d+)(?:$|[/?#])/);
        const postNumber = postNumberMatch ? Number(postNumberMatch[1]) : 1;

        return {
            type: "article",
            url: postUrl,
            author,
            handle: username ? `@${username}` : "",
            author_url: authorUrl,
            published: extractLinuxDoPublished(post),
            article_title: buildLinuxDoPostTitle(options.topicTitle, postNumber, username || author),
            article_content: articleContent,
            images: [],
            videos: [],
            platform: "LINUX DO",
        };
    }

    const exported = {
        LINUX_DO_LIKE_SELECTOR,
        buildLinuxDoPostTitle,
        cleanLinuxDoPostUrl,
        extractLinuxDoMarkdown,
        extractLinuxDoPostData,
        isLinuxDoTopicPage,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
