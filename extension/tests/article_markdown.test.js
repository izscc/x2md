const test = require("node:test");
const assert = require("node:assert/strict");

require("../dom_utils.js");

const {
    extractArticleMarkdown,
    isBlockElement,
} = require("../article_markdown.js");

function textNode(text) {
    return {
        nodeType: 3,
        textContent: text,
    };
}


function matchesTestSelector(element, selector) {
    if (!element || element.nodeType !== 1) return false;
    const selectors = String(selector).split(",").map((part) => part.trim());
    for (const sel of selectors) {
        const dataTestId = sel.match(/^\[data-testid="([^"]+)"\]$/);
        if (dataTestId && element.getAttribute("data-testid") === dataTestId[1]) return true;

        const articleTestId = sel.match(/^article\[data-testid="([^"]+)"\]$/);
        if (articleTestId && element.tagName === "ARTICLE" && element.getAttribute("data-testid") === articleTestId[1]) return true;

        const linkHrefContains = sel.match(/^a\[href\*="([^"]+)"\]$/);
        if (linkHrefContains && element.tagName === "A" && String(element.getAttribute("href") || "").includes(linkHrefContains[1])) return true;
    }
    return false;
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
        innerText: children.map((child) => child.textContent || child.innerText || "").join(""),
        textContent: children.map((child) => child.textContent || child.innerText || "").join(""),
        getAttribute(name) {
            return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
        },
        closest(selector) {
            let current = element;
            while (current) {
                if (matchesTestSelector(current, selector)) return current;
                current = current.parentElement;
            }
            return null;
        },
        __style: style,
    };

    for (const child of children) {
        if (child && typeof child === "object") {
            child.parentElement = element;
        }
    }

    return element;
}

function getComputedStyle(element) {
    return element.__style || {};
}

test("isBlockElement keeps inline draft div wrappers inline", () => {
    const inlineWrapper = elementNode("div", {
        className: "css-175oi2r r-1loqt21",
        style: { display: "inline" },
    });
    const blockWrapper = elementNode("div", {
        className: "public-DraftStyleDefault-block public-DraftStyleDefault-ltr",
        style: { display: "block" },
    });

    assert.equal(isBlockElement(inlineWrapper, { getComputedStyle }), false);
    assert.equal(isBlockElement(blockWrapper, { getComputedStyle }), true);
});

test("extractArticleMarkdown preserves inline link layout inside draft block wrappers", () => {
    const tree = elementNode("li", {
        children: [
            elementNode("div", {
                className: "public-DraftStyleDefault-block public-DraftStyleDefault-ltr",
                style: { display: "block" },
                children: [
                    elementNode("span", {
                        children: [textNode("Go to ")],
                    }),
                    elementNode("div", {
                        className: "css-175oi2r r-1loqt21 r-1471scf",
                        style: { display: "inline", whiteSpace: "pre-wrap" },
                        children: [
                            elementNode("a", {
                                attrs: { href: "http://claude.ai/" },
                                children: [
                                    elementNode("span", {
                                        style: { fontWeight: "700" },
                                        children: [textNode("claude.ai")],
                                    }),
                                ],
                            }),
                        ],
                    }),
                    elementNode("span", {
                        children: [textNode(", the regular chat version.")],
                    }),
                ],
            }),
        ],
    });

    assert.equal(
        extractArticleMarkdown(tree, { getComputedStyle }),
        "- Go to [**claude.ai**](http://claude.ai/), the regular chat version.",
    );
});

test("extractArticleMarkdown preserves inline mention layout", () => {
    const tree = elementNode("div", {
        className: "public-DraftStyleDefault-block public-DraftStyleDefault-ltr",
        style: { display: "block" },
        children: [
            elementNode("span", { children: [textNode("Follow me on X → ")] }),
            elementNode("div", {
                style: { display: "inline" },
                children: [
                    elementNode("a", {
                        attrs: { href: "https://x.com/@rubenhassid" },
                        children: [elementNode("span", { children: [textNode("@rubenhassid")] })],
                    }),
                ],
            }),
        ],
    });

    assert.equal(
        extractArticleMarkdown(tree, { getComputedStyle }),
        "Follow me on X → [@rubenhassid](https://x.com/@rubenhassid)",
    );
});

