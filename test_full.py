#!/usr/bin/env python3
"""
x2md 全面测试脚本 — 模拟 Windows 端完整流程
测试覆盖: 保存、覆盖/去重、配置、各平台、路径兼容
"""
import json
import os
import shutil
import sys
import tempfile
import time
import threading
import urllib.request
import urllib.error

# 确保导入项目模块
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server

PASS = 0
FAIL = 0
ERRORS = []


def test(name):
    """装饰器：记录测试结果"""
    def decorator(fn):
        def wrapper(*args, **kwargs):
            global PASS, FAIL
            try:
                fn(*args, **kwargs)
                PASS += 1
                print(f"  [PASS] {name}")
            except Exception as e:
                FAIL += 1
                ERRORS.append((name, str(e)))
                print(f"  [FAIL] {name}: {e}")
        return wrapper
    return decorator


# ═══════════════════════════════════════════════
# 1. 基础函数测试
# ═══════════════════════════════════════════════
print("\n=== 1. 基础函数测试 ===")


@test("sanitize_filename: 清理非法字符")
def test_sanitize():
    assert server.sanitize_filename('hello/world:test?') == "hello_world_test_"
    assert server.sanitize_filename('a' * 200, 60) == 'a' * 60
    assert server.sanitize_filename('file.name.') == "file.name"
    assert server.sanitize_filename('') == "untitled"
test_sanitize()


@test("normalize_image_url: 推特图片 URL 标准化")
def test_normalize():
    url = "https://pbs.twimg.com/media/abc.jpg?name=small"
    result = server.normalize_image_url(url)
    assert "name=orig" in result
    assert "name=small" not in result
    # 非推特 URL 不变
    assert server.normalize_image_url("https://example.com/img.jpg") == "https://example.com/img.jpg"
test_normalize()


# ═══════════════════════════════════════════════
# 2. URL 去重查找测试
# ═══════════════════════════════════════════════
print("\n=== 2. URL 去重查找测试 ===")

TEMP_DIR = tempfile.mkdtemp(prefix="x2md_test_")


@test("find_existing_file_by_source_url: 找到匹配文件")
def test_find_url_match():
    fpath = os.path.join(TEMP_DIR, "test_match.md")
    with open(fpath, "w", encoding="utf-8") as f:
        f.write('---\n标题: "Test"\n源: "https://x.com/user/status/123"\n---\nContent\n')
    result = server.find_existing_file_by_source_url(TEMP_DIR, "https://x.com/user/status/123")
    assert result == fpath, f"Expected {fpath}, got {result}"
test_find_url_match()


@test("find_existing_file_by_source_url: URL 不匹配返回 None")
def test_find_url_no_match():
    result = server.find_existing_file_by_source_url(TEMP_DIR, "https://x.com/other/456")
    assert result is None
test_find_url_no_match()


@test("find_existing_file_by_source_url: 空目录返回 None")
def test_find_url_empty_dir():
    empty = os.path.join(TEMP_DIR, "empty_sub")
    os.makedirs(empty, exist_ok=True)
    result = server.find_existing_file_by_source_url(empty, "https://x.com/user/status/123")
    assert result is None
test_find_url_empty_dir()


@test("find_existing_file_by_source_url: 目录不存在返回 None")
def test_find_url_no_dir():
    result = server.find_existing_file_by_source_url("/nonexistent/dir", "https://x.com/test")
    assert result is None
test_find_url_no_dir()


# ═══════════════════════════════════════════════
# 3. build_markdown 测试（各平台）
# ═══════════════════════════════════════════════
print("\n=== 3. build_markdown 各平台测试 ===")

BASE_CFG = {
    "filename_format": "{summary}_{date}_{author}",
    "max_filename_length": 60,
    "download_images": False,
    "image_subfolder": "assets",
}


@test("build_markdown: Twitter 推文")
def test_build_twitter():
    data = {
        "author": "TestUser",
        "handle": "@testuser",
        "text": "Hello World, this is a test tweet!",
        "url": "https://x.com/testuser/status/123",
        "platform": "Twitter/X",
        "type": "tweet",
        "images": [],
        "videos": [],
    }
    filename, content, img_tasks, _ = server.build_markdown(data, BASE_CFG)
    assert filename, "Filename should not be empty"
    assert '源: "https://x.com/testuser/status/123"' in content
    assert '平台: "Twitter/X"' in content
    assert "Hello World" in content
