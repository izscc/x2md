(function (globalScope) {
    function isWechatArticlePage(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");
        return hostname === "mp.weixin.qq.com" && /^\/s(\/|$|\?)/.test(pathname);
    }

    function cleanWechatUrl(url) {
        if (!url) return "";
        try {
            const parsed = new URL(url);
            if (parsed.hostname === "mp.weixin.qq.com") {
                // 保留 __biz, mid, idx, sn 这些核心标识参数，去掉追踪参数
                const keep = ["__biz", "mid", "idx", "sn"];
                const newParams = new URLSearchParams();
                for (const key of keep) {
                    const val = parsed.searchParams.get(key);
                    if (val) newParams.set(key, val);
                }
                // 如果是短链 /s/xxx 格式，直接去掉 query
                if (/^\/s\/[A-Za-z0-9_-]+$/.test(parsed.pathname)) {
                    parsed.search = "";
                    parsed.hash = "";
                    return parsed.href;
                }
                parsed.search = newParams.toString() ? "?" + newParams.toString() : "";
                parsed.hash = "";
                return parsed.href;
            }
            return url;
        } catch (error) {
            return String(url).replace(/#.*$/, "");
        }
    }

    function resolveWechatImageUrl(url) {
        const raw = String(url || "").trim();
        if (!raw) return "";
        if (/^(data|blob|javascript):/i.test(raw)) return "";
        // 微信图片使用 mmbiz.qpic.cn 或 mmbiz.wpimg.cn 等 CDN
        // 去掉 wx_fmt 以外的追踪参数，保留格式参数
        try {
            const parsed = new URL(raw);
            if (parsed.hostname.includes("mmbiz")) {
                const wxFmt = parsed.searchParams.get("wx_fmt") || parsed.searchParams.get("tp");
                const newParams = new URLSearchParams();
                if (wxFmt) newParams.set("wx_fmt", wxFmt);
                parsed.search = newParams.toString() ? "?" + newParams.toString() : "";
                return parsed.href;
            }
        } catch (error) { }
        return raw;
    }

    function shouldSkipWechatNode(node) {
        const tag = getTagName(node);
        const classList = getClassList(node);
        return tag === "script" ||
            tag === "style" ||
            tag === "svg" ||
            tag === "button" ||
            tag === "noscript" ||
            classList.includes("qr_code_pc") ||
            classList.includes("reward_area") ||
            classList.includes("like_area") ||
            classList.includes("function_area") ||
            classList.includes("ct_mpda_wrp");
    }

    function isHeadingStyle(node) {
        // 微信公众号文章的标题经常用内联样式实现
        // 检测 font-size >= 20px 且为粗体的元素
        const style = node?.style;
        if (!style) return 0;
        const fontSize = parseInt(style.fontSize, 10);
        const fontWeight = style.fontWeight;
        const isBold = fontWeight === "bold" || (parseInt(fontWeight, 10) >= 700);
        if (fontSize >= 24 && isBold) return 1;
        if (fontSize >= 20 && isBold) return 2;
        if (fontSize >= 17 && isBold) return 3;
        return 0;
    }

    function convertWechatNodeToMarkdown(node, options = {}) {
        if (!node) return "";
        if (node.nodeType === 3) return node.textContent || "";
        if (node.nodeType !== 1) return "";
        if (shouldSkipWechatNode(node)) return "";

        const tag = getTagName(node);
        const classList = getClassList(node);

        // 视频占位
        if (tag === "mpvoice" || classList.includes("voice_player_inner")) {
            return "\n> [语音消息]\n";
        }
        if (classList.includes("video_iframe") || tag === "iframe" && String(node.src || "").includes("v.qq.com")) {
            return "\n> [视频]\n";
        }
        if (classList.includes("weapp_display_element") || classList.includes("weapp_text_link")) {
            const title = safeGetAttribute(node, "data-title") || getNodeText(node).trim() || "小程序";
            return `\n> [小程序: ${title}]\n`;
        }

        // 图片：微信用 data-src 做懒加载
        if (tag === "img") {
            const classList = getClassList(node);
            // 跳过表情图、装饰图
            if (classList.includes("img_loading") && !safeGetAttribute(node, "data-src")) return "";
            const src = safeGetAttribute(node, "data-src") ||
                node.currentSrc || node.src ||
                safeGetAttribute(node, "src") || "";
            if (!src) return "";
            // 跳过很小的装饰图片
            const width = parseInt(safeGetAttribute(node, "data-w") || safeGetAttribute(node, "width") || "0", 10);
            if (width > 0 && width < 20) return "";
            const resolved = resolveWechatImageUrl(src);
            return resolved ? `\n![](${resolved})\n` : "";
        }

        if (tag === "br") return "\n";
        if (tag === "hr") return "\n---\n";

        // 代码块
        if (tag === "pre") {
            const codeNode = node.querySelector?.("code") || node;
            const code = cleanZeroWidth(codeNode.innerText || codeNode.textContent || "").trim();
            if (!code) return "";
            // 尝试获取语言
            const langClass = String(codeNode.className || "").match(/\blanguage-([A-Za-z0-9+._#-]+)\b/i);
            const lang = langClass ? langClass[1].toLowerCase() : "";
            return `\n\`\`\`${lang}\n${code}\n\`\`\`\n`;
        }

        // 微信常用 code_snippet_box 样式的代码块
        if (classList.includes("code_snippet_box") || classList.includes("code-snippet__fix")) {
            const codeNode = node.querySelector?.("code, pre") || node;
            const code = cleanZeroWidth(codeNode.innerText || codeNode.textContent || "").trim();
            if (!code) return "";
            return `\n\`\`\`\n${code}\n\`\`\`\n`;
        }

        // 列表容器：传递嵌套深度给子节点
        if (tag === "ul" || tag === "ol") {
            const parentDepth = options._listDepth || 0;
            let listMd = "";
            for (const child of node.childNodes || []) {
                listMd += convertWechatNodeToMarkdown(child, { ...options, _listDepth: parentDepth + 1 });
            }
            return `\n${listMd}\n`;
        }

        // 递归子节点
        let markdown = "";
        for (const child of node.childNodes || []) {
            markdown += convertWechatNodeToMarkdown(child, options);
        }

        // 行内代码
        if (tag === "code" && !node.querySelector?.("code")) {
            const text = cleanZeroWidth(markdown).trim();
            if (text && !text.includes("\n")) return `\`${text}\``;
        }

        // 链接
        if (tag === "a") {
            const href = safeGetAttribute(node, "href") || "";
            const text = markdown.trim();
            if (!href || !text || href.startsWith("javascript:")) return markdown;
            if (text.includes("![](")) return text;
            // 微信内部跳转链接转为绝对路径
            const absHref = href.startsWith("/") ? `https://mp.weixin.qq.com${href}` : href;
            return `[${text}](${absHref})`;
        }

        // 加粗
        if ((tag === "strong" || tag === "b") && markdown.trim()) {
            return `**${markdown.replace(/\*\*/g, "")}**`;
        }

        // 斜体
        if ((tag === "em" || tag === "i") && markdown.trim()) {
            const trimmed = markdown.trim();
            // 避免和加粗冲突
            if (!trimmed.startsWith("*") && !trimmed.endsWith("*")) {
                return `*${trimmed}*`;
            }
        }

        // 标题
        if (tag === "h1") return `\n# ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h2") return `\n## ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h3") return `\n### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h4") return `\n#### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h5") return `\n##### ${markdown.replace(/\*\*/g, "").trim()}\n`;
        if (tag === "h6") return `\n###### ${markdown.replace(/\*\*/g, "").trim()}\n`;

        // 引用
        if (tag === "blockquote") {
            const lines = markdown.trim().split("\n").filter((line) => line.trim() !== "");
            if (!lines.length) return "";
            return "\n" + lines.map((line) => `> ${line}`).join("\n") + "\n";
        }

        // 列表
        if (tag === "li") {
            const parent = node.parentElement;
            const parentTag = getTagName(parent);
            const depth = Math.max(0, (options._listDepth || 1) - 1);
            const indent = "  ".repeat(depth);
            if (parentTag === "ol") {
                const siblings = Array.from(parent?.children || []);
                const index = siblings.indexOf(node) + 1;
                return `\n${indent}${index}. ${markdown.trim()}\n`;
            }
            return `\n${indent}- ${markdown.trim()}\n`;
        }

        // section 中用内联样式模拟标题的情况
        if (tag === "section" || tag === "p") {
            const headingLevel = isHeadingStyle(node);
            const text = markdown.trim();
            if (headingLevel > 0 && text && text.length < 100 && !text.includes("\n")) {
                const prefix = "#".repeat(headingLevel);
                return `\n${prefix} ${text.replace(/\*\*/g, "")}\n`;
            }
        }

        // 表格处理：转换为 GFM pipe table
        if (tag === "table") {
            const rows = [];
            for (const tr of node.querySelectorAll?.("tr") || []) {
                const cells = [];
                for (const cell of tr.querySelectorAll?.("td, th") || []) {
                    cells.push(convertWechatNodeToMarkdown(cell, options).replace(/\n/g, " ").trim());
                }
                if (cells.length) rows.push(cells);
            }
            if (rows.length) {
                const colCount = Math.max(...rows.map(r => r.length));
                const lines = [];
                rows.forEach((row, i) => {
                    while (row.length < colCount) row.push("");
                    lines.push("| " + row.join(" | ") + " |");
                    if (i === 0) lines.push("| " + Array(colCount).fill("---").join(" | ") + " |");
                });
                return "\n" + lines.join("\n") + "\n";
            }
        }
        if (tag === "tr" || tag === "td" || tag === "th" || tag === "thead" || tag === "tbody") {
            return markdown;
        }

        // 块级元素换行
        const blockTags = new Set(["p", "div", "section", "article", "figure", "figcaption"]);
        if (blockTags.has(tag)) {
            return `\n${markdown}\n`;
        }

        return markdown;
    }

    function extractWechatMarkdown(container, options = {}) {
        if (!container) return "";
        const markdown = convertWechatNodeToMarkdown(container, options);
        return markdown
            .replace(/\n{3,}/g, "\n\n")
            .replace(/^\s+/, "")
            .trim();
    }

    function extractWechatTitle(doc = document) {
        // 优先：文章标题元素
        const selectors = [
            "#activity-name",
            ".rich_media_title",
            "h1",
        ];
        for (const selector of selectors) {
            const el = doc.querySelector?.(selector);
            const text = cleanZeroWidth(getNodeText(el)).trim();
            if (text) return text;
        }
        // 回退：页面标题
        return cleanZeroWidth(String(doc.title || "")).trim();
    }

    function extractWechatAuthor(doc = document) {
        // 公众号名称
        const selectors = [
            "#js_name",
            ".profile_nickname",
            "a.wx_tap_link[id='js_name']",
        ];
        for (const selector of selectors) {
            const el = doc.querySelector?.(selector);
            const text = cleanZeroWidth(getNodeText(el)).trim();
            if (text) return text;
        }
        // 原创作者
        const authorEl = doc.querySelector?.("#js_author_name, .rich_media_meta_text");
        if (authorEl) {
            const text = cleanZeroWidth(getNodeText(authorEl)).trim();
            if (text) return text;
        }
        return "unknown";
    }

    function extractWechatPublished(doc = document) {
        // 发布时间
        const el = doc.querySelector?.("#publish_time");
        if (el) {
            const text = cleanZeroWidth(getNodeText(el)).trim();
            if (text) return text;
        }
        // 备选：从 meta 或 script 中提取
        const metaEl = doc.querySelector?.('meta[property="og:article:published_time"], meta[property="article:published_time"]');
        if (metaEl) {
            const content = safeGetAttribute(metaEl, "content");
            if (content) return content;
        }
        return "";
    }

    function extractWechatDocumentData(doc = document, options = {}) {
        const pageUrl = options.pageUrl || doc.location?.href || globalScope.location?.href || "";
        const root = doc.querySelector?.("#js_content");
        if (!root) return null;

        const articleContent = extractWechatMarkdown(root, { pageUrl });
        if (!articleContent) return null;

        const title = extractWechatTitle(doc);
        const author = extractWechatAuthor(doc);

        return {
            type: "article",
            url: cleanWechatUrl(pageUrl),
            author,
            handle: "",
            author_url: "",
            published: extractWechatPublished(doc),
            article_title: title,
            article_content: articleContent,
            images: [],
            videos: [],
            platform: "微信公众号",
        };
    }

    const exported = {
        cleanWechatUrl,
        convertWechatNodeToMarkdown,
        extractWechatDocumentData,
        extractWechatMarkdown,
        isWechatArticlePage,
        resolveWechatImageUrl,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
