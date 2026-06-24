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

testMarkdownAtomicEntityIsPreserved();
console.log("media_helpers tests passed");