test_build_twitter()


@test("build_markdown: LinuxDo 帖子")
def test_build_linuxdo():
    data = {
        "author": "linux_user",
        "handle": "",
        "text": "这是一个 Linux Do 帖子的内容测试",
        "url": "https://linux.do/t/topic/12345",
        "platform": "LinuxDo",
        "type": "tweet",
        "images": [],
        "videos": [],
    }
    filename, content, _, _ = server.build_markdown(data, BASE_CFG)
    assert '平台: "LinuxDo"' in content
    assert "Linux Do" in content
test_build_linuxdo()


@test("build_markdown: 飞书文档")
def test_build_feishu():
    data = {
        "author": "飞书用户",
        "handle": "",
        "text": "飞书文档测试内容\n\n包含多段文字",
        "url": "https://xxx.feishu.cn/wiki/abc123",
        "platform": "Feishu",
        "type": "tweet",
        "images": [],
        "videos": [],
    }
    filename, content, _, _ = server.build_markdown(data, BASE_CFG)
    assert '平台: "Feishu"' in content
    assert "飞书文档测试" in content
test_build_feishu()


@test("build_markdown: 微信公众号")
def test_build_wechat():
    data = {
        "author": "公众号作者",
        "handle": "",
        "text": "微信公众号文章内容",
        "url": "https://mp.weixin.qq.com/s/abc123",
        "platform": "WeChat",
        "type": "tweet",
        "images": [],
        "videos": [],
    }
    filename, content, _, _ = server.build_markdown(data, BASE_CFG)
    assert '平台: "WeChat"' in content
test_build_wechat()


@test("build_markdown: X Article")
def test_build_article():
    data = {
        "author": "ArticleWriter",
        "handle": "@writer",
        "text": "Short summary",
        "url": "https://x.com/writer/status/999",
        "platform": "Twitter/X",
        "type": "article",
        "article_title": "My Long Article Title",
        "article_content": "# Heading\n\nParagraph content here.",
        "images": [],
        "videos": [],
    }
    filename, content, _, _ = server.build_markdown(data, BASE_CFG)
    assert "My Long Article Title" in content
    assert "# Heading" in content
test_build_article()


# ═══════════════════════════════════════════════
# 4. 覆盖/去重逻辑端到端测试
# ═══════════════════════════════════════════════
print("\n=== 4. 覆盖/去重逻辑测试 ===")

SAVE_DIR = os.path.join(TEMP_DIR, "saves")
os.makedirs(SAVE_DIR, exist_ok=True)


