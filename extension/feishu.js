(function (globalScope) {
    function cleanFeishuUrl(url) {
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

    function resolveFeishuUrl(url, pageUrl = "") {
        const raw = String(url || "").trim();
        if (!raw) return "";
        if (/^(data|blob|javascript):/i.test(raw)) return "";
        if (/^https?:\/\//i.test(raw)) {
            if (/^https?:\/\/[^/]+$/i.test(raw)) {
                return `${raw}/`;
            }
            return raw;
        }
        try {
            return new URL(raw, pageUrl || globalScope.location?.href || "").href;
        } catch (error) {
            return raw;
        }
    }

    function isFeishuWikiOrDocxPage(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");
        return hostname.endsWith(".feishu.cn") && (/^\/wiki\/[^/]+/.test(pathname) || /^\/docx\/[^/]+/.test(pathname));
    }

    function shouldSkipFeishuInlineNode(node) {
        const classList = getClassList(node);
        const tag = getTagName(node);
        return tag === "button" ||
            tag === "svg" ||
            tag === "style" ||
            tag === "script" ||
            classList.includes("docx-block-zero-space") ||
            classList.includes("fold-wrapper") ||
            classList.includes("block-area-comment-container") ||
            classList.includes("gpf-biz-action-manager-forbidden-placeholder");
    }

    function isBoldNode(node) {
        const style = String(node?.__style?.fontWeight || node?.style?.fontWeight || "");
        const numericWeight = parseInt(style, 10);
        return getTagName(node) === "strong" ||
            getTagName(node) === "b" ||
            style === "bold" ||
            Number.isFinite(numericWeight) && numericWeight >= 700;
    }

    function extractFeishuInlineMarkdown(node, options = {}) {
        if (!node) return "";
        if (node.nodeType === 3) return cleanZeroWidth(node.textContent || "");
        if (node.nodeType !== 1) return "";
        if (shouldSkipFeishuInlineNode(node)) return "";

        if (safeGetAttribute(node, "data-zero-space") === "true" || safeGetAttribute(node, "data-enter") === "true") {
            return "";
        }

        const tag = getTagName(node);

        if (tag === "img") {
            if (safeClosest(node, "a.mention-doc, a.link")) {
                return "";
            }
            const src = resolveFeishuUrl(node.currentSrc || node.src || safeGetAttribute(node, "src") || "", options.pageUrl);
            return src ? `![](${src})` : "";
        }

        let markdown = "";
        for (const child of node.childNodes || []) {
            markdown += extractFeishuInlineMarkdown(child, options);
        }

        markdown = cleanZeroWidth(markdown);

        if (tag === "a") {
            const href = resolveFeishuUrl(safeGetAttribute(node, "href") || "", options.pageUrl);
            const text = markdown.trim();
            if (!href || !text) return markdown;
            if (text.includes("![](")) return text;
            return `[${text}](${href})`;
        }

        if (tag === "div" && getClassList(node).includes("ace-line")) {
            return `${markdown}\n`;
        }

        if (isBoldNode(node) && markdown.trim()) {
            return `**${markdown.replace(/\*\*/g, "")}**`;
        }

        return markdown;
    }

    function isInsideAiSummary(block) {
        const summaryRoot = safeClosest(block, ".docx-ai-summary-block");
        return !!summaryRoot && summaryRoot !== block;
    }

    function extractBlockText(block, options = {}) {
        const content = extractFeishuInlineMarkdown(block, options)
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return cleanZeroWidth(content).trim();
    }

    function formatQuoteBlock(text) {
        const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
        return lines.length ? lines.map((line) => `> ${line}`).join("\n") : "";
    }

    function extractFeishuBlockMarkdown(block, options = {}) {
        if (!block) return "";
        const type = safeGetAttribute(block, "data-block-type") || "";
        const classList = getClassList(block);

        if (type === "ai-summary" || type === "page" || type === "grid" || type === "grid_column" || type === "callout" || type === "quote_container" || type === "synced_source") {
            return "";
        }

        if (isInsideAiSummary(block)) return "";

        if (classList.includes("isEmpty")) return "";

        if (type === "heading1") return `# ${extractBlockText(block, options)}`.trim();
        if (type === "heading2") return `## ${extractBlockText(block, options)}`.trim();
        if (type === "heading3") return `### ${extractBlockText(block, options)}`.trim();
        if (type === "heading4") return `#### ${extractBlockText(block, options)}`.trim();

        if (type === "ordered") {
            const order = (block.querySelector?.(".order")?.innerText || "1.").trim();
            const content = extractBlockText(block.querySelector?.(".list-content") || block, options);
            return content ? `${order} ${content}` : "";
        }

        if (type === "bullet" || type === "unordered") {
            const content = extractBlockText(block.querySelector?.(".list-content") || block, options);
            return content ? `- ${content}` : "";
        }

        if (type === "image") {
            const img = block.querySelector?.("img.docx-image, .img img, img");
            const src = resolveFeishuUrl(img?.currentSrc || img?.src || safeGetAttribute(img, "src") || "", options.pageUrl);
            return src ? `![](${src})` : "";
        }

        if (type === "divider") return "---";

        if (type === "iframe") {
            const iframe = block.querySelector?.("iframe");
            const src = iframe?.src || safeGetAttribute(iframe, "src") || "";
            if (!src) return "";
            // 清理嵌入参数，保留核心 URL
            const cleanSrc = cleanFeishuUrl(src);
            return `[嵌入内容](${cleanSrc})`;
        }

        if (type === "table") {
            const cells = block.querySelectorAll?.(".block[data-block-type='table_cell']") || [];
            if (!cells.length) return "";
            // 推断列数：取第一行的列数（飞书表格 grid 结构）
            const gridStyle = block.querySelector?.(".table-block-wrapper, table, .docx-table-block")?.style;
            let cols = 0;
            if (gridStyle?.gridTemplateColumns) {
                cols = gridStyle.gridTemplateColumns.split(/\s+/).filter(Boolean).length;
            }
            if (!cols) {
                // 尝试从第一行 tr 中计算
                const firstRow = block.querySelector?.("tr");
                cols = firstRow ? firstRow.children?.length || 0 : 0;
            }
            if (!cols) cols = Math.ceil(Math.sqrt(cells.length)) || 1;

            const rows = [];
            for (let i = 0; i < cells.length; i += cols) {
                const row = [];
                for (let j = 0; j < cols && (i + j) < cells.length; j++) {
                    row.push(extractBlockText(cells[i + j], options).replace(/\|/g, "\\|").replace(/\n/g, " "));
                }
                rows.push(row);
            }
            if (!rows.length) return "";
            const header = "| " + rows[0].join(" | ") + " |";
            const separator = "| " + rows[0].map(() => "---").join(" | ") + " |";
            const body = rows.slice(1).map((r) => "| " + r.join(" | ") + " |").join("\n");
            return [header, separator, body].filter(Boolean).join("\n");
        }

        if (type === "table_cell") return "";

        if (type === "base_refer") {
            const link = block.querySelector?.("a");
            const href = safeGetAttribute(link, "href") || "";
            const text = cleanZeroWidth(getNodeText(link)).trim() || "多维表格";
            return href ? `[${text}](${resolveFeishuUrl(href, options.pageUrl)})` : text;
        }

        if (type === "code") {
            const code = cleanZeroWidth(block.querySelector?.("code, pre")?.innerText || block.innerText || "").trim();
            const language = safeGetAttribute(block, "data-code-language") || "";
            return code ? `\`\`\`${language}\n${code}\n\`\`\`` : "";
        }

        const text = extractBlockText(block, options);
        if (!text) return "";

        if (safeClosest(block, ".docx-callout-block, .docx-quote_container-block")) {
            return formatQuoteBlock(text);
        }

        return text;
    }

    function extractFeishuMarkdownFromBlocks(blocks, options = {}) {
        const parts = [];
        for (const block of blocks || []) {
            const markdown = extractFeishuBlockMarkdown(block, options);
            if (!markdown) continue;
            parts.push(markdown);
        }
        return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
    }

    function extractFeishuTitle(doc = document) {
        const selectors = [
            "#ssrHeaderTitle",
            ".note-title__input .header-ssr-layout-component-Title",
            ".note-title__input",
            "h1:nth-of-type(2)",
            "h1",
        ];
        for (const selector of selectors) {
            const el = doc.querySelector?.(selector);
            const text = cleanZeroWidth(getNodeText(el)).trim();
            if (text && text !== "飞书云文档") return text;
        }
        return cleanZeroWidth(String(doc.title || "").replace(/\s*-\s*飞书云文档\s*$/, "")).trim();
    }

    function extractFeishuAuthor(doc = document) {
        const selectors = [
            ".doc-info-editor-wrapper",
            ".docs-info-editor",
            ".docs-info-editor-list-avatar-with-name",
        ];
        for (const selector of selectors) {
            const text = cleanZeroWidth(getNodeText(doc.querySelector?.(selector))).trim();
            if (text) return text;
        }
        const hostname = String(doc.location?.hostname || globalScope.location?.hostname || "");
        return hostname.split(".")[0] || "unknown";
    }

    function extractFeishuUpdated(doc = document) {
        const text = cleanZeroWidth(getNodeText(doc.querySelector?.(".note-title__time"))).trim();
        return text.replace(/^最近修改:\s*/, "");
    }

    function extractFeishuDocumentData(doc = document, options = {}) {
        const pageUrl = options.pageUrl || doc.location?.href || globalScope.location?.href || "";
        const root = doc.querySelector?.("#docx") || doc.querySelector?.(".garr-container-docx");
        if (!root) return null;

        const blocks = Array.from(root.querySelectorAll?.(".block[data-block-type]") || []);
        const articleContent = extractFeishuMarkdownFromBlocks(blocks, { pageUrl });
        if (!articleContent) return null;

        const title = extractFeishuTitle(doc);
        const author = extractFeishuAuthor(doc);

        return {
            type: "article",
            url: cleanFeishuUrl(pageUrl),
            author,
            handle: "",
            author_url: "",
            published: extractFeishuUpdated(doc),
            article_title: title,
            article_content: articleContent,
            images: [],
            videos: [],
            platform: "Feishu",
        };
    }

    const exported = {
        cleanFeishuUrl,
        extractFeishuAuthor,
        extractFeishuBlockMarkdown,
        extractFeishuDocumentData,
        extractFeishuInlineMarkdown,
        extractFeishuMarkdownFromBlocks,
        extractFeishuTitle,
        extractFeishuUpdated,
        isFeishuWikiOrDocxPage,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
