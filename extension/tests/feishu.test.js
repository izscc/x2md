const test = require("node:test");
const assert = require("node:assert/strict");

require("../dom_utils.js");

const {
    cleanFeishuUrl,
    extractFeishuMarkdownFromBlocks,
    isFeishuWikiOrDocxPage,
} = require("../feishu.js");

function textNode(text) {
    return {
        nodeType: 3,
        textContent: text,
        parentElement: null,
    };
}

function matchesSelector(element, selector) {
    if (!element || element.nodeType !== 1 || !selector) return false;

    const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
    return selectors.some((part) => {
        const attrMatches = [...part.matchAll(/\[([^\]=]+)(?:="([^"]*)")?\]/g)];
        const attrTokens = attrMatches.map((match) => ({ name: match[1], value: match[2] ?? null }));
        const withoutAttrs = part.replace(/\[[^\]]+\]/g, "");
        const classMatches = [...withoutAttrs.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
        const tag = withoutAttrs.replace(/\.[A-Za-z0-9_-]+/g, "").trim().toLowerCase();

        if (tag && String(element.tagName || "").toLowerCase() !== tag) return false;

        const className = String(element.className || "");
        for (const cls of classMatches) {
            if (!className.split(/\s+/).includes(cls)) return false;
        }

        for (const token of attrTokens) {
            const actual = element.getAttribute(token.name);
            if (token.value === null) {
                if (actual == null) return false;
            } else if (actual !== token.value) {
                return false;
            }
        }

        return true;
    });
}

function querySelectorFrom(root, selector, firstOnly = true) {
    const results = [];
    const visit = (node) => {
        if (!node || typeof node !== "object") return false;
        if (node.nodeType === 1 && matchesSelector(node, selector)) {
            results.push(node);
            if (firstOnly) return true;
        }
        for (const child of node.childNodes || []) {
            if (visit(child) && firstOnly) return true;
        }
        return false;
    };
    visit(root);
    return firstOnly ? results[0] || null : results;
}

function elementNode(tagName, {
    attrs = {},
    className = "",
    style = {},
    children = [],
} = {}) {
    const element = {
        nodeType: 1,
        tagName: tagName.toUpperCase(),
        className,
        childNodes: children,
        parentElement: null,
        src: attrs.src || "",
        alt: attrs.alt || "",
        href: attrs.href || "",
        innerText: children.map((child) => child.textContent || child.innerText || "").join(""),
        textContent: children.map((child) => child.textContent || child.innerText || "").join(""),
        __style: style,
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
        },
        closest(selector) {
            let current = this;
            while (current) {
                if (matchesSelector(current, selector)) return current;
                current = current.parentElement;
            }
            return null;
        },
        querySelector(selector) {
            return querySelectorFrom(this, selector, true);
        },
        querySelectorAll(selector) {
            return querySelectorFrom(this, selector, false);
        },
    };

    for (const child of children) {
        if (child && typeof child === "object") {
            child.parentElement = element;
        }
    }

    return element;
}

test("isFeishuWikiOrDocxPage matches feishu wiki and docx urls only", () => {
    assert.equal(isFeishuWikiOrDocxPage({ hostname: "waytoagi.feishu.cn", pathname: "/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e" }), true);
    assert.equal(isFeishuWikiOrDocxPage({ hostname: "waytoagi.feishu.cn", pathname: "/docx/G9fzdabOlocE16x80BXcFXtUnu8" }), true);
    assert.equal(isFeishuWikiOrDocxPage({ hostname: "waytoagi.feishu.cn", pathname: "/folder/abc" }), false);
    assert.equal(isFeishuWikiOrDocxPage({ hostname: "linux.do", pathname: "/t/topic/1" }), false);
});

test("cleanFeishuUrl strips tracking params and hash", () => {
    assert.equal(
        cleanFeishuUrl("https://waytoagi.feishu.cn/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e?dcuId=7403345586610405404#abc"),
        "https://waytoagi.feishu.cn/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e",
    );
});

