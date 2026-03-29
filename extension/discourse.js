(function (globalScope) {
    const LINUX_DO_HOST = "linux.do";
    // 可配置 Discourse 域名列表，运行时从配置注入
    let _discourseDomains = ["linux.do"];
    function setDiscourseDomains(domains) {
        if (Array.isArray(domains) && domains.length > 0) {
            _discourseDomains = domains.map(d => d.toLowerCase().trim()).filter(Boolean);
        }
    }
    function getDiscourseDomains() { return _discourseDomains; }

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

    function isDiscourseTopicPage(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");
        return _discourseDomains.includes(hostname) && /^\/t\/[^/]+\/\d+(?:\/\d+)?\/?$/.test(pathname);
    }

    // 向后兼容别名
    function isLinuxDoTopicPage(locationLike) {
        return isDiscourseTopicPage(locationLike);
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
            (classList.includes("meta") && !!safeClosest(element, "a.lightbox")) ||
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

        // 视频标签 → iframe 或 Markdown 链接
        if (tag === "video") {
            const src = safeGetAttribute(node, "src") || node.querySelector?.("source")?.src || "";
            if (src) {
                const resolved = resolveLinuxDoUrl(src, options.pageUrl);
                return `\n![video](${resolved})\n`;
            }
            return "";
        }

        // iframe 嵌入（YouTube / Bilibili / 其他）
        if (tag === "iframe") {
            const src = safeGetAttribute(node, "src") || "";
            if (!src) return "";
            const resolved = resolveLinuxDoUrl(src, options.pageUrl);
            // YouTube
            if (/youtube\.com\/embed\/|youtu\.be\//i.test(resolved)) {
                const videoId = resolved.match(/(?:embed\/|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                if (videoId) {
                    return `\n<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId[1]}" frameborder="0" allowfullscreen></iframe>\n`;
                }
            }
            // Bilibili
            if (/bilibili\.com\/(?:video|player)/i.test(resolved)) {
                return `\n<iframe width="560" height="315" src="${resolved}" frameborder="0" allowfullscreen></iframe>\n`;
            }
            // 其他 iframe → 保留为链接
            return `\n[嵌入内容](${resolved})\n`;
        }

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

        const classList = getClassList(node);

        // Discourse <details> 折叠/剧透块
        if (tag === "details") {
            const summary = node.querySelector?.("summary");
            const summaryText = summary ? (getNodeText(summary).trim() || "详情") : "详情";
            let inner = "";
            for (const child of node.childNodes || []) {
                if (child === summary) continue;
                inner += convertLinuxDoNodeToMarkdown(child, options);
            }
            const content = inner.trim();
            if (!content) return "";
            return `\n<details>\n<summary>${summaryText}</summary>\n\n${content}\n\n</details>\n`;
        }
        if (tag === "summary") return "";  // 已在 details 中处理

        // Discourse onebox 引用（aside.quote / aside.onebox）
        if (tag === "aside" && (classList.includes("quote") || classList.includes("onebox"))) {
            // 检查 onebox 是否包含视频嵌入（YouTube/Bilibili）
            if (classList.includes("onebox")) {
                const iframeEl = node.querySelector?.("iframe");
                if (iframeEl) {
                    return convertLinuxDoNodeToMarkdown(iframeEl, options);
                }
                // 检查 data-onebox-src 或链接中的视频 URL
                const oneboxSrc = safeGetAttribute(node, "data-onebox-src") || "";
                const linkEl = node.querySelector?.("a[href]");
                const linkHref = safeGetAttribute(linkEl, "href") || "";
                const videoUrl = oneboxSrc || linkHref;
                if (videoUrl && /youtube\.com\/watch|youtu\.be\/|bilibili\.com\/video/i.test(videoUrl)) {
                    // YouTube watch URL → embed
                    const ytMatch = videoUrl.match(/(?:watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]+)/);
                    if (ytMatch) {
                        return `\n<iframe width="560" height="315" src="https://www.youtube.com/embed/${ytMatch[1]}" frameborder="0" allowfullscreen></iframe>\n`;
                    }
                    // Bilibili → embed
                    const bvMatch = videoUrl.match(/bilibili\.com\/video\/(BV[a-zA-Z0-9]+)/i);
                    if (bvMatch) {
                        return `\n<iframe width="560" height="315" src="https://player.bilibili.com/player.html?bvid=${bvMatch[1]}" frameborder="0" allowfullscreen></iframe>\n`;
                    }
                }
            }

            const title = node.querySelector?.(".title, header");
            const titleText = title ? getNodeText(title).trim() : "";
            let inner = "";
            for (const child of node.childNodes || []) {
                if (child === title || (child.nodeType === 1 && (getClassList(child).includes("title") || getTagName(child) === "header"))) continue;
                inner += convertLinuxDoNodeToMarkdown(child, options);
            }
            const lines = inner.trim().split("\n").filter((l) => l.trim() !== "");
            if (titleText) lines.unshift(titleText);
            if (!lines.length) return "";
            return "\n" + lines.map((l) => `> ${l}`).join("\n") + "\n";
        }

        // Discourse 表格（使用共享 GFM 转换函数）
        if (tag === "table") {
            const result = convertTableToGfm(node, convertLinuxDoNodeToMarkdown, options);
            if (result) return result;
        }
        if (tag === "tr" || tag === "td" || tag === "th" || tag === "thead" || tag === "tbody") {
            // 被 table handler 调用时单独处理
            let md = "";
            for (const child of node.childNodes || []) {
                md += convertLinuxDoNodeToMarkdown(child, options);
            }
            return md;
        }

        // Discourse 投票（poll widget）—— 简化为文本列表
        if (classList.includes("poll")) {
            const titleEl = node.querySelector?.(".poll-title");
            const title = titleEl ? getNodeText(titleEl).trim() : "投票";
            const optionEls = node.querySelectorAll?.(".poll-option .option-text, li[data-poll-option-id]") || [];
            const optionTexts = Array.from(optionEls).map(el => getNodeText(el).trim()).filter(Boolean);
            if (!optionTexts.length) return "";
            return `\n> **${title}**\n${optionTexts.map(o => `> - ${o}`).join("\n")}\n`;
        }

        let markdown = "";
        for (const child of node.childNodes || []) {
            markdown += convertLinuxDoNodeToMarkdown(child, options);
        }

        if (tag === "a") {
            const href = resolveLinuxDoUrl(safeGetAttribute(node, "href") || "", options.pageUrl);
            const text = markdown.trim();
            if (!href || !text) return markdown;
            if (/!\[[^\]]*]\(/.test(text)) return markdown;
            return `[${escapeMdLinkText(text)}](${escapeMdLinkUrl(href)})`;
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
            platform: getDiscoursePlatformName(),
        };
    }

    function getDiscoursePlatformName() {
        const host = String(globalScope.location?.hostname || "").toLowerCase();
        if (host === "linux.do") return "LINUX DO";
        // 其他 Discourse 站点用域名作为平台名
        return host.replace(/\./g, "_") || "Discourse";
    }

    function cookedHtmlToMarkdown(htmlString, pageUrl) {
        // 使用 DOMParser 代替 innerHTML，避免直接执行脚本（安全加固）
        let container;
        if (typeof DOMParser !== "undefined") {
            const parser = new DOMParser();
            const doc = parser.parseFromString(`<div>${htmlString || ""}</div>`, "text/html");
            container = doc.body.firstElementChild || doc.body;
        } else {
            // Node.js 测试环境等无 DOMParser 时的兜底
            const div = document.createElement("div");
            div.innerHTML = htmlString || "";
            container = div;
        }
        return extractLinuxDoMarkdown(container, { pageUrl: pageUrl || "" });
    }

    async function fetchDiscourseReplies(topicId, hostname) {
        const host = hostname || globalScope.location?.hostname || "linux.do";
        const resp = await fetch(`https://${host}/t/${topicId}.json`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const posts = data.post_stream?.posts || [];
        // posts[0] 是主帖，posts[1:] 是回复
        const replies = posts.slice(1).map(p => ({
            floor: p.post_number,
            author: p.username || "匿名",
            content: cookedHtmlToMarkdown(p.cooked || "", `https://${host}/t/${topicId}`),
            published: p.created_at || "",
            likes: p.like_count || 0,
            reply_to: p.reply_to_post_number || null,
        }));
        // 返回结构化对象，而非在数组上挂属性
        return {
            replies,
            topicTags: Array.isArray(data.tags) ? data.tags : [],
        };
    }

    // 向后兼容别名
    function fetchLinuxDoReplies(topicId) {
        return fetchDiscourseReplies(topicId);
    }

    const exported = {
        LINUX_DO_LIKE_SELECTOR,
        buildLinuxDoPostTitle,
        cleanLinuxDoPostUrl,
        cookedHtmlToMarkdown,
        extractLinuxDoMarkdown,
        extractLinuxDoPostData,
        fetchLinuxDoReplies,
        fetchDiscourseReplies,
        isLinuxDoTopicPage,
        isDiscourseTopicPage,
        setDiscourseDomains,
        getDiscourseDomains,
        getDiscoursePlatformName,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