test("extractArticleMarkdown folds a standalone language label into the following code fence", () => {
    const tree = elementNode("div", {
        children: [
            elementNode("div", {
                className: "public-DraftStyleDefault-block public-DraftStyleDefault-ltr",
                style: { display: "block" },
                children: [textNode("json")],
            }),
            elementNode("pre", {
                children: [textNode('{\n  "hooks": {\n    "PostToolUse": []\n  }\n}')],
            }),
        ],
    });

    assert.equal(
        extractArticleMarkdown(tree, { getComputedStyle }),
        '```json\n{\n  "hooks": {\n    "PostToolUse": []\n  }\n}\n```',
    );
});

test("extractArticleMarkdown keeps unlabeled code fences in the default format", () => {
    const tree = elementNode("div", {
        children: [
            elementNode("pre", {
                children: [textNode("/context\n/clear\n/compact")],
            }),
        ],
    });

    assert.equal(
        extractArticleMarkdown(tree, { getComputedStyle }),
        "```\n/context\n/clear\n/compact\n```",
    );
});


test("extractArticleMarkdown formats embedded X quote tweet without engagement metadata", () => {
    const tree = elementNode("div", {
        attrs: { "data-testid": "simpleTweet" },
        style: { display: "block" },
        children: [
            elementNode("div", {
                attrs: { "data-testid": "User-Name" },
                children: [textNode("BeautyVerse\n@BeautyVerse_Lab\n·\n3月9日")],
            }),
            elementNode("a", {
                attrs: { href: "/BeautyVerse_Lab/status/2031003251555066008" },
                children: [textNode("3月9日")],
            }),
            elementNode("div", {
                attrs: { "data-testid": "tweetText" },
                children: [textNode("—\nDear algorithm, these are SFW AI-generated illustrations.")],
            }),
            elementNode("a", {
                attrs: { href: "/BeautyVerse_Lab/status/2031003251555066008/photo/1" },
                children: [elementNode("img", {
                    attrs: { src: "https://pbs.twimg.com/media/top.jpg?format=jpg&name=small" },
                })],
            }),
            elementNode("div", { attrs: { "data-testid": "reply" }, children: [textNode("5")] }),
            elementNode("div", { attrs: { "data-testid": "retweet" }, children: [textNode("10")] }),
            elementNode("div", { attrs: { "data-testid": "like" }, children: [textNode("125")] }),
            elementNode("a", {
                attrs: { href: "/BeautyVerse_Lab/status/2031003251555066008/analytics" },
                children: [textNode("2.9万")],
            }),
            elementNode("button", { children: [textNode("Download")] }),
            elementNode("div", { children: [textNode("由 AI 生成")] }),
            elementNode("a", {
                attrs: { href: "/BeautyVerse_Lab/status/2030916468729352332/photo/1" },
                children: [elementNode("img", {
                    attrs: { src: "https://pbs.twimg.com/media/nested.jpg?format=jpg&name=small" },
                })],
            }),
        ],
    });

    const markdown = extractArticleMarkdown(tree, { getComputedStyle });

    assert.match(markdown, /^> \[!quote\] 引用推文/);
    assert.match(markdown, /Dear algorithm, these are SFW AI-generated illustrations\./);
    assert.match(markdown, /https:\/\/pbs\.twimg\.com\/media\/top\.jpg\?format=jpg&name=orig/);
    assert.match(markdown, /原文：https:\/\/x\.com\/BeautyVerse_Lab\/status\/2031003251555066008/);
    assert.doesNotMatch(markdown, /\b5\b|\b10\b|\b125\b|2\.9万|Download|由 AI 生成|nested\.jpg/);
});
