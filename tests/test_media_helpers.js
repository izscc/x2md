const assert = require("assert");

const { extractArticleMarkdownFromGraphQL } = require("../extension/media_helpers.js");

function testMarkdownAtomicEntityIsPreserved() {
    const result = {
        article: {
            article_results: {
                result: {
                    title: "Article with prompt",
                    content_state: {
                        blocks: [
                            { type: "unstyled", text: "before", entityRanges: [], inlineStyleRanges: [], data: {} },
                            { type: "atomic", text: " ", entityRanges: [{ key: 0, offset: 0, length: 1 }], inlineStyleRanges: [], data: {} },
                            { type: "unstyled", text: "after", entityRanges: [], inlineStyleRanges: [], data: {} },
                        ],
                        entityMap: [
                            {
                                key: 0,
                                value: {
                                    type: "MARKDOWN",
                                    mutability: "Mutable",
                                    data: { markdown: "```\nkeep this prompt\n```" },
                                },
                            },
                        ],
                    },
                },
            },
        },
    };

    const article = extractArticleMarkdownFromGraphQL(result);

    assert(article, "article should be parsed");
    assert(
        article.content.includes("before\n\n```\nkeep this prompt\n```\n\nafter"),
        article.content,
    );
    assert.strictEqual((article.content.match(/```/g) || []).length, 2, article.content);
}

function testGraphqlLinkEntityIsRenderedInline() {
    const result = {
        article: {
            article_results: {
                result: {
                    title: "Article with link",
                    content_state: {
                        blocks: [
                            {
                                type: "unstyled",
                                text: "可以用 Devilstore/Glados-Railgun-checkin 里面的自动签到。",
                                entityRanges: [{ key: 0, offset: 4, length: 33 }],
                                inlineStyleRanges: [{ style: "BOLD", offset: 4, length: 33 }],
                                data: {},
                            },
                        ],
                        entityMap: [
                            {
                                key: 0,
                                value: {
                                    type: "LINK",
                                    mutability: "MUTABLE",
                                    data: { url: "https://github.com/Devilstore/Glados-Railgun-checkin" },
                                },
                            },
                        ],
                    },
                },
            },
        },
    };

    const article = extractArticleMarkdownFromGraphQL(result);

    assert(article, "article should be parsed");
    assert(
        article.content.includes("**[github.com/Devilstore/Glados-Railgun-checkin](https://github.com/Devilstore/Glados-Railgun-checkin)**"),
        article.content,
    );
    assert(!article.content.includes("http**"), article.content);
}

testMarkdownAtomicEntityIsPreserved();
testGraphqlLinkEntityIsRenderedInline();
console.log("media_helpers tests passed");
