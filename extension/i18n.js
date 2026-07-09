(function (globalScope) {
    const X2MD_MESSAGES = {
        "zh-CN": {
            save: "保存",
            exportVisible: "导出可见",
            pause: "暂停",
            resume: "继续",
            cancel: "取消",
            retryFailed: "重试失败",
            upgradeAvailable: "扩展需要升级",
        },
        en: {
            save: "Save",
            exportVisible: "Export visible",
            pause: "Pause",
            resume: "Resume",
            cancel: "Cancel",
            retryFailed: "Retry failed",
            upgradeAvailable: "Extension update required",
        },
    };

    function x2mdT(key, locale = "zh-CN") {
        return X2MD_MESSAGES[locale]?.[key] || X2MD_MESSAGES["zh-CN"]?.[key] || key;
    }

    const exported = { X2MD_MESSAGES, x2mdT };
    if (typeof module !== "undefined" && module.exports) module.exports = exported;
    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
