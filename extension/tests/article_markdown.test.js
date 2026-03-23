const test = require("node:test");
const assert = require("node:assert/strict");

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
        closest() {
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
