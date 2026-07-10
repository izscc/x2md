(function () {
    const COLORS = {
        loading: { bg: "#1d9bf0", shadow: "rgba(29,155,240,.4)", icon: "⏳" },
        saved: { bg: "#00ba7c", shadow: "rgba(0,186,124,.4)", icon: "✅" },
        skipped: { bg: "#536471", shadow: "rgba(83,100,113,.4)", icon: "↩️" },
        partial: { bg: "#f59e0b", shadow: "rgba(245,158,11,.4)", icon: "⚠️" },
        failed: { bg: "#f4212e", shadow: "rgba(244,33,46,.4)", icon: "❌" },
    };

    function basename(path) {
        return String(path || "").split(/[\\/]/).pop() || "";
    }

    function describeSaveResult(result) {
        const outcome = result?.outcome || (result?.success ? "saved" : "failed");
        const firstFile = result?.files?.[0]?.path || result?.result?.saved?.[0] || "";
        const warning = result?.warnings?.[0]?.message || result?.warning || "";
        const rawError = result?.error?.message || result?.result?.errors?.[0] || result?.error || "未知错误";
        const error = typeof rawError === "object" ? rawError.message : rawError;
        if (outcome === "skipped") return { state: "skipped", title: "已存在", detail: basename(firstFile), retryable: false };
        if (outcome === "partial") return { state: "partial", title: "部分保存", detail: String(warning || basename(firstFile)), retryable: false };
        if (outcome === "failed" || result?.success === false) {
            return { state: "failed", title: "保存失败", detail: String(error || "未知错误"), retryable: result?.error?.retryable === true };
        }
        return { state: "saved", title: outcome === "updated" ? "已更新" : "保存成功", detail: basename(firstFile), retryable: false };
    }

    function getFocusableElements(root) {
        if (!root?.querySelectorAll) return [];
        return Array.from(root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'))
            .filter((item) => !item.disabled && item.getAttribute?.("aria-hidden") !== "true");
    }

    function handleDialogKeydown(event, root, activeElement, close) {
        if (event.key === "Escape") {
            event.preventDefault();
            close();
            return true;
        }
        if (event.key !== "Tab") return false;
        const focusable = getFocusableElements(root);
        if (!focusable.length) return false;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && activeElement === first) { event.preventDefault(); last.focus(); return true; }
        if (!event.shiftKey && activeElement === last) { event.preventDefault(); first.focus(); return true; }
        return false;
    }

    function style(target, values) {
        if (target?.style) Object.assign(target.style, values);
        return target;
    }

    function createCaptureUi(options = {}) {
        const doc = options.document === undefined ? globalThis.document : options.document;
        const win = options.window === undefined ? globalThis.window : options.window;
        const sendAction = options.sendAction || ((message) => globalThis.chrome?.runtime?.sendMessage?.(message));
        const copyText = options.copyText || ((text) => globalThis.navigator?.clipboard?.writeText?.(text));
        let toastTimer = null;
        let retryState = null;
        let currentResult = null;
        let longVideoChoice;
        let closeModal = null;

        function clearRetry() {
            retryState = null;
        }

        function rememberRetry(captureDocument, retry) {
            retryState = captureDocument && typeof retry === "function" ? { captureDocument, retry } : null;
        }

        async function retry() {
            const pending = retryState;
            if (!pending) return false;
            await pending.retry(pending.captureDocument);
            return true;
        }

        function getToast() {
            if (!doc?.body) return null;
            let toast = doc.getElementById("__x2md_toast");
            if (toast) return toast;
            toast = doc.createElement("section");
            toast.id = "__x2md_toast";
            toast.setAttribute("role", "status");
            toast.setAttribute("aria-live", "polite");
            style(toast, {
                position: "fixed", bottom: "24px", right: "24px", minWidth: "220px", maxWidth: "380px",
                padding: "12px 18px", borderRadius: "12px", fontSize: "14px", fontWeight: "600", color: "#fff",
                fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", lineHeight: "1.5",
                zIndex: "2147483647", transition: "opacity .3s ease, transform .3s ease",
                opacity: "0", transform: "translateY(8px)", pointerEvents: "none",
            });
            doc.body.appendChild(toast);
            return toast;
        }

        function showToast(message, type = "loading", duration = null, actions = []) {
            const toast = getToast();
            if (!toast) return;
            const color = COLORS[type] || COLORS.loading;
            toast.replaceChildren();
            const text = doc.createElement("span");
            text.textContent = `${color.icon} ${String(message)}`;
            toast.appendChild(text);
            if (actions.length) {
                const row = style(doc.createElement("div"), { display: "flex", gap: "8px", marginTop: "8px", flexWrap: "wrap" });
                for (const action of actions) {
                    const button = style(doc.createElement("button"), {
                        border: "1px solid rgba(255,255,255,.65)", borderRadius: "8px", padding: "4px 8px",
                        background: "transparent", color: "#fff", cursor: "pointer", font: "inherit",
                    });
                    button.type = "button";
                    button.textContent = action.label;
                    button.addEventListener("click", action.run);
                    row.appendChild(button);
                }
                toast.appendChild(row);
            }
            toast.style.background = color.bg;
            toast.style.boxShadow = `0 8px 24px ${color.shadow}`;
            toast.style.pointerEvents = actions.length ? "auto" : "none";
            toast.style.opacity = "1";
            toast.style.transform = "translateY(0)";
            clearTimeout(toastTimer);
            if (duration !== null) toastTimer = setTimeout(() => {
                toast.style.opacity = "0";
                toast.style.transform = "translateY(8px)";
                toast.style.pointerEvents = "none";
            }, duration);
        }

        function resultFile() {
            return currentResult?.files?.[0] || (currentResult?.result?.saved?.[0] ? { path: currentResult.result.saved[0] } : null);
        }

        async function runResultAction(command) {
            const file = resultFile();
            if (command === "retry") return retry();
            if (!file?.history_id) return false;
            if (command === "copy_path") {
                const response = await sendAction({ action: "capture_result_action", command, id: file.history_id });
                if (response?.path) await copyText(response.path);
                return true;
            }
            if (["show_file", "open_obsidian", "open_source"].includes(command)) {
                await sendAction({ action: "capture_result_action", command, id: file.history_id });
                return true;
            }
            return false;
        }

        function showSaveResult(result, context = {}) {
            currentResult = result || {};
            const view = describeSaveResult(currentResult);
            if (view.state === "failed" && view.retryable) rememberRetry(context.captureDocument, context.retry);
            else clearRetry();
            const actions = [];
            const file = resultFile();
            if (file?.history_id && view.state !== "failed") {
                actions.push({ label: "复制路径", run: () => runResultAction("copy_path") });
                actions.push({ label: "显示文件", run: () => runResultAction("show_file") });
                actions.push({ label: "在 Obsidian 打开", run: () => runResultAction("open_obsidian") });
            }
            if (view.retryable && retryState) actions.push({ label: "重试", run: () => runResultAction("retry") });
            showToast(`${view.title}${view.detail ? `\n${view.detail.slice(0, 100)}` : ""}`, view.state, actions.length ? 8000 : 5000, actions);
            return view;
        }

        function setLongVideoChoice(choice) {
            longVideoChoice = Boolean(choice);
        }

        function confirmLongVideo({ durationMin = 0 } = {}) {
            if (longVideoChoice !== undefined) return Promise.resolve(longVideoChoice);
            if (!doc?.body) return Promise.resolve(false);
            return new Promise((resolve) => {
                const previousFocus = doc.activeElement;
                const overlay = style(doc.createElement("div"), {
                    position: "fixed", inset: "0", zIndex: "2147483647", background: "rgba(15,23,42,.58)",
                    display: "grid", placeItems: "center", padding: "20px",
                });
                const dialog = style(doc.createElement("section"), {
                    width: "min(440px, 100%)", borderRadius: "18px", background: "#fff", color: "#0f172a",
                    padding: "22px", boxShadow: "0 24px 70px rgba(0,0,0,.35)", fontFamily: "-apple-system, sans-serif",
                });
                dialog.setAttribute("role", "dialog");
                dialog.setAttribute("aria-modal", "true");
                dialog.setAttribute("aria-labelledby", "__x2md_video_title");
                const title = doc.createElement("h2");
                title.id = "__x2md_video_title";
                title.textContent = "是否下载长视频？";
                style(title, { margin: "0 0 8px", fontSize: "20px" });
                const detail = doc.createElement("p");
                detail.textContent = `检测到约 ${Number(durationMin) || 0} 分钟的视频。下载可能耗时较长，也可以仅保存图文。`;
                const rememberLabel = doc.createElement("label");
                const remember = doc.createElement("input");
                remember.type = "checkbox";
                rememberLabel.append(remember, doc.createTextNode(" 本页面后续使用相同选择"));
                const row = style(doc.createElement("div"), { display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "20px" });
                const skip = doc.createElement("button");
                skip.type = "button";
                skip.textContent = "仅保存图文";
                const download = doc.createElement("button");
                download.type = "button";
                download.textContent = "下载并保存";
                style(download, { background: "#1d9bf0", color: "#fff" });
                for (const button of [skip, download]) style(button, { border: "0", borderRadius: "9px", padding: "9px 13px", cursor: "pointer" });
                row.append(skip, download);
                dialog.append(title, detail, rememberLabel, row);
                overlay.appendChild(dialog);
                doc.body.appendChild(overlay);
                let settled = false;
                const finish = (choice) => {
                    if (settled) return;
                    settled = true;
                    if (remember.checked) longVideoChoice = choice;
                    overlay.remove();
                    previousFocus?.focus?.();
                    closeModal = null;
                    resolve(choice);
                };
                closeModal = () => finish(false);
                skip.addEventListener("click", () => finish(false));
                download.addEventListener("click", () => finish(true));
                overlay.addEventListener("keydown", (event) => {
                    handleDialogKeydown(event, dialog, doc.activeElement, () => finish(false));
                });
                skip.focus();
            });
        }

        function setButtonState(button, state, label) {
            if (!button) return;
            button.dataset.x2mdCaptureState = state;
            button.disabled = state === "loading";
            button.setAttribute("aria-busy", state === "loading" ? "true" : "false");
            if (label) button.setAttribute("aria-label", label);
        }

        function dispose() {
            clearRetry();
            currentResult = null;
            closeModal?.();
            closeModal = null;
            clearTimeout(toastTimer);
        }

        win?.addEventListener?.("pagehide", dispose, { once: true });
        return {
            clearRetry, confirmLongVideo, dispose, hasRetry: () => retryState !== null,
            rememberRetry, retry, runResultAction, setButtonState, setLongVideoChoice,
            showSaveResult, showToast,
        };
    }

    globalThis.createCaptureUi = createCaptureUi;
    globalThis.describeSaveResult = describeSaveResult;
    globalThis.getFocusableElements = getFocusableElements;
    globalThis.handleDialogKeydown = handleDialogKeydown;
    if (typeof module !== "undefined" && module.exports) module.exports = { createCaptureUi, describeSaveResult, getFocusableElements, handleDialogKeydown };
})();
