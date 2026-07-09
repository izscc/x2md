const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractArticleMarkdownFromGraphQL,
  extractArticleMediaVideos,
  fillArticleVideoPlaceholders,
  mergeTweetImagesWithDomFallback,
  normalizeTweetMediaUrlForCompare,
} = require("../media_helpers.js");

test("normalizeTweetMediaUrlForCompare treats X media extension and format variants as one image", () => {
  assert.equal(
    normalizeTweetMediaUrlForCompare("https://pbs.twimg.com/media/a.jpg?format=jpg&name=small"),
    "https://pbs.twimg.com/media/a",
  );
  assert.equal(
    normalizeTweetMediaUrlForCompare("https://pbs.twimg.com/media/a?format=jpg&name=orig"),
    "https://pbs.twimg.com/media/a",
  );
});

test("mergeTweetImagesWithDomFallback keeps DOM media missing from GraphQL", () => {
  assert.deepEqual(
    mergeTweetImagesWithDomFallback(
      ["https://pbs.twimg.com/media/a.jpg?format=jpg&name=orig"],
      [
        "https://pbs.twimg.com/media/a.jpg?format=jpg&name=small",
        "https://pbs.twimg.com/media/a?format=jpg&name=small",
        "https://pbs.twimg.com/media/b.jpg?format=jpg&name=small",
      ],
    ),
    [
      "https://pbs.twimg.com/media/a.jpg?format=jpg&name=orig",
      "https://pbs.twimg.com/media/b.jpg?format=jpg&name=small",
    ],
  );
});

test("extractArticleMediaVideos returns only referenced inline article videos", () => {
  const result = {
    article: {
      article_results: {
        result: {
          content_state: {
            entityMap: [
              {
                value: {
                  data: {
                    mediaItems: [
                      { mediaCategory: "AmplifyVideo", mediaId: "111" },
                    ],
                  },
                },
              },
              {
                value: {
                  data: {
                    mediaItems: [
                      { mediaCategory: "DraftTweetImage", mediaId: "222" },
                    ],
                  },
                },
              },
              {
                value: {
                  data: {
                    mediaItems: [
                      { mediaCategory: "AmplifyVideo", mediaId: "333" },
                    ],
                  },
                },
              },
            ],
          },
          media_entities: [
            {
              media_id: "111",
              media_info: {
                __typename: "ApiVideo",
                duration_millis: 1200,
                variants: [
                  { content_type: "video/mp4", bit_rate: 256000, url: "https://video.twimg.com/amplify_video/111/vid/320x180/low.mp4" },
                  { content_type: "video/mp4", bit_rate: 2176000, url: "https://video.twimg.com/amplify_video/111/vid/1280x720/high.mp4" },
                  { content_type: "application/x-mpegURL", url: "https://video.twimg.com/amplify_video/111/pl/playlist.m3u8" },
                ],
              },
            },
            {
              media_id: "333",
              media_info: {
                __typename: "ApiVideo",
                duration_millis: 3400,
                variants: [
                  { content_type: "video/mp4", bitrate: 832000, url: "https://video.twimg.com/amplify_video/333/vid/640x360/mid.mp4" },
                  { content_type: "video/mp4", bitrate: 10368000, url: "https://video.twimg.com/amplify_video/333/vid/1920x1080/high.mp4" },
                ],
              },
            },
            {
              media_id: "444",
              media_info: {
                __typename: "ApiVideo",
                duration_millis: 5600,
                variants: [
                  { content_type: "video/mp4", bit_rate: 2176000, url: "https://video.twimg.com/amplify_video/444/vid/1280x720/high.mp4" },
                ],
              },
            },
          ],
        },
      },
    },
  };

  assert.deepEqual(extractArticleMediaVideos(result), {
    videos: [
      "https://video.twimg.com/amplify_video/111/vid/1280x720/high.mp4",
      "https://video.twimg.com/amplify_video/333/vid/1920x1080/high.mp4",
    ],
    videoDurations: [1200, 3400],
  });
});

test("fillArticleVideoPlaceholders injects matches and preserves missing holders when requested", () => {
  const content = [
    "Intro",
    "[[VIDEO_HOLDER_111]]",
    "[[VIDEO_HOLDER_999]]",
  ].join("\n");

  const filled = fillArticleVideoPlaceholders(content, [
    "https://video.twimg.com/amplify_video/111/vid/1280x720/high.mp4",
  ], { preserveMissing: true });

  assert.equal(
    filled,
    [
      "Intro",
      "",
      "[MEDIA_VIDEO_URL:https://video.twimg.com/amplify_video/111/vid/1280x720/high.mp4]",
      "",
      "[[VIDEO_HOLDER_999]]",
    ].join("\n"),
  );
});