test("extractFeishuMarkdownFromBlocks keeps path urls intact", () => {
    const text = elementNode("div", {
        className: "block docx-text-block",
        attrs: { "data-block-type": "text", "data-block-id": "100" },
        children: [
            elementNode("a", {
                className: "link contextmenu-without-copyperm",
                attrs: { href: "https://waytoagi.feishu.cn/wiki/BE57wlWV2iDkOvkbYIockX11nTC" },
                children: [textNode("知识库介绍说明")],
            }),
        ],
    });

    assert.equal(
        extractFeishuMarkdownFromBlocks([text], { pageUrl: "https://waytoagi.feishu.cn/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e" }),
        "[知识库介绍说明](https://waytoagi.feishu.cn/wiki/BE57wlWV2iDkOvkbYIockX11nTC)",
    );
});

test("extractFeishuMarkdownFromBlocks keeps feishu block rules isolated", () => {
    const aiSummary = elementNode("div", {
        className: "block docx-ai-summary-block",
        attrs: { "data-block-type": "ai-summary", "data-block-id": "571" },
        children: [],
    });
    const aiSummaryText = elementNode("div", {
        className: "block docx-text-block",
        attrs: { "data-block-type": "text", "data-block-id": "572" },
        children: [textNode("这段 AI 速览内容不应该进入导出的正文")],
    });
    aiSummaryText.parentElement = aiSummary;

    const heading = elementNode("div", {
        className: "block docx-heading1-block",
        attrs: { "data-block-type": "heading1", "data-block-id": "2" },
        children: [
            elementNode("div", {
                children: [
                    elementNode("span", { children: [textNode("🎯 愿景和目标")] }),
                    elementNode("span", { attrs: { "data-enter": "true" }, children: [textNode("​")] }),
                ],
            }),
        ],
    });

    const text = elementNode("div", {
        className: "block docx-text-block",
        attrs: { "data-block-type": "text", "data-block-id": "9" },
        children: [
            elementNode("a", {
                className: "link contextmenu-without-copyperm",
                attrs: { href: "http://waytoAGI.com" },
                children: [textNode("WaytoAGI.com")],
            }),
            elementNode("span", { children: [textNode(" 是社区主页")] }),
        ],
    });

    const callout = elementNode("div", {
        className: "block docx-callout-block",
        attrs: { "data-block-type": "callout", "data-block-id": "3" },
        children: [],
    });
    const calloutText = elementNode("div", {
        className: "block docx-text-block callout-render-unit",
        attrs: { "data-block-type": "text", "data-block-id": "4" },
        children: [textNode("我们的目标是让更多的人因 AI 而强大。")],
    });
    calloutText.parentElement = callout;

    const image = elementNode("div", {
        className: "block docx-image-block",
        attrs: { "data-block-type": "image", "data-block-id": "12" },
        children: [
            elementNode("img", {
                className: "docx-image",
                attrs: {
                    src: "https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/NSbvb3C4yo8qzoxGt9IcLTy5nld/",
                    alt: "飞书文档 - 图片",
                },
            }),
        ],
    });

    assert.equal(
        extractFeishuMarkdownFromBlocks(
            [aiSummary, aiSummaryText, heading, text, calloutText, image],
            { pageUrl: "https://waytoagi.feishu.cn/wiki/QPe5w5g7UisbEkkow8XcDmOpn8e" },
        ),
        [
            "# 🎯 愿景和目标",
            "",
            "[WaytoAGI.com](http://waytoAGI.com/) 是社区主页",
            "",
            "> 我们的目标是让更多的人因 AI 而强大。",
            "",
            "![](https://internal-api-drive-stream.feishu.cn/space/api/box/stream/download/v2/cover/NSbvb3C4yo8qzoxGt9IcLTy5nld/)",
        ].join("\n"),
    );
});
