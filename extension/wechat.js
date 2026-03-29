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

        // 语音消息
        if (tag === "mpvoice" || classList.includes("voice_player_inner")) {
            return "\n> [语音消息]\n";
        }

        // 视频号 / 内嵌视频：提取实际 URL 用于下载
        if (tag === "mpvideosnap" || tag === "mp-common-videosnap" ||
            classList.includes("video_channel") || classList.includes("channels_iframe")) {
            const videoUrl = safeGetAttribute(node, "data-url") ||
                safeGetAttribute(node, "data-src") ||
                safeGetAttribute(node, "data-videourl") || "";
            const desc = safeGetAttribute(node, "data-desc") ||
                safeGetAttribute(node, "data-nickname") || "视频号视频";
            if (videoUrl) {
                // 用占位符，server 端会处理下载
                return `\n[MEDIA_VIDEO_URL:${videoUrl}]\n`;
            }
            return `\n> [视频号: ${desc}]\n`;
        }
        if (classList.includes("video_iframe") || (tag === "iframe" && String(node.src || "").includes("v.qq.com"))) {
            const src = safeGetAttribute(node, "data-src") || node.src || "";
            if (src && src.startsWith("http")) {
                return `\n[MEDIA_VIDEO_URL:${src}]\n`;
            }
            return "\n> [视频]\n";
        }
        // 微信原生 video 标签
        if (tag === "video") {
            const src = safeGetAttribute(node, "data-src") || node.src ||
                safeGetAttribute(node, "src") || "";
            if (src && src.startsWith("http")) {
                return `\n[MEDIA_VIDEO_URL:${src}]\n`;
            }
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
            return `[${escapeMdLinkText(text)}](${escapeMdLinkUrl(absHref)})`;
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

        // 表格处理：转换为 GFM pipe table（使用共享函数）
        if (tag === "table") {
            const result = convertTableToGfm(node, convertWechatNodeToMarkdown, options);
            if (result) return result;
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

    function extractWechatVideos(doc = document) {
        const videos = [];
        const seen = new Set();
        // 视频号元素
        const videoEls = doc.querySelectorAll?.(
            "mpvideosnap, mp-common-videosnap, .video_channel, .channels_iframe, " +
            ".video_iframe iframe, video, iframe[src*='v.qq.com'], iframe[src*='channels']"
        ) || [];
        for (const el of videoEls) {
            const url = safeGetAttribute(el, "data-url") || safeGetAttribute(el, "data-src") ||
                safeGetAttribute(el, "data-videourl") || el.src || "";
            if (url && url.startsWith("http") && !seen.has(url)) {
                seen.add(url);
                videos.push(url);
            }
        }
        // 从页面脚本中提取视频 URL（微信经常在 script 里放视频地址）
        const scripts = doc.querySelectorAll?.("script") || [];
        for (const script of scripts) {
            const text = script.textContent || "";
            const matches = text.matchAll(/(?:video_src|mpvideo_src|url_info\.url)\s*[:=]\s*["']([^"']+\.mp4[^"']*)/gi);
            for (const m of matches) {
                let vUrl = m[1].replace(/\\x26/g, "&").replace(/&amp;/g, "&");
                if (vUrl.startsWith("http") && !seen.has(vUrl)) {
                    seen.add(vUrl);
                    videos.push(vUrl);
                }
            }
        }
        return videos;
    }

    function detectWechatPaywall(doc = document) {
        // 付费文章检测
        const payBar = doc.querySelector?.("#js_pay_bar, .pay_content_area, .pay_tips_area, .js_pay_preview_wap");
        const payBtn = doc.querySelector?.(".js_pay_btn, .pay_btn, .weui-btn[data-type='pay']");
        return !!(payBar || payBtn);
    }

    /**
     * 尝试移除微信付费文章的遮罩层，暴露完整内容。
     * 付费文章通过 CSS 隐藏/截断内容区域并覆盖付费提示遮罩。
     * 此函数移除这些限制，让已加载到 DOM 中的完整内容可见并可提取。
     */
    function removeWechatPaywall(doc = document) {
        // 1. 移除付费遮罩层（覆盖在内容区上方的半透明渐变遮罩）
        const overlaySelectors = [
            "#js_pay_bar",
            ".pay_content_area",
            ".pay_tips_area",
            ".js_pay_preview_wap",
            ".pay_wall_wrap",
            ".pay-wall__content",
            ".pay_wall_mask",        // 渐变遮罩
            ".pay_content_mask",     // 内容遮罩
            ".rich_media_pay_area",  // 付费区域包装
        ];
        overlaySelectors.forEach(sel => {
            doc.querySelectorAll?.(sel).forEach(el => {
                el.style.display = "none";
                el.remove();
            });
        });

        // 2. 移除内容区域的高度限制和 overflow:hidden
        const contentArea = doc.querySelector?.("#js_content");
        if (contentArea) {
            contentArea.style.maxHeight = "none";
            contentArea.style.height = "auto";
            contentArea.style.overflow = "visible";
            contentArea.style.webkitLineClamp = "unset";
            contentArea.style.webkitBoxOrient = "unset";
        }

        // 3. 移除 #js_content_cutoff（微信用这个 div 标记截断位置）
        const cutoff = doc.querySelector?.("#js_content_cutoff");
        if (cutoff) {
            cutoff.style.display = "none";
            cutoff.remove();
        }

        // 4. 显示所有被 display:none 隐藏的付费内容区段
        //    微信付费文章将付费内容 section 设为 display:none
        const hiddenSections = doc.querySelectorAll?.("#js_content > section[style*='display'], #js_content > div[style*='display']") || [];
        hiddenSections.forEach(section => {
            if (section.style.display === "none") {
                section.style.display = "";
            }
        });

        // 5. 移除 .rich_media_area_extra 上的截断样式
        const extraArea = doc.querySelector?.(".rich_media_area_extra");
        if (extraArea) {
            extraArea.style.maxHeight = "none";
            extraArea.style.overflow = "visible";
        }

        // 6. 注入 CSS 覆盖微信的付费墙样式
        const style = doc.createElement?.("style");
        if (style) {
            style.textContent = `
                #js_content { max-height: none !important; overflow: visible !important; }
                .pay_content_mask, .pay_wall_mask, #js_pay_bar, .pay_content_area,
                .pay_tips_area, .js_pay_preview_wap, .pay_wall_wrap, .rich_media_pay_area {
                    display: none !important;
                }
                #js_content > section, #js_content > div, #js_content > p {
                    display: block !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                }
            `;
            (doc.head || doc.documentElement)?.appendChild(style);
        }
    }

    function extractWechatDocumentData(doc = document, options = {}) {
        const pageUrl = options.pageUrl || doc.location?.href || globalScope.location?.href || "";
        const root = doc.querySelector?.("#js_content");
        if (!root) return null;

        const isPaid = detectWechatPaywall(doc);

        // 付费文章：先尝试移除遮罩层，暴露完整内容
        if (isPaid) {
            removeWechatPaywall(doc);
        }

        const articleContent = extractWechatMarkdown(root, { pageUrl });
        if (!articleContent && !isPaid) return null;

        const title = extractWechatTitle(doc);
        const author = extractWechatAuthor(doc);

        // 提取 og:article:tag 标签
        const tags = [];
        doc.querySelectorAll?.('meta[property="og:article:tag"], meta[property="article:tag"]').forEach(el => {
            const tag = safeGetAttribute(el, "content");
            if (tag && tag.trim()) tags.push(tag.trim());
        });

        // 提取图片 URL（用于飞书 Bitable 等需要独立图片列表的场景）
        const images = [];
        const imgSeen = new Set();
        root.querySelectorAll?.("img").forEach(img => {
            const src = safeGetAttribute(img, "data-src") || img.currentSrc || img.src || "";
            const width = parseInt(safeGetAttribute(img, "data-w") || safeGetAttribute(img, "width") || "0", 10);
            if (src && src.startsWith("http") && (width === 0 || width >= 20) && !imgSeen.has(src)) {
                imgSeen.add(src);
                images.push(resolveWechatImageUrl(src));
            }
        });

        // 提取视频
        const videos = extractWechatVideos(doc);

        // 付费文章：标记标签，提示已尝试解除遮罩
        let finalContent = articleContent || "";
        if (isPaid) {
            tags.push("付费文章");
            if (!finalContent) {
                finalContent = "> 这是一篇付费文章，遮罩层已移除但未提取到内容（内容可能需要服务端解密）。";
            } else {
                // 已移除遮罩并成功提取到内容，添加来源说明
                finalContent = "> 本文为付费文章，已尝试移除遮罩层提取完整内容。\n\n" + finalContent;
            }
        }

        return {
            type: "article",
            url: cleanWechatUrl(pageUrl),
            author,
            handle: "",
            author_url: "",
            published: extractWechatPublished(doc),
            article_title: title,
            article_content: finalContent,
            images,
            videos,
            platform: "微信公众号",
            tags,
        };
    }

    const exported = {
        cleanWechatUrl,
        convertWechatNodeToMarkdown,
        detectWechatPaywall,
        extractWechatDocumentData,
        extractWechatMarkdown,
        extractWechatVideos,
        isWechatArticlePage,
        removeWechatPaywall,
        resolveWechatImageUrl,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    globalScope.X2MD = Object.assign(globalScope.X2MD || {}, exported);
    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
