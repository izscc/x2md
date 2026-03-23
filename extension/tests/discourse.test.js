const test = require("node:test");
const assert = require("node:assert/strict");

const {
    isLinuxDoTopicPage,
    buildLinuxDoPostTitle,
    cleanLinuxDoPostUrl,
    extractLinuxDoMarkdown,
} = require("../discourse.js");

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

        if (tag && String(element.tagName || "").toLowerCase() !== tag) {
            return false;
        }

        const className = String(element.className || "");
        for (const cls of classMatches) {
            if (!className.split(/\s+/).includes(cls)) {
                return false;
            }
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
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
        },
        closest(selector) {
            let current = this;
            while (current) {
                if (matchesSelector(current, selector)) {
                    return current;
                }
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

test("isLinuxDoTopicPage only matches linux.do topic pages", () => {
    assert.equal(isLinuxDoTopicPage({ hostname: "linux.do", pathname: "/t/topic/841319" }), true);
    assert.equal(isLinuxDoTopicPage({ hostname: "linux.do", pathname: "/latest" }), false);
    assert.equal(isLinuxDoTopicPage({ hostname: "meta.discourse.org", pathname: "/t/foo/1" }), false);
});

test("buildLinuxDoPostTitle distinguishes topic owner and replies", () => {
    assert.equal(buildLinuxDoPostTitle("手把手教你怎么写2API", 1, "hzruo"), "手把手教你怎么写2API");
    assert.equal(buildLinuxDoPostTitle("手把手教你怎么写2API", 2, "iberxilong"), "手把手教你怎么写2API - iberxilong #2");
});

test("cleanLinuxDoPostUrl strips tracking query from post links", () => {
    assert.equal(
        cleanLinuxDoPostUrl("https://linux.do/t/topic/841319/2?u=zscc.in"),
        "https://linux.do/t/topic/841319/2",
    );
});

test("extractLinuxDoMarkdown keeps discourse originals with site-specific rules", () => {
    const tree = elementNode("div", {
        className: "cooked",
        children: [
            elementNode("h1", {
                children: [
                    elementNode("a", {
                        className: "anchor",
                        attrs: { href: "#p-7682637-h-1" },
                    }),
                    textNode("名词解释"),
                ],
            }),
            elementNode("p", {
                children: [
                    textNode("详情见 "),
                    elementNode("a", {
                        attrs: { href: "/u/iberxilong" },
                        children: [textNode("Iberxilong")],
                    }),
                ],
            }),
            elementNode("a", {
                className: "lightbox",
                attrs: { href: "https://cdn3.linux.do/original/4X/8/8/e/example.png" },
                children: [
                    elementNode("img", {
                        attrs: {
                            src: "https://cdn3.linux.do/optimized/4X/8/8/e/example_2_690x388.png",
                            alt: "example",
                        },
                    }),
                    elementNode("div", {
                        className: "meta",
                        children: [textNode("example 1816×1456 298 KB")],
                    }),
                ],
            }),
            elementNode("pre", {
                children: [
                    elementNode("div", {
                        className: "codeblock-button-wrapper",
                        children: [],
                    }),
                    elementNode("code", {
                        className: "hljs language-js",
                        children: [textNode("console.log('linux.do');")],
                    }),
                ],
            }),
            elementNode("div", {
                className: "cooked-selection-barrier",
                children: [elementNode("br")],
            }),
        ],
    });

    assert.equal(
        extractLinuxDoMarkdown(tree, { pageUrl: "https://linux.do/t/topic/841319" }),
        [
            "# 名词解释",
            "",
            "详情见 [Iberxilong](https://linux.do/u/iberxilong)",
            "",
            "![](https://cdn3.linux.do/original/4X/8/8/e/example.png)",
            "",
            "```js",
            "console.log('linux.do');",
            "```",
        ].join("\n"),
    );
});
