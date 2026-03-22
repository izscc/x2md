const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractArticleMediaVideos,
  fillArticleVideoPlaceholders,
} = require("../media_helpers.js");

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
