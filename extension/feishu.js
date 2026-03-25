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

        // 斜体
        if ((tag === "em" || tag === "i") && markdown.trim()) {
            return `*${markdown.trim()}*`;
        }

        // 删除线
        if ((tag === "del" || tag === "s") && markdown.trim()) {
            return `~~${markdown.trim()}~~`;
        }

        // 行内代码
        if (tag === "code" && markdown.trim() && !markdown.includes("\n")) {
            return `\`${markdown.trim()}\``;
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
        if (type === "heading5") return `##### ${extractBlockText(block, options)}`.trim();
        if (type === "heading6" || type === "heading7" || type === "heading8" || type === "heading9") return `###### ${extractBlockText(block, options)}`.trim();

        // Todo / Checkbox 块
        if (type === "todo") {
            const checkbox = block.querySelector?.("input[type='checkbox'], .checkbox, .todo-checkbox");
            const checked = checkbox?.checked || getClassList(checkbox).includes("checked") || safeGetAttribute(checkbox, "data-checked") === "true";
            const content = extractBlockText(block.querySelector?.(".list-content, .todo-content") || block, options);
            return content ? `- [${checked ? "x" : " "}] ${content}` : "";
        }

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

    // ─────────────────────────────────────────────
    // 飞书内部 API JSON 读取方案（替代滚动收集）
    // ─────────────────────────────────────────────

    function extractFeishuDocToken(url) {
        const match = String(url || "").match(/\/(wiki|docx)\/([A-Za-z0-9]+)/);
        return match ? { type: match[1], token: match[2] } : null;
    }

    // 将飞书 API 返回的 text.elements 转为 markdown 内联文本
    function convertFeishuApiTextElements(elements) {
        let md = "";
        for (const el of elements || []) {
            if (el.text_run) {
                let text = el.text_run.content || "";
                if (!text) continue;
                const style = el.text_run.text_element_style || {};
                if (style.inline_code) text = `\`${text}\``;
                else {
                    if (style.bold) text = `**${text}**`;
                    if (style.italic) text = `*${text}*`;
                    if (style.strikethrough) text = `~~${text}~~`;
                }
                if (style.link && style.link.url) {
                    try {
                        const decoded = decodeURIComponent(style.link.url);
                        text = `[${text}](${decoded})`;
                    } catch (e) {
                        text = `[${text}](${style.link.url})`;
                    }
                }
                md += text;
            } else if (el.mention_doc) {
                const title = el.mention_doc.title || "文档";
                const url = el.mention_doc.url || "";
                md += url ? `[${title}](${url})` : title;
            } else if (el.equation) {
                md += `$${el.equation.content || ""}$`;
            }
        }
        return md;
    }

    // 代码语言枚举映射（飞书 API 返回数字类型）
    const FEISHU_CODE_LANG_MAP = {
        1: "plaintext", 2: "bash", 3: "c", 4: "cpp", 5: "csharp",
        6: "css", 7: "go", 8: "html", 9: "java", 10: "javascript",
        11: "json", 12: "kotlin", 13: "lua", 14: "markdown", 15: "objc",
        16: "perl", 17: "php", 18: "python", 19: "ruby", 20: "rust",
        21: "scala", 22: "shell", 23: "sql", 24: "swift", 25: "typescript",
        26: "xml", 27: "yaml",
    };

    // 递归将飞书 API 的 JSON block 转换为 markdown
    function convertFeishuApiBlock(block, allBlocks, depth) {
        if (!block) return "";
        const type = block.block_type;

        // 获取文本内容（text 块和 heading 块共用 text 字段）
        const textElements = block.text?.elements || block.heading?.elements || [];
        const text = convertFeishuApiTextElements(textElements);

        // 递归转换子块
        function convertChildren(childDepth) {
            return (block.children || [])
                .map(function (id) { return convertFeishuApiBlock(allBlocks[id], allBlocks, childDepth || depth); })
                .filter(Boolean)
                .join("\n\n");
        }

        switch (type) {
            case 1: // page
                return convertChildren(0);
            case 2: // text
                return text || "";
            case 3: return text ? `# ${text}` : "";
            case 4: return text ? `## ${text}` : "";
            case 5: return text ? `### ${text}` : "";
            case 6: return text ? `#### ${text}` : "";
            case 7: return text ? `##### ${text}` : "";
            case 8: case 9: case 10: case 11: // heading6-9 → h6
                return text ? `###### ${text}` : "";
            case 12: { // bullet
                const children = convertChildren(depth + 1);
                const indent = "  ".repeat(depth);
                const line = text ? `${indent}- ${text}` : "";
                return [line, children].filter(Boolean).join("\n");
            }
            case 13: { // ordered
                const children = convertChildren(depth + 1);
                const indent = "  ".repeat(depth);
                const line = text ? `${indent}1. ${text}` : "";
                return [line, children].filter(Boolean).join("\n");
            }
            case 14: { // code
                const codeElements = block.code?.text?.elements || textElements;
                const codeText = codeElements.map(function (e) { return e.text_run?.content || ""; }).join("");
                const langVal = block.code?.style?.language;
                const langStr = typeof langVal === "number" ? (FEISHU_CODE_LANG_MAP[langVal] || "") : String(langVal || "").toLowerCase();
                return codeText ? `\`\`\`${langStr}\n${codeText}\n\`\`\`` : "";
            }
            case 15: { // quote
                const content = text || convertChildren(depth);
                return content ? content.split("\n").map(function (l) { return `> ${l}`; }).join("\n") : "";
            }
            case 16: { // todo
                const checked = block.todo?.style?.done === true;
                return text ? `- [${checked ? "x" : " "}] ${text}` : "";
            }
            case 17: return "---"; // divider
            case 18: { // image
                const token = block.image?.token || "";
                return token ? `![](feishu-image://${token})` : "";
            }
            case 19: { // table
                const cellIds = block.children || [];
                if (!cellIds.length) return "";
                const cols = block.table?.property?.column_size || 1;
                const rows = [];
                for (let i = 0; i < cellIds.length; i += cols) {
                    const row = [];
                    for (let j = 0; j < cols && (i + j) < cellIds.length; j++) {
                        const cell = allBlocks[cellIds[i + j]];
                        const cellContent = cell ? (cell.children || [])
                            .map(function (id) { return convertFeishuApiBlock(allBlocks[id], allBlocks, 0); })
                            .filter(Boolean)
                            .join(" ")
                            .replace(/\|/g, "\\|")
                            .replace(/\n/g, " ") : "";
                        row.push(cellContent);
                    }
                    rows.push(row);
                }
                if (!rows.length) return "";
                const header = "| " + rows[0].join(" | ") + " |";
                const sep = "| " + rows[0].map(function () { return "---"; }).join(" | ") + " |";
                const body = rows.slice(1).map(function (r) { return "| " + r.join(" | ") + " |"; }).join("\n");
                return [header, sep, body].filter(Boolean).join("\n");
            }
            case 20: // table_cell - handled by table
                return "";
            case 22: case 23: // grid, grid_column
                return convertChildren(depth);
            case 27: { // callout
                const content = convertChildren(depth);
                return content ? content.split("\n").map(function (l) { return `> ${l}`; }).join("\n") : "";
            }
            default:
                return text || convertChildren(depth);
        }
    }

    // 通过飞书内部 API 获取文档 JSON 并转 markdown（通过页面上下文注入执行）
    // 返回 Promise<string|null>
    function fetchFeishuDocViaApi(pageUrl) {
        const info = extractFeishuDocToken(pageUrl);
        if (!info) return Promise.resolve(null);

        return new Promise(function (resolve) {
            // 生成唯一 message ID
            var msgId = "__x2md_feishu_" + Date.now() + "_" + Math.random().toString(36).slice(2);

            // 监听从页面上下文返回的结果
            function onMessage(event) {
                if (event.data && event.data.type === msgId) {
                    globalScope.removeEventListener("message", onMessage);
                    clearTimeout(timer);
                    resolve(event.data.result || null);
                }
            }
            globalScope.addEventListener("message", onMessage);

            // 超时 8 秒
            var timer = setTimeout(function () {
                globalScope.removeEventListener("message", onMessage);
                resolve(null);
            }, 8000);

            // 注入脚本到页面上下文（这样 fetch 自带页面 cookies）
            var script = globalScope.document.createElement("script");
            script.textContent = `(function(){
                var msgId = ${JSON.stringify(msgId)};
                var docType = ${JSON.stringify(info.type)};
                var docToken = ${JSON.stringify(info.token)};
                var origin = location.origin;

                function sendResult(data) {
                    window.postMessage({ type: msgId, result: data }, "*");
                }

                async function run() {
                    try {
                        var realDocToken = docToken;
                        // wiki 页面需先解析真实 doc_token
                        if (docType === "wiki") {
                            var wikiResp = await fetch(origin + "/space/api/wiki/v2/tree/get_info?token=" + docToken, {
                                credentials: "include"
                            });
                            if (wikiResp.ok) {
                                var wikiData = await wikiResp.json();
                                realDocToken = (wikiData && wikiData.data && wikiData.data.wiki_info && wikiData.data.wiki_info.doc_token) || docToken;
                            }
                        }
                        // 获取文档原始内容
                        var resp = await fetch(origin + "/space/api/docx/v2/" + realDocToken + "/raw_content", {
                            credentials: "include"
                        });
                        if (!resp.ok) { sendResult(null); return; }
                        var json = await resp.json();
                        if (!json || json.code !== 0 || !json.data) { sendResult(null); return; }
                        sendResult(json.data);
                    } catch(e) {
                        console.error("[x2md] Feishu API fetch failed:", e);
                        sendResult(null);
                    }
                }
                run();
            })();`;
            (globalScope.document.head || globalScope.document.documentElement).appendChild(script);
            script.remove();
        });
    }

    // 将 API 返回的 data 转为 markdown
    function convertFeishuApiDataToMarkdown(apiData) {
        if (!apiData) return null;

        var blocks = apiData.blocks || {};
        var doc = apiData.document;
        if (!doc || !doc.block_id) return null;

        var rootBlock = blocks[doc.block_id];
        if (!rootBlock) return null;

        // 将 document.children 设为 rootBlock 的 children
        rootBlock.children = doc.children || rootBlock.children || [];

        var md = convertFeishuApiBlock(rootBlock, blocks, 0);
        return md ? md.replace(/\n{3,}/g, "\n\n").trim() : null;
    }

    const exported = {
        cleanFeishuUrl,
        convertFeishuApiDataToMarkdown,
        extractFeishuAuthor,
        extractFeishuBlockMarkdown,
        extractFeishuDocToken,
        extractFeishuDocumentData,
        extractFeishuInlineMarkdown,
        extractFeishuMarkdownFromBlocks,
        extractFeishuTitle,
        extractFeishuUpdated,
        fetchFeishuDocViaApi,
        isFeishuWikiOrDocxPage,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
