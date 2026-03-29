(function (globalScope) {

    // ─────────────────────────────────────────────
    // 飞书权限绕过：解除"仅阅读/禁止复制"的前端限制
    // ─────────────────────────────────────────────

    function neutralizeFeishuCopyProtection(doc) {
        doc = doc || globalScope.document;
        if (!doc || doc.__x2md_protection_neutralized) return;
        doc.__x2md_protection_neutralized = true;

        // 1. CSS：强制恢复文字可选中，隐藏复制保护提示/遮罩
        var style = doc.createElement("style");
        style.id = "__x2md_copy_unlock";
        style.textContent = [
            "* { -webkit-user-select: text !important; user-select: text !important; }",
            ".copy-forbidden-toast, .copy-protection-mask, .copy-tip-container,",
            ".gpf-biz-action-manager-forbidden-placeholder,",
            ".suite-permission-toast, .permission-denied-dialog,",
            "[class*='copy-forbidden'], [class*='copy-protection'],",
            "[class*='permission-toast'], [class*='no-copy'] {",
            "  display: none !important; visibility: hidden !important; pointer-events: none !important;",
            "}",
        ].join("\n");
        (doc.head || doc.documentElement).appendChild(style);

        // 2. JS事件：在捕获阶段拦截飞书的复制保护监听器
        var protectedEvents = ["copy", "cut", "contextmenu", "selectstart", "beforecopy"];
        protectedEvents.forEach(function (eventType) {
            doc.addEventListener(eventType, function (e) {
                e.stopPropagation();
            }, true);
        });

        // 3. 页面上下文注入：清除飞书在 document 上挂的 on* 保护
        var script = doc.createElement("script");
        script.textContent = "(function(){" +
            "document.oncopy=null;document.oncut=null;document.onselectstart=null;document.oncontextmenu=null;" +
            // 覆盖 ClipboardEvent 阻止逻辑：让 navigator.clipboard 正常工作
            "try{var _dp=Event.prototype.preventDefault;Event.prototype.preventDefault=function(){" +
            "if(this instanceof ClipboardEvent||this.type==='copy'||this.type==='cut'||this.type==='selectstart')return;" +
            "_dp.call(this);};}catch(e){}" +
            "})();";
        (doc.head || doc.documentElement).appendChild(script);
        script.remove();
    }

    // ─────────────────────────────────────────────
    // 飞书页面类型检测（扩展：支持 wiki/docx/minutes/sheets/mindnotes/messenger）
    // ─────────────────────────────────────────────

    function detectFeishuPageType(locationLike) {
        locationLike = locationLike || globalScope.location;
        var hostname = String(locationLike.hostname || "").toLowerCase();
        var pathname = String(locationLike.pathname || "");

        if (!hostname.endsWith(".feishu.cn") && !hostname.endsWith(".larksuite.com")) return null;

        if (/^\/wiki\/[^/]+/.test(pathname)) return "wiki";
        if (/^\/docx\/[^/]+/.test(pathname)) return "docx";
        if (/^\/minutes\/[^/]+/.test(pathname)) return "minutes";
        if (/^\/sheets\/[^/]+/.test(pathname)) return "sheets";
        if (/^\/mindnotes\/[^/]+/.test(pathname)) return "mindnotes";
        if (/^\/docs\/[^/]+/.test(pathname)) return "docs";  // 旧版飞书文档
        if (/^\/drive\/[^/]+/.test(pathname)) return "drive";
        if (/^\/messenger\b/.test(pathname)) return "messenger";

        return null;
    }

    function isFeishuContentPage(locationLike) {
        return detectFeishuPageType(locationLike) !== null;
    }

    // ─────────────────────────────────────────────
    // 飞书智能纪要 (minutes) 提取
    // ─────────────────────────────────────────────

    function extractFeishuMinutesData(doc, options) {
        doc = doc || globalScope.document;
        options = options || {};
        var pageUrl = options.pageUrl || doc.location?.href || globalScope.location?.href || "";

        // 智能纪要标题
        var title = "";
        var titleSelectors = [
            ".minutes-title", ".vc-minutes-title", "[class*='minutes-title']",
            ".header-title", "h1", "title"
        ];
        for (var i = 0; i < titleSelectors.length; i++) {
            var el = doc.querySelector(titleSelectors[i]);
            if (el) {
                var t = cleanZeroWidth(getNodeText(el)).trim();
                if (t && t !== "飞书智能纪要" && t !== "飞书") { title = t; break; }
            }
        }
        if (!title) title = String(doc.title || "").replace(/\s*-\s*飞书.*$/, "").trim();

        // 纪要内容：多种容器尝试
        var contentParts = [];

        // 方法A：结构化段落（发言人 + 内容）
        var speakerBlocks = doc.querySelectorAll(
            "[class*='transcript-item'], [class*='speaker-block'], " +
            "[class*='subtitle-item'], [class*='minutes-content'] > div"
        );
        if (speakerBlocks.length > 0) {
            for (var j = 0; j < speakerBlocks.length; j++) {
                var block = speakerBlocks[j];
                var speaker = "";
                var speakerEl = block.querySelector("[class*='speaker-name'], [class*='name'], [class*='avatar'] + span");
                if (speakerEl) speaker = cleanZeroWidth(getNodeText(speakerEl)).trim();
                var text = cleanZeroWidth(getNodeText(block)).trim();
                if (speaker && text.startsWith(speaker)) {
                    text = text.slice(speaker.length).trim();
                }
                if (text) {
                    contentParts.push(speaker ? ("**" + speaker + "**：" + text) : text);
                }
            }
        }

        // 方法B：AI总结区域
        var summarySelectors = [
            "[class*='ai-summary'], [class*='minutes-summary'], [class*='smart-summary']",
            "[class*='key-points'], [class*='action-items']"
        ];
        for (var k = 0; k < summarySelectors.length; k++) {
            var summaryEl = doc.querySelector(summarySelectors[k]);
            if (summaryEl) {
                var summaryText = cleanZeroWidth(getNodeText(summaryEl)).trim();
                if (summaryText.length > 20) {
                    contentParts.unshift("## AI 总结\n\n" + summaryText);
                }
            }
        }

        // 方法C：兜底 - 全页面正文区域
        if (contentParts.length === 0) {
            var bodySelectors = [
                ".minutes-body", ".vc-minutes-body", "[class*='minutes-content']",
                ".main-content", "#content", "main"
            ];
            for (var m = 0; m < bodySelectors.length; m++) {
                var bodyEl = doc.querySelector(bodySelectors[m]);
                if (bodyEl) {
                    var bodyText = cleanZeroWidth(getNodeText(bodyEl)).trim();
                    if (bodyText.length > 50) {
                        contentParts.push(bodyText);
                        break;
                    }
                }
            }
        }

        var articleContent = contentParts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
        if (!articleContent || articleContent.length < 30) return null;

        return {
            type: "article",
            url: cleanFeishuUrl(pageUrl),
            author: extractFeishuAuthor(doc),
            handle: "",
            author_url: "",
            published: "",
            article_title: title,
            article_content: articleContent,
            images: [],
            videos: [],
            platform: "飞书",
        };
    }

    // ─────────────────────────────────────────────
    // 飞书通用页面滚动收集（兼容 minutes 等非 docx 页面）
    // ─────────────────────────────────────────────

    function findFeishuScrollContainer(doc) {
        doc = doc || globalScope.document;
        var candidates = [
            ".bear-web-x-container",
            ".minutes-body", ".vc-minutes-body",
            "[class*='minutes-content']",
            ".main-content",
            "main",
            "#content",
        ];
        for (var i = 0; i < candidates.length; i++) {
            var el = doc.querySelector(candidates[i]);
            if (el && el.scrollHeight > el.clientHeight + 100) return el;
        }
        return null;
    }

    /**
     * 清理飞书页面 URL（仅去除跟踪参数，保留功能性参数和锚点）
     * @param {string} url - 原始 URL
     * @param {boolean} stripAll - 是否去除所有查询参数（仅用于页面规范 URL）
     */
    function cleanFeishuUrl(url, stripAll = true) {
        if (!url) return "";
        try {
            const parsed = new URL(url);
            if (stripAll) {
                parsed.search = "";
                parsed.hash = "";
            } else {
                // 仅去除已知跟踪参数，保留功能性参数
                const trackingParams = ["from", "source", "utm_source", "utm_medium", "utm_campaign", "ccm_ref"];
                trackingParams.forEach(p => parsed.searchParams.delete(p));
            }
            return parsed.href;
        } catch (error) {
            return stripAll ? String(url).replace(/[?#].*$/, "") : String(url);
        }
    }

    function resolveFeishuUrl(url, pageUrl = "") {
        const raw = String(url || "").trim();
        if (!raw) return "";
        if (/^(data|blob|javascript):/i.test(raw)) return "";
        // 绝对 URL 直接返回（不做修改）
        if (/^https?:\/\//i.test(raw)) return raw;
        // 协议相对 URL（//host/path）
        if (/^\/\//.test(raw)) return "https:" + raw;
        // 相对 URL：尝试解析为绝对 URL
        const base = pageUrl || globalScope.location?.href || "";
        if (base) {
            try {
                return new URL(raw, base).href;
            } catch (error) { /* fall through */ }
        }
        // 飞书内部相对路径 fallback：补全飞书域名
        if (/^\/(wiki|docx|docs|sheets|minutes|drive|mindnotes)\//.test(raw)) {
            return "https://feishu.cn" + raw;
        }
        return raw;
    }

    function isFeishuWikiOrDocxPage(locationLike = globalScope.location) {
        const hostname = String(locationLike?.hostname || "").toLowerCase();
        const pathname = String(locationLike?.pathname || "");
        return (hostname.endsWith(".feishu.cn") || hostname.endsWith(".larksuite.com")) &&
            (/^\/wiki\/[^/]+/.test(pathname) || /^\/docx\/[^/]+/.test(pathname));
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
            (Number.isFinite(numericWeight) && numericWeight >= 700);
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
            // 带链接的图片：[![](img)](href)
            if (text.includes("![](")) return `[${text}](${escapeMdLinkUrl(href)})`;
            return `[${escapeMdLinkText(text)}](${escapeMdLinkUrl(href)})`;
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
        const lines = String(text || "").split("\n").map((line) => line.trim());
        // 保留段落间空行（用 "> " 前缀保持 blockquote 连续性）
        const quoted = lines.map((line) => line ? `> ${line}` : `>`);
        // 去掉首尾空引用行
        while (quoted.length && quoted[0] === ">") quoted.shift();
        while (quoted.length && quoted[quoted.length - 1] === ">") quoted.pop();
        return quoted.length ? quoted.join("\n") : "";
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
            // 保留嵌入功能性参数（embed token 等），仅去跟踪参数
            const cleanSrc = cleanFeishuUrl(src, false);
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
            const gfmTable = [header, separator, body].filter(Boolean).join("\n");
            return renderTableDualFormat(gfmTable, !!options.includeHtmlTable);
        }

        if (type === "table_cell") return "";

        if (type === "base_refer") {
            const link = block.querySelector?.("a");
            const href = safeGetAttribute(link, "href") || "";
            const text = cleanZeroWidth(getNodeText(link)).trim() || "多维表格";
            return href ? `[${escapeMdLinkText(text)}](${escapeMdLinkUrl(resolveFeishuUrl(href, options.pageUrl))})` : text;
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

    // options.includeHtmlTable: 是否同时输出 HTML 表格（传递给 extractFeishuBlockMarkdown）
    const LIST_BLOCK_TYPES = new Set(["bullet", "unordered", "ordered", "todo"]);

    function extractFeishuMarkdownFromBlocks(blocks, options = {}) {
        const entries = [];
        for (const block of blocks || []) {
            const markdown = extractFeishuBlockMarkdown(block, options);
            if (!markdown) continue;
            const blockType = safeGetAttribute(block, "data-block-type") || "";
            entries.push({ markdown, isList: LIST_BLOCK_TYPES.has(blockType) });
        }
        if (!entries.length) return "";
        // 智能拼接：连续列表项用 \n（紧凑列表），其他用 \n\n（段落间距）
        let result = entries[0].markdown;
        for (let i = 1; i < entries.length; i++) {
            const sep = (entries[i - 1].isList && entries[i].isList) ? "\n" : "\n\n";
            result += sep + entries[i].markdown;
        }
        return result.replace(/\n{3,}/g, "\n\n").trim();
    }

    function extractFeishuTitle(doc = document) {
        // 第一轮：精确选择器，要求长度 >= 5（避免截断的短片段）
        const selectors = [
            "#ssrHeaderTitle",
            ".note-title__input .header-ssr-layout-component-Title",
            ".note-title__input",
            ".doc-header-title",
            "[data-testid='doc-title']",
            ".suite-title-input",
        ];
        for (const selector of selectors) {
            const el = doc.querySelector?.(selector);
            const text = cleanZeroWidth(getNodeText(el)).trim();
            if (text && text.length >= 5 && text !== "飞书云文档") return text;
        }
        // 第二轮：h1 选择器（可能匹配到非标题元素，取最长的）
        const h1s = doc.querySelectorAll?.("h1") || [];
        let bestH1 = "";
        for (const h1 of h1s) {
            const t = cleanZeroWidth(getNodeText(h1)).trim();
            if (t && t.length > bestH1.length && t !== "飞书云文档" && t !== "飞书") bestH1 = t;
        }
        if (bestH1.length >= 5) return bestH1;
        // 第三轮：document.title 清洗（最可靠的 fallback）
        const docTitle = cleanZeroWidth(String(doc.title || ""))
            .replace(/\s*-\s*飞书云文档\s*$/, "")
            .replace(/\s*-\s*飞书\s*$/, "")
            .trim();
        if (docTitle) return docTitle;
        // 最终 fallback：返回第一轮中任何非空结果（即使短于5字符）
        for (const selector of selectors) {
            const el = doc.querySelector?.(selector);
            const text = cleanZeroWidth(getNodeText(el)).trim();
            if (text && text !== "飞书云文档" && text !== "飞书") return text;
        }
        return bestH1 || "未命名飞书文档";
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
            platform: "飞书",
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
    // pageUrl: 用于将相对链接解析为绝对 URL
    function convertFeishuApiTextElements(elements, pageUrl) {
        let md = "";
        for (const el of elements || []) {
            if (el.text_run) {
                let text = el.text_run.content || "";
                if (!text) continue;
                const style = el.text_run.text_element_style || {};
                if (style.inline_code) text = `\`${text}\``;
                else {
                    if (style.bold && style.italic) text = `***${text}***`;
                    else if (style.bold) text = `**${text}**`;
                    else if (style.italic) text = `*${text}*`;
                    if (style.strikethrough) text = `~~${text}~~`;
                }
                if (style.link && style.link.url) {
                    const escapedText = escapeMdLinkText(text);
                    let linkUrl = style.link.url;
                    try { linkUrl = decodeURIComponent(linkUrl); } catch (e) { /* keep original */ }
                    // 解析相对 URL 为绝对 URL
                    linkUrl = resolveFeishuUrl(linkUrl, pageUrl || "");
                    text = `[${escapedText}](${escapeMdLinkUrl(linkUrl)})`;
                }
                md += text;
            } else if (el.mention_doc) {
                const title = el.mention_doc.title || "文档";
                let url = el.mention_doc.url || "";
                if (url) {
                    try { url = decodeURIComponent(url); } catch (e) { /* keep original */ }
                    url = resolveFeishuUrl(url, pageUrl || "");
                }
                md += url ? `[${escapeMdLinkText(title)}](${escapeMdLinkUrl(url)})` : title;
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
    function convertFeishuApiBlock(block, allBlocks, depth, options) {
        options = options || {};
        if (!block) return "";
        const type = block.block_type;

        // 获取文本内容（text 块和 heading 块共用 text 字段）
        const textElements = block.text?.elements || block.heading?.elements || [];
        const text = convertFeishuApiTextElements(textElements, options.pageUrl);

        // 列表类型集合（API block_type 枚举）
        const API_LIST_TYPES = new Set([12, 13, 16]); // bullet, ordered, todo

        // 递归转换子块，智能拼接：连续列表项用 \n，其他用 \n\n
        function convertChildren(childDepth) {
            const childIds = block.children || [];
            const entries = [];
            for (const id of childIds) {
                const child = allBlocks[id];
                if (!child) continue;
                const md = convertFeishuApiBlock(child, allBlocks, typeof childDepth === "number" ? childDepth : depth, options);
                if (!md) continue;
                entries.push({ markdown: md, isList: API_LIST_TYPES.has(child.block_type) });
            }
            if (!entries.length) return "";
            let result = entries[0].markdown;
            for (let i = 1; i < entries.length; i++) {
                const sep = (entries[i - 1].isList && entries[i].isList) ? "\n" : "\n\n";
                result += sep + entries[i].markdown;
            }
            return result;
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
                            .map(function (id) { return convertFeishuApiBlock(allBlocks[id], allBlocks, 0, options); })
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
                const gfmTable = [header, sep, body].filter(Boolean).join("\n");
                return renderTableDualFormat(gfmTable, !!options.includeHtmlTable);
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

            // 监听从页面上下文返回的结果（验证来源）
            var expectedOrigin = globalScope.location?.origin || "";
            function onMessage(event) {
                if (expectedOrigin && event.origin !== expectedOrigin) return;
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
                    window.postMessage({ type: msgId, result: data }, location.origin);
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
    // options.includeHtmlTable: 是否同时输出 HTML 表格
    function convertFeishuApiDataToMarkdown(apiData, options) {
        if (!apiData) return null;
        options = options || {};

        var blocks = apiData.blocks || {};
        var doc = apiData.document;
        if (!doc || !doc.block_id) return null;

        var rootBlock = blocks[doc.block_id];
        if (!rootBlock) return null;

        // 将 document.children 设为 rootBlock 的 children
        rootBlock.children = doc.children || rootBlock.children || [];

        var md = convertFeishuApiBlock(rootBlock, blocks, 0, options);
        return md ? md.replace(/\n{3,}/g, "\n\n").trim() : null;
    }

    // ─────────────────────────────────────────────
    // 飞书 Messenger 聊天记录提取
    // ─────────────────────────────────────────────

    /**
     * 将飞书消息 body.content JSON 转为 Markdown 文本
     * msg_type: text / post / image / file / media / sticker / share_chat / share_user / system / merge_forward 等
     */
    function convertFeishuMsgContent(msgType, contentJson) {
        if (!contentJson) return "";
        var content;
        try {
            content = typeof contentJson === "string" ? JSON.parse(contentJson) : contentJson;
        } catch (e) {
            return String(contentJson);
        }

        if (msgType === "text") {
            return String(content.text || "").trim();
        }

        if (msgType === "post") {
            // 富文本消息：多语言 → 取第一个可用语言
            var langContent = content.zh_cn || content.en_us || content[Object.keys(content)[0]];
            if (!langContent) return "";
            var parts = [];
            if (langContent.title) parts.push("**" + langContent.title + "**");
            var paragraphs = langContent.content || [];
            for (var p = 0; p < paragraphs.length; p++) {
                var line = "";
                var elements = paragraphs[p] || [];
                for (var e = 0; e < elements.length; e++) {
                    var el = elements[e];
                    if (el.tag === "text") line += el.text || "";
                    else if (el.tag === "a") line += "[" + (el.text || el.href || "") + "](" + (el.href || "") + ")";
                    else if (el.tag === "at") line += "@" + (el.user_name || el.user_id || "");
                    else if (el.tag === "img") line += "![图片](feishu-image://" + (el.image_key || "") + ")";
                    else if (el.tag === "media") line += "[视频/媒体]";
                    else if (el.tag === "emotion") line += el.emoji_type || "[表情]";
                    else line += el.text || "";
                }
                parts.push(line);
            }
            return parts.join("\n").trim();
        }

        if (msgType === "image") {
            return "![图片](feishu-image://" + (content.image_key || "") + ")";
        }

        if (msgType === "file") {
            return "[文件: " + (content.file_name || "未知文件") + "]";
        }

        if (msgType === "media") {
            return "[媒体: " + (content.file_name || "视频/音频") + "]";
        }

        if (msgType === "sticker") {
            return "[表情包]";
        }

        if (msgType === "share_chat") {
            return "[分享群聊: " + (content.chat_name || "") + "]";
        }

        if (msgType === "share_user") {
            return "[分享联系人: " + (content.user_id || "") + "]";
        }

        if (msgType === "system") {
            return "*[系统消息]*";
        }

        if (msgType === "merge_forward") {
            return "[合并转发消息]";
        }

        if (msgType === "interactive") {
            // 卡片消息 — 提取标题和内容
            var title = content.header?.title?.content || "";
            return title ? "[卡片: " + title + "]" : "[卡片消息]";
        }

        // 未知类型 fallback
        return "[" + msgType + " 消息]";
    }

    /**
     * 格式化时间戳为可读格式
     * @param {string|number} ts 毫秒时间戳
     */
    function formatFeishuTimestamp(ts) {
        if (!ts) return "";
        var d = new Date(typeof ts === "string" ? parseInt(ts, 10) : ts);
        if (isNaN(d.getTime())) return "";
        var pad = function (n) { return n < 10 ? "0" + n : String(n); };
        return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " +
            pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    }

    /**
     * 将飞书消息列表转为 Markdown 对话格式
     * @param {Array} messages - 飞书 IM API 消息数组
     * @param {Object} userMap - { open_id: display_name } 映射
     * @param {Object} options
     * @returns {string} Markdown 格式的聊天记录
     */
    function convertFeishuChatToMarkdown(messages, userMap, options) {
        options = options || {};
        if (!messages || messages.length === 0) return "";

        var lines = [];
        var lastDate = "";

        for (var i = 0; i < messages.length; i++) {
            var msg = messages[i];
            if (msg.deleted) continue;

            var senderId = msg.sender?.id || "";
            var senderName = (userMap && userMap[senderId]) || senderId || "未知";
            var time = formatFeishuTimestamp(msg.create_time);
            var dateStr = time.slice(0, 10);

            // 按日期分组
            if (dateStr && dateStr !== lastDate) {
                if (lines.length > 0) lines.push("");
                lines.push("## " + dateStr);
                lines.push("");
                lastDate = dateStr;
            }

            var timeStr = time.slice(11) || "";  // HH:MM:SS
            var content = convertFeishuMsgContent(msg.msg_type || "", msg.body?.content || "");

            // 处理 @mentions — 替换占位符
            if (msg.mentions && content) {
                for (var m = 0; m < msg.mentions.length; m++) {
                    var mention = msg.mentions[m];
                    if (mention.key && mention.name) {
                        content = content.replace(mention.key, "@" + mention.name);
                    }
                }
            }

            if (!content) continue;

            // 多行消息缩进处理
            var contentLines = content.split("\n");
            if (contentLines.length > 1) {
                lines.push("**" + senderName + "** (" + timeStr + "):");
                for (var cl = 0; cl < contentLines.length; cl++) {
                    lines.push("> " + contentLines[cl]);
                }
            } else {
                lines.push("**" + senderName + "** (" + timeStr + "): " + content);
            }
        }

        return lines.join("\n").trim();
    }

    /**
     * 通过 DOM 提取飞书 messenger 页面当前可见的聊天记录（兜底策略）
     * 飞书 messenger 是 React SPA，DOM 结构可能变化，这里用宽泛选择器做 best-effort 提取
     */
    function extractFeishuChatFromDOM(doc) {
        doc = doc || globalScope.document;

        // 尝试获取聊天标题（对话名称/群名）
        var chatTitle = "";
        var titleSelectors = [
            "[class*='chat-header'] [class*='name']",
            "[class*='ChatHeader'] [class*='name']",
            "[class*='header-title']",
            "[class*='chat_name']",
            "[class*='chatName']",
            "[data-testid*='chat-name']",
            "[data-testid*='header-title']",
        ];
        for (var t = 0; t < titleSelectors.length; t++) {
            var titleEl = doc.querySelector(titleSelectors[t]);
            if (titleEl) {
                var tt = cleanZeroWidth(getNodeText(titleEl)).trim();
                if (tt && tt.length >= 2 && tt.length < 100) { chatTitle = tt; break; }
            }
        }
        if (!chatTitle) {
            chatTitle = String(doc.title || "").replace(/\s*-\s*飞书.*$/, "").trim() || "飞书聊天记录";
            console.debug("[x2md] Feishu Chat: 所有标题选择器均未命中，使用 document.title 兜底：" + chatTitle);
        }

        // 尝试多种消息容器选择器
        var messageSelectors = [
            "[class*='message-list'] [class*='message-item']",
            "[class*='MessageList'] [class*='MessageItem']",
            "[class*='msg-list'] [class*='msg-item']",
            "[class*='chat-message']",
            "[data-testid*='message']",
            "[class*='im-message']",
            "[class*='message_content']",
            "[class*='messageContent']",
        ];

        var messageElements = [];
        for (var s = 0; s < messageSelectors.length; s++) {
            var found = doc.querySelectorAll(messageSelectors[s]);
            if (found && found.length > 0) {
                messageElements = Array.from(found);
                break;
            }
        }

        if (messageElements.length === 0) {
            // 所有消息选择器均未命中，记录诊断信息帮助排查飞书 DOM 变更
            console.warn("[x2md] Feishu Chat DOM 提取失败：所有消息选择器均未命中。" +
                "飞书可能已更新 DOM 结构。页面包含的 class 属性样本：",
                Array.from(doc.querySelectorAll("[class]")).slice(0, 30).map(
                    function(el) { return el.tagName.toLowerCase() + "." + el.className.split(/\s+/).slice(0, 3).join("."); }
                )
            );
            return null;
        }

        // 从每个消息元素中提取信息
        var contentParts = [];
        var senderSelectors = [
            "[class*='sender'], [class*='Sender'], [class*='name'], [class*='nickname']",
            "[class*='avatar'] + span, [class*='avatar'] + div",
        ];
        var timeSelectors = [
            "[class*='time'], [class*='Time'], [class*='timestamp'], time",
        ];
        var textSelectors = [
            "[class*='content'], [class*='Content'], [class*='text'], [class*='Text']",
            "[class*='rich-text'], [class*='richText']",
            "p, span",
        ];

        for (var i = 0; i < messageElements.length; i++) {
            var msgEl = messageElements[i];
            var sender = "";
            var time = "";
            var text = "";

            // 发送人
            for (var si = 0; si < senderSelectors.length; si++) {
                var senderEl = msgEl.querySelector(senderSelectors[si]);
                if (senderEl) {
                    sender = cleanZeroWidth(getNodeText(senderEl)).trim();
                    if (sender) break;
                }
            }

            // 时间
            for (var ti = 0; ti < timeSelectors.length; ti++) {
                var timeEl = msgEl.querySelector(timeSelectors[ti]);
                if (timeEl) {
                    time = cleanZeroWidth(getNodeText(timeEl)).trim();
                    if (time) break;
                }
            }

            // 消息内容
            for (var xi = 0; xi < textSelectors.length; xi++) {
                var textEl = msgEl.querySelector(textSelectors[xi]);
                if (textEl) {
                    text = cleanZeroWidth(getNodeText(textEl)).trim();
                    if (text && text.length > 0) break;
                }
            }

            if (!text) {
                text = cleanZeroWidth(getNodeText(msgEl)).trim();
            }

            if (!text) continue;

            var line = "";
            if (sender && time) line = "**" + sender + "** (" + time + "): " + text;
            else if (sender) line = "**" + sender + "**: " + text;
            else if (time) line = "(" + time + ") " + text;
            else line = text;

            contentParts.push(line);
        }

        if (contentParts.length === 0) {
            console.warn("[x2md] Feishu Chat DOM 提取：找到 " + messageElements.length +
                " 个消息元素，但未能从中提取到有效文本内容。内容选择器可能需要更新。");
            return null;
        }

        return {
            type: "article",
            url: cleanFeishuUrl(globalScope.location?.href || ""),
            author: "",
            handle: "",
            author_url: "",
            published: "",
            article_title: chatTitle,
            article_content: contentParts.join("\n\n"),
            images: [],
            videos: [],
            platform: "飞书聊天",
        };
    }

    /**
     * 通过注入页面脚本，调用飞书 messenger 内部 API 获取消息
     * 飞书网页版的 messenger 使用内部 API 加载消息，注入脚本共享 cookies 可以直接调用
     * @returns {Promise<Object|null>} 聊天数据 { chatName, messages: [...], userMap: {...} }
     */
    function fetchFeishuChatViaInternalApi() {
        return new Promise(function (resolve) {
            var msgId = "__x2md_feishu_chat_" + Date.now() + "_" + Math.random().toString(36).slice(2);
            var expectedOrigin = globalScope.location?.origin || "";

            function onMessage(event) {
                if (expectedOrigin && event.origin !== expectedOrigin) return;
                if (event.data && event.data.type === msgId) {
                    globalScope.removeEventListener("message", onMessage);
                    clearTimeout(timer);
                    resolve(event.data.result || null);
                }
            }
            globalScope.addEventListener("message", onMessage);

            var timer = setTimeout(function () {
                globalScope.removeEventListener("message", onMessage);
                resolve(null);
            }, 15000);

            // 注入到页面上下文（共享 cookies 和 JS 全局对象）
            var script = globalScope.document.createElement("script");
            script.textContent = `(function(){
                var msgId = ${JSON.stringify(msgId)};
                var origin = location.origin;

                function sendResult(data) {
                    window.postMessage({ type: msgId, result: data }, location.origin);
                }

                async function run() {
                    try {
                        // 策略1: 尝试从飞书 messenger 全局状态中获取当前聊天ID
                        var chatId = null;
                        var chatName = "";

                        // 从 URL hash 或路径中提取 chat ID
                        var hashMatch = location.hash.match(/chat[_-]?id[=\\/]([a-zA-Z0-9_-]+)/i);
                        if (hashMatch) chatId = hashMatch[1];

                        // 尝试从 URL 路径提取（/messenger/oc_xxx 格式）
                        if (!chatId) {
                            var pathMatch = location.pathname.match(/\\/messenger\\/?(oc_[a-zA-Z0-9]+)/);
                            if (pathMatch) chatId = pathMatch[1];
                        }

                        // 尝试从 URL 参数提取
                        if (!chatId) {
                            var params = new URLSearchParams(location.search);
                            chatId = params.get("chatId") || params.get("chat_id") || params.get("id") || "";
                        }

                        // 尝试从页面全局状态获取（多种可能的全局变量名）
                        if (!chatId) {
                            var stateObjects = [
                                window.__INITIAL_STATE__,
                                window.__STORE__?.getState?.(),
                                window.__NEXT_DATA__?.props?.pageProps,
                            ].filter(Boolean);
                            for (var si = 0; si < stateObjects.length && !chatId; si++) {
                                var state = stateObjects[si];
                                chatId = state.chatId || state.chat_id
                                    || (state.chat && (state.chat.id || state.chat.chatId))
                                    || (state.im && (state.im.chatId || state.im.currentChatId))
                                    || "";
                            }
                        }

                        // 尝试从 DOM 数据属性提取
                        if (!chatId) {
                            var chatEl = document.querySelector("[data-chat-id], [data-chatid], [data-container-id]");
                            if (chatEl) {
                                chatId = chatEl.getAttribute("data-chat-id")
                                    || chatEl.getAttribute("data-chatid")
                                    || chatEl.getAttribute("data-container-id")
                                    || "";
                            }
                        }

                        // 尝试从 React fiber 获取（兼容 React 16/17/18）
                        if (!chatId) {
                            var appRoot = document.querySelector("#root, #app, [id*='messenger']");
                            if (appRoot) {
                                try {
                                    // React 16/17: _reactRootContainer; React 18: __reactFiber$xxx
                                    var fiber = null;
                                    if (appRoot._reactRootContainer) {
                                        fiber = appRoot._reactRootContainer._internalRoot?.current;
                                    } else {
                                        var fiberKey = Object.keys(appRoot).find(function(k) { return k.startsWith("__reactFiber$"); });
                                        if (fiberKey) fiber = appRoot[fiberKey];
                                    }
                                    if (fiber) {
                                        var queue = [fiber];
                                        for (var qi = 0; qi < queue.length && qi < 300; qi++) {
                                            var f = queue[qi];
                                            if (!f) continue;
                                            var fChatId = f.memoizedProps?.chatId || f.memoizedProps?.chat_id
                                                || f.memoizedState?.chatId || f.memoizedState?.chat_id;
                                            if (fChatId) { chatId = fChatId; break; }
                                            if (f.child) queue.push(f.child);
                                            if (f.sibling) queue.push(f.sibling);
                                        }
                                    }
                                } catch(e) {}
                            }
                        }

                        if (!chatId) {
                            sendResult({ error: "no_chat_id", chatId: null });
                            return;
                        }

                        // 获取聊天信息
                        try {
                            var chatResp = await fetch(origin + "/messenger/api/v1/chat/info?chat_id=" + chatId, {
                                credentials: "include"
                            });
                            if (chatResp.ok) {
                                var chatData = await chatResp.json();
                                chatName = chatData?.data?.name || chatData?.data?.chat_name || "";
                            }
                        } catch(e) {}

                        // 获取消息列表（尝试多个可能的内部 API 路径）
                        var messages = null;
                        var userMap = {};
                        var apiPaths = [
                            "/messenger/api/v1/messages?chat_id=" + chatId + "&count=200",
                            "/messenger/api/v1/message/list?chat_id=" + chatId + "&page_size=200",
                            "/api/im/v1/messages?container_id=" + chatId + "&container_id_type=chat&page_size=50",
                            "/messenger/api/messages?chat_id=" + chatId + "&limit=200",
                        ];

                        for (var i = 0; i < apiPaths.length; i++) {
                            try {
                                var resp = await fetch(origin + apiPaths[i], {
                                    credentials: "include",
                                    headers: { "Accept": "application/json" }
                                });
                                if (!resp.ok) continue;
                                var data = await resp.json();
                                // 不同 API 返回格式可能不同
                                var items = data?.data?.items || data?.data?.messages || data?.data?.list || data?.messages || [];
                                if (items.length > 0) {
                                    messages = items;
                                    break;
                                }
                            } catch(e) { continue; }
                        }

                        // 尝试获取群成员名称映射
                        if (chatId) {
                            try {
                                var memberResp = await fetch(origin + "/messenger/api/v1/chat/members?chat_id=" + chatId + "&page_size=100", {
                                    credentials: "include"
                                });
                                if (memberResp.ok) {
                                    var memberData = await memberResp.json();
                                    var members = memberData?.data?.items || memberData?.data?.members || [];
                                    for (var m = 0; m < members.length; m++) {
                                        var member = members[m];
                                        var id = member.open_id || member.user_id || member.id || "";
                                        var name = member.name || member.display_name || member.nickname || "";
                                        if (id && name) userMap[id] = name;
                                    }
                                }
                            } catch(e) {}
                        }

                        sendResult({
                            chatId: chatId,
                            chatName: chatName,
                            messages: messages,
                            userMap: userMap,
                            messageCount: messages ? messages.length : 0,
                        });
                    } catch(e) {
                        console.error("[x2md] Feishu chat fetch failed:", e);
                        sendResult({ error: e.message });
                    }
                }
                run();
            })();`;
            (globalScope.document.head || globalScope.document.documentElement).appendChild(script);
            script.remove();
        });
    }

    const exported = {
        cleanFeishuUrl,
        convertFeishuApiDataToMarkdown,
        convertFeishuChatToMarkdown,
        convertFeishuMsgContent,
        detectFeishuPageType,
        extractFeishuAuthor,
        extractFeishuBlockMarkdown,
        extractFeishuChatFromDOM,
        extractFeishuDocToken,
        extractFeishuDocumentData,
        extractFeishuInlineMarkdown,
        extractFeishuMarkdownFromBlocks,
        extractFeishuMinutesData,
        extractFeishuTitle,
        extractFeishuUpdated,
        fetchFeishuChatViaInternalApi,
        fetchFeishuDocViaApi,
        findFeishuScrollContainer,
        formatFeishuTimestamp,
        isFeishuContentPage,
        isFeishuWikiOrDocxPage,
        neutralizeFeishuCopyProtection,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    globalScope.X2MD = Object.assign(globalScope.X2MD || {}, exported);
    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
