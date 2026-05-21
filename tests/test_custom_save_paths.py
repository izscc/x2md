import unittest

from server import resolve_save_paths_for_request


class CustomSavePathTests(unittest.TestCase):
    def test_default_save_paths_are_used_without_custom_selection(self):
        paths, using_custom = resolve_save_paths_for_request({
            "save_paths": ["/vault/default"],
            "custom_save_paths": [{"name": "生图类", "path": "/vault/images"}],
        }, {})

        self.assertEqual(paths, ["/vault/default"])
        self.assertFalse(using_custom)

    def test_configured_custom_save_path_is_selected(self):
        paths, using_custom = resolve_save_paths_for_request({
            "save_paths": ["/vault/default"],
            "custom_save_paths": [{"name": "生图类", "path": "/vault/images"}],
        }, {
            "custom_save_path_name": "生图类",
            "custom_save_path": "/vault/images",
        })

        self.assertEqual(paths, ["/vault/images"])
        self.assertTrue(using_custom)

    def test_unknown_custom_save_path_is_rejected(self):
        with self.assertRaises(ValueError):
            resolve_save_paths_for_request({
                "save_paths": ["/vault/default"],
                "custom_save_paths": [{"name": "生图类", "path": "/vault/images"}],
            }, {
                "custom_save_path_name": "未知",
                "custom_save_path": "/tmp/other",
            })


if __name__ == "__main__":
    unittest.main()
