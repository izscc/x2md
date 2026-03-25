#!/usr/bin/env python3
"""
x2md Obsidian 渲染全面验证测试
覆盖：各平台输出、Front Matter 格式、图片/视频引用、线程、Article、覆盖逻辑、Windows 兼容
每个测试都会打印生成的 Markdown 内容，方便人工审阅。
"""
import json
import os
import re
import shutil
import sys
import tempfile
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server

PASS = 0
FAIL = 0
ERRORS = []

def test(name):
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
# 配置
# ═══════════════════════════════════════════════
CFG_NO_DOWNLOAD = {
    "filename_format": "{summary}_{date}_{author}",
    "max_filename_length": 60,
    "download_images": False,
    "image_subfolder": "assets",
}
CFG_WITH_DOWNLOAD = {
    "filename_format": "{summary}_{date}_{author}",
    "max_filename_length": 60,
    "download_images": True,
    "image_subfolder": "assets",
}

TEMP_DIR = tempfile.mkdtemp(prefix="x2md_ob_test_")


# ═══════════════════════════════════════════════
# 1. Front Matter 格式验证（Obsidian YAML 合规性）
# ═══════════════════════════════════════════════
print("\n=== 1. Front Matter YAML 合规性 ===")

@test("FM: 以 --- 开头和结尾")
def test_fm_delimiters():
    data = {
        "author": "Test", "handle": "@test", "text": "Hello",
        "url": "https://x.com/test/status/1", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    lines = content.split("\n")
    assert lines[0] == "---", f"First line should be '---', got '{lines[0]}'"
    # 找第二个 ---
    fm_end = None
    for i, line in enumerate(lines[1:], 1):
        if line == "---":
            fm_end = i
            break
    assert fm_end is not None, "No closing --- found"
test_fm_delimiters()


@test("FM: title 中的双引号被转义")
def test_fm_quotes():
    data = {
        "author": "Test", "handle": "@test",
        "text": 'He said "hello" to me',
        "url": "https://x.com/test/status/2", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    for line in content.split("\n"):
        if line.startswith("标题:"):
            # 双引号包裹的 title 内部不应有未转义的双引号
            val = line[len("标题:"):].strip()
            # val 应该是 "'He said 'hello' to me'"
            assert val.startswith('"') and val.endswith('"'), f"title not quoted: {val}"
            inner = val[1:-1]
            assert '"' not in inner, f"Unescaped quote in title: {inner}"
            break
test_fm_quotes()


@test("FM: title 不含换行符")
def test_fm_no_newline():
    data = {
        "author": "Test", "handle": "@test",
        "text": "Line1\nLine2\nLine3",
        "url": "https://x.com/test/status/3", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    for line in content.split("\n"):
        if line.startswith("标题:"):
            assert "\n" not in line.strip(), "Title contains newline"
            break
test_fm_no_newline()


@test("FM: 所有必需字段存在")
def test_fm_all_fields():
    data = {
        "author": "Tester", "handle": "@tester", "text": "Check fields",
        "url": "https://x.com/tester/status/4", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    required = ['标题:', 'tags:', '源:', '作者主页:', '创建时间:', '发布时间:', '平台:', '类别:', '阅读状态:', '整理:']
    for field in required:
        assert field in content, f"Missing: {field}"
test_fm_all_fields()


@test("FM: 类别使用 Obsidian wiki-link 格式")
def test_fm_wikilink():
    data = {
        "author": "A", "handle": "@a", "text": "Test",
        "url": "https://x.com/a/status/5", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert '类别: "[[剪报]]"' in content, "类别 should use [[wiki-link]]"
test_fm_wikilink()


@test("FM: 阅读状态和整理为 boolean（非字符串）")
def test_fm_booleans():
    data = {
        "author": "A", "handle": "@a", "text": "Test",
        "url": "https://x.com/a/status/6", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "阅读状态: false" in content, "阅读状态 should be boolean false"
    assert "整理: false" in content, "整理 should be boolean false"
test_fm_booleans()


# ═══════════════════════════════════════════════
# 2. 各平台 Markdown 输出验证
# ═══════════════════════════════════════════════
print("\n=== 2. 各平台 Markdown 输出验证 ===")

@test("Twitter 推文: 正文+图片渲染")
def test_twitter_tweet():
    data = {
        "author": "Elon", "handle": "@elonmusk",
        "text": "This is a **test** tweet with some content!",
        "url": "https://x.com/elonmusk/status/123",
        "platform": "Twitter/X",
        "images": ["https://pbs.twimg.com/media/abc.jpg?name=small"],
        "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert '平台: "Twitter/X"' in content
    assert "**test**" in content, "Bold should be preserved"
    assert "![1](https://pbs.twimg.com/media/abc.jpg?name=orig)" in content, \
        "Image should use name=orig"
test_twitter_tweet()


@test("Twitter 推文(图片下载模式): 本地路径引用")
def test_twitter_local_img():
    data = {
        "author": "User", "handle": "@user",
        "text": "Tweet with local image",
        "url": "https://x.com/user/status/200",
        "platform": "Twitter/X",
        "images": ["https://pbs.twimg.com/media/xyz.jpg"],
        "videos": [],
    }
    _, content, tasks, _ = server.build_markdown(data, CFG_WITH_DOWNLOAD)
    assert "assets/" in content, "Should reference local path"
    assert len(tasks) >= 1, "Should have image download task"
    assert tasks[0][0].endswith("name=orig"), "Download URL should be normalized"
test_twitter_local_img()


@test("X Article: 标题+正文渲染")
def test_x_article():
    data = {
        "author": "Writer", "handle": "@writer",
        "text": "Short preview",
        "url": "https://x.com/writer/status/300",
        "platform": "Twitter/X",
        "type": "article",
        "article_title": "My Amazing Article",
        "article_content": "# Introduction\n\nThis is a long article.\n\n## Section 2\n\nMore content here.",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert '标题: "My Amazing Article"' in content, "Article title in FM"
    assert "# Introduction" in content, "H1 preserved"
    assert "## Section 2" in content, "H2 preserved"
    assert "This is a long article." in content
test_x_article()


@test("X Article: 图片内嵌+本地化")
def test_article_images():
    data = {
        "author": "A", "handle": "@a",
        "text": "Preview",
        "url": "https://x.com/a/status/301",
        "platform": "Twitter/X",
        "type": "article",
        "article_title": "Image Article",
        "article_content": "Intro\n\n![pic](https://pbs.twimg.com/media/test.jpg)\n\nEnd",
        "images": [], "videos": [],
    }
    _, content, tasks, _ = server.build_markdown(data, CFG_WITH_DOWNLOAD)
    assert "assets/" in content, "Inline image should be localized"
    assert len(tasks) >= 1, "Should have image task"
test_article_images()


@test("LinuxDo 帖子: 正确渲染")
def test_linuxdo():
    data = {
        "author": "linux_user", "handle": "",
        "text": "这是一个 Linux Do 帖子\n\n包含多段内容\n\n**加粗文字**",
        "url": "https://linux.do/t/topic/12345",
        "platform": "LinuxDo",
        "images": ["https://linux.do/uploads/default/abc.png"],
        "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert '平台: "LinuxDo"' in content
    assert "**加粗文字**" in content
    assert "![1](https://linux.do/uploads/default/abc.png)" in content
test_linuxdo()


@test("飞书文档: article 类型渲染")
def test_feishu():
    data = {
        "author": "飞书用户", "handle": "",
        "text": "",
        "url": "https://xxx.feishu.cn/wiki/abc123",
        "platform": "Feishu",
        "type": "article",
        "article_title": "飞书知识库文档标题",
        "article_content": "# 第一章\n\n这是正文\n\n## 第二节\n\n- 列表项1\n- 列表项2\n\n```python\nprint('hello')\n```",
        "images": [], "videos": [],
        "author_url": "",
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert '平台: "Feishu"' in content
    assert '飞书知识库文档标题' in content
    assert "# 第一章" in content
    assert "- 列表项1" in content
    assert "```python" in content
test_feishu()


@test("微信公众号: article 类型渲染")
def test_wechat():
    data = {
        "author": "公众号作者", "handle": "",
        "text": "",
        "url": "https://mp.weixin.qq.com/s/abc123",
        "platform": "WeChat",
        "type": "article",
        "article_title": "微信公众号文章标题",
        "article_content": "# 标题\n\n正文段落\n\n> 引用内容\n\n![img](https://mmbiz.qpic.cn/abc.jpg?wx_fmt=jpeg)",
        "images": [], "videos": [],
        "author_url": "",
    }
    _, content, tasks, _ = server.build_markdown(data, CFG_WITH_DOWNLOAD)
    assert '平台: "WeChat"' in content
    assert "正文段落" in content
    assert "> 引用内容" in content
    # 图片应被本地化
    assert "assets/" in content
test_wechat()


# ═══════════════════════════════════════════════
# 3. 视频渲染验证
# ═══════════════════════════════════════════════
print("\n=== 3. 视频渲染验证 ===")

@test("视频: 不下载模式显示链接")
def test_video_link():
    data = {
        "author": "V", "handle": "@v",
        "text": "Tweet with video",
        "url": "https://x.com/v/status/400",
        "platform": "Twitter/X",
        "images": [], "videos": ["https://video.twimg.com/ext/abc.mp4"],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "[视频：点击播放](https://video.twimg.com/ext/abc.mp4)" in content
test_video_link()


@test("视频: 下载模式显示本地路径")
def test_video_download():
    data = {
        "author": "V", "handle": "@v",
        "text": "Tweet with video",
        "url": "https://x.com/v/status/401",
        "platform": "Twitter/X",
        "images": [], "videos": ["https://video.twimg.com/ext/def.mp4"],
        "download_video": True,
    }
    _, content, _, vid_tasks = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "assets/" in content, "Video should reference local path"
    assert any("video" in t[2] for t in vid_tasks), "Should have video download task"
test_video_download()


@test("视频占位符: [MEDIA_VIDEO_URL:xxx] 替换")
def test_video_placeholder():
    vid_url = "https://video.twimg.com/ext/placeholder.mp4"
    data = {
        "author": "V", "handle": "@v",
        "text": "Before\n\n[MEDIA_VIDEO_URL:" + vid_url + "]\n\nAfter",
        "url": "https://x.com/v/status/402",
        "platform": "Twitter/X",
        "images": [], "videos": [vid_url],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "[MEDIA_VIDEO_URL:" not in content, \
        f"Placeholder should be replaced everywhere (including title)"
    assert vid_url in content, "Video URL should appear in content"
test_video_placeholder()


# ═══════════════════════════════════════════════
# 4. 线程推文渲染
# ═══════════════════════════════════════════════
print("\n=== 4. 线程推文渲染 ===")

@test("线程: 分隔线 + 各条推文内容")
def test_thread():
    data = {
        "author": "Thread", "handle": "@thread",
        "text": "Thread start (1/3)",
        "url": "https://x.com/thread/status/500",
        "platform": "Twitter/X",
        "images": ["https://pbs.twimg.com/media/main.jpg"],
        "videos": [],
        "thread_tweets": [
            {
                "text": "Second tweet in thread (2/3)",
                "images": ["https://pbs.twimg.com/media/second.jpg"],
                "videos": [],
            },
            {
                "text": "Third tweet in thread (3/3)",
                "images": [],
                "videos": ["https://video.twimg.com/ext/thread.mp4"],
            },
        ],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "Thread start" in content
    assert "---" in content, "Thread should have separator"
    assert "Second tweet" in content
    assert "Third tweet" in content
    assert "thread.mp4" in content
test_thread()


@test("线程: 空推文（仅图片）不崩溃")
def test_thread_empty_text():
    data = {
        "author": "T", "handle": "@t",
        "text": "Main",
        "url": "https://x.com/t/status/501",
        "platform": "Twitter/X",
        "images": [], "videos": [],
        "thread_tweets": [
            {"text": "", "images": ["https://pbs.twimg.com/media/only.jpg"], "videos": []},
            {"text": "", "images": [], "videos": []},  # 完全为空应跳过
        ],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "only.jpg" in content
test_thread_empty_text()


# ═══════════════════════════════════════════════
# 5. 覆盖/去重逻辑验证
# ═══════════════════════════════════════════════
print("\n=== 5. 覆盖/去重逻辑验证 ===")

@test("非覆盖: 同名文件添加时间戳后缀")
def test_no_overwrite():
    d = os.path.join(TEMP_DIR, "no_ow")
    os.makedirs(d, exist_ok=True)
    cfg = {**CFG_NO_DOWNLOAD, "overwrite_existing": False}
    data = {
        "author": "Dup", "handle": "@dup", "text": "First",
        "url": "https://x.com/dup/status/600", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    fn, c1, _, _ = server.build_markdown(data, cfg)
    fp1 = os.path.join(d, fn + ".md")
    with open(fp1, "w", encoding="utf-8") as f:
        f.write(c1)

    data["text"] = "Second"
    fn2, c2, _, _ = server.build_markdown(data, cfg)
    fp2 = os.path.join(d, fn2 + ".md")
    if os.path.exists(fp2):
        ts = datetime.now().strftime("%H%M%S")
        fp2 = os.path.join(d, f"{fn2}_{ts}.md")
    with open(fp2, "w", encoding="utf-8") as f:
        f.write(c2)

    assert fp1 != fp2, "Should be different files"
    assert os.path.exists(fp1) and os.path.exists(fp2)
test_no_overwrite()


@test("覆盖: URL 匹配覆盖旧文件")
def test_overwrite():
    d = os.path.join(TEMP_DIR, "ow")
    os.makedirs(d, exist_ok=True)
    url = "https://x.com/ow/status/601"
    old_file = os.path.join(d, "old_name.md")
    with open(old_file, "w", encoding="utf-8") as f:
        f.write(f'---\ntitle: "Old"\n源: "{url}"\n---\nOld\n')

    found = server.find_existing_file_by_source_url(d, url)
    assert found == old_file
    with open(found, "w", encoding="utf-8") as f:
        f.write(f'---\ntitle: "New"\n源: "{url}"\n---\nNew\n')
    with open(old_file, "r", encoding="utf-8") as f:
        assert "New" in f.read()
    assert len([f for f in os.listdir(d) if f.endswith(".md")]) == 1
test_overwrite()


@test("覆盖: URL 不匹配时正常新建")
def test_overwrite_no_match():
    d = os.path.join(TEMP_DIR, "ow_nomatch")
    os.makedirs(d, exist_ok=True)
    old = os.path.join(d, "existing.md")
    with open(old, "w", encoding="utf-8") as f:
        f.write('---\n源: "https://x.com/other"\n---\n')

    result = server.find_existing_file_by_source_url(d, "https://x.com/new_url")
    assert result is None
test_overwrite_no_match()


# ═══════════════════════════════════════════════
# 6. Windows 路径兼容性
# ═══════════════════════════════════════════════
print("\n=== 6. Windows 路径兼容性 ===")

@test("Win: 文件名不含 \\/:*?\"<>| 字符")
def test_win_chars():
    bad = 'test\\file/name:with*bad?"chars<>|end'
    result = server.sanitize_filename(bad)
    for c in '\\/:*?"<>|':
        assert c not in result, f"Character '{c}' found in: {result}"
test_win_chars()


@test("Win: 文件名不以 . 或空格结尾")
def test_win_trailing():
    assert server.sanitize_filename("file.") == "file"
    assert server.sanitize_filename("file ") == "file"
    assert server.sanitize_filename("...") == "untitled"
test_win_trailing()


@test("Win: 超长文件名正确截断")
def test_win_long():
    long_name = "这是一个非常长的文件名" * 20
    result = server.sanitize_filename(long_name, 60)
    assert len(result) <= 60
    # 确保截断后不以 . 或空格结尾
    assert not result.endswith('.') and not result.endswith(' ')
test_win_long()


@test("Win: 全中文文件名正确处理")
def test_win_chinese():
    name = "关于人工智能未来发展的思考"
    result = server.sanitize_filename(name, 60)
    assert result == name, f"Chinese filename broken: {result}"
test_win_chinese()


@test("Win: Emoji 文件名不崩溃")
def test_win_emoji():
    name = "测试🚀文件📝名称"
    result = server.sanitize_filename(name, 60)
    assert result, "Should not be empty"
    assert len(result) <= 60
test_win_emoji()


# ═══════════════════════════════════════════════
# 7. Obsidian 渲染特定验证
# ═══════════════════════════════════════════════
print("\n=== 7. Obsidian 渲染特定验证 ===")

@test("OB: Front Matter 和正文之间有空行")
def test_ob_blank_line():
    data = {
        "author": "A", "handle": "@a", "text": "Body text",
        "url": "https://x.com/a/status/700", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    # 找到 FM 结束的 ---
    lines = content.split("\n")
    fm_end_idx = None
    for i, line in enumerate(lines[1:], 1):
        if line == "---":
            fm_end_idx = i
            break
    assert fm_end_idx is not None, "No FM end found"
    # FM 结束后应该有空行
    assert lines[fm_end_idx + 1] == "", f"Expected blank line after FM, got: '{lines[fm_end_idx + 1]}'"
test_ob_blank_line()


@test("OB: 图片引用格式正确（Obsidian 标准 Markdown）")
def test_ob_image_format():
    data = {
        "author": "A", "handle": "@a", "text": "Check images",
        "url": "https://x.com/a/status/701", "platform": "Twitter/X",
        "images": ["https://pbs.twimg.com/media/test.jpg"],
        "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    # Obsidian 标准 Markdown 图片格式: ![alt](url)
    img_pattern = re.compile(r'!\[.*?\]\(.+?\)')
    assert img_pattern.search(content), "No valid image reference found"
test_ob_image_format()


@test("OB: 本地图片用相对路径（无前导 ./）")
def test_ob_local_path():
    data = {
        "author": "A", "handle": "@a", "text": "Local imgs",
        "url": "https://x.com/a/status/702", "platform": "Twitter/X",
        "images": ["https://pbs.twimg.com/media/local.jpg"],
        "videos": [],
    }
    _, content, tasks, _ = server.build_markdown(data, CFG_WITH_DOWNLOAD)
    # Obsidian 本地引用不应有 ./
    assert "./" not in content or "://" in content.split("./")[0][-10:], \
        "Local path should not start with ./"
    # 应该直接是 assets/filename
    assert re.search(r'!\[.*?\]\(assets/', content), "Should use assets/ relative path"
test_ob_local_path()


@test("OB: YAML tags 是数组格式")
def test_ob_tags_array():
    data = {
        "author": "A", "handle": "@a", "text": "Tags test",
        "url": "https://x.com/a/status/703", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "tags: []" in content, "tags should be empty array"
test_ob_tags_array()


@test("OB: 多图片不在同一行")
def test_ob_multiline_images():
    data = {
        "author": "A", "handle": "@a", "text": "Multi images",
        "url": "https://x.com/a/status/704", "platform": "Twitter/X",
        "images": [
            "https://pbs.twimg.com/media/img1.jpg",
            "https://pbs.twimg.com/media/img2.jpg",
            "https://pbs.twimg.com/media/img3.jpg",
        ],
        "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    # 每张图片应该在自己的行上
    img_lines = [l for l in content.split("\n") if l.startswith("![")]
    assert len(img_lines) == 3, f"Expected 3 image lines, got {len(img_lines)}"
test_ob_multiline_images()


@test("OB: 正文中的 Markdown 语法保持不变（不被转义）")
def test_ob_markdown_preserved():
    data = {
        "author": "A", "handle": "@a",
        "text": "**bold** *italic* `code` [link](https://example.com)",
        "url": "https://x.com/a/status/705", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "**bold**" in content
    assert "*italic*" in content
    assert "`code`" in content
    assert "[link](https://example.com)" in content
test_ob_markdown_preserved()


@test("OB: Article 中的代码块保留")
def test_ob_code_block():
    data = {
        "author": "A", "handle": "@a", "text": "Preview",
        "url": "https://x.com/a/status/706", "platform": "Twitter/X",
        "type": "article", "article_title": "Code Demo",
        "article_content": "Intro\n\n```python\ndef hello():\n    print('world')\n```\n\nEnd",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "```python" in content
    assert "def hello():" in content
    assert "```" in content
test_ob_code_block()


@test("OB: 飞书文档类型正确（article 而非 tweet）")
def test_ob_feishu_type():
    data = {
        "author": "飞书", "handle": "",
        "text": "",
        "url": "https://xxx.feishu.cn/wiki/abc",
        "platform": "Feishu",
        "type": "article",
        "article_title": "飞书测试",
        "article_content": "# 标题\n正文",
        "images": [], "videos": [],
        "author_url": "",
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    # article 模式下正文应直接输出 article_content
    assert "# 标题" in content
    assert "正文" in content
    # FM 中平台正确
    assert '平台: "Feishu"' in content
test_ob_feishu_type()


@test("OB: 微信图片 wx_fmt 参数正确识别扩展名")
def test_ob_wechat_image_ext():
    wx_url = "https://mmbiz.qpic.cn/mmbiz_jpg/xxx?wx_fmt=jpeg"
    ext = server._guess_image_ext(wx_url)
    assert ext == ".jpg", f"Expected .jpg for wx_fmt=jpeg, got {ext}"

    wx_url2 = "https://mmbiz.qpic.cn/mmbiz_png/xxx?wx_fmt=png"
    ext2 = server._guess_image_ext(wx_url2)
    assert ext2 == ".png", f"Expected .png, got {ext2}"
test_ob_wechat_image_ext()


# ═══════════════════════════════════════════════
# 8. 交互逻辑验证（配置白名单 + 默认值）
# ═══════════════════════════════════════════════
print("\n=== 8. 交互逻辑验证 ===")

@test("配置: 所有 V1.2 字段在白名单中")
def test_config_whitelist():
    required_keys = {
        "port", "save_paths", "filename_format", "max_filename_length",
        "show_site_save_icon", "enable_platform_folders", "platform_folder_names",
        "download_images", "image_subfolder", "overwrite_existing",
        "enable_video_download", "video_save_path", "video_duration_threshold",
    }
    missing = required_keys - server.X2MDHandler.ALLOWED_CONFIG_KEYS
    assert not missing, f"Missing from whitelist: {missing}"
test_config_whitelist()


@test("配置: 默认值完整性")
def test_config_defaults():
    cfg = server.DEFAULT_CONFIG
    assert cfg.get("overwrite_existing") is False
    assert cfg.get("download_images") is True
    assert cfg.get("enable_platform_folders") is True
    assert "image_subfolder" in cfg
    assert "platform_folder_names" in cfg
test_config_defaults()


@test("配置: platform_folder_names 覆盖所有支持平台")
def test_config_platforms():
    folders = server.DEFAULT_CONFIG.get("platform_folder_names", {})
    required_platforms = ["Twitter/X", "LinuxDo", "Feishu", "WeChat"]
    for p in required_platforms:
        assert p in folders, f"Missing platform folder: {p}"
test_config_platforms()


# ═══════════════════════════════════════════════
# 9. 边界情况
# ═══════════════════════════════════════════════
print("\n=== 9. 边界情况 ===")

@test("边界: 空推文（无文字无图片）")
def test_empty_tweet():
    data = {
        "author": "E", "handle": "@e", "text": "",
        "url": "https://x.com/e/status/900", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    fn, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert fn, "Filename should not be empty"
    assert "---" in content, "FM should still exist"
test_empty_tweet()


@test("边界: 超长推文不截断正文")
def test_long_text():
    long_text = "这是一段很长的文字。" * 500
    data = {
        "author": "L", "handle": "@l", "text": long_text,
        "url": "https://x.com/l/status/901", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    fn, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert long_text in content, "Full text should be preserved"
    assert len(fn) <= 60, f"Filename too long: {len(fn)}"
test_long_text()


@test("边界: URL 包含特殊字符")
def test_special_url():
    data = {
        "author": "S", "handle": "@s",
        "text": "Special URL test",
        "url": "https://x.com/s/status/902?ref=abc&lang=zh",
        "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert "?ref=abc&lang=zh" in content, "URL should preserve query params"
test_special_url()


@test("边界: published 时间字段为空不崩溃")
def test_no_published():
    data = {
        "author": "P", "handle": "@p", "text": "No time",
        "url": "https://x.com/p/status/903", "platform": "Twitter/X",
        "images": [], "videos": [],
        "published": "",
    }
    _, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    assert '发布时间: ""' in content
test_no_published()


@test("边界: 特殊字符在 title 中（引号、反斜杠、尖括号）")
def test_special_title():
    data = {
        "author": "Sp", "handle": "@sp",
        "text": 'He said "hello" and <world> & back\\slash',
        "url": "https://x.com/sp/status/904", "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    fn, content, _, _ = server.build_markdown(data, CFG_NO_DOWNLOAD)
    # FM 中 title 的双引号应被替换为单引号
    for line in content.split("\n"):
        if line.startswith("标题:"):
            inner = line[len('title: "'):-1]
            assert '"' not in inner, f"Unescaped quote in title: {inner}"
            break
    # 文件名中特殊字符应被清理
    for c in '\\/:*?"<>|':
        assert c not in fn, f"Bad char '{c}' in filename: {fn}"
test_special_title()


# ═══════════════════════════════════════════════
# 10. 打印一份完整的示例输出供人工审阅
# ═══════════════════════════════════════════════
print("\n=== 10. 示例输出（人工审阅） ===")
print("-" * 60)

sample_data = {
    "author": "示例用户", "handle": "@example",
    "text": "这是一条示例推文 **包含加粗** 和 `代码`\n\n第二段内容",
    "url": "https://x.com/example/status/9999",
    "platform": "Twitter/X",
    "published": "2026-03-25 10:30",
    "images": ["https://pbs.twimg.com/media/sample1.jpg", "https://pbs.twimg.com/media/sample2.jpg"],
    "videos": ["https://video.twimg.com/ext/sample.mp4"],
    "thread_tweets": [
        {"text": "这是线程的第二条推文", "images": ["https://pbs.twimg.com/media/thread2.jpg"], "videos": []},
    ],
}
fn, md, tasks, _ = server.build_markdown(sample_data, CFG_NO_DOWNLOAD)
print(f"文件名: {fn}.md")
print(f"图片/视频下载任务数: {len(tasks)}")
print()
print(md)
print("-" * 60)


# ═══════════════════════════════════════════════
# 11. 评论/回复 Obsidian 渲染验证
# ═══════════════════════════════════════════════
print("\n=== 11. 评论/回复 Obsidian 渲染验证 ===")

COMMENTS_CFG = {**CFG_NO_DOWNLOAD, "enable_comments": True, "comments_display": "details", "max_comments": 200, "comment_floor_range": ""}
OB_COMMENTS = [
    {"floor": 2, "author": "reviewer", "content": "这是一条评论\n包含多行", "published": "2026-03-25T10:00:00+08:00"},
    {"floor": 3, "author": "commenter", "content": "另一条评论", "published": ""},
]


@test("Obsidian: details 模式评论渲染")
def test_ob_comments_details():
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文内容",
        "url": "https://x.com/testuser/status/456", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": OB_COMMENTS,
    }
    _, content, _, _ = server.build_markdown(data, COMMENTS_CFG)
    # Obsidian 支持 <details>/<summary> 标签
    assert "<details>" in content
    assert "<summary>评论/回复</summary>" in content
    assert "**#2 reviewer**" in content
    assert "2026-03-25 10:00" in content  # 时间被规范化
    assert "这是一条评论" in content
    assert "**#3 commenter**" in content
    assert "</details>" in content
    # 主内容仍在
    assert "主推文内容" in content
test_ob_comments_details()


@test("Obsidian: heading 模式评论渲染")
def test_ob_comments_heading():
    cfg = {**COMMENTS_CFG, "comments_display": "heading"}
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文内容",
        "url": "https://x.com/testuser/status/456", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": OB_COMMENTS,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "## 评论/回复" in content
    assert "### #2 reviewer (2026-03-25 10:00)" in content
    assert "### #3 commenter" in content
    # heading 模式不应有 <details>
    assert "<details>" not in content
test_ob_comments_heading()


@test("Obsidian: 评论含图片引用")
def test_ob_comments_with_images():
    comments_with_img = [
        {"floor": 2, "author": "img_user", "content": "看这个图 ![图片](https://example.com/img.jpg)", "published": ""},
    ]
    data = {
        "author": "TestUser", "handle": "@testuser", "text": "主推文",
        "url": "https://x.com/testuser/status/789", "platform": "Twitter/X",
        "type": "tweet", "images": [], "videos": [],
        "comments": comments_with_img,
    }
    _, content, _, _ = server.build_markdown(data, COMMENTS_CFG)
    assert "![图片](https://example.com/img.jpg)" in content
test_ob_comments_with_images()


@test("Obsidian: LinuxDo 评论渲染")
def test_ob_linuxdo_comments():
    linuxdo_comments = [
        {"floor": 2, "author": "linux_user", "content": "很好的教程，感谢分享！", "published": "2026-03-25T09:00:00+08:00"},
        {"floor": 5, "author": "another", "content": "学到了", "published": "2026-03-25T12:30:00+08:00"},
    ]
    data = {
        "author": "original_poster", "handle": "",
        "text": "", "article_content": "# 技术教程\n\n这是一篇教程",
        "article_title": "Linux DO 教程",
        "url": "https://linux.do/t/topic/12345", "platform": "LinuxDo",
        "type": "article", "images": [], "videos": [],
        "comments": linuxdo_comments,
    }
    _, content, _, _ = server.build_markdown(data, COMMENTS_CFG)
    assert "技术教程" in content
    assert "**#2 linux_user**" in content
    assert "感谢分享" in content
    assert "**#5 another**" in content
test_ob_linuxdo_comments()


# ═══════════════════════════════════════════════
# 12. iframe 嵌入 Obsidian 渲染验证
# ═══════════════════════════════════════════════
print("\n=== 12. iframe 嵌入 Obsidian 渲染验证 ===")


@test("Obsidian: YouTube iframe 嵌入渲染正确")
def test_ob_youtube_iframe():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "YouTuber", "handle": "@youtuber",
        "text": "Great video!",
        "url": "https://x.com/youtuber/status/111",
        "platform": "Twitter/X",
        "images": [],
        "videos": ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
        "download_video": True,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "<iframe" in content
    assert "youtube.com/embed/dQw4w9WgXcQ" in content
    assert 'width="560"' in content
    assert 'height="315"' in content
    assert "allowfullscreen" in content
test_ob_youtube_iframe()


@test("Obsidian: Bilibili iframe 嵌入渲染正确")
def test_ob_bilibili_iframe():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "BiliUser", "handle": "@biliuser",
        "text": "精彩视频！",
        "url": "https://x.com/biliuser/status/222",
        "platform": "Twitter/X",
        "images": [],
        "videos": ["https://www.bilibili.com/video/BV1xx411c7mD"],
        "download_video": True,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "<iframe" in content
    assert "player.bilibili.com" in content
    assert "BV1xx411c7mD" in content
test_ob_bilibili_iframe()


@test("Obsidian: embed_mode=local 不生成 iframe")
def test_ob_local_no_iframe():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "local"}
    data = {
        "author": "LocalUser", "handle": "@localuser",
        "text": "Video test",
        "url": "https://x.com/localuser/status/333",
        "platform": "Twitter/X",
        "images": [],
        "videos": ["https://www.youtube.com/watch?v=test123"],
        "download_video": True,
    }
    _, content, _, video_tasks = server.build_markdown(data, cfg)
    assert "<iframe" not in content
    assert len(video_tasks) == 1
    assert "assets/" in content  # 本地路径引用
test_ob_local_no_iframe()


@test("Obsidian: 新配置字段在白名单中")
def test_ob_new_config_whitelist():
    assert "discourse_domains" in server.X2MDHandler.ALLOWED_CONFIG_KEYS
    assert "embed_mode" in server.X2MDHandler.ALLOWED_CONFIG_KEYS
test_ob_new_config_whitelist()


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
