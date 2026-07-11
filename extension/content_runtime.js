(function (root) {
    "use strict";

    function start() {
        /**
         * content.js - X2MD 内容脚本 v1.4
         *
         * 职责简化：只负责
         *   1. 监听书签按钮点击（首页 Feed + 详情页 + X Article）
         *   2. 提取推文基础信息（URL、作者、发布时间）+ 当前可见的文字/图片（作为后备）
         *   3. 发给 background.js → Syndication API 获取完整内容
         *
         * 完整内容（解决"显示更多"截断、图片丢失）由 background.js 处理。
         */


        let runtimeConfig = null;
        root.runtimeConfig = null;

        function requestRuntimeConfig() {
            if (runtimeConfig) {
                ensureFloatingSaveButton();
                ensureXProfileCaptureButton();
                return;
            }

            chrome.runtime.sendMessage({ action: "get_config" }, (resp) => {
                runtimeConfig = resp?.success ? (resp.config || {}) : {};
                root.runtimeConfig = runtimeConfig;
                ensureFloatingSaveButton();
                ensureXProfileCaptureButton();
            });
        }

        function findCurrentLinuxDoPost() {
            const match = location.pathname.match(/^\/t\/[^/]+\/\d+\/(\d+)\/?$/);
            if (match) {
                const exactPost = document.getElementById(`post_${match[1]}`);
                if (exactPost) return exactPost;
            }
            return document.querySelector("article[data-post-id]");
        }

        async function captureWebSite(siteKey, options = {}) {
            const labels = {
                linux_do: { loading: "正在保存 LINUX DO 帖子…", failed: "帖子内容提取失败" },
                feishu: { loading: "正在滚动页面加载全部内容…", failed: "飞书文档提取失败" },
                wechat: { loading: "正在保存微信公众号文章…", failed: "微信公众号文章提取失败" },
            };
            const label = labels[siteKey];
            if (!label) return;
            showToast(label.loading, "loading", null);
            try {
                const captureDocument = await webCaptureAdapter.capture(siteKey, {
                    document,
                    location,
                    post: options.post,
                    trigger: options.trigger,
                });
                if (!captureDocument) {
                    showToast(label.failed, "error", 4000);
                    return;
                }
                sendToBackground(webCaptureAdapter.normalize(captureDocument));
            } catch (error) {
                console.error(`[x2md] ${siteKey} capture failed`, error);
                showToast(label.failed, "error", 4000);
            }
        }

        function handleFloatingSave(siteKey) {
            const post = siteKey === "linux_do" ? findCurrentLinuxDoPost() : undefined;
            void captureWebSite(siteKey, { post });
        }

        // ─────────────────────────────────────────────
        // 书签按钮监听
        // ─────────────────────────────────────────────
        const BOOKMARK_SELECTORS = [
            '[data-testid="bookmark"]',
            '[data-testid="removeBookmark"]',
            '[aria-label="Bookmark"]',
            '[aria-label="书签"]',
            '[aria-label="Add Bookmark"]',
            '[aria-label="添加书签"]',
            '[aria-label="Remove Bookmark"]',
            '[aria-label="移除书签"]',
            '[aria-label="取消书签"]',
        ].join(", ");

        const X_CUSTOM_SAVE_MENU_ID = "__x2md_x_custom_save_menu";
        const X_CUSTOM_SAVE_MENU_MAX_CHARS = 5;
        let xCustomSaveMenuHideTimer = null;

        function getCustomSavePathEntries() {
            const entries = Array.isArray(runtimeConfig?.custom_save_paths) ? runtimeConfig.custom_save_paths : [];
            return entries
                .map((entry, index) => ({
                    index,
                    name: String(entry?.name || "").trim(),
                    path: String(entry?.path || "").trim(),
                }))
                .filter((entry) => entry.name && entry.path);
        }

        function truncateCustomSaveTitle(title) {
            return Array.from(String(title || "").trim()).slice(0, X_CUSTOM_SAVE_MENU_MAX_CHARS).join("");
        }

        function ensureCustomSaveMenu() {
            let menu = document.getElementById(X_CUSTOM_SAVE_MENU_ID);
            if (menu) return menu;

            menu = document.createElement("div");
            menu.id = X_CUSTOM_SAVE_MENU_ID;
            Object.assign(menu.style, {
                position: "fixed",
                zIndex: "2147483647",
                width: "fit-content",
                minWidth: "86px",
                maxWidth: "148px",
                padding: "6px",
                borderRadius: "16px",
                border: "1px solid rgba(255,255,255,.48)",
                background: "rgba(246,246,246,.72)",
                boxShadow: "0 18px 44px rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.52)",
                backdropFilter: "saturate(180%) blur(22px)",
                WebkitBackdropFilter: "saturate(180%) blur(22px)",
                display: "none",
                opacity: "0",
                transform: "translateY(-4px) scale(.98)",
                transformOrigin: "top center",
                transition: "opacity .14s ease, transform .14s ease",
                pointerEvents: "auto",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', sans-serif",
            });
            menu.addEventListener("mouseenter", () => {
                clearTimeout(xCustomSaveMenuHideTimer);
            });
            menu.addEventListener("mouseleave", scheduleHideCustomSaveMenu);
            document.body.appendChild(menu);
            return menu;
        }

        function scheduleHideCustomSaveMenu() {
            clearTimeout(xCustomSaveMenuHideTimer);
            xCustomSaveMenuHideTimer = setTimeout(() => {
                const menu = document.getElementById(X_CUSTOM_SAVE_MENU_ID);
                if (!menu) return;
                menu.style.opacity = "0";
                menu.style.transform = "translateY(-4px) scale(.98)";
                setTimeout(() => {
                    if (menu.style.opacity === "0") menu.style.display = "none";
                }, 160);
            }, 180);
        }

        function showCustomSaveMenu(btn) {
            const entries = getCustomSavePathEntries();
            if (!entries.length) return;

            clearTimeout(xCustomSaveMenuHideTimer);
            const menu = ensureCustomSaveMenu();
            menu.textContent = "";

            const visibleTitles = entries.map((entry) => truncateCustomSaveTitle(entry.name));
            const maxTitleLength = Math.max(1, ...visibleTitles.map((title) => Array.from(title).length));
            const menuWidth = Math.min(148, Math.max(86, 32 + maxTitleLength * 18));
            menu.style.width = `${menuWidth}px`;

            entries.forEach((entry, index) => {
                const item = document.createElement("button");
                item.type = "button";
                item.textContent = visibleTitles[index];
                item.title = entry.name === visibleTitles[index] ? entry.path : `${entry.name} · ${entry.path}`;
                Object.assign(item.style, {
                    display: "block",
                    width: "100%",
                    border: "none",
                    borderRadius: "11px",
                    background: "transparent",
                    color: "#1d1d1f",
                    cursor: "pointer",
                    fontSize: "13px",
                    fontWeight: "600",
                    lineHeight: "1.2",
                    textAlign: "center",
                    padding: "8px 10px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    letterSpacing: ".01em",
                });
                item.addEventListener("mouseenter", () => {
                    item.style.background = "rgba(0, 122, 255, .16)";
                });
                item.addEventListener("mouseleave", () => {
                    item.style.background = "transparent";
                });
                item.addEventListener("click", (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    menu.style.display = "none";
                    const captureTarget = btn.closest?.("article, [role='article']") || null;
                    if (!isBookmarkButtonAlreadySaved(btn)) {
                        btn.__x2md_skip_next_default_bookmark_save = true;
                        btn.click();
                        setTimeout(() => {
                            if (btn.__x2md_skip_next_default_bookmark_save) {
                                btn.__x2md_skip_next_default_bookmark_save = false;
                            }
                        }, 0);
                    }
                    setTimeout(() => {
                        captureAndSend(btn, {
                            captureTarget,
                            customSavePath: {
                                index: entry.index,
                                name: entry.name,
                            },
                        });
                    }, 400);
                }, true);
                menu.appendChild(item);
            });

            menu.style.visibility = "hidden";
            menu.style.display = "block";
            const rect = btn.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const centeredLeft = rect.left + rect.width / 2 - menuRect.width / 2;
            const left = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, centeredLeft));
            let top = rect.bottom + 8;
            if (top + menuRect.height > window.innerHeight - 8) {
                top = rect.top - menuRect.height - 8;
            }
            top = Math.max(8, Math.min(window.innerHeight - menuRect.height - 8, top));
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.style.visibility = "visible";
            requestAnimationFrame(() => {
                menu.style.opacity = "1";
                menu.style.transform = "translateY(0) scale(1)";
            });
        }

        function isBookmarkButtonAlreadySaved(btn) {
            return getBookmarkButtonAction(btn) === "remove";
        }

        function attachBookmarkListener(btn) {
            if (btn.__x2md_bound) return;
            btn.__x2md_bound = true;
            btn.addEventListener("mouseenter", () => showCustomSaveMenu(btn), true);
            btn.addEventListener("mouseleave", scheduleHideCustomSaveMenu, true);
            bindBookmarkSaveListener(btn, (_button, context) => captureAndSend(btn, context), {
                shouldSkip: () => {
                    if (!btn.__x2md_skip_next_default_bookmark_save) return false;
                    btn.__x2md_skip_next_default_bookmark_save = false;
                    return true;
                },
            });
        }

        // ─────────────────────────────────────────────
        // 主流程：捕获 → 组装基础数据 → 发给 background
        // ─────────────────────────────────────────────
        function captureAndSend(btn, options = {}) {
            showToast("正在获取完整推文内容…", "loading", null);
            captureUi.setButtonState(btn, "loading", "X2MD 正在保存");
            const sendCapture = (data) => sendToBackground(data, { button: btn });

            const performCapture = () => {
                let captureDocument;
                try {
                    captureDocument = xCaptureAdapter.capture({ document, location, trigger: options.captureTarget || btn });
                } catch (error) {
                    console.error("[x2md] X DOM 提取异常：", error);
                }
                if (!captureDocument) {
                    showToast(isNotePageUrl() ? "未能提取文章内容，请稍后重试" : "未找到推文链接，请进入推文详情页再试", "error", 4000);
                    captureUi.setButtonState(btn, "failed", "X2MD：提取失败");
                    return;
                }
                try {
                    if (options.customSavePath?.name) {
                        captureDocument.preferences = { ...captureDocument.preferences, custom_save_path_name: options.customSavePath.name };
                    }
                    let payload = xCaptureAdapter.normalize(captureDocument);
                    if (options.customSavePath) payload.x2md_custom_save_path = { ...options.customSavePath };
                    const scope = options.captureTarget || btn?.closest?.("article, [role='article']") || document;
                    payload = X2MDXTranslationUI.applyVisibleTranslationOverride(payload, scope);
                    showToast(captureDocument.content.type === "article" ? "已识别为 X Article，正在保存…" : "正在保存 X 内容…", "loading", null);
                    sendCapture(payload);
                } catch (error) {
                    console.error("[x2md] X 内容处理异常：", error);
                    showToast("推文内容处理失败，请刷新页面后重试", "error", 4000);
                    captureUi.setButtonState(btn, "failed", "X2MD：处理失败");
                }
            };

            if (!isNotePageUrl()) {
                performCapture();
                return;
            }
            const waitForArticle = (retries = 0) => {
                const ready = !!document.querySelector('[data-testid="twitterArticleRichTextView"], [data-testid="twitterArticleReadView"]');
                if (ready || retries >= 10) performCapture();
                else setTimeout(() => waitForArticle(retries + 1), 500);
            };
            waitForArticle();
        }

        function sendToBackground(data, uiContext = {}) {
            chrome.runtime.sendMessage({ action: "save_tweet", data }, async (resp) => {
                if (chrome.runtime.lastError) {
                    console.error("[x2md] 扩展通信失败：", chrome.runtime.lastError);
                    handleSaveResponse({
                        success: false,
                        outcome: "failed",
                        error: { message: "扩展通信失败，请重试", retryable: true },
                    }, {
                        ...uiContext,
                        captureDocument: data,
                        retry: () => sendToBackground(data, uiContext),
                    });
                    return;
                }

                // 处理视频超时警告拦截
                if (resp && resp.require_video_confirm && resp.payload) {
                    const yes = await captureUi.confirmLongVideo({ durationMin: resp.durationMin });
                    resp.payload.download_video = yes;
                    resp.payload.video_confirmed = true;

                    showToast(yes ? "指令已下达，正在连同长视频一并下载..." : "视频已剥离，正在光速脱水图文...");

                    chrome.runtime.sendMessage({ action: "force_save_tweet", data: resp.payload }, (finalResp) => {
                        handleSaveResponse(finalResp, {
                            ...uiContext,
                            captureDocument: resp.payload,
                            retry: () => sendToBackground(resp.payload, uiContext),
                        });
                    });
                    return;
                }

                handleSaveResponse(resp, {
                    ...uiContext,
                    captureDocument: data,
                    retry: () => sendToBackground(data, uiContext),
                });
            });
        }

        const captureUi = createCaptureUi();

        function handleSaveResponse(resp, context = {}) {
            const result = resp?.result?.outcome
                ? { ...resp.result, success: resp.success !== false }
                : resp;
            const view = captureUi.showSaveResult(result, context);
            captureUi.setButtonState(context.button, view.state, `X2MD：${view.title}`);
        }

        // ─────────────────────────────────────────────
        // X 博主主页 / Articles 批量抓取
        // ─────────────────────────────────────────────

        function showToast(message, type = "loading", duration = null) {
            captureUi.showToast(message, type === "success" ? "saved" : type === "error" ? "failed" : type, duration);
        }
        root.showToast = showToast;

        function ensureFloatingSaveButton() {
            const siteKey = detectFloatingSaveSite();
            const enabled = isFloatingSaveIconEnabled(runtimeConfig || {});
            let btn = document.getElementById(SITE_FLOATING_SAVE_BUTTON_ID);

            if (!siteKey || !enabled) {
                btn?.remove();
                return;
            }

            const siteConfig = getFloatingSaveSiteConfig(siteKey);
            if (!siteConfig) {
                btn?.remove();
                return;
            }

            if (!btn) {
                btn = document.createElement("button");
                btn.id = SITE_FLOATING_SAVE_BUTTON_ID;
                btn.type = "button";
                Object.assign(btn.style, {
                    position: "fixed",
                    top: "96px",
                    right: "24px",
                    width: "42px",
                    height: "42px",
                    border: "none",
                    borderRadius: "999px",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: "700",
                    letterSpacing: ".04em",
                    cursor: "pointer",
                    zIndex: "2147483646",
                    boxShadow: "0 10px 24px rgba(0,0,0,.18)",
                    transition: "transform .15s ease, opacity .15s ease",
                });
                btn.addEventListener("mouseenter", () => {
                    btn.style.transform = "translateY(-1px)";
                });
                btn.addEventListener("mouseleave", () => {
                    btn.style.transform = "translateY(0)";
                });
                btn.addEventListener("click", () => handleFloatingSave(btn.dataset.siteKey));
                document.body.appendChild(btn);
            }

            btn.dataset.siteKey = siteKey;
            btn.textContent = siteConfig.label;
            btn.title = siteConfig.title;
            btn.setAttribute("aria-label", siteConfig.title);
            btn.style.background = siteConfig.background;
            btn.style.boxShadow = `0 10px 24px ${siteConfig.shadow}`;
        }

        function ensureX2MDA11yStyle() {
            if (document.getElementById("__x2md_a11y_style")) return;
            const style = document.createElement("style");
            style.id = "__x2md_a11y_style";
            style.textContent = `button[id^="__x2md"], #__x2md_bookmarks_toolbar button { outline: none; } button[id^="__x2md"]:focus-visible, #__x2md_bookmarks_toolbar button:focus-visible { outline: 3px solid #1d9bf0; outline-offset: 2px; }`;
            document.documentElement.appendChild(style);
        }

        // ─────────────────────────────────────────────
        // MutationObserver：监听动态加载的推文
        // ─────────────────────────────────────────────

        function isTwitterDetailOrArticlePage() {
            return isNotePageUrl() || location.pathname.includes("/status/");
        }

        function bindAll() {
            ensureX2MDA11yStyle();
            // 关键性能修复：书签按钮只存在于 X/Twitter。
            // 之前在 linux.do / 微信公众号页面的每次 DOM mutation 都会全页扫描一组
            // Twitter 选择器；这两个站点本身会高频动态更新 DOM，导致扩展开启后页面卡死。
            if (isTwitterLikePage()) {
                document.querySelectorAll(BOOKMARK_SELECTORS).forEach(attachBookmarkListener);
                X2MDXTranslationUI.mount();
                X2MDXTranslationUI.schedule();
                ensureXProfileCaptureButton();
                ensureBookmarksToolbar();
            }
            ensureFloatingSaveButton();
        }

        let bindScheduled = false;
        function scheduleBindAll() {
            if (bindScheduled) return;
            bindScheduled = true;
            const run = () => {
                bindScheduled = false;
                bindAll();
            };
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(run);
            } else {
                setTimeout(run, 100);
            }
        }

        document.addEventListener("click", (event) => {
            if (!isLinuxDoTopicPage()) return;
            const btn = event.target?.closest?.(LINUX_DO_LIKE_SELECTOR);
            if (!btn) return;
            setTimeout(() => void captureWebSite("linux_do", { post: btn.closest?.("article[data-post-id]"), trigger: btn }), 250);
        }, true);

        const observer = new MutationObserver(scheduleBindAll);
        observer.observe(document.body, { childList: true, subtree: true });
        requestRuntimeConfig();
        bindAll();

        console.log("[x2md] 内容脚本已加载 v1.4");
    }

    root.X2MDContentRuntime = { start };
})(typeof globalThis !== "undefined" ? globalThis : this);
