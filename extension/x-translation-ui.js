(function (globalScope) {
    const translationHelpers = typeof module !== "undefined" && module.exports
        ? require("./translation_helpers.js")
        : globalScope;
    const applyTranslationOverride = translationHelpers.applyTranslationOverrideToData;
    const {
        escapeHtml,
        hasInlineMarkdownLinks,
        inlineMarkdownToHtml,
        markdownToClipboardHtml,
        markdownToClipboardPlainText,
        plainTextToClipboardHtml,
    } = translationHelpers;
    // ─────────────────────────────────────────────
    // X/Twitter 页面内复制正文按钮
    // ─────────────────────────────────────────────
    const X_INLINE_COPY_BUTTON_CLASS = "__x2md_x_inline_copy_button";
    const X_INLINE_TRANSLATE_BUTTON_CLASS = "__x2md_x_inline_translate_button";
    const X_INLINE_TRANSLATION_BLOCK_CLASS = "__x2md_x_inline_translation_block";
    const X_INLINE_ACTIONS_CONTAINER_CLASS = "__x2md_x_inline_actions_container";
    const X_INLINE_TRANSLATION_STATUS_CLASS = "__x2md_x_inline_translation_status";
    const X_AUTO_TRANSLATE_LONG_PRESS_MS = 650;
    const X_AUTO_TRANSLATE_MAX_CONCURRENCY = 2;
    const X_NATIVE_TRANSLATE_LABELS = [
        "显示翻译",
        "翻译帖子",
        "翻译推文",
        "translate post",
        "translate tweet",
    ];
    const X_NATIVE_SHOW_ORIGINAL_LABELS = [
        "显示原文",
        "show original",
        "show original post",
        "show original tweet",
    ];
    const X_COPY_ICON_URL = globalScope.chrome?.runtime?.getURL?.("icons/copy_5304228.png") || "icons/copy_5304228.png";
    const X_TRANSLATE_ICON_URL = globalScope.chrome?.runtime?.getURL?.("icons/translate_16818360.png") || "icons/translate_16818360.png";
    const X_GROK_BUTTON_SELECTORS = [
        'button[aria-label*="Grok"]',
        'button[aria-label*="grok"]',
        '[role="button"][aria-label*="Grok"]',
        '[role="button"][aria-label*="grok"]',
    ].join(", ");

    let xAutoTranslateEnabled = false;
    let xAutoTranslateScheduled = false;
    const xAutoTranslateDoneKeys = new Set();
    const xAutoTranslateQueuedKeys = new Set();
    const xAutoTranslateQueue = [];
    let xAutoTranslateActiveCount = 0;

    function getLocalArticleTextForCopy(article) {
        if (isNotePageUrl()) {
            const source = getTwitterArticleTranslationSource(document);
            if (source.text) return source.text;
        }

        const ctx = article || document;
        const tweetText = ctx.querySelector('[data-testid="tweetText"]')?.innerText?.trim();
        if (tweetText) return stripLeadingReplyMentions(tweetText);

        const fallback = extractTweetTextBasic(ctx);
        return stripLeadingReplyMentions(fallback || "");
    }

    function getTwitterArticleBodyContainer(scope = document) {
        const ctx = scope || document;
        return ctx.querySelector?.('[data-testid="twitterArticleRichTextView"]') ||
            ctx.querySelector?.('[data-testid="longformRichTextComponent"]') ||
            ctx.querySelector?.('[data-testid="twitterArticleReadView"]') ||
            ctx.querySelector?.('[data-testid="article-content"]') ||
            null;
    }

    function getTwitterArticleTitleElement(scope = document) {
        const ctx = scope || document;
        return ctx.querySelector?.('[data-testid="twitter-article-title"], [data-testid="article-title"], h1') || null;
    }

    function getTwitterArticleTranslationSource(scope = document) {
        const ctx = scope || document;
        const bodyEl = getTwitterArticleBodyContainer(ctx) || getTwitterArticleBodyContainer(document);
        const mainScope = bodyEl?.closest?.('main, [role="main"]') || ctx;
        const titleEl = getTwitterArticleTitleElement(mainScope) || getTwitterArticleTitleElement(ctx);
        return buildArticleTranslationSource({
            title: titleEl?.innerText || "",
            body: bodyEl?.innerText || "",
        });
    }

    function isTwitterArticleTranslationScope(scope = document) {
        const ctx = scope || document;
        if (ctx !== document) {
            return !!getTwitterArticleBodyContainer(ctx);
        }
        return isNotePageUrl() || !!getTwitterArticleBodyContainer(document);
    }

    function findVisibleTranslationBlock(scope = document) {
        const ctx = scope || document;
        const block = ctx.querySelector?.(`.${X_INLINE_TRANSLATION_BLOCK_CLASS}`);
        if (!block || block.style.display === "none") return null;
        return block;
    }

    function getDisplayedTranslationContentForCopy(scope = document) {
        const override = getElementTranslationOverride(scope) || findDescendantTranslationOverride(scope);
        const overrideText = String(override?.text || override?.article_content || "").trim();
        if (overrideText) return { text: overrideText, html: plainTextToClipboardHtml(overrideText), source: "visible_translation" };

        const block = findVisibleTranslationBlock(scope);
        const text = block?.innerText?.trim() || "";
        if (!text) return null;
        return { text, html: plainTextToClipboardHtml(text), source: "visible_translation" };
    }

    function buildCopyContentPayload(article, triggerButton) {
        const ctx = article || document;
        const noteArticleUrl = detectNoteUrl(ctx);
        const { url: tweetUrl } = findTweetUrl(triggerButton || ctx);
        const localText = getLocalArticleTextForCopy(article);

        return {
            type: noteArticleUrl ? "note" : "tweet",
            url: tweetUrl || location.href.split("?")[0],
            note_article_url: noteArticleUrl || "",
            text: localText,
            graphql_operation_ids: extractDiscoveredGraphQLOperationIds(),
        };
    }

    function requestBackgroundCopyText(payload) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: "copy_content_text", data: payload }, (resp) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                if (!resp?.success || !resp.text) {
                    reject(new Error(resp?.error || "empty copy text"));
                    return;
                }
                resolve({ text: resp.text, markdown: resp.markdown || "", source: resp.source || "" });
            });
        });
    }

            function normalizeRemoteCopyContent(remoteContent) {
        const text = String(remoteContent?.text || "").trim();
        const markdown = String(remoteContent?.markdown || "").trim();
        if (markdown) {
            return {
                text: text || markdownToClipboardPlainText(markdown),
                html: markdownToClipboardHtml(markdown),
                source: remoteContent.source || "remote",
            };
        }
        if (hasInlineMarkdownLinks(text)) {
            return {
                text: markdownToClipboardPlainText(text),
                html: markdownToClipboardHtml(text),
                source: remoteContent?.source || "remote",
            };
        }
        return {
            text,
            html: text ? plainTextToClipboardHtml(text) : "",
            source: remoteContent?.source || "remote",
        };
    }

    function isCopyScopeShowingTranslatedTweet(scope = document) {
        const target = getTranslationTarget(scope);
        if (!target || target.kind !== "tweet") return false;
        if (targetHasVisibleTranslation(target)) return true;
        return !!findNativeTwitterTranslationControl(scope, "original");
    }

    async function requestBackgroundTweetTranslationForCopy(payload) {
        const tweetId = extractTweetIdFromUrl(payload?.url || "");
        if (!tweetId) return null;
        const result = await requestBackgroundTweetTranslation({
            url: payload.url,
            tweetId,
        });
        const text = String(result?.translatedText || "").trim();
        if (!text) return null;
        return {
            text,
            html: plainTextToClipboardHtml(text),
            source: "tweet_translation_api",
        };
    }

    async function resolveContentForCopy(article, triggerButton) {
        const scope = article || document;
        await expandCollapsedTweetText(scope);

        const payload = buildCopyContentPayload(article, triggerButton);
        const visibleTranslation = getDisplayedTranslationContentForCopy(article || document) ||
            (article && article !== document ? getDisplayedTranslationContentForCopy(document) : null);

        if (isCopyScopeShowingTranslatedTweet(scope)) {
            try {
                const translatedContent = await requestBackgroundTweetTranslationForCopy(payload);
                if (translatedContent?.text) return translatedContent;
            } catch (error) {
                console.warn("[x2md] 后台提取 X 译文失败，回退当前显示译文：", error);
            }
            if (visibleTranslation?.text) return visibleTranslation;
        }

        if (visibleTranslation?.text) {
            return visibleTranslation;
        }

        if (payload.note_article_url || payload.url?.includes("/status/")) {
            try {
                const remoteContent = await requestBackgroundCopyText(payload);
                if (remoteContent?.text) {
                    return normalizeRemoteCopyContent(remoteContent);
                }
            } catch (error) {
                console.warn("[x2md] 后台提取 X 正文失败，回退当前 DOM：", error);
            }
        }

        const text = payload.text || getLocalArticleTextForCopy(article);
        return { text, html: text ? plainTextToClipboardHtml(text) : "" };
    }

                    function copyHtmlViaSelection(html, text) {
        const container = document.createElement("div");
        container.contentEditable = "true";
        container.innerHTML = html || escapeHtml(text).replace(/\n/g, "<br>");
        Object.assign(container.style, {
            position: "fixed",
            top: "-9999px",
            left: "-9999px",
            opacity: "0",
            pointerEvents: "none",
        });
        document.body.appendChild(container);

        const range = document.createRange();
        range.selectNodeContents(container);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const ok = document.execCommand("copy");
        selection.removeAllRanges();
        container.remove();
        if (!ok) throw new Error("copy command failed");
    }

    async function copyContentToClipboard(content) {
        const text = String(content?.text || "").trim();
        const html = String(content?.html || "").trim();
        if (!text) throw new Error("empty text");

        if (html && navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
            await navigator.clipboard.write([
                new ClipboardItem({
                    "text/html": new Blob([html], { type: "text/html" }),
                    "text/plain": new Blob([text], { type: "text/plain" }),
                }),
            ]);
            return;
        }

        if (html) {
            copyHtmlViaSelection(html, text);
            return;
        }

        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        copyHtmlViaSelection("", text);
    }

    function extractTweetIdFromUrl(url) {
        return String(url || "").match(/\/status\/(\d+)/)?.[1] || "";
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function findExpandableTweetTextControls(scope = document) {
        const ctx = scope || document;
        const controls = [];
        for (const el of ctx.querySelectorAll?.('button, [role="button"]') || []) {
            if (el.closest(`.${X_INLINE_TRANSLATION_BLOCK_CLASS}`)) continue;
            const text = (el.innerText || el.textContent || el.getAttribute?.("aria-label") || "").trim();
            if (isExpandableTweetTextControl(text)) controls.push(el);
        }
        return controls;
    }

    async function expandCollapsedTweetText(scope = document) {
        const ctx = scope || document;
        const textRoot = ctx === document ? document.body : ctx;
        const beforeText = normalizeSpaces(textRoot?.innerText || textRoot?.textContent || "");
        const controls = findExpandableTweetTextControls(ctx);
        if (!controls.length) return 0;

        let clicked = 0;
        for (const control of controls.slice(0, 3)) {
            try {
                control.click();
                clicked++;
            } catch (error) { }
        }

        if (!clicked) return 0;

        const started = Date.now();
        while (Date.now() - started < 1200) {
            await delay(120);
            const afterText = normalizeSpaces(textRoot?.innerText || textRoot?.textContent || "");
            const remainingControls = findExpandableTweetTextControls(ctx).filter((el) => el.isConnected !== false);
            if (!remainingControls.length || afterText.length > beforeText.length + 8) break;
        }

        return clicked;
    }

    function normalizeControlText(text) {
        return normalizeSpaces(text || "").replace(/\s+/g, " ").trim();
    }

    function getTwitterControlText(el) {
        if (!el) return "";
        return normalizeControlText(el.innerText || el.textContent || el.getAttribute?.("aria-label") || "");
    }

    function matchesNativeTwitterTranslationLabel(text, mode = "translate") {
        const value = normalizeControlText(text);
        const lower = value.toLowerCase();
        const labels = mode === "original" ? X_NATIVE_SHOW_ORIGINAL_LABELS : X_NATIVE_TRANSLATE_LABELS;
        return labels.includes(value) || labels.includes(lower);
    }

    function findNativeTwitterTranslationControl(scope = document, mode = "translate") {
        const ctx = scope || document;
        const controls = ctx.querySelectorAll?.('button, [role="button"]') || [];
        for (const el of controls) {
            if (el.classList?.contains(X_INLINE_TRANSLATE_BUTTON_CLASS)) continue;
            if (el.closest?.(`.${X_INLINE_TRANSLATE_BUTTON_CLASS}, .${X_INLINE_ACTIONS_CONTAINER_CLASS}, .${X_INLINE_TRANSLATION_BLOCK_CLASS}`)) continue;
            if (el.closest?.('[data-testid="simpleTweet"]')) continue;

            const text = getTwitterControlText(el);
            if (matchesNativeTwitterTranslationLabel(text, mode)) return el;
        }
        return null;
    }

    function clearTranslationMark(el) {
        if (!el) return;
        delete el.__x2md_translation_override;
        el.removeAttribute?.("data-x2md-translated");
    }

    function clearNativeTwitterTranslationOverride(scope = document) {
        const target = getTranslationTarget(scope);
        if (target?.textEl?.__x2md_translation_override?.source === "twitter_native") {
            clearTranslationMark(target.textEl);
        }
    }

    function markNativeTwitterTranslation(scope = document) {
        const target = getTranslationTarget(scope);
        if (!target || target.kind !== "tweet" || !target.textEl || !target.text) return false;
        markElementTranslated(target.textEl, {
            type: "tweet",
            text: target.text,
            source: "twitter_native",
        });
        return true;
    }

    async function waitForNativeTwitterTranslationState(scope = document, mode = "original", timeoutMs = 6000) {
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
            if (findNativeTwitterTranslationControl(scope, mode)) return true;
            await delay(120);
        }
        return false;
    }

    async function showNativeTwitterTranslation(scope = document) {
        const target = getTranslationTarget(scope);
        if (!target || target.kind !== "tweet") return "";

        if (findNativeTwitterTranslationControl(scope, "original")) {
            markNativeTwitterTranslation(scope);
            return "cached";
        }

        const nativeTranslateButton = findNativeTwitterTranslationControl(scope, "translate");
        if (!nativeTranslateButton) return "";

        nativeTranslateButton.click();
        const translated = await waitForNativeTwitterTranslationState(scope, "original");
        if (!translated) return "";

        return markNativeTwitterTranslation(scope) ? "translated" : "";
    }

    async function toggleNativeTwitterTranslation(scope = document) {
        const target = getTranslationTarget(scope);
        if (!target || target.kind !== "tweet") return "";

        const showOriginalButton = findNativeTwitterTranslationControl(scope, "original");
        if (showOriginalButton) {
            showOriginalButton.click();
            await waitForNativeTwitterTranslationState(scope, "translate", 3000);
            clearNativeTwitterTranslationOverride(scope);
            return "original";
        }

        return await showNativeTwitterTranslation(scope);
    }

    function findMainTweetTextElement(article, options = {}) {
        const ctx = article || document;
        for (const el of ctx.querySelectorAll('[data-testid="tweetText"]')) {
            if (!options.includeQuote && el.closest('[data-testid="simpleTweet"]')) continue;
            if (!options.includeQuote && el.closest('[data-x2md-quote-container="1"]')) continue;
            if (el.closest(`.${X_INLINE_TRANSLATION_BLOCK_CLASS}`)) continue;
            return el;
        }
        return null;
    }

    function isQuoteTweetLabel(text) {
        return /^(?:引用|Quote)$/i.test(normalizeSpaces(text || ""));
    }

    function findQuoteContainerFromLabel(labelEl, root) {
        let current = labelEl?.parentElement || null;
        while (current && current !== root && current !== document.body) {
            const text = normalizeSpaces(current.innerText || current.textContent || "");
            const rect = getVisibleRect(current);
            const hasQuoteContent = !!current.querySelector?.('[data-testid="User-Name"], [data-testid="tweetText"]') ||
                !!findTwitterArticleCardContainer(current);
            if (rect && rect.width > 220 && rect.height > 40 && hasQuoteContent && !current.matches?.('article[data-testid="tweet"]')) {
                current.setAttribute?.("data-x2md-quote-container", "1");
                return current;
            }
            if (text.length > 2000) break;
            current = current.parentElement;
        }
        return null;
    }

    function findQuoteTweetContainer(scope = document) {
        const ctx = scope || document;
        const simple = ctx.querySelector?.('[data-testid="simpleTweet"]');
        if (simple) {
            simple.setAttribute?.("data-x2md-quote-container", "1");
            return simple;
        }

        for (const el of ctx.querySelectorAll?.("span, div") || []) {
            if (!isQuoteTweetLabel(el.innerText || el.textContent || "")) continue;
            const quote = findQuoteContainerFromLabel(el, ctx);
            if (quote) return quote;
        }
        return null;
    }

    function findQuoteTweetTranslationTarget(scope = document) {
        const quote = findQuoteTweetContainer(scope);
        if (!quote) return null;
        const textEl = findMainTweetTextElement(quote, { includeQuote: true });
        if (!textEl) return null;
        const text = stripLeadingReplyMentions(textEl.innerText || "");
        if (!text) return null;

        return {
            kind: "quote_tweet",
            scope: quote,
            quoteEl: quote,
            insertAfter: textEl,
            originalEls: [textEl],
            textEl,
            text,
            url: findFirstStatusUrl(quote),
            tweetId: extractTweetIdFromUrl(findFirstStatusUrl(quote)),
        };
    }

    function isTwitterArticleCardLabel(text) {
        return /^(?:X\s*)?文章$|^Article$/i.test(normalizeSpaces(text || ""));
    }

    function getVisibleRect(el) {
        const rect = el?.getBoundingClientRect?.();
        if (!rect || rect.width <= 0 || rect.height <= 0) return null;
        return rect;
    }

    function meaningfulArticleCardText(el) {
        const text = normalizeSpaces(el?.innerText || el?.textContent || "");
        if (!text || text.length < 2) return "";
        if (isTwitterArticleCardLabel(text)) return "";
        if (/^(?:Download|⊘|🖋️|\d+|[\d.,]+万|[\d.,]+k)$/i.test(text)) return "";
        return text;
    }

    function elementHasDivergentTextChild(el, ownText) {
        for (const child of Array.from(el?.children || [])) {
            if (child.tagName !== "DIV") continue;
            const childText = meaningfulArticleCardText(child);
            if (childText && childText !== ownText) return true;
        }
        return false;
    }

    function findTwitterArticleCardContainer(scope = document) {
        const ctx = scope || document;
        const candidates = [];

        for (const el of ctx.querySelectorAll?.("div") || []) {
            if (el.closest?.('[data-testid="User-Name"], [role="group"], [data-testid="tweetText"]')) continue;
            const text = normalizeSpaces(el.innerText || "");
            const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
            if (lines.length < 3 || !isTwitterArticleCardLabel(lines[0])) continue;
            const rect = getVisibleRect(el);
            if (!rect || rect.width < 220 || rect.height < 80) continue;
            candidates.push({ el, area: rect.width * rect.height });
        }

        candidates.sort((left, right) => left.area - right.area);
        return candidates[0]?.el || null;
    }

    function findTwitterArticleCardTextBlocks(cardEl) {
        if (!cardEl) return [];

        const blocks = [];
        const seen = new Set();
        for (const el of cardEl.querySelectorAll?.("div") || []) {
            if (el.closest?.(`.${X_INLINE_TRANSLATION_BLOCK_CLASS}`)) continue;
            const text = meaningfulArticleCardText(el);
            if (!text || text.length < 6) continue;
            if (text === meaningfulArticleCardText(cardEl)) continue;
            if (elementHasDivergentTextChild(el, text)) continue;

            const rect = getVisibleRect(el);
            if (!rect) continue;
            if (seen.has(text)) continue;
            seen.add(text);
            blocks.push({ el, text, top: rect.top, left: rect.left });
        }

        blocks.sort((left, right) => left.top === right.top ? left.left - right.left : left.top - right.top);
        return blocks.map((item) => item.el).slice(0, 2);
    }

    function getTwitterArticleCardTranslationTarget(scope = document) {
        const ctx = scope || document;
        const cardEl = findTwitterArticleCardContainer(ctx);
        const blocks = findTwitterArticleCardTextBlocks(cardEl);
        if (!cardEl || !blocks.length) return null;

        const titleEl = blocks[0] || null;
        const bodyEl = blocks[1] || null;
        const articleTitle = meaningfulArticleCardText(titleEl);
        const articleBody = meaningfulArticleCardText(bodyEl);
        const text = [articleTitle, articleBody].filter(Boolean).join("\n\n");
        if (!text) return null;

        return {
            kind: "article_card",
            scope: ctx,
            cardEl,
            insertAfter: bodyEl || titleEl || cardEl,
            originalEls: [titleEl, bodyEl].filter(Boolean),
            titleEl,
            bodyEl,
            articleTitle,
            articleBody,
            text,
            url: findFirstStatusUrl(cardEl) || findFirstStatusUrl(ctx),
            tweetId: extractTweetIdFromUrl(findFirstStatusUrl(cardEl) || findFirstStatusUrl(ctx)),
        };
    }

    function getTranslationTarget(scope = document) {
        const ctx = scope || document;
        if (isTwitterArticleTranslationScope(ctx)) {
            const bodyEl = getTwitterArticleBodyContainer(document);
            const mainScope = bodyEl?.closest?.('main, [role="main"]') || document;
            const titleEl = getTwitterArticleTitleElement(mainScope);
            if (bodyEl) {
                const source = getTwitterArticleTranslationSource(document);
                return {
                    kind: "article",
                    scope: document,
                    insertAfter: titleEl || bodyEl,
                    originalEls: [titleEl, bodyEl].filter(Boolean),
                    titleEl,
                    bodyEl,
                    articleTitle: source.title,
                    articleBody: source.body,
                    text: source.text,
                };
            }
        }

        const tweetTextEl = findMainTweetTextElement(ctx);
        if (tweetTextEl) {
            return {
                kind: "tweet",
                scope: ctx,
                insertAfter: tweetTextEl,
                originalEls: [tweetTextEl],
                textEl: tweetTextEl,
                text: stripLeadingReplyMentions(tweetTextEl.innerText || ""),
            };
        }

        const articleCardTarget = getTwitterArticleCardTranslationTarget(ctx);
        if (articleCardTarget) return articleCardTarget;

        return null;
    }

    function markElementTranslated(el, override) {
        if (!el || !override) return;
        el.__x2md_translation_override = override;
        el.setAttribute?.("data-x2md-translated", "1");
    }

    function getElementTranslationOverride(el) {
        let current = el;
        while (current && current !== globalScope.document?.documentElement) {
            if (current.__x2md_translation_override) return current.__x2md_translation_override;
            current = current.parentElement;
        }
        return null;
    }

    function findDescendantTranslationOverride(scope) {
        const translated = scope?.querySelector?.('[data-x2md-translated="1"]');
        return translated?.__x2md_translation_override || null;
    }

    function restoreTranslatedElement(el) {
        if (!el || el.__x2md_original_html === undefined) return false;
        el.innerHTML = el.__x2md_original_html;
        delete el.__x2md_original_html;
        delete el.__x2md_translation_override;
        el.removeAttribute?.("data-x2md-translated");
        return true;
    }

    function replaceElementTextWithTranslation(el, translatedText, override) {
        if (!el || !translatedText) return false;
        if (el.__x2md_original_html === undefined) {
            el.__x2md_original_html = el.innerHTML;
        }
        el.innerHTML = escapeHtml(translatedText).replace(/\n/g, "<br>");
        markElementTranslated(el, override || { type: "tweet", text: translatedText });
        return true;
    }

    function sanitizeTwitterNativeTranslationHtml(html) {
        const source = String(html || "").trim();
        if (!source) return "";

        const template = document.createElement("template");
        template.innerHTML = source;

        const allowedTags = new Set(["SPAN", "A", "IMG", "BR", "B", "STRONG", "I", "EM", "S"]);
        const allowedAttrs = {
            SPAN: new Set(["class", "dir", "aria-hidden"]),
            A: new Set(["class", "dir", "href", "rel", "target", "role", "aria-hidden", "style"]),
            IMG: new Set(["class", "alt", "src", "title", "draggable", "aria-hidden"]),
            BR: new Set([]),
            B: new Set(["class"]),
            STRONG: new Set(["class"]),
            I: new Set(["class"]),
            EM: new Set(["class"]),
            S: new Set(["class"]),
        };

        const cleanNode = (node) => {
            if (node.nodeType === Node.TEXT_NODE) return;
            if (node.nodeType !== Node.ELEMENT_NODE) {
                node.remove();
                return;
            }

            if (!allowedTags.has(node.tagName)) {
                node.replaceWith(document.createTextNode(node.textContent || ""));
                return;
            }

            const tagAttrs = allowedAttrs[node.tagName] || new Set();
            for (const attr of Array.from(node.attributes || [])) {
                if (!tagAttrs.has(attr.name)) {
                    node.removeAttribute(attr.name);
                    continue;
                }
                if ((attr.name === "href" || attr.name === "src") && !/^https?:\/\//i.test(attr.value)) {
                    node.removeAttribute(attr.name);
                }
                if (attr.name === "style" && !/^color:\s*rgb\(29,\s*155,\s*240\);?$/i.test(attr.value.trim())) {
                    node.removeAttribute(attr.name);
                }
            }

            for (const child of Array.from(node.childNodes)) cleanNode(child);
        };

        for (const child of Array.from(template.content.childNodes)) cleanNode(child);
        return template.innerHTML.trim();
    }

    function decodeHtmlEntities(text) {
        const textarea = document.createElement("textarea");
        textarea.innerHTML = String(text || "");
        return textarea.value;
    }

    function escapeRegExp(text) {
        return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    function uniqueNonEmpty(values) {
        return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean)));
    }

    function normalizeInlineLinkText(text) {
        return String(text || "").replace(/\s+/g, "");
    }

    function makeLooseInlineTextPattern(text) {
        const compact = normalizeInlineLinkText(text);
        if (!compact) return "";
        return compact
            .split("")
            .map((char) => escapeRegExp(char))
            .join("\\s*");
    }

    function cleanupTranslationMentionLineBreaks(text, descriptors = []) {
        let result = String(text || "");
        const mentions = descriptors
            .filter((item) => item.type === "mention")
            .map((item) => item.displayText)
            .filter(Boolean)
            .sort((left, right) => right.length - left.length);

        for (const mention of mentions) {
            const pattern = makeLooseInlineTextPattern(mention);
            if (!pattern) continue;
            result = result.replace(new RegExp(`\\n\\s*(${pattern})\\s*\\n`, "gi"), " $1 ");
            result = result.replace(new RegExp(`\\n\\s*(${pattern})(?=[\\s\\u3000，,。.！!？?；;：:])`, "gi"), " $1");
            result = result.replace(new RegExp(`([\\s\\u3000，,。.！!？?；;：:])(${pattern})\\s*\\n`, "gi"), "$1$2 ");
        }

        return result
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/[ \t]{2,}/g, " ");
    }

    function buildOriginalTweetLinkDescriptors(tweetTextEl) {
        const descriptors = [];
        for (const anchor of tweetTextEl?.querySelectorAll?.("a[href]") || []) {
            const href = anchor.href || "";
            const rawHref = anchor.getAttribute("href") || "";
            let absoluteRawHref = rawHref;
            try {
                absoluteRawHref = new URL(rawHref, location.origin).href;
            } catch (error) { }

            const visibleText = normalizeSpaces(anchor.innerText || anchor.textContent || "");
            const compactVisibleText = normalizeInlineLinkText(visibleText);
            const isMentionOrHash = /^[@#]/.test(visibleText);
            const isUrlLike = /^https?:\/\//i.test(href) || /^https?:\/\//i.test(absoluteRawHref) || href.includes("t.co/");

            const candidates = uniqueNonEmpty([
                href,
                absoluteRawHref,
                href.replace(/^http:\/\//i, "https://"),
                absoluteRawHref.replace(/^http:\/\//i, "https://"),
                isMentionOrHash ? visibleText : "",
                isUrlLike ? compactVisibleText : "",
            ]).sort((left, right) => right.length - left.length);

            if (!candidates.length) continue;

            const clone = anchor.cloneNode(true);
            clone.setAttribute("href", href || absoluteRawHref);
            clone.setAttribute("rel", "noopener noreferrer nofollow");
            clone.setAttribute("target", "_blank");

            descriptors.push({
                candidates,
                html: sanitizeTwitterNativeTranslationHtml(clone.outerHTML),
                displayText: visibleText,
                type: isMentionOrHash ? "mention" : (isUrlLike ? "url" : "link"),
            });
        }
        return descriptors.filter((item) => item.html);
    }

    function buildNativeLikeTweetTranslationHtml(translatedText, originalTweetTextEl) {
        let text = decodeHtmlEntities(translatedText)
            .replace(/\r\n/g, "\n")
            .trim();
        if (!text) return { text: "", html: "" };

        const descriptors = buildOriginalTweetLinkDescriptors(originalTweetTextEl);
        text = cleanupTranslationMentionLineBreaks(text, descriptors);

        const tokens = [];
        for (const descriptor of descriptors) {
            for (const candidate of descriptor.candidates) {
                if (!candidate) continue;
                const token = `\uE000${tokens.length}\uE001`;
                const pattern = descriptor.type === "mention"
                    ? makeLooseInlineTextPattern(candidate)
                    : escapeRegExp(candidate);
                const re = new RegExp(pattern, "g");
                if (!re.test(text)) continue;
                text = text.replace(re, token);
                tokens.push({ token, html: descriptor.html });
                break;
            }
        }

        let html = escapeHtml(text).replace(/\n/g, "<br>");
        for (const item of tokens) {
            html = html.split(item.token).join(item.html);
        }

        return {
            text: text.replace(/\uE000\d+\uE001/g, (token) => {
                const item = tokens.find((entry) => entry.token === token);
                if (!item) return "";
                const template = document.createElement("template");
                template.innerHTML = item.html;
                return template.content.textContent || "";
            }).trim(),
            html,
        };
    }

    function replaceElementWithNativeTranslation(el, translation, override) {
        const translatedText = String(translation?.text || "").trim();
        if (!el || !translatedText) return false;
        if (el.__x2md_original_html === undefined) {
            el.__x2md_original_html = el.innerHTML;
        }

        const safeHtml = sanitizeTwitterNativeTranslationHtml(translation.html);
        el.innerHTML = safeHtml || escapeHtml(translatedText).replace(/\n/g, "<br>");
        markElementTranslated(el, override || { type: "tweet", text: translatedText, source: "twitter_native" });
        return true;
    }

    function showOriginalTranslationTargets(scope = document) {
        const target = getTranslationTarget(scope);
        if (!target) return false;

        if (target.kind === "article") {
            let restored = false;
            if (target.titleEl) restored = restoreTranslatedElement(target.titleEl) || restored;
            for (const block of getArticleTranslatableTextBlocks(target.bodyEl)) {
                restored = restoreTranslatedElement(block) || restored;
            }
            if (target.bodyEl) {
                delete target.bodyEl.__x2md_translation_override;
                target.bodyEl.removeAttribute?.("data-x2md-translated");
            }
            return restored;
        }

        if (target.kind === "article_card") {
            let restored = false;
            if (target.titleEl) restored = restoreTranslatedElement(target.titleEl) || restored;
            if (target.bodyEl) restored = restoreTranslatedElement(target.bodyEl) || restored;
            if (target.cardEl) {
                delete target.cardEl.__x2md_translation_override;
                target.cardEl.removeAttribute?.("data-x2md-translated");
            }
            return restored;
        }

        if (target.kind === "quote_tweet") {
            let restored = restoreTranslatedElement(target.textEl);
            if (target.quoteEl) {
                delete target.quoteEl.__x2md_translation_override;
                target.quoteEl.removeAttribute?.("data-x2md-translated");
            }
            return restored;
        }

        return restoreTranslatedElement(target.textEl);
    }

    function targetHasVisibleTranslation(target) {
        if (!target) return false;
        if (target.kind === "article") {
            if (target.titleEl?.__x2md_translation_override) return true;
            return getArticleTranslatableTextBlocks(target.bodyEl).some((block) => !!block.__x2md_translation_override);
        }
        if (target.kind === "article_card") {
            return !!target.titleEl?.__x2md_translation_override || !!target.bodyEl?.__x2md_translation_override;
        }
        if (target.kind === "quote_tweet") {
            return !!target.textEl?.__x2md_translation_override;
        }
        return !!target.textEl?.__x2md_translation_override;
    }

    function toggleExistingInlineTranslation(scope = document) {
        const target = getTranslationTarget(scope);
        if (!target || !targetHasVisibleTranslation(target)) return "";
        showOriginalTranslationTargets(scope);
        return "original";
    }

    function requestBackgroundTweetTranslation(payload) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: "translate_tweet", data: payload }, (resp) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                if (!resp?.success || !resp.translatedText) {
                    reject(new Error(resp?.error || "empty translation"));
                    return;
                }
                resolve({ translatedText: resp.translatedText, tweetId: resp.tweetId || payload.tweetId || "" });
            });
        });
    }

    function requestBackgroundTextTranslation(payload) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({ action: "translate_text", data: payload }, (resp) => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                    return;
                }
                if (!resp?.success || !resp.translatedText) {
                    reject(new Error(resp?.error || "empty translation"));
                    return;
                }
                resolve({ translatedText: resp.translatedText });
            });
        });
    }

    function createNativeLikeTranslationBlock(target) {
        if (!target?.insertAfter?.parentElement) return null;
        let block = target.insertAfter.parentElement.querySelector?.(`:scope > .${X_INLINE_TRANSLATION_BLOCK_CLASS}`);
        if (block) return block;

        block = document.createElement("div");
        block.className = X_INLINE_TRANSLATION_BLOCK_CLASS;
        Object.assign(block.style, {
            marginTop: "0px",
            marginBottom: "0px",
            color: "rgb(83, 100, 113)",
            fontSize: "13px",
            lineHeight: "1.35",
            whiteSpace: "pre-wrap",
        });

        block.innerHTML = `<div data-x2md-role="translated-status" class="${X_INLINE_TRANSLATION_STATUS_CLASS}" style="display:none;color:rgb(83,100,113);font-size:13px;line-height:1.35;"></div>`;
        target.insertAfter.insertAdjacentElement("afterend", block);
        return block;
    }

    function setInlineTranslationStatus(scope, message) {
        const target = getTranslationTarget(scope);
        if (!target) return false;
        const block = createNativeLikeTranslationBlock(target);
        const statusEl = block?.querySelector('[data-x2md-role="translated-status"]');
        if (!statusEl) return false;
        statusEl.textContent = message || "";
        statusEl.style.display = message ? "block" : "none";
        block.style.display = message ? "block" : "none";
        return true;
    }

    function clearInlineTranslationStatus(scope) {
        const target = getTranslationTarget(scope);
        const block = target?.insertAfter?.parentElement?.querySelector?.(`:scope > .${X_INLINE_TRANSLATION_BLOCK_CLASS}`);
        if (block) block.remove();
    }

    function articleBlockText(block) {
        return String(block?.innerText || block?.textContent || "").trim();
    }

    function isArticleTextBlockCandidate(el, bodyEl) {
        if (!el || el.nodeType !== 1 || !bodyEl?.contains?.(el)) return false;
        if (el.closest?.('[data-testid="simpleTweet"], article[data-testid="tweet"], [data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"], [data-testid="User-Name"]')) return false;
        if (el.querySelector?.('img, video, [data-testid="simpleTweet"], article[data-testid="tweet"], [data-testid="tweetPhoto"], [data-testid="videoComponent"], [data-testid="videoPlayer"]')) return false;
        const text = articleBlockText(el);
        if (!text || text.length < 2) return false;
        if (/^(想发布自己的文章|升级为\s*Premium|Want to publish your own article)/i.test(text)) return false;
        return true;
    }

    function getArticleTextLeafBlocks(bodyEl) {
        if (!bodyEl || typeof document.createTreeWalker !== "function") return [];
        const blocks = [];
        const seen = new Set();
        const walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                const text = String(node.textContent || "").trim();
                if (text.length < 2) return NodeFilter.FILTER_REJECT;
                const parent = node.parentElement;
                if (!parent || !bodyEl.contains(parent)) return NodeFilter.FILTER_REJECT;
                if (!isArticleTextBlockCandidate(parent, bodyEl)) return NodeFilter.FILTER_SKIP;
                return NodeFilter.FILTER_ACCEPT;
            },
        });

        while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            const block = parent?.closest?.('div[dir="auto"], div[lang], p, li, blockquote, h1, h2, h3, h4, h5, h6, span') || parent;
            if (!block || seen.has(block) || !isArticleTextBlockCandidate(block, bodyEl)) continue;
            seen.add(block);
            blocks.push(block);
        }
        return blocks;
    }

    function getArticleTranslatableTextBlocks(bodyEl) {
        if (!bodyEl) return [];
        const selectors = [
            '.public-DraftStyleDefault-block',
            '[data-block="true"]',
            'div[dir="auto"]',
            'div[lang]',
            'p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        ].join(',');
        let blocks = Array.from(bodyEl.querySelectorAll?.(selectors) || [])
            .filter((el) => isArticleTextBlockCandidate(el, bodyEl));

        if (!blocks.length) {
            blocks = Array.from(bodyEl.children || [])
                .filter((el) => isArticleTextBlockCandidate(el, bodyEl));
        }

        if (!blocks.length) {
            blocks = getArticleTextLeafBlocks(bodyEl);
        }

        return blocks.filter((el, index, list) => !list.some((other, otherIndex) => otherIndex !== index && other.contains?.(el)));
    }

    async function translateArticleInPlace(target) {
        const titleText = String(target.articleTitle || "").trim();
        const bodyBlocks = getArticleTranslatableTextBlocks(target.bodyEl);
        const translatedParts = [];
        let translatedTitle = "";

        if (titleText && target.titleEl) {
            const titleResult = await requestBackgroundTextTranslation({
                text: titleText,
                url: location.href.split("?")[0],
                type: "x_article_title",
            });
            translatedTitle = titleResult.translatedText || "";
            if (translatedTitle) {
                replaceElementTextWithTranslation(target.titleEl, translatedTitle, {
                    type: "article_title",
                    article_title: translatedTitle,
                });
            }
        }

        for (const block of bodyBlocks) {
            const original = articleBlockText(block);
            if (!original) continue;
            const result = await requestBackgroundTextTranslation({
                text: original,
                url: location.href.split("?")[0],
                type: "x_article_block",
            });
            const translated = result.translatedText || "";
            if (!translated) continue;
            replaceElementTextWithTranslation(block, translated, {
                type: "article_block",
                text: translated,
            });
            translatedParts.push(translated);
        }

        const translatedBody = translatedParts.join("\n\n").trim();
        const translatedText = [translatedTitle, translatedBody].filter(Boolean).join("\n\n");
        const articleOverride = {
            type: "article",
            article_title: translatedTitle,
            article_content: translatedBody || translatedTitle,
            text: translatedText,
        };
        if (target.titleEl) markElementTranslated(target.titleEl, articleOverride);
        if (target.bodyEl) markElementTranslated(target.bodyEl, articleOverride);
        clearInlineTranslationStatus(document);
        return !!translatedText;
    }

    function splitNativeArticleCardTranslation(translatedText) {
        const parts = String(translatedText || "")
            .replace(/\r\n/g, "\n")
            .split(/\n{2,}|\n/)
            .map((part) => normalizeSpaces(part))
            .filter(Boolean);
        if (!parts.length) return { title: "", body: "" };

        let droppedLeadingUrl = false;
        while (parts.length && isUrlOnlyText(parts[0])) {
            parts.shift();
            droppedLeadingUrl = true;
        }
        if (!parts.length) return { title: "", body: "" };

        if (droppedLeadingUrl) {
            return {
                title: "",
                body: parts.join("\n").trim(),
            };
        }

        return {
            title: parts[0] || "",
            body: parts.slice(1).join("\n").trim(),
        };
    }

    function isUrlOnlyText(text) {
        return /^https?:\/\/\S+$/i.test(normalizeSpaces(text || ""));
    }

    async function translateArticleCardInPlace(target, options = {}) {
        if (!target?.titleEl && !target?.bodyEl) return false;

        const originalTitle = String(target.articleTitle || "").trim();
        const originalBody = String(target.articleBody || "").trim();
        let translatedTitle = "";
        let translatedBody = "";

        const { url: scopeTweetUrl } = findTweetUrl(target.scope);
        const tweetUrl = target.url || scopeTweetUrl || findFirstStatusUrl(target.scope);
        const tweetId = target.tweetId || extractTweetIdFromUrl(tweetUrl);
        if (tweetId && !options.skipNativeTweetTranslation) {
            try {
                const nativeResult = await requestBackgroundTweetTranslation({ url: tweetUrl, tweetId });
                const split = splitNativeArticleCardTranslation(nativeResult.translatedText || "");
                if (split.title && !isUrlOnlyText(split.title) && (!originalTitle || split.title !== originalTitle)) translatedTitle = split.title;
                if (split.body && (!originalBody || split.body !== originalBody)) translatedBody = split.body;
            } catch (error) {
                console.warn("[x2md] Article 卡片原生翻译失败，回退文本翻译：", error);
            }
        }

        if (!translatedTitle && originalTitle && target.titleEl) {
            const result = await requestBackgroundTextTranslation({
                text: originalTitle,
                url: tweetUrl || location.href.split("?")[0],
                type: "x_article_card_title",
            });
            translatedTitle = result.translatedText || "";
        }

        if (!translatedBody && originalBody && target.bodyEl) {
            const result = await requestBackgroundTextTranslation({
                text: originalBody,
                url: tweetUrl || location.href.split("?")[0],
                type: "x_article_card_summary",
            });
            translatedBody = result.translatedText || "";
        }

        const override = {
            type: "article_card",
            article_title: translatedTitle,
            article_content: translatedBody,
            text: [translatedTitle, translatedBody].filter(Boolean).join("\n\n"),
            source: "twitter_article_card",
        };

        let rendered = false;
        if (translatedTitle && target.titleEl) {
            rendered = replaceElementTextWithTranslation(target.titleEl, translatedTitle, override) || rendered;
        }
        if (translatedBody && target.bodyEl) {
            rendered = replaceElementTextWithTranslation(target.bodyEl, translatedBody, override) || rendered;
        }
        if (rendered && target.cardEl) markElementTranslated(target.cardEl, override);
        clearInlineTranslationStatus(target.scope);
        return rendered;
    }

    async function translateTweetTextTargetInPlace(target, options = {}) {
        if (!target?.textEl || !target.text) return false;

        const tweetUrl = target.url || "";
        const tweetId = target.tweetId || extractTweetIdFromUrl(tweetUrl);
        let translatedText = "";
        let translatedHtml = "";

        if (tweetId) {
            try {
                const result = await requestBackgroundTweetTranslation({ url: tweetUrl, tweetId });
                if (result.translatedText) {
                    const nativeLike = buildNativeLikeTweetTranslationHtml(result.translatedText, target.textEl);
                    translatedText = nativeLike.text || result.translatedText || "";
                    translatedHtml = nativeLike.html || "";
                }
            } catch (error) {
                console.warn("[x2md] 推文翻译失败，回退普通文本翻译：", error);
            }
        }

        if (!translatedText) {
            const result = await requestBackgroundTextTranslation({
                text: target.text,
                url: tweetUrl || location.href.split("?")[0],
                type: options.type || "x_tweet",
            });
            translatedText = result.translatedText || "";
        }

        if (!translatedText) return false;

        const override = {
            type: options.overrideType || "tweet",
            text: translatedText,
            source: translatedHtml ? "twitter_native" : "",
        };
        const rendered = translatedHtml
            ? replaceElementWithNativeTranslation(target.textEl, { text: translatedText, html: translatedHtml }, override)
            : replaceElementTextWithTranslation(target.textEl, translatedText, override);

        if (rendered && target.quoteEl) markElementTranslated(target.quoteEl, override);
        return rendered;
    }

    async function translateQuoteTweetInPlace(scope = document) {
        const target = findQuoteTweetTranslationTarget(scope);
        if (!target || targetHasVisibleTranslation(target)) return false;
        return await translateTweetTextTargetInPlace(target, {
            type: "x_quote_tweet",
            overrideType: "quote_tweet",
        });
    }

    async function translateEmbeddedArticleCardInPlace(scope = document) {
        const target = getTwitterArticleCardTranslationTarget(scope);
        if (!target || targetHasVisibleTranslation(target)) return false;

        // 当同一条推文同时包含正文和文章卡片时，X 原生推文翻译接口优先返回正文译文；
        // 直接拿它拆分会把正文第一句误写进卡片标题。此时卡片标题/摘要改为逐段翻译。
        const hasPrimaryTweetText = !!findMainTweetTextElement(scope);
        return await translateArticleCardInPlace(target, {
            skipNativeTweetTranslation: hasPrimaryTweetText,
        });
    }

    async function translateEmbeddedTargetsInPlace(scope = document) {
        let rendered = false;
        rendered = await translateQuoteTweetInPlace(scope) || rendered;
        rendered = await translateEmbeddedArticleCardInPlace(scope) || rendered;
        return rendered;
    }

    function renderInlineTranslation(scope, translation) {
        const target = getTranslationTarget(scope);
        if (!target || !translation) return false;

        const translatedText = typeof translation === "string" ? translation : translation.text;
        if (!translatedText) return false;

        if (target.kind === "tweet") {
            if (translation.source === "twitter_native_api" || translation.html) {
                return replaceElementWithNativeTranslation(target.textEl, {
                    text: translatedText,
                    html: translation.html || "",
                }, translation.override || { type: "tweet", text: translatedText, source: "twitter_native" });
            }
            return replaceElementTextWithTranslation(target.textEl, translatedText, typeof translation === "string"
                ? { type: "tweet", text: translatedText }
                : translation.override || { type: "tweet", text: translatedText });
        }

        return false;
    }

    function getTranslationOverrideForSave(scope = globalScope.document) {
        const ctx = scope || globalScope.document;
        const elementOverride = getElementTranslationOverride(ctx) || findDescendantTranslationOverride(ctx);
        if (elementOverride) return elementOverride;

        if (ctx === globalScope.document && isTwitterArticleTranslationScope(globalScope.document)) {
            const target = getTranslationTarget(document);
            if (targetHasVisibleTranslation(target)) {
                const articleTitle = target.titleEl?.innerText?.trim() || target.articleTitle || "";
                let articleContent = "";
                try {
                    articleContent = target.bodyEl ? extractArticleMarkdown(target.bodyEl) : "";
                } catch (error) {
                    articleContent = getArticleTranslatableTextBlocks(target.bodyEl)
                        .map((block) => block.innerText?.trim() || "")
                        .filter(Boolean)
                        .join("\n\n");
                }
                const text = [articleTitle, articleContent].filter(Boolean).join("\n\n");
                if (text) {
                    return {
                        type: "article",
                        article_title: articleTitle,
                        article_content: articleContent,
                        text,
                    };
                }
            }
        }

        const nativeTarget = getTranslationTarget(ctx);
        if (nativeTarget?.kind === "tweet" && findNativeTwitterTranslationControl(ctx, "original")) {
            const nativeText = String(nativeTarget.text || "").trim();
            if (nativeText) {
                return {
                    type: "tweet",
                    text: nativeText,
                    source: "twitter_native",
                };
            }
        }

        const block = findVisibleTranslationBlock(ctx) ||
            (ctx !== globalScope.document ? findVisibleTranslationBlock(globalScope.document) : null);
        const override = block?.__x2md_translation_override;
        if (!override) return null;
        const text = String(override.text || override.article_content || "").trim();
        const title = String(override.article_title || "").trim();
        if (!text && !title) return null;
        return override;
    }

    function withVisibleTranslationOverride(data, scope = document) {
        const override = getTranslationOverrideForSave(scope);
        if (!override) return data;
        return applyTranslationOverride({
            ...data,
            prefer_translated_content: true,
            translation_override: override,
        });
    }

    async function translateScopeInline(scope = document, options = {}) {
        const requestedScope = scope || document;
        const targetScope = requestedScope === document && isTwitterArticleTranslationScope(document)
            ? document
            : requestedScope;
        if (!options.force) {
            const currentTarget = getTranslationTarget(targetScope);
            if (targetHasVisibleTranslation(currentTarget)) {
                const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
                return embeddedRendered ? "translated" : "cached";
            }
            if (currentTarget?.kind === "tweet" && findNativeTwitterTranslationControl(targetScope, "original")) {
                markNativeTwitterTranslation(targetScope);
                const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
                return embeddedRendered ? "translated" : "cached";
            }
        }

        await expandCollapsedTweetText(targetScope);
        const target = getTranslationTarget(targetScope);
        if (!target?.text) return "missing";

        setInlineTranslationStatus(targetScope, "正在翻译…");

        if (target.kind === "article") {
            const mainRendered = await translateArticleInPlace(target);
            const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
            return (mainRendered || embeddedRendered) ? "translated" : "missing";
        }

        if (target.kind === "article_card") {
            const mainRendered = await translateArticleCardInPlace(target);
            const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
            return (mainRendered || embeddedRendered) ? "translated" : "missing";
        }

        const nativeState = await showNativeTwitterTranslation(targetScope);
        if (nativeState) {
            const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
            clearInlineTranslationStatus(targetScope);
            return (nativeState === "cached" && !embeddedRendered) ? "cached" : "translated";
        }

        const { url: tweetUrl } = findTweetUrl(targetScope);
        let fallbackUrl = "";
        if (location.pathname.includes("/status/")) {
            const statusPath = location.pathname.match(/^(\/[^/]+\/status\/\d+)/)?.[1] || "";
            if (statusPath) fallbackUrl = location.origin + statusPath;
        }
        const resolvedTweetUrl = tweetUrl || fallbackUrl || findFirstStatusUrl(targetScope);
        const tweetId = extractTweetIdFromUrl(resolvedTweetUrl);
        let translatedText = "";
        let translatedHtml = "";
        let translationSource = "";
        if (tweetId) {
            try {
                const result = await requestBackgroundTweetTranslation({ url: resolvedTweetUrl, tweetId });
                if (result.translatedText) {
                    const nativeLike = buildNativeLikeTweetTranslationHtml(result.translatedText, target.textEl);
                    translatedText = nativeLike.text || result.translatedText || "";
                    translatedHtml = nativeLike.html || "";
                    translationSource = "twitter_native_api";
                }
            } catch (error) {
                console.warn("[x2md] Grok 翻译失败，回退普通文本翻译：", error);
            }
        }
        if (!translatedText) {
            const result = await requestBackgroundTextTranslation({
                text: target.text,
                url: resolvedTweetUrl || location.href.split("?")[0],
                type: "x_tweet",
            });
            translatedText = result.translatedText || "";
        }
        if (!translatedText) return "missing";
        const rendered = renderInlineTranslation(targetScope, {
            text: translatedText,
            html: translatedHtml,
            source: translationSource,
            override: { type: "tweet", text: translatedText, source: translationSource ? "twitter_native" : "" },
        });
        const embeddedRendered = await translateEmbeddedTargetsInPlace(targetScope);
        clearInlineTranslationStatus(targetScope);
        return (rendered || embeddedRendered) ? "translated" : "missing";
    }

    function getAutoTranslateKey(scope = document) {
        if ((!scope || scope === document) && isTwitterArticleTranslationScope(document)) {
            return `article:${location.href.split("?")[0]}`;
        }
        let currentStatusUrl = "";
        if (location.pathname.includes("/status/")) {
            const statusPath = location.pathname.match(/^(\/[^/]+\/status\/\d+)/)?.[1] || "";
            if (statusPath) currentStatusUrl = `${location.origin}${statusPath}`;
        }
        const statusUrl = findFirstStatusUrl(scope) || currentStatusUrl;
        const id = extractTweetIdFromUrl(statusUrl);
        return id ? `tweet:${id}` : "";
    }

    function enqueueAutoTranslateScope(scope = document) {
        const key = getAutoTranslateKey(scope);
        if (!key || xAutoTranslateDoneKeys.has(key) || xAutoTranslateQueuedKeys.has(key)) return;
        xAutoTranslateQueuedKeys.add(key);
        xAutoTranslateQueue.push({ key, scope });
        drainAutoTranslateQueue();
    }

    function drainAutoTranslateQueue() {
        while (xAutoTranslateActiveCount < X_AUTO_TRANSLATE_MAX_CONCURRENCY && xAutoTranslateQueue.length) {
            const item = xAutoTranslateQueue.shift();
            xAutoTranslateActiveCount++;
            translateScopeInline(item.scope, { force: false, auto: true })
                .then((state) => {
                    if (state === "translated" || state === "cached") xAutoTranslateDoneKeys.add(item.key);
                })
                .catch((error) => {
                    console.warn("[x2md] 自动翻译失败：", error);
                })
                .finally(() => {
                    xAutoTranslateQueuedKeys.delete(item.key);
                    xAutoTranslateActiveCount--;
                    drainAutoTranslateQueue();
                });
        }
    }

    function scheduleAutoTranslateLoadedContent() {
        if (!xAutoTranslateEnabled || xAutoTranslateScheduled || !isTwitterLikePage()) return;
        xAutoTranslateScheduled = true;
        setTimeout(() => {
            xAutoTranslateScheduled = false;
            if (!xAutoTranslateEnabled) return;
            if (isTwitterArticleTranslationScope(document)) {
                enqueueAutoTranslateScope(document);
            }
            document.querySelectorAll("article, [role='article']").forEach((article) => {
                if (isTwitterArticleTranslationScope(article)) return;
                enqueueAutoTranslateScope(article);
            });
        }, 250);
    }

    function enableAutoTranslateMode() {
        if (!isTwitterDetailOrArticlePage()) {
            showToast("请先进入推文详情页或文章页再长按自动翻译", "error", 3200);
            return;
        }
        xAutoTranslateEnabled = true;
        showToast("已开启自动翻译：正在处理正文和已加载评论…", "loading", 2600);
        scheduleAutoTranslateLoadedContent();
    }

    function buildTwitterInlineTranslateButton(referenceButton) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `${referenceButton?.className || ""} ${X_INLINE_TRANSLATE_BUTTON_CLASS}`.trim();
        btn.setAttribute("aria-label", "显示翻译");
        btn.title = "显示翻译";
        btn.innerHTML = `
            <div dir="ltr" style="display:flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;line-height:32px;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;">
                    <img src="${X_TRANSLATE_ICON_URL}" alt="" aria-hidden="true" style="width:20px;height:20px;display:block;object-fit:contain;" />
                </span>
            </div>
        `;
        btn.style.marginRight = "4px";
        btn.style.flexShrink = "0";
        btn.addEventListener("mouseenter", () => {
            const span = btn.querySelector("span");
            if (span) span.style.background = "rgba(29, 155, 240, .10)";
        });
        btn.addEventListener("mouseleave", () => {
            const span = btn.querySelector("span");
            if (span) span.style.background = "transparent";
        });
        let longPressTimer = null;
        const clearLongPressTimer = () => {
            if (longPressTimer) clearTimeout(longPressTimer);
            longPressTimer = null;
        };
        btn.addEventListener("pointerdown", (event) => {
            clearLongPressTimer();
            btn.__x2md_long_press_fired = false;
            longPressTimer = setTimeout(() => {
                btn.__x2md_long_press_fired = true;
                try {
                    event.preventDefault();
                    event.stopPropagation();
                } catch (error) { }
                enableAutoTranslateMode();
            }, X_AUTO_TRANSLATE_LONG_PRESS_MS);
        }, true);
        ["pointerup", "pointerleave", "pointercancel"].forEach((eventName) => {
            btn.addEventListener(eventName, clearLongPressTimer, true);
        });
        btn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            clearLongPressTimer();
            if (btn.__x2md_long_press_fired) {
                btn.__x2md_long_press_fired = false;
                return;
            }
            const fixedActions = btn.closest(`.${X_INLINE_ACTIONS_CONTAINER_CLASS}`);
            const article = fixedActions ? document : (btn.closest("article, [role='article']") || document);
            const nativeState = await toggleNativeTwitterTranslation(article);
            if (nativeState) {
                showToast(nativeState === "original" ? "已显示原文" : "翻译已显示", "success", 1600);
                return;
            }

            const existingState = toggleExistingInlineTranslation(article);
            if (existingState) {
                showToast(existingState === "original" ? "已显示原文" : "翻译已显示", "success", 1600);
                return;
            }

            showToast("正在获取翻译…", "loading", null);
            try {
                const state = await translateScopeInline(article, { force: true });
                if (state !== "translated" && state !== "cached") {
                    showToast("译文已获取，但未找到插入位置", "error", 3500);
                    return;
                }
                showToast("翻译已显示", "success", 2200);
            } catch (error) {
                console.error("[x2md] 翻译失败：", error);
                showToast("翻译失败，请点进推文后重试", "error", 4500);
            }
        }, true);
        return btn;
    }

    function buildTwitterInlineCopyButton(referenceButton) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = `${referenceButton?.className || ""} ${X_INLINE_COPY_BUTTON_CLASS}`.trim();
        btn.setAttribute("aria-label", "复制正文");
        btn.title = "复制这条推文或文章的正文";
        btn.innerHTML = `
            <div dir="ltr" style="display:flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;line-height:32px;">
                <span style="display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:999px;">
                    <img src="${X_COPY_ICON_URL}" alt="" aria-hidden="true" style="width:19px;height:19px;display:block;object-fit:contain;" />
                </span>
            </div>
        `;
        btn.style.marginRight = "4px";
        btn.style.flexShrink = "0";
        btn.addEventListener("mouseenter", () => {
            const span = btn.querySelector("span");
            if (span) span.style.background = "rgba(29, 155, 240, .10)";
        });
        btn.addEventListener("mouseleave", () => {
            const span = btn.querySelector("span");
            if (span) span.style.background = "transparent";
        });
        btn.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            const article = btn.closest("article, [role='article']") || document;
            showToast("正在提取正文…", "loading", null);
            try {
                const content = await resolveContentForCopy(article, btn);
                if (!content?.text) {
                    showToast("未找到可复制的正文", "error", 3500);
                    return;
                }
                await copyContentToClipboard(content);
                showToast(content.html ? "正文已复制（含格式）" : "正文已复制", "success", 2200);
            } catch (error) {
                console.error("[x2md] 复制正文失败：", error);
                showToast("复制失败，请重试", "error", 3500);
            }
        }, true);
        return btn;
    }

    function ensureTwitterInlineCopyButtons() {
        if (!isTwitterLikePage()) {
            document.querySelectorAll(`.${X_INLINE_COPY_BUTTON_CLASS}`).forEach((btn) => btn.remove());
            document.querySelectorAll(`.${X_INLINE_ACTIONS_CONTAINER_CLASS}`).forEach((el) => el.remove());
            return;
        }

        document.querySelectorAll("article, [role='article']").forEach((article) => {
            const grokButton = article.querySelector(X_GROK_BUTTON_SELECTORS);
            if (!grokButton || !grokButton.parentElement) return;

            let copyButton = article.querySelector(`.${X_INLINE_COPY_BUTTON_CLASS}`);
            if (!copyButton) {
                copyButton = buildTwitterInlineCopyButton(grokButton);
                grokButton.parentElement.insertBefore(copyButton, grokButton);
            }

            if (!article.querySelector(`.${X_INLINE_TRANSLATE_BUTTON_CLASS}`)) {
                const translateButton = buildTwitterInlineTranslateButton(grokButton);
                copyButton.insertAdjacentElement("afterend", translateButton);
            }
        });

        if (isNotePageUrl() && !document.querySelector(`.${X_INLINE_COPY_BUTTON_CLASS}`)) {
            const grokButton = document.querySelector(X_GROK_BUTTON_SELECTORS);
            if (grokButton?.parentElement) {
                const copyButton = buildTwitterInlineCopyButton(grokButton);
                const translateButton = buildTwitterInlineTranslateButton(grokButton);
                grokButton.parentElement.insertBefore(copyButton, grokButton);
                copyButton.insertAdjacentElement("afterend", translateButton);
                return;
            }

            let container = document.querySelector(`.${X_INLINE_ACTIONS_CONTAINER_CLASS}`);
            if (!container) {
                container = document.createElement("div");
                container.className = X_INLINE_ACTIONS_CONTAINER_CLASS;
                Object.assign(container.style, {
                    position: "fixed",
                    top: "72px",
                    right: "18px",
                    zIndex: "2147483646",
                    display: "flex",
                    alignItems: "center",
                    gap: "4px",
                    background: "rgba(255,255,255,.86)",
                    borderRadius: "999px",
                    boxShadow: "0 4px 16px rgba(0,0,0,.10)",
                    backdropFilter: "blur(8px)",
                });
                const copyButton = buildTwitterInlineCopyButton(null);
                const translateButton = buildTwitterInlineTranslateButton(null);
                container.append(copyButton, translateButton);
                document.body.appendChild(container);
            }
        }
    }

    const api = {
        mount: ensureTwitterInlineCopyButtons,
        schedule: scheduleAutoTranslateLoadedContent,
        applyVisibleTranslationOverride: withVisibleTranslationOverride,
        normalizeRemoteCopyContent,
    };

    if (typeof module !== "undefined" && module.exports) module.exports = api;
    globalScope.X2MDXTranslationUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