test("fillArticleVideoPlaceholders collapses only adjacent identical holders", () => {
  const content = [
    "[[VIDEO_HOLDER_111]]",
    "[[VIDEO_HOLDER_111]]",
    "[[VIDEO_HOLDER_222]]",
    "[[VIDEO_HOLDER_333]]",
    "[[VIDEO_HOLDER_333]]",
  ].join("\n");

  const filled = fillArticleVideoPlaceholders(content, [
    "https://video.twimg.com/amplify_video/111/vid/1280x720/high.mp4",
    "https://video.twimg.com/amplify_video/222/vid/1280x720/high.mp4",
    "https://video.twimg.com/amplify_video/333/vid/1280x720/high.mp4",
  ]);

  assert.equal(
    filled,
    [
      "",
      "[MEDIA_VIDEO_URL:https://video.twimg.com/amplify_video/111/vid/1280x720/high.mp4]",
      "",
      "[MEDIA_VIDEO_URL:https://video.twimg.com/amplify_video/222/vid/1280x720/high.mp4]",
      "",
      "[MEDIA_VIDEO_URL:https://video.twimg.com/amplify_video/333/vid/1280x720/high.mp4]",
      "",
    ].join("\n"),
  );
});

test("extractArticleMarkdownFromGraphQL converts X article rich content and media", () => {
  const result = {
    article: {
      article_results: {
        result: {
          title: "Article Title",
          metadata: { first_published_at_secs: 1770000000 },
          cover_media: {
            media_info: { original_img_url: "https://pbs.twimg.com/media/cover.jpg" },
          },
          content_state: {
            blocks: [
              { key: "a", type: "unstyled", text: "Hello world", inlineStyleRanges: [{ offset: 6, length: 5, style: "BOLD" }] },
              { key: "b", type: "atomic", text: "", entityRanges: [{ key: 0, offset: 0, length: 1 }] },
              { key: "c", type: "unordered-list-item", text: "one" },
            ],
            entityMap: [
              {
                key: "0",
                value: {
                  type: "MEDIA",
                  data: { mediaItems: [{ mediaId: "222", mediaCategory: "DraftTweetImage" }] },
                },
              },
            ],
          },
          media_entities: [
            {
              media_id: "222",
              media_info: { original_img_url: "https://pbs.twimg.com/media/body.png" },
            },
          ],
        },
      },
    },
  };

  const article = extractArticleMarkdownFromGraphQL(result);
  assert.equal(article.title, "Article Title");
  assert.match(article.content, /!\[]\(https:\/\/pbs\.twimg\.com\/media\/cover\.jpg\?format=jpg&name=orig\)/);
  assert.match(article.content, /Hello \*\*world\*\*/);
  assert.match(article.content, /!\[]\(https:\/\/pbs\.twimg\.com\/media\/body\.png\?format=png&name=orig\)/);
  assert.match(article.content, /- one/);
  assert.deepEqual(article.images, [
    "https://pbs.twimg.com/media/cover.jpg?format=jpg&name=orig",
    "https://pbs.twimg.com/media/body.png?format=png&name=orig",
  ]);
});

test("extractArticleMarkdownFromGraphQL keeps atomic code block entities", () => {
  const result = {
    article: {
      article_results: {
        result: {
          title: "Code Article",
          content_state: {
            blocks: [
              { key: "a", type: "unstyled", text: "Install:" },
              { key: "b", type: "atomic", text: " ", entityRanges: [{ key: 0, offset: 0, length: 1 }] },
            ],
            entityMap: [
              {
                key: "0",
                value: {
                  type: "CODE_BLOCK",
                  data: {
                    text: "npm i -g openskills",
                    language: "bash",
                  },
                },
              },
            ],
          },
          media_entities: [],
        },
      },
    },
  };

  const article = extractArticleMarkdownFromGraphQL(result);
  assert.match(article.content, /Install:/);
  assert.match(article.content, /```bash\nnpm i -g openskills\n```/);
});

test("extractArticleMarkdownFromGraphQL keeps Draft code-block blocks", () => {
  const result = {
    article: {
      article_results: {
        result: {
          title: "Code Article",
          content_state: {
            blocks: [
              {
                key: "a",
                type: "code-block",
                text: "ln -s ~/.agent/skills ~/.gemini/antigravity/skills",
                data: { language: "sh" },
              },
            ],
            entityMap: [],
          },
          media_entities: [],
        },
      },
    },
  };

  const article = extractArticleMarkdownFromGraphQL(result);
  assert.match(article.content, /```sh\nln -s ~\/.agent\/skills ~\/.gemini\/antigravity\/skills\n```/);
});
