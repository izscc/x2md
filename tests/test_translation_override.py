import unittest

from server import build_markdown, sanitize_unicode_text


BASE_CFG = {
    "filename_format": "{summary}_{date}_{author}",
    "max_filename_length": 60,
    "video_save_path": "/tmp/x2md-videos",
}


class TranslationOverrideMarkdownTests(unittest.TestCase):
    def test_tweet_markdown_prefers_translated_text(self):
        _, content = build_markdown({
            "type": "tweet",
            "text": "Original text",
            "url": "https://x.com/a/status/1",
            "handle": "@alice",
            "prefer_translated_content": True,
            "translation_override": {
                "type": "tweet",
                "text": "译文正文",
            },
        }, BASE_CFG)

        self.assertIn("译文正文", content)
        self.assertNotIn("Original text", content)
        self.assertIn('源: "https://x.com/a/status/1"', content)

    def test_article_markdown_prefers_translated_title_and_body(self):
        _, content = build_markdown({
            "type": "article",
            "article_title": "Original title",
            "article_content": "Original body",
            "url": "https://x.com/i/article/1",
            "handle": "@alice",
            "prefer_translated_content": True,
            "translation_override": {
                "type": "article",
                "article_title": "译文标题",
                "article_content": "译文第一段\n\n译文第二段",
            },
        }, BASE_CFG)

        self.assertIn('title: "译文标题"', content)
        self.assertIn("译文第一段\n\n译文第二段", content)
        self.assertNotIn("Original body", content)


class ImageAltMarkdownTests(unittest.TestCase):
    def test_tweet_image_alt_text_is_written_after_image(self):
        _, content = build_markdown({
            "type": "tweet",
            "text": "GPT Image 2 on ChatGPT",
            "url": "https://x.com/a/status/1",
            "handle": "@alice",
            "images": ["https://pbs.twimg.com/media/watch.jpg?format=jpg&name=small"],
            "image_alt_texts": {
                "https://pbs.twimg.com/media/watch.jpg?format=jpg&name=orig": "Apple Watch ⌚",
            },
        }, BASE_CFG)

        self.assertIn("![1](https://pbs.twimg.com/media/watch.jpg?format=jpg&name=orig)\n```\nApple Watch ⌚\n```", content)

    def test_quote_tweet_image_alt_text_is_written_inside_quote_block(self):
        _, content = build_markdown({
            "type": "tweet",
            "text": "Parent",
            "url": "https://x.com/a/status/1",
            "handle": "@alice",
            "quote_tweet": {
                "text": "Quoted",
                "images": ["https://pbs.twimg.com/media/quote.jpg?name=small"],
                "image_alt_texts": {
                    "https://pbs.twimg.com/media/quote.jpg?name=orig": "Quoted image description",
                },
            },
        }, BASE_CFG)

        self.assertIn("> ![](https://pbs.twimg.com/media/quote.jpg?name=orig)\n> ```\n> Quoted image description\n> ```", content)


class ArticleImageOrderTests(unittest.TestCase):
    def test_article_images_use_markdown_body_order_without_fallback_dump(self):
        _, content = build_markdown({
            "type": "article",
            "article_title": "Article with images",
            "article_content": (
                "第一段\n\n"
                "![](https://pbs.twimg.com/media/inline.jpg?format=jpg&name=orig)\n\n"
                "第二段"
            ),
            "url": "https://x.com/a/status/1",
            "handle": "@alice",
            "images": [
                "https://pbs.twimg.com/media/inline.jpg?format=jpg&name=small",
                "https://pbs.twimg.com/media/missing.jpg?format=jpg&name=small",
            ],
        }, BASE_CFG)

        body = content.split("---\n", 2)[-1].strip()
        self.assertTrue(body.startswith("第一段"), body)
        self.assertEqual(content.count("inline.jpg"), 1)
        self.assertLess(content.index("第一段"), content.index("inline.jpg"))
        self.assertNotIn("missing.jpg", content)


class UnicodeSanitizerTests(unittest.TestCase):
    def test_lone_surrogate_is_removed_before_utf8_write(self):
        _, content = build_markdown({
            "type": "article",
            "article_title": "Bad unicode \ud83d",
            "article_content": "正文里有非法字符：\ud83d，但保存不应失败",
            "url": "https://x.com/a/status/1",
            "handle": "@alice",
        }, BASE_CFG)

        cleaned = sanitize_unicode_text(content)
        self.assertNotIn("\ud83d", cleaned)
        cleaned.encode("utf-8")


if __name__ == "__main__":
    unittest.main()
