import unittest

from server import build_markdown


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


if __name__ == "__main__":
    unittest.main()
