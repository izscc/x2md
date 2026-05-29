import os
import tempfile
import unittest

import server


class ProfileCaptureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.state_file = os.path.join(self.tmp.name, "profile_capture_state.json")
        self.old_state_file = server.PROFILE_CAPTURE_STATE_FILE
        server.PROFILE_CAPTURE_STATE_FILE = self.state_file

    def tearDown(self):
        server.PROFILE_CAPTURE_STATE_FILE = self.old_state_file
        self.tmp.cleanup()

    def test_profile_tweets_are_grouped_by_day_and_skipped_next_time(self):
        cfg = {
            "save_paths": [self.tmp.name],
            "profile_capture_save_path": "",
        }
        payload = {
            "mode": "tweets",
            "range_label": "当日",
            "profile": {
                "handle": "alice",
                "displayName": "Alice",
                "profileUrl": "https://x.com/alice",
            },
            "items": [
                {
                    "url": "https://x.com/alice/status/1",
                    "published": "2026-05-29T08:00:00Z",
                    "text": "hello",
                    "images": [],
                    "videos": [],
                },
                {
                    "url": "https://x.com/alice/status/2",
                    "published": "2026-05-29T07:00:00Z",
                    "text": "world",
                    "images": [],
                    "videos": [],
                },
            ],
        }

        first = server.handle_profile_capture_save(payload, cfg)
        self.assertEqual(first["skipped"], 0)
        self.assertEqual(len(first["saved"]), 1)
        with open(first["saved"][0], encoding="utf-8") as f:
            content = f.read()
        self.assertIn("# Alice 推文 2026-05-29", content)
        self.assertIn("hello", content)
        self.assertIn("world", content)

        second = server.handle_profile_capture_save(payload, cfg)
        self.assertEqual(second["skipped"], 2)
        self.assertEqual(second["saved"], [])

    def test_profile_articles_are_saved_one_file_each(self):
        cfg = {
            "save_paths": [self.tmp.name],
            "profile_capture_save_path": "",
        }
        payload = {
            "mode": "articles",
            "profile": {
                "handle": "alice",
                "displayName": "Alice",
                "profileUrl": "https://x.com/alice",
            },
            "items": [
                {
                    "url": "https://x.com/alice/article/123",
                    "published": "2026-05-28T08:00:00Z",
                    "article_title": "Long Note",
                    "article_content": "body\n\n![](https://pbs.twimg.com/media/existing.jpg?format=jpg&name=orig)",
                    "images": [
                        "https://pbs.twimg.com/media/existing.jpg?format=jpg&name=small",
                        "https://pbs.twimg.com/media/new.jpg?format=jpg&name=small",
                    ],
                }
            ],
        }

        result = server.handle_profile_capture_save(payload, cfg)
        self.assertEqual(result["skipped"], 0)
        self.assertEqual(len(result["saved"]), 1)
        with open(result["saved"][0], encoding="utf-8") as f:
            content = f.read()
        self.assertIn("# Long Note", content)
        self.assertIn("body", content)
        self.assertEqual(content.count("existing.jpg"), 1)
        self.assertIn("https://pbs.twimg.com/media/new.jpg?format=jpg&name=orig", content)


if __name__ == "__main__":
    unittest.main()
