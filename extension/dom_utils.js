(function (globalScope) {
    function getTagName(element) {
        return String(element?.tagName || "").toLowerCase();
    }

    function getClassList(element) {
        return String(element?.className || "").split(/\s+/).filter(Boolean);
    }

    function safeGetAttribute(element, name) {
        try {
            if (element && typeof element.getAttribute === "function") {
                return element.getAttribute(name);
            }
        } catch (error) { }
        return null;
    }

    function safeClosest(element, selector) {
        try {
            if (element && typeof element.closest === "function") {
                return element.closest(selector);
            }
        } catch (error) { }
        return null;
    }

    function getNodeText(node) {
        if (!node) return "";
        if (node.nodeType === 3) return node.textContent || "";
        if (node.nodeType !== 1) return "";
        return node.innerText || node.textContent || "";
    }

    function cleanZeroWidth(text) {
        return String(text || "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
    }

    const exported = {
        cleanZeroWidth,
        getClassList,
        getNodeText,
        getTagName,
        safeClosest,
        safeGetAttribute,
    };

    if (typeof module !== "undefined" && module.exports) {
        module.exports = exported;
    }

    Object.assign(globalScope, exported);
})(typeof globalThis !== "undefined" ? globalThis : this);
