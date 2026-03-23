const test = require("node:test");
const assert = require("node:assert/strict");

const {
    cleanWechatUrl,
    convertWechatNodeToMarkdown,
    extractWechatMarkdown,
    isWechatArticlePage,
    resolveWechatImageUrl,
} = require("../wechat.js");

function textNode(text) {
    return {
        nodeType: 3,
        textContent: text,
        parentElement: null,
    };
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
        currentSrc: attrs.currentSrc || "",
        alt: attrs.alt || "",
        href: attrs.href || "",
        style,
        innerText: children.map((child) => child.textContent || child.innerText || "").join(""),
        textContent: children.map((child) => child.textContent || child.innerText || "").join(""),
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

        const cn = String(element.className || "");
        for (const cls of classMatches) {
            if (!cn.split(/\s+/).includes(cls)) return false;
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

test("isWechatArticlePage matches mp.weixin.qq.com article urls", () => {
    assert.equal(isWechatArticlePage({ hostname: "mp.weixin.qq.com", pathname: "/s/abc123" }), true);
    assert.equal(isWechatArticlePage({ hostname: "mp.weixin.qq.com", pathname: "/s" }), true);
    assert.equal(isWechatArticlePage({ hostname: "mp.weixin.qq.com", pathname: "/s?__biz=MzA3MDM3NjE5NQ==" }), true);
    assert.equal(isWechatArticlePage({ hostname: "mp.weixin.qq.com", pathname: "/mp/homepage" }), false);
    assert.equal(isWechatArticlePage({ hostname: "linux.do", pathname: "/t/topic/1" }), false);
    assert.equal(isWechatArticlePage({ hostname: "x.com", pathname: "/foo/status/1" }), false);
});

test("cleanWechatUrl strips tracking params, keeps biz/mid/idx/sn", () => {
    assert.equal(
        cleanWechatUrl("https://mp.weixin.qq.com/s?__biz=MzA3MDM3NjE5NQ==&mid=2650100&idx=1&sn=abc123&chksm=xxx&scene=21#wechat_redirect"),
        "https://mp.weixin.qq.com/s?__biz=MzA3MDM3NjE5NQ%3D%3D&mid=2650100&idx=1&sn=abc123",
    );
});

test("cleanWechatUrl keeps short url format clean", () => {
    assert.equal(
        cleanWechatUrl("https://mp.weixin.qq.com/s/AbCdEfGh123?from=timeline#rd"),
        "https://mp.weixin.qq.com/s/AbCdEfGh123",
    );
});

test("resolveWechatImageUrl cleans mmbiz CDN tracking params", () => {
    assert.equal(
        resolveWechatImageUrl("https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png&tp=webp&wxfrom=5&wx_lazy=1"),
        "https://mmbiz.qpic.cn/mmbiz_png/abc/640?wx_fmt=png",
    );
});

test("resolveWechatImageUrl returns empty for data urls", () => {
    assert.equal(resolveWechatImageUrl("data:image/png;base64,abc"), "");
    assert.equal(resolveWechatImageUrl(""), "");
});

test("extractWechatMarkdown converts basic HTML structure", () => {
    const container = elementNode("div", {
        attrs: { id: "js_content" },
        children: [
            elementNode("h2", { children: [textNode("第一章")] }),
            elementNode("p", {
                children: [
                    textNode("这是一段"),
                    elementNode("strong", { children: [textNode("加粗")] }),
                    textNode("文字。"),
                ],
            }),
            elementNode("blockquote", {
                children: [
                    elementNode("p", { children: [textNode("这是引用内容")] }),
                ],
            }),
            elementNode("p", {
                children: [
                    elementNode("img", {
                        attrs: {
                            "data-src": "https://mmbiz.qpic.cn/mmbiz_jpg/abc/640?wx_fmt=jpeg",
                        },
                    }),
                ],
            }),
        ],
    });

    const result = extractWechatMarkdown(container, {});
    assert.ok(result.includes("## 第一章"));
    assert.ok(result.includes("**加粗**"));
    assert.ok(result.includes("> 这是引用内容"));
    assert.ok(result.includes("![](https://mmbiz.qpic.cn/mmbiz_jpg/abc/640?wx_fmt=jpeg)"));
});

test("extractWechatMarkdown handles code blocks", () => {
    const container = elementNode("div", {
        attrs: { id: "js_content" },
        children: [
            elementNode("pre", {
                children: [
                    elementNode("code", {
                        className: "language-python",
                        children: [textNode("print('hello')")],
                    }),
                ],
            }),
        ],
    });

    const result = extractWechatMarkdown(container, {});
    assert.ok(result.includes("```python"));
    assert.ok(result.includes("print('hello')"));
    assert.ok(result.includes("```"));
});

test("extractWechatMarkdown handles links", () => {
    const container = elementNode("div", {
        attrs: { id: "js_content" },
        children: [
            elementNode("p", {
                children: [
                    textNode("参考 "),
                    elementNode("a", {
                        attrs: { href: "https://example.com/article" },
                        children: [textNode("这篇文章")],
                    }),
                ],
            }),
        ],
    });

    const result = extractWechatMarkdown(container, {});
    assert.ok(result.includes("[这篇文章](https://example.com/article)"));
});

test("extractWechatMarkdown skips script, style and functional areas", () => {
    const container = elementNode("div", {
        attrs: { id: "js_content" },
        children: [
            elementNode("p", { children: [textNode("正文内容")] }),
            elementNode("script", { children: [textNode("var a = 1;")] }),
            elementNode("style", { children: [textNode(".foo { color: red; }")] }),
            elementNode("div", { className: "reward_area", children: [textNode("打赏")] }),
        ],
    });

    const result = extractWechatMarkdown(container, {});
    assert.ok(result.includes("正文内容"));
    assert.ok(!result.includes("var a = 1"));
    assert.ok(!result.includes("color: red"));
    assert.ok(!result.includes("打赏"));
});

test("extractWechatMarkdown handles ordered list", () => {
    const ol = elementNode("ol", {
        children: [
            elementNode("li", { children: [textNode("第一项")] }),
            elementNode("li", { children: [textNode("第二项")] }),
        ],
    });
    // Set up children array on parent for index detection
    ol.children = ol.childNodes;

    const container = elementNode("div", {
        attrs: { id: "js_content" },
        children: [ol],
    });

    const result = extractWechatMarkdown(container, {});
    assert.ok(result.includes("1. 第一项"));
    assert.ok(result.includes("2. 第二项"));
});
