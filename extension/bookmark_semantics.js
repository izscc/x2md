(function (globalScope) {
    function getBookmarkButtonAction(button) {
        const testId = String(button?.getAttribute?.("data-testid") || "").trim().toLowerCase();
        if (testId === "removebookmark") return "remove";
        if (testId === "bookmark") return "add";

        const aria = String(button?.getAttribute?.("aria-label") || "").replace(/\s+/g, " ").trim();
        if (/^remove bookmark$/i.test(aria) || aria === "移除书签" || aria === "取消书签") return "remove";
        if (/^(?:add )?bookmark$/i.test(aria) || aria === "书签" || aria === "添加书签") return "add";
        return "unknown";
    }

    function shouldSaveBookmarkClick(button) {
        return getBookmarkButtonAction(button) === "add";
    }

    function bindBookmarkSaveListener(button, onSave, options = {}) {
        if (!button || typeof button.addEventListener !== "function" || button.__x2md_bookmark_save_bound) return false;
        button.__x2md_bookmark_save_bound = true;
        const schedule = options.schedule || globalScope.setTimeout;
        const delay = options.delay === undefined ? 400 : options.delay;
        button.addEventListener("click", () => {
            if (options.shouldSkip?.()) return;
            // X updates bookmark -> removeBookmark after the click. Classify now,
            // before scheduling capture, so a newly-added bookmark is not lost.
            if (!shouldSaveBookmarkClick(button)) return;
            schedule(() => onSave(button), delay);
        }, true);
        return true;
    }

    const exported = {
        bindBookmarkSaveListener,
        getBookmarkButtonAction,
        shouldSaveBookmarkClick,
    };

    if (typeof module !== "undefined" && module.exports) module.exports = exported;
    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