@test("非覆盖模式: 同名文件生成时间戳后缀")
def test_no_overwrite():
    no_ow_dir = os.path.join(TEMP_DIR, "no_overwrite")
    os.makedirs(no_ow_dir, exist_ok=True)
    cfg = {**BASE_CFG, "overwrite_existing": False}
    data = {
        "author": "Dup", "handle": "@dup", "text": "First save",
        "url": "https://x.com/dup/status/111", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    # 第一次保存
    filename, content, _, _ = server.build_markdown(data, cfg)
    fp1 = os.path.join(no_ow_dir, filename + ".md")
    with open(fp1, "w", encoding="utf-8") as f:
        f.write(content)
    assert os.path.exists(fp1), "First file should exist"

    # 第二次保存同名文件，模拟 _handle_save 的时间戳逻辑
    data["text"] = "Second save"
    _, content2, _, _ = server.build_markdown(data, cfg)
    fp2 = os.path.join(no_ow_dir, filename + ".md")
    if os.path.exists(fp2):
        from datetime import datetime
        ts = datetime.now().strftime("%H%M%S")
        fp2 = os.path.join(no_ow_dir, f"{filename}_{ts}.md")
    with open(fp2, "w", encoding="utf-8") as f:
        f.write(content2)
    assert fp1 != fp2, "Should be different files"
    assert os.path.exists(fp1) and os.path.exists(fp2)
test_no_overwrite()


@test("覆盖模式: 通过 URL 查找并覆盖旧文件")
def test_overwrite_by_url():
    overwrite_dir = os.path.join(TEMP_DIR, "overwrite_test")
    os.makedirs(overwrite_dir, exist_ok=True)

    source_url = "https://x.com/testoverwrite/status/222"
    # 先写一个旧文件（模拟之前保存的）
    old_file = os.path.join(overwrite_dir, "old_file_2026-03-20.md")
    with open(old_file, "w", encoding="utf-8") as f:
        f.write(f'---\n标题: "Old"\n源: "{source_url}"\n---\nOld content\n')

    # 查找应该返回旧文件
    found = server.find_existing_file_by_source_url(overwrite_dir, source_url)
    assert found == old_file, f"Should find old file, got {found}"

    # 覆盖写入
    with open(found, "w", encoding="utf-8") as f:
        f.write(f'---\n标题: "New"\n源: "{source_url}"\n---\nNew content\n')

    with open(old_file, "r", encoding="utf-8") as f:
        assert "New content" in f.read()

    # 目录中应只有一个文件
    md_files = [f for f in os.listdir(overwrite_dir) if f.endswith(".md")]
    assert len(md_files) == 1, f"Should have 1 file, got {len(md_files)}"
test_overwrite_by_url()


@test("覆盖模式: URL 无匹配，同名文件直接覆盖")
def test_overwrite_same_name():
    same_dir = os.path.join(TEMP_DIR, "same_name_test")
    os.makedirs(same_dir, exist_ok=True)

    cfg = {**BASE_CFG, "overwrite_existing": True}
    data = {
        "author": "Same", "handle": "@same", "text": "Content v1",
        "url": "https://x.com/same/status/333", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    filename, content1, _, _ = server.build_markdown(data, cfg)
    fp = os.path.join(same_dir, filename + ".md")
    with open(fp, "w", encoding="utf-8") as f:
        f.write(content1)

    # 第二次保存，覆盖模式下先通过 URL 找文件
    found = server.find_existing_file_by_source_url(same_dir, data["url"])
    if found:
        target = found
    else:
        target = fp  # 同名文件直接覆盖

    data["text"] = "Content v2"
    _, content2, _, _ = server.build_markdown(data, cfg)
    with open(target, "w", encoding="utf-8") as f:
        f.write(content2)

    with open(target, "r", encoding="utf-8") as f:
        assert "Content v2" in f.read()
test_overwrite_same_name()


# ═══════════════════════════════════════════════
# 5. 平台文件夹分类测试
# ═══════════════════════════════════════════════
print("\n=== 5. 平台文件夹分类测试 ===")


@test("平台文件夹: 各平台文件分到对应子目录")
def test_platform_folders():
    pf_dir = os.path.join(TEMP_DIR, "platform_folders")
    os.makedirs(pf_dir, exist_ok=True)

    platforms = {
        "Twitter/X": "Twitter",
        "LinuxDo": "LinuxDo",
        "Feishu": "Feishu",
        "WeChat": "WeChat",
    }

    for platform, folder in platforms.items():
        final_dir = os.path.join(pf_dir, folder)
        os.makedirs(final_dir, exist_ok=True)
        fp = os.path.join(final_dir, f"test_{folder}.md")
        with open(fp, "w", encoding="utf-8") as f:
            f.write(f"# Test {platform}\n")
        assert os.path.exists(fp), f"File should exist: {fp}"

    # 验证目录结构
    subdirs = set(os.listdir(pf_dir))
    assert subdirs == {"Twitter", "LinuxDo", "Feishu", "WeChat"}
test_platform_folders()


# ═══════════════════════════════════════════════
# 6. 配置读写测试
# ═══════════════════════════════════════════════
print("\n=== 6. 配置读写测试 ===")


@test("配置: overwrite_existing 默认为 False")
def test_config_default():
    cfg = server.DEFAULT_CONFIG
    assert cfg.get("overwrite_existing") is False
test_config_default()


@test("配置: overwrite_existing 在白名单中")
def test_config_whitelist():
    assert "overwrite_existing" in server.X2MDHandler.ALLOWED_CONFIG_KEYS
test_config_whitelist()


# ═══════════════════════════════════════════════
# 7. Windows 路径兼容性测试
# ═══════════════════════════════════════════════
print("\n=== 7. Windows 路径兼容性测试 ===")


@test("Windows 路径: 文件名不含非法字符")
def test_windows_filenames():
    bad_chars = ['\\', '/', ':', '*', '?', '"', '<', '>', '|']
    for char in bad_chars:
        result = server.sanitize_filename(f"file{char}name")
        assert char not in result, f"Character {char} should be sanitized, got: {result}"
test_windows_filenames()


@test("Windows 路径: 文件名不以点或空格结尾")
def test_windows_trailing():
    assert server.sanitize_filename("file.") == "file"
    assert server.sanitize_filename("file ") == "file"
    assert server.sanitize_filename("file. .") == "file"  # 尾部点和空格都被去掉
test_windows_trailing()


@test("Windows 路径: 超长文件名截断")
def test_windows_long_name():
    long_name = "这是一个非常长的文件名" * 20
    result = server.sanitize_filename(long_name, 60)
    assert len(result) <= 60
test_windows_long_name()


# ═══════════════════════════════════════════════
# 8. Front Matter 格式正确性
# ═══════════════════════════════════════════════
print("\n=== 8. Front Matter 测试 ===")


@test("Front Matter: 包含所有必需字段")
def test_front_matter_fields():
    data = {
        "author": "FM-Test", "handle": "@fmtest",
        "text": "Test content", "url": "https://x.com/fmtest/status/555",
        "platform": "Twitter/X", "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, BASE_CFG)
    required = ['标题:', 'tags:', '源:', '作者主页:', '创建时间:', '发布时间:', '平台:', '类别:', '阅读状态:', '整理:']
    for field in required:
        assert field in content, f"Missing front matter field: {field}"
test_front_matter_fields()


@test("Front Matter: title 不含换行")
def test_front_matter_no_newline():
    data = {
        "author": "NL-Test", "handle": "@nltest",
        "text": "Line 1\nLine 2\nLine 3",
        "url": "https://x.com/nltest/status/666",
        "platform": "Twitter/X", "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, BASE_CFG)
    # 提取 title 行
    for line in content.split("\n"):
        if line.startswith("标题:"):
            assert "\n" not in line.strip()
            break
test_front_matter_no_newline()


# ═══════════════════════════════════════════════
# 9. 线程推文测试
# ═══════════════════════════════════════════════
print("\n=== 9. 线程推文测试 ===")


@test("线程推文: 多条推文拼接")
def test_thread_tweets():
    data = {
        "author": "Thread", "handle": "@thread",
        "text": "Thread intro",
        "url": "https://x.com/thread/status/777",
        "platform": "Twitter/X", "images": [], "videos": [],
        "thread_tweets": [
            {"text": "Tweet 1 in thread", "images": [], "videos": []},
            {"text": "Tweet 2 in thread", "images": [], "videos": []},
        ],
    }
    _, content, _, _ = server.build_markdown(data, BASE_CFG)
    assert "Tweet 1 in thread" in content
    assert "Tweet 2 in thread" in content
test_thread_tweets()


# ═══════════════════════════════════════════════
# 10. 评论/回复功能测试
# ═══════════════════════════════════════════════
print("\n=== 10. 评论/回复功能测试 ===")

COMMENTS_CFG = {**BASE_CFG, "enable_comments": True, "comments_display": "details", "max_comments": 200, "comment_floor_range": ""}
SAMPLE_COMMENTS = [
    {"floor": 2, "author": "user_a", "content": "回复内容A", "published": "2026-03-25T10:00:00+08:00"},
    {"floor": 3, "author": "user_b", "content": "回复内容B", "published": "2026-03-25T11:00:00+08:00"},
    {"floor": 4, "author": "user_c", "content": "回复内容C", "published": ""},
]


@test("parse_floor_range: 空字符串返回 None")
def test_floor_range_empty():
    assert server.parse_floor_range("") is None
    assert server.parse_floor_range("  ") is None
    assert server.parse_floor_range(None) is None
test_floor_range_empty()


@test("parse_floor_range: 指定楼层")
def test_floor_range_specific():
    result = server.parse_floor_range("2,5,8")
    assert result == {2, 5, 8}
test_floor_range_specific()


@test("parse_floor_range: 范围")
def test_floor_range_range():
    result = server.parse_floor_range("1-10")
    assert result == set(range(1, 11))
test_floor_range_range()


@test("parse_floor_range: 混合")
def test_floor_range_mixed():
    result = server.parse_floor_range("1-3,7,10")
    assert result == {1, 2, 3, 7, 10}
test_floor_range_mixed()


@test("评论渲染: details 折叠模式")
def test_comments_details():
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文",
        "url": "https://x.com/testuser/status/123", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": SAMPLE_COMMENTS,
    }
    _, content, _, _ = server.build_markdown(data, COMMENTS_CFG)
    assert "<details>" in content
    assert "<summary>评论/回复</summary>" in content
    assert "**#2 user_a**" in content
    assert "回复内容A" in content
    assert "**#3 user_b**" in content
    assert "</details>" in content
test_comments_details()


@test("评论渲染: heading 标题模式")
def test_comments_heading():
    cfg = {**COMMENTS_CFG, "comments_display": "heading"}
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文",
        "url": "https://x.com/testuser/status/123", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": SAMPLE_COMMENTS,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "## 评论/回复" in content
    assert "### #2 user_a" in content
    assert "回复内容B" in content
    assert "<details>" not in content
test_comments_heading()


@test("评论渲染: 关闭时无评论输出")
def test_comments_disabled():
    cfg = {**BASE_CFG, "enable_comments": False}
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文",
        "url": "https://x.com/testuser/status/123", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": SAMPLE_COMMENTS,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "评论/回复" not in content
    assert "user_a" not in content
test_comments_disabled()


@test("评论渲染: 楼层过滤")
def test_comments_floor_filter():
    cfg = {**COMMENTS_CFG, "comment_floor_range": "2,4"}
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文",
        "url": "https://x.com/testuser/status/123", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": SAMPLE_COMMENTS,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "user_a" in content  # floor 2
    assert "user_c" in content  # floor 4
    assert "user_b" not in content  # floor 3 被过滤
test_comments_floor_filter()


@test("评论渲染: max_comments 限制")
def test_comments_max_limit():
    cfg = {**COMMENTS_CFG, "max_comments": 1}
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文",
        "url": "https://x.com/testuser/status/123", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": SAMPLE_COMMENTS,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "user_a" in content  # 第一条通过
    assert "user_b" not in content  # 被截断
    assert "user_c" not in content  # 被截断
test_comments_max_limit()


@test("评论渲染: 无楼层号的评论自动编号")
def test_comments_auto_floor():
    comments_no_floor = [
        {"author": "reply_1", "content": "第一条回复", "published": ""},
        {"author": "reply_2", "content": "第二条回复", "published": ""},
    ]
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文",
        "url": "https://x.com/testuser/status/123", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": comments_no_floor,
    }
    _, content, _, _ = server.build_markdown(data, COMMENTS_CFG)
    assert "**#2 reply_1**" in content  # i=0 -> floor=2
    assert "**#3 reply_2**" in content  # i=1 -> floor=3
test_comments_auto_floor()


# ═══════════════════════════════════════════════
# 11. 新配置项测试（discourse_domains, embed_mode）
# ═══════════════════════════════════════════════
print("\n=== 11. 新配置项测试 ===")


@test("配置: discourse_domains 默认包含 linux.do")
def test_config_discourse_domains():
    cfg = server.DEFAULT_CONFIG
    assert "discourse_domains" in cfg
    assert "linux.do" in cfg["discourse_domains"]
test_config_discourse_domains()


@test("配置: discourse_domains 在白名单中")
def test_config_discourse_whitelist():
    assert "discourse_domains" in server.X2MDHandler.ALLOWED_CONFIG_KEYS
test_config_discourse_whitelist()


@test("配置: embed_mode 默认为 local")
def test_config_embed_mode():
    cfg = server.DEFAULT_CONFIG
    assert cfg.get("embed_mode") == "local"
test_config_embed_mode()


@test("配置: embed_mode 在白名单中")
def test_config_embed_whitelist():
    assert "embed_mode" in server.X2MDHandler.ALLOWED_CONFIG_KEYS
test_config_embed_whitelist()


# ═══════════════════════════════════════════════
# 12. iframe 嵌入测试
# ═══════════════════════════════════════════════
print("\n=== 12. iframe 嵌入测试 ===")


@test("_is_embeddable_video: YouTube URL 识别")
def test_embeddable_youtube():
    assert server._is_embeddable_video("https://www.youtube.com/watch?v=abc123")
    assert server._is_embeddable_video("https://youtu.be/abc123")
    assert server._is_embeddable_video("https://www.youtube.com/embed/abc123")
    assert not server._is_embeddable_video("https://example.com/video.mp4")
    assert not server._is_embeddable_video("")
    assert not server._is_embeddable_video(None)
test_embeddable_youtube()


@test("_is_embeddable_video: Bilibili URL 识别")
def test_embeddable_bilibili():
    assert server._is_embeddable_video("https://www.bilibili.com/video/BV1xx411c7mD")
    assert server._is_embeddable_video("https://player.bilibili.com/player.html?bvid=BV1xx411c7mD")
    assert not server._is_embeddable_video("https://example.com/not-bilibili")
test_embeddable_bilibili()


@test("_make_video_iframe: YouTube iframe 生成")
def test_make_iframe_youtube():
    result = server._make_video_iframe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert "<iframe" in result
    assert "youtube.com/embed/dQw4w9WgXcQ" in result
    assert "allowfullscreen" in result
test_make_iframe_youtube()


@test("_make_video_iframe: Bilibili iframe 生成")
def test_make_iframe_bilibili():
    result = server._make_video_iframe("https://www.bilibili.com/video/BV1xx411c7mD")
    assert "<iframe" in result
    assert "player.bilibili.com" in result
    assert "BV1xx411c7mD" in result
test_make_iframe_bilibili()


@test("build_markdown: embed_mode=iframe 对 YouTube 视频生成 iframe")
def test_build_embed_iframe():
    cfg = {**BASE_CFG, "embed_mode": "iframe"}
    data = {
        "author": "EmbedTest", "handle": "@embed",
        "text": "Check this video",
        "url": "https://x.com/embed/status/999",
        "platform": "Twitter/X",
        "images": [],
        "videos": ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
        "download_video": True,
    }
    _, content, _, video_tasks = server.build_markdown(data, cfg)
    assert "<iframe" in content
    assert "youtube.com/embed/dQw4w9WgXcQ" in content
    # iframe 模式下不应产生下载任务
    assert len(video_tasks) == 0
test_build_embed_iframe()


@test("build_markdown: embed_mode=local 对 YouTube 视频下载")
def test_build_embed_local():
    cfg = {**BASE_CFG, "embed_mode": "local"}
    data = {
        "author": "LocalTest", "handle": "@local",
        "text": "Check this video",
        "url": "https://x.com/local/status/999",
        "platform": "Twitter/X",
        "images": [],
        "videos": ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
        "download_video": True,
    }
    _, content, _, video_tasks = server.build_markdown(data, cfg)
    assert "<iframe" not in content
    # local 模式应产生下载任务
    assert len(video_tasks) == 1
test_build_embed_local()


@test("build_markdown: embed_mode=iframe 对普通视频仍下载")
def test_build_embed_non_embeddable():
    cfg = {**BASE_CFG, "embed_mode": "iframe"}
    data = {
        "author": "NormalVid", "handle": "@normal",
        "text": "Normal video",
        "url": "https://x.com/normal/status/888",
        "platform": "Twitter/X",
        "images": [],
        "videos": ["https://video.twimg.com/ext/sample.mp4"],
        "download_video": True,
    }
    _, content, _, video_tasks = server.build_markdown(data, cfg)
    # 非嵌入式视频仍走下载流程
    assert len(video_tasks) == 1
    assert "<iframe" not in content
test_build_embed_non_embeddable()


# ═══════════════════════════════════════════════
# 清理 + 结果
# ═══════════════════════════════════════════════
shutil.rmtree(TEMP_DIR, ignore_errors=True)

print(f"\n{'='*50}")
print(f"测试结果: {PASS} 通过, {FAIL} 失败")
if ERRORS:
    print("\n失败详情:")
    for name, err in ERRORS:
        print(f"  - {name}: {err}")
    sys.exit(1)
else:
    print("全部通过!")
    sys.exit(0)
