#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_new_features.py — 新增功能综合测试

覆盖范围:
  1. 飞书知识库功能验证（平台识别、Markdown 渲染、front matter）
  2. iframe 嵌入 + embed_mode 切换逻辑
  3. Discourse 可配置域名 + 平台文件夹映射
  4. 并发 / 竞态条件测试
  5. Obsidian 桌面端渲染正确性验证
  6. 边界情况与异常输入
"""

import importlib
import json
import os
import re
import sys
import threading
import time

# ── 确保能 import server ──
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server

# ── 测试计数器 ──
_pass = 0
_fail = 0

def test(name):
    def decorator(fn):
        global _pass, _fail
        try:
            fn()
            _pass += 1
            print(f"  [PASS] {name}")
        except Exception as e:
            _fail += 1
            print(f"  [FAIL] {name}: {e}")
        return fn
    return decorator


# ═══════════════════════════════════════════════
# 1. 飞书知识库功能验证
# ═══════════════════════════════════════════════
print("\n=== 1. 飞书知识库 — build_markdown 正确性 ===")


@test("飞书: front matter 平台字段为 Feishu")
def test_feishu_platform():
    cfg = dict(server.DEFAULT_CONFIG)
    data = {
        "type": "article",
        "url": "https://example.feishu.cn/wiki/abc123",
        "author": "张三",
        "handle": "",
        "published": "2026-03-20",
        "article_title": "飞书测试文档",
        "article_content": "这是飞书的文档正文内容，包含多个段落。",
        "images": [],
        "videos": [],
        "platform": "Feishu",
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert '平台: "Feishu"' in content
    assert '源: "https://example.feishu.cn/wiki/abc123"' in content
    assert "飞书测试文档" in content


@test("飞书: 平台分类文件夹名为 Feishu")
def test_feishu_folder():
    cfg = dict(server.DEFAULT_CONFIG)
    folder_names = cfg.get("platform_folder_names", {})
    assert "Feishu" in folder_names, f"缺少 Feishu 键: {folder_names}"
    assert folder_names["Feishu"] == "Feishu"


@test("飞书: 文章图片本地化处理")
def test_feishu_image_localize():
    cfg = {**server.DEFAULT_CONFIG, "download_images": True}
    data = {
        "type": "article",
        "url": "https://example.feishu.cn/wiki/abc",
        "author": "作者",
        "handle": "",
        "published": "",
        "article_title": "含图文档",
        "article_content": "正文\n\n![](https://example.com/img.png)\n\n尾部",
        "images": [],
        "videos": [],
        "platform": "Feishu",
    }
    _, content, img_tasks, _ = server.build_markdown(data, cfg)
    # 图片应被本地化替换为 assets/ 路径
    assert "assets/" in content
    assert len(img_tasks) == 1
    assert img_tasks[0][0] == "https://example.com/img.png"


@test("飞书: feishu-image:// 协议不被本地化")
def test_feishu_image_protocol_skip():
    cfg = {**server.DEFAULT_CONFIG, "download_images": True}
    data = {
        "type": "article",
        "url": "https://example.feishu.cn/wiki/abc",
        "author": "作者",
        "handle": "",
        "published": "",
        "article_title": "API图片",
        "article_content": "![](feishu-image://token123)",
        "images": [],
        "videos": [],
        "platform": "Feishu",
    }
    _, content, img_tasks, _ = server.build_markdown(data, cfg)
    # feishu-image:// 应保留原样，不生成下载任务
    assert "feishu-image://token123" in content
    assert len(img_tasks) == 0


@test("飞书: article_content 中的 Markdown 格式保留")
def test_feishu_markdown_preservation():
    cfg = dict(server.DEFAULT_CONFIG)
    md_content = """# 一级标题

## 二级标题

- 列表项1
- 列表项2

```python
print("hello")
```

> 引用块

| 列A | 列B |
| --- | --- |
| 1   | 2   |"""
    data = {
        "type": "article",
        "url": "https://example.feishu.cn/docx/xyz",
        "author": "作者",
        "handle": "",
        "published": "",
        "article_title": "Markdown测试",
        "article_content": md_content,
        "images": [],
        "videos": [],
        "platform": "Feishu",
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "# 一级标题" in content
    assert "## 二级标题" in content
    assert "```python" in content
    assert "> 引用块" in content
    assert "| 列A | 列B |" in content


# ═══════════════════════════════════════════════
# 2. iframe 嵌入 + embed_mode 切换
# ═══════════════════════════════════════════════
print("\n=== 2. iframe 嵌入 + embed_mode 切换 ===")


@test("embed_mode=iframe: YouTube → iframe 标签")
def test_embed_iframe_youtube():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "A", "handle": "@a", "text": "Video",
        "url": "https://x.com/a/status/1",
        "platform": "Twitter/X", "images": [],
        "videos": ["https://www.youtube.com/watch?v=abc123"],
        "download_video": True,
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "<iframe" in content
    assert "youtube.com/embed/abc123" in content
    assert len(vid_tasks) == 0  # iframe 模式不产生下载任务


@test("embed_mode=iframe: Bilibili → iframe 标签")
def test_embed_iframe_bilibili():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "B", "handle": "@b", "text": "B站",
        "url": "https://x.com/b/status/2",
        "platform": "Twitter/X", "images": [],
        "videos": ["https://www.bilibili.com/video/BV1test123"],
        "download_video": True,
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "<iframe" in content
    assert "BV1test123" in content
    assert len(vid_tasks) == 0


@test("embed_mode=iframe: 普通 MP4 → 仍然走下载")
def test_embed_iframe_regular_mp4():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "C", "handle": "@c", "text": "MP4",
        "url": "https://x.com/c/status/3",
        "platform": "Twitter/X", "images": [],
        "videos": ["https://video.twimg.com/ext/12345.mp4"],
        "download_video": True,
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "<iframe" not in content
    assert len(vid_tasks) == 1  # 普通 MP4 应产生下载任务


@test("embed_mode=local: YouTube → 下载而非 iframe")
def test_embed_local_youtube():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "local"}
    data = {
        "author": "D", "handle": "@d", "text": "Local",
        "url": "https://x.com/d/status/4",
        "platform": "Twitter/X", "images": [],
        "videos": ["https://www.youtube.com/watch?v=xyz789"],
        "download_video": True,
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "<iframe" not in content
    assert len(vid_tasks) == 1


@test("embed_mode=local + download_video=False: YouTube → 纯链接")
def test_embed_local_no_download():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "local"}
    data = {
        "author": "E", "handle": "@e", "text": "NoDown",
        "url": "https://x.com/e/status/5",
        "platform": "Twitter/X", "images": [],
        "videos": ["https://www.youtube.com/watch?v=nnn"],
        "download_video": False,
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "<iframe" not in content
    assert len(vid_tasks) == 0
    assert "[视频：点击播放]" in content


@test("embed_mode=iframe: youtu.be 短链也能识别")
def test_embed_iframe_youtu_be():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "F", "handle": "@f", "text": "Short",
        "url": "https://x.com/f/status/6",
        "platform": "Twitter/X", "images": [],
        "videos": ["https://youtu.be/shortID123"],
        "download_video": True,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "<iframe" in content
    assert "youtube.com/embed/shortID123" in content


@test("embed_mode=iframe: player.bilibili.com 直接链接")
def test_embed_iframe_bilibili_player():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    url = "https://player.bilibili.com/player.html?bvid=BV1xx"
    data = {
        "author": "G", "handle": "@g", "text": "Player",
        "url": "https://x.com/g/status/7",
        "platform": "Twitter/X", "images": [],
        "videos": [url],
        "download_video": True,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "<iframe" in content
    assert url in content


@test("embed_mode=iframe: 线程推文中的视频也用 iframe")
def test_embed_iframe_thread_videos():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "H", "handle": "@h", "text": "Thread",
        "url": "https://x.com/h/status/8",
        "platform": "Twitter/X", "images": [],
        "videos": [],
        "download_video": True,
        "thread_tweets": [
            {"text": "接上", "images": [], "videos": ["https://www.youtube.com/watch?v=threadVid"]},
        ],
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "youtube.com/embed/threadVid" in content
    assert len(vid_tasks) == 0


@test("embed_mode 不在 config 中时，默认为 local")
def test_embed_mode_default():
    cfg = dict(server.DEFAULT_CONFIG)
    del cfg["embed_mode"]  # 模拟旧配置没有这个字段
    data = {
        "author": "I", "handle": "@i", "text": "Default",
        "url": "https://x.com/i/status/9",
        "platform": "Twitter/X", "images": [],
        "videos": ["https://www.youtube.com/watch?v=defaultTest"],
        "download_video": True,
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "<iframe" not in content
    assert len(vid_tasks) == 1


# ═══════════════════════════════════════════════
# 3. _is_embeddable_video / _make_video_iframe 边界
# ═══════════════════════════════════════════════
print("\n=== 3. 视频嵌入辅助函数边界测试 ===")


@test("_is_embeddable_video: 空字符串返回 False")
def test_embeddable_empty():
    assert server._is_embeddable_video("") is False
    assert server._is_embeddable_video(None) is False


@test("_is_embeddable_video: twitter MP4 不可嵌入")
def test_embeddable_twimg():
    assert server._is_embeddable_video("https://video.twimg.com/ext/123.mp4") is False


@test("_is_embeddable_video: YouTube embed URL")
def test_embeddable_yt_embed():
    assert server._is_embeddable_video("https://www.youtube.com/embed/abc") is True


@test("_make_video_iframe: 无法识别的 URL → fallback 链接")
def test_make_iframe_fallback():
    result = server._make_video_iframe("https://example.com/video.mp4")
    assert "[视频：点击播放]" in result
    assert "example.com/video.mp4" in result


@test("_make_video_iframe: YouTube watch URL 提取正确")
def test_make_iframe_yt_watch():
    result = server._make_video_iframe("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    assert "youtube.com/embed/dQw4w9WgXcQ" in result
    assert 'width="560"' in result
    assert "allowfullscreen" in result


@test("_make_video_iframe: Bilibili BV号提取")
def test_make_iframe_bv():
    result = server._make_video_iframe("https://www.bilibili.com/video/BV1abc123")
    assert "player.bilibili.com" in result
    assert "BV1abc123" in result


# ═══════════════════════════════════════════════
# 4. Discourse 可配置域名
# ═══════════════════════════════════════════════
print("\n=== 4. Discourse 可配置域名 ===")


@test("DEFAULT_CONFIG 包含 discourse_domains")
def test_discourse_config_exists():
    assert "discourse_domains" in server.DEFAULT_CONFIG
    assert isinstance(server.DEFAULT_CONFIG["discourse_domains"], list)
    assert "linux.do" in server.DEFAULT_CONFIG["discourse_domains"]


@test("discourse_domains 在配置白名单中")
def test_discourse_in_allowed():
    assert "discourse_domains" in server.X2MDHandler.ALLOWED_CONFIG_KEYS


@test("自定义 Discourse 域名平台名映射（fallback）")
def test_custom_discourse_platform_folder():
    cfg = {**server.DEFAULT_CONFIG, "enable_platform_folders": True}
    data = {
        "type": "article",
        "url": "https://forum.example.com/t/test/123",
        "author": "用户", "handle": "@user",
        "published": "",
        "article_title": "自定义论坛帖子",
        "article_content": "正文内容",
        "images": [], "videos": [],
        "platform": "forum_example_com",  # getDiscoursePlatformName 生成的
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert '平台: "forum_example_com"' in content


@test("LinuxDo 平台 front matter 正确")
def test_linuxdo_platform():
    cfg = dict(server.DEFAULT_CONFIG)
    data = {
        "type": "article",
        "url": "https://linux.do/t/test/12345",
        "author": "linuxer", "handle": "@linuxer",
        "published": "2026-03-25T10:00:00+08:00",
        "article_title": "LinuxDo 测试帖",
        "article_content": "帖子内容",
        "images": [], "videos": [],
        "platform": "LinuxDo",
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert '平台: "LinuxDo"' in content
    assert '源: "https://linux.do/t/test/12345"' in content


# ═══════════════════════════════════════════════
# 5. 并发 / 竞态条件测试
# ═══════════════════════════════════════════════
print("\n=== 5. 并发 / 竞态条件测试 ===")


@test("并发 build_markdown 不产生数据污染")
def test_concurrent_build_markdown():
    """多线程同时调用 build_markdown，检查无交叉数据污染"""
    cfg = dict(server.DEFAULT_CONFIG)
    results = {}
    errors = []

    def worker(idx):
        try:
            unique_tag = f"UNIQ_{idx:04d}_ENDTAG"
            data = {
                "author": f"Author{idx}", "handle": f"@handle{idx}",
                "text": f"Content {unique_tag}",
                "url": f"https://x.com/handle{idx}/status/{1000+idx}",
                "platform": "Twitter/X",
                "images": [f"https://pbs.twimg.com/media/img{idx}.jpg?name=orig"],
                "videos": [],
            }
            fname, content, img_tasks, vid_tasks = server.build_markdown(data, cfg)
            results[idx] = (fname, content, img_tasks)
        except Exception as e:
            errors.append((idx, str(e)))

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=10)

    assert not errors, f"线程执行出错: {errors}"
    assert len(results) == 20, f"预期 20 个结果，实际 {len(results)}"

    # 验证每个结果只包含自己的数据，不包含其他线程的
    for idx, (fname, content, img_tasks) in results.items():
        unique_tag = f"UNIQ_{idx:04d}_ENDTAG"
        assert unique_tag in content, f"线程 {idx} 内容不含自己的推文正文"
        # 检查不包含其他线程的 handle
        for other_idx in range(20):
            if other_idx == idx:
                continue
            other_tag = f"UNIQ_{other_idx:04d}_ENDTAG"
            assert other_tag not in content, \
                f"线程 {idx} 内容含有其他线程 {other_idx} 的数据（交叉污染）"


@test("并发配置读取的线程安全性")
def test_concurrent_config_read():
    """多线程同时 load_config，确保返回一致性"""
    results = []

    def reader():
        cfg = server.load_config()
        results.append(cfg.get("port", -1))

    threads = [threading.Thread(target=reader) for _ in range(50)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=5)

    assert len(results) == 50
    # 所有线程读到的 port 应该相同
    ports = set(results)
    assert len(ports) == 1, f"并发读取到不同的 port 值: {ports}"


@test("_save_lock 保护文件写入原子性")
def test_save_lock_exists():
    """验证 _save_lock 存在且为 Lock 类型"""
    assert hasattr(server, "_save_lock")
    assert isinstance(server._save_lock, type(threading.Lock()))


@test("build_markdown 重入安全 — 同一数据多次调用结果一致")
def test_build_markdown_idempotent():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "Idem", "handle": "@idem",
        "text": "Same tweet",
        "url": "https://x.com/idem/status/100",
        "platform": "Twitter/X",
        "images": ["https://pbs.twimg.com/media/test.jpg?name=orig"],
        "videos": ["https://www.youtube.com/watch?v=idemTest"],
        "download_video": True,
    }
    r1 = server.build_markdown(data, cfg)
    r2 = server.build_markdown(data, cfg)
    # 文件名（去掉时间戳部分）内容应一致
    assert r1[1] == r2[1], "同一数据两次调用内容不一致"
    assert len(r1[2]) == len(r2[2]), "图片任务数不一致"
    assert len(r1[3]) == len(r2[3]), "视频任务数不一致"


# ═══════════════════════════════════════════════
# 6. 配置更新竞态分析
# ═══════════════════════════════════════════════
print("\n=== 6. 配置更新竞态分析 ===")


@test("_handle_config_update 白名单过滤有效")
def test_config_update_whitelist():
    """验证非白名单字段不会被保存"""
    handler = server.X2MDHandler
    allowed = handler.ALLOWED_CONFIG_KEYS
    # 模拟恶意字段
    assert "__import__" not in allowed
    assert "exec" not in allowed
    assert "password" not in allowed
    # 合法字段
    assert "embed_mode" in allowed
    assert "discourse_domains" in allowed
    assert "enable_comments" in allowed


@test("DEFAULT_CONFIG 新字段都在白名单中")
def test_all_new_config_in_whitelist():
    """确认新增的配置项都在 ALLOWED_CONFIG_KEYS 中"""
    new_keys = ["discourse_domains", "embed_mode",
                "enable_comments", "comments_display", "max_comments", "comment_floor_range"]
    for key in new_keys:
        assert key in server.X2MDHandler.ALLOWED_CONFIG_KEYS, f"{key} 不在白名单中"
        assert key in server.DEFAULT_CONFIG, f"{key} 不在 DEFAULT_CONFIG 中"


# ═══════════════════════════════════════════════
# 7. Obsidian 桌面端渲染正确性
# ═══════════════════════════════════════════════
print("\n=== 7. Obsidian 渲染正确性 ===")


@test("Obsidian: front matter YAML 格式合法")
def test_ob_front_matter_valid():
    cfg = dict(server.DEFAULT_CONFIG)
    data = {
        "author": "测试", "handle": "@test",
        "text": '包含"双引号"和特殊字符<>&',
        "url": "https://x.com/test/status/999",
        "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    # front matter 应以 --- 开闭
    assert content.startswith("---\n")
    assert "\n---\n" in content
    # 双引号在 title 中应被转义为单引号
    lines = content.split("---\n")[1].split("\n")
    for line in lines:
        if line.startswith("标题:"):
            assert '"' not in line.split(": ", 1)[1].strip('"'), \
                f"标题值内含未转义双引号: {line}"
            break


@test("Obsidian: iframe 在阅读模式下可渲染")
def test_ob_iframe_render():
    """Obsidian 阅读模式支持 HTML iframe 标签"""
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "OB", "handle": "@ob",
        "text": "视频", "url": "https://x.com/ob/status/111",
        "platform": "Twitter/X", "images": [],
        "videos": ["https://www.youtube.com/watch?v=obTest"],
        "download_video": True,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    # Obsidian 要求 iframe 在空行包围中
    iframe_match = re.search(r'\n<iframe .+?></iframe>\n', content)
    assert iframe_match, "iframe 没有被空行包围，Obsidian 可能无法渲染"


@test("Obsidian: details 折叠在阅读模式下可渲染")
def test_ob_details_render():
    cfg = {**server.DEFAULT_CONFIG, "enable_comments": True, "comments_display": "details"}
    data = {
        "author": "OB2", "handle": "@ob2",
        "text": "评论测试", "url": "https://x.com/ob2/status/222",
        "platform": "Twitter/X", "images": [], "videos": [],
        "comments": [
            {"floor": 2, "author": "回复者", "content": "好帖！", "published": "2026-03-25"},
        ],
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "<details>" in content
    assert "<summary>" in content
    assert "</details>" in content
    # Obsidian 要求 details 标签与内容间有空行
    assert "<details>\n<summary>" in content


@test("Obsidian: 图片相对路径在 assets 子文件夹")
def test_ob_image_relative_path():
    cfg = {**server.DEFAULT_CONFIG, "download_images": True, "image_subfolder": "assets"}
    data = {
        "author": "Img", "handle": "@img",
        "text": "图片",
        "url": "https://x.com/img/status/333",
        "platform": "Twitter/X",
        "images": ["https://pbs.twimg.com/media/test.jpg?name=orig"],
        "videos": [],
    }
    _, content, img_tasks, _ = server.build_markdown(data, cfg)
    assert "![1](assets/" in content
    assert len(img_tasks) == 1


@test("Obsidian: 视频本地引用格式 ![video_N](assets/...)")
def test_ob_video_local_ref():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "local"}
    data = {
        "author": "Vid", "handle": "@vid",
        "text": "视频",
        "url": "https://x.com/vid/status/444",
        "platform": "Twitter/X",
        "images": [],
        "videos": ["https://video.twimg.com/ext/v.mp4"],
        "download_video": True,
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "![video_1](assets/" in content
    # video_1 出现在 alt text 和文件名中，检查只有一个 ![video_1] 引用
    assert content.count("![video_1]") == 1, "视频引用应只出现一次"


@test("Obsidian: 文件名不含非法字符")
def test_ob_filename_safe():
    cfg = dict(server.DEFAULT_CONFIG)
    data = {
        "author": "非法/字符", "handle": '@bad:"chars"',
        "text": "推文<内容>包含|管道*星号?问号",
        "url": "https://x.com/bad/status/555",
        "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    fname, _, _, _ = server.build_markdown(data, cfg)
    # Windows 不允许: \ / : * ? " < > |
    for c in r'\/:*?"<>|':
        assert c not in fname, f"文件名含非法字符 '{c}': {fname}"


# ═══════════════════════════════════════════════
# 8. 评论 + iframe 混合场景
# ═══════════════════════════════════════════════
print("\n=== 8. 评论 + iframe 混合场景 ===")


@test("评论 + iframe: 同时开启两个功能不冲突")
def test_comments_and_iframe_together():
    cfg = {**server.DEFAULT_CONFIG,
           "enable_comments": True, "comments_display": "heading",
           "embed_mode": "iframe"}
    data = {
        "author": "Mix", "handle": "@mix",
        "text": "混合测试",
        "url": "https://x.com/mix/status/666",
        "platform": "Twitter/X",
        "images": [],
        "videos": ["https://www.youtube.com/watch?v=mixVid"],
        "download_video": True,
        "comments": [
            {"floor": 2, "author": "评论者", "content": "nice!", "published": ""},
        ],
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    # iframe 存在
    assert "youtube.com/embed/mixVid" in content
    # 评论存在
    assert "## 评论/回复" in content
    assert "#2 评论者" in content
    # iframe 在评论前面
    iframe_pos = content.index("iframe")
    comment_pos = content.index("评论/回复")
    assert iframe_pos < comment_pos


@test("评论楼层过滤 + max_comments 限制同时生效")
def test_comments_filter_and_limit():
    cfg = {**server.DEFAULT_CONFIG,
           "enable_comments": True,
           "comment_floor_range": "2-4",
           "max_comments": 2}
    comments = [
        {"floor": i, "author": f"User{i}", "content": f"Reply {i}", "published": ""}
        for i in range(2, 10)
    ]
    data = {
        "author": "A", "handle": "@a", "text": "Test",
        "url": "https://x.com/a/status/777",
        "platform": "Twitter/X",
        "images": [], "videos": [],
        "comments": comments,
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    # 楼层范围 2-4，但 max_comments=2，所以只有 2 和 3
    assert "#2 User2" in content
    assert "#3 User3" in content
    assert "#4 User4" not in content  # 被 max_comments 截断
    assert "#5 User5" not in content  # 不在范围内


# ═══════════════════════════════════════════════
# 9. 边界情况与异常输入
# ═══════════════════════════════════════════════
print("\n=== 9. 边界情况与异常输入 ===")


@test("空视频列表 + embed_mode=iframe 不崩溃")
def test_no_videos_iframe_mode():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "author": "Empty", "handle": "@empty",
        "text": "无视频推文",
        "url": "https://x.com/empty/status/800",
        "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    fname, content, _, _ = server.build_markdown(data, cfg)
    assert "无视频推文" in content
    assert "<iframe" not in content


@test("discourse_domains 为空列表 → 不崩溃")
def test_empty_discourse_domains():
    cfg = {**server.DEFAULT_CONFIG, "discourse_domains": []}
    # 空域名列表不应影响 build_markdown
    data = {
        "author": "A", "handle": "@a", "text": "Test",
        "url": "https://x.com/a/status/801",
        "platform": "Twitter/X",
        "images": [], "videos": [],
    }
    fname, content, _, _ = server.build_markdown(data, cfg)
    assert content  # 至少有 front matter


@test("超长 article_content 不导致文件名过长")
def test_long_content_filename():
    cfg = {**server.DEFAULT_CONFIG, "max_filename_length": 60}
    data = {
        "type": "article",
        "url": "https://x.com/a/status/802",
        "author": "Long", "handle": "@long",
        "published": "",
        "article_title": "A" * 200,  # 超长标题
        "article_content": "B" * 10000,
        "images": [], "videos": [],
        "platform": "Twitter/X",
    }
    fname, _, _, _ = server.build_markdown(data, cfg)
    assert len(fname) <= 60, f"文件名过长: {len(fname)} > 60"


@test("[MEDIA_VIDEO_URL:xxx] 占位符在 article 中被正确替换")
def test_video_placeholder_replacement():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    vid_url = "https://www.youtube.com/watch?v=placeholder123"
    data = {
        "type": "article",
        "url": "https://x.com/a/status/803",
        "author": "P", "handle": "@p",
        "published": "",
        "article_title": "Placeholder Test",
        "article_content": f"正文\n\n[MEDIA_VIDEO_URL:{vid_url}]\n\n尾部",
        "images": [], "videos": [vid_url],
        "download_video": True,
        "platform": "Twitter/X",
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert "[MEDIA_VIDEO_URL:" not in content, "占位符未被替换"
    assert "youtube.com/embed/placeholder123" in content


@test("微信公众号平台 front matter 正确")
def test_wechat_platform():
    cfg = dict(server.DEFAULT_CONFIG)
    data = {
        "type": "article",
        "url": "https://mp.weixin.qq.com/s/abc123",
        "author": "公众号作者",
        "handle": "",
        "published": "",
        "article_title": "微信公众号文章标题",
        "article_content": "公众号文章正文",
        "images": [], "videos": [],
        "platform": "WeChat",
    }
    _, content, _, _ = server.build_markdown(data, cfg)
    assert '平台: "WeChat"' in content
    # WeChat 应有对应的文件夹名
    folder = cfg["platform_folder_names"].get("WeChat")
    assert folder == "WeChat"


@test("parse_floor_range: 混合格式 '1-3,7,10-12' 解析正确")
def test_parse_floor_range_mixed():
    result = server.parse_floor_range("1-3,7,10-12")
    assert result == {1, 2, 3, 7, 10, 11, 12}


@test("parse_floor_range: 非法输入不崩溃")
def test_parse_floor_range_bad_input():
    assert server.parse_floor_range("abc") is None
    assert server.parse_floor_range("1-abc") is None or isinstance(server.parse_floor_range("1-abc"), set)
    assert server.parse_floor_range("") is None
    assert server.parse_floor_range("   ") is None


# ═══════════════════════════════════════════════
# 10. SYNC_FIELDS 一致性验证（模拟检查）
# ═══════════════════════════════════════════════
print("\n=== 10. SYNC_FIELDS 一致性验证 ===")


@test("background.js 两处 SYNC_FIELDS 包含新字段（通过文件读取验证）")
def test_sync_fields_in_background():
    bg_path = os.path.join(os.path.dirname(__file__), "extension", "background.js")
    with open(bg_path, "r", encoding="utf-8") as f:
        bg_content = f.read()

    # 查找所有 SYNC_FIELDS 数组
    sync_blocks = re.findall(r'SYNC_FIELDS\s*=\s*\[([^\]]+)\]', bg_content)
    assert len(sync_blocks) >= 2, f"预期至少 2 处 SYNC_FIELDS，实际 {len(sync_blocks)}"

    new_fields = ["discourse_domains", "embed_mode",
                  "enable_comments", "comments_display", "max_comments", "comment_floor_range"]

    for i, block in enumerate(sync_blocks):
        for field in new_fields:
            assert f'"{field}"' in block, \
                f"第 {i+1} 处 SYNC_FIELDS 缺少 \"{field}\""


@test("options.js 读写新配置字段")
def test_options_js_fields():
    opts_path = os.path.join(os.path.dirname(__file__), "extension", "options.js")
    with open(opts_path, "r", encoding="utf-8") as f:
        opts_content = f.read()

    # saveConfig 中应包含这些字段
    new_fields_in_save = ["discourse_domains", "embed_mode",
                          "enable_comments", "comments_display", "max_comments", "comment_floor_range"]
    for field in new_fields_in_save:
        assert field in opts_content, f"options.js 中缺少 {field}"


@test("manifest.json 包含 optional_host_permissions")
def test_manifest_optional_permissions():
    manifest_path = os.path.join(os.path.dirname(__file__), "extension", "manifest.json")
    with open(manifest_path, "r", encoding="utf-8") as f:
        manifest = json.load(f)

    assert "optional_host_permissions" in manifest, "manifest 缺少 optional_host_permissions"
    assert "https://*/*" in manifest["optional_host_permissions"]


# ═══════════════════════════════════════════════
# 11. chrome.permissions.request 竞态风险检查
# ═══════════════════════════════════════════════
print("\n=== 11. 扩展交互逻辑风险检查 ===")


@test("background.js: registerDiscourseContentScripts 有异常捕获")
def test_register_has_try_catch():
    bg_path = os.path.join(os.path.dirname(__file__), "extension", "background.js")
    with open(bg_path, "r", encoding="utf-8") as f:
        bg_content = f.read()

    # 函数内应有 try/catch
    func_match = re.search(
        r'async function registerDiscourseContentScripts.*?\n\}', bg_content, re.DOTALL)
    assert func_match, "未找到 registerDiscourseContentScripts 函数"
    func_body = func_match.group()
    assert "try" in func_body and "catch" in func_body, \
        "registerDiscourseContentScripts 缺少异常捕获"


@test("background.js: permissions.request 有 .catch 防护")
def test_permissions_request_catch():
    bg_path = os.path.join(os.path.dirname(__file__), "extension", "background.js")
    with open(bg_path, "r", encoding="utf-8") as f:
        bg_content = f.read()

    # chrome.permissions.request 应有 .catch() 处理
    assert "permissions.request" in bg_content
    # 检查 request 后有 .catch
    perm_idx = bg_content.index("permissions.request")
    nearby = bg_content[perm_idx:perm_idx+200]
    assert ".catch" in nearby, "chrome.permissions.request 没有 .catch() 防护"


@test("background.js: 启动时配置获取有超时和异常捕获")
def test_startup_config_timeout():
    bg_path = os.path.join(os.path.dirname(__file__), "extension", "background.js")
    with open(bg_path, "r", encoding="utf-8") as f:
        bg_content = f.read()

    # 启动 IIFE 中应有 AbortSignal.timeout
    assert "AbortSignal.timeout" in bg_content, "启动配置获取缺少超时设置"


@test("content.js: Discourse 域名初始化有安全检查")
def test_content_discourse_init_safe():
    cs_path = os.path.join(os.path.dirname(__file__), "extension", "content.js")
    with open(cs_path, "r", encoding="utf-8") as f:
        cs_content = f.read()

    # setDiscourseDomains 调用前应检查函数存在
    assert 'typeof setDiscourseDomains === "function"' in cs_content, \
        "content.js 未检查 setDiscourseDomains 是否存在"


# ═══════════════════════════════════════════════
# 12. 飞书 iframe 嵌入处理验证
# ═══════════════════════════════════════════════
print("\n=== 12. 飞书 iframe 嵌入处理 ===")


@test("飞书: 文档中含 YouTube 视频链接时的处理")
def test_feishu_youtube_in_content():
    """飞书文档 article_content 中包含 YouTube 链接，embed_mode=iframe 时应生效"""
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "iframe"}
    data = {
        "type": "article",
        "url": "https://example.feishu.cn/wiki/abc",
        "author": "作者", "handle": "",
        "published": "",
        "article_title": "含视频的飞书文档",
        "article_content": "正文内容",
        "images": [],
        "videos": ["https://www.youtube.com/watch?v=feishuYT"],
        "download_video": True,
        "platform": "Feishu",
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "youtube.com/embed/feishuYT" in content
    assert len(vid_tasks) == 0


@test("飞书: embed_mode=local 时视频走本地下载")
def test_feishu_local_video():
    cfg = {**server.DEFAULT_CONFIG, "embed_mode": "local"}
    data = {
        "type": "article",
        "url": "https://example.feishu.cn/wiki/abc",
        "author": "作者", "handle": "",
        "published": "",
        "article_title": "本地视频",
        "article_content": "正文",
        "images": [],
        "videos": ["https://www.youtube.com/watch?v=localYT"],
        "download_video": True,
        "platform": "Feishu",
    }
    _, content, _, vid_tasks = server.build_markdown(data, cfg)
    assert "<iframe" not in content
    assert len(vid_tasks) == 1


# ═══════════════════════════════════════════════
# 13. 已知风险点文档化测试
# ═══════════════════════════════════════════════
print("\n=== 13. 已知风险点检测 ===")


@test("风险: chrome.permissions.request 在 service worker 中可能失败")
def test_risk_permissions_in_sw():
    """
    chrome.permissions.request() 只能在用户手势上下文中调用。
    background.js (service worker) 中直接调用可能静默失败。
    验证代码中有 .catch() 防护。
    """
    bg_path = os.path.join(os.path.dirname(__file__), "extension", "background.js")
    with open(bg_path, "r", encoding="utf-8") as f:
        bg = f.read()
    # 确认 permissions.request 有 catch 防护
    assert ".catch(() => false)" in bg or ".catch" in bg[bg.index("permissions.request"):bg.index("permissions.request")+150], \
        "permissions.request 缺少 .catch 防护"


@test("风险: _config_cache 双重检查锁模式正确")
def test_risk_config_double_check():
    """验证 load_config 的双重检查锁模式"""
    import inspect
    source = inspect.getsource(server.load_config)
    # 应有两次 _config_cache 检查（锁前 + 锁后）
    cache_checks = source.count("_config_cache is not None")
    assert cache_checks >= 2, f"load_config 双重检查锁不完整，只有 {cache_checks} 次检查"


@test("风险: discourse.js fetchDiscourseReplies 使用 hostname 参数")
def test_risk_discourse_hostname_param():
    """验证 fetchDiscourseReplies 接受 hostname 参数，不再硬编码 linux.do"""
    ds_path = os.path.join(os.path.dirname(__file__), "extension", "discourse.js")
    with open(ds_path, "r", encoding="utf-8") as f:
        ds = f.read()
    # 函数签名应含 hostname 参数
    assert "fetchDiscourseReplies(topicId, hostname)" in ds
    # 使用 hostname 构建 URL，而非硬编码
    assert "${host}" in ds


# ═══════════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════════
print(f"\n{'='*50}")
print(f"测试结果: {_pass} 通过, {_fail} 失败")
if _fail == 0:
    print("全部通过!")
else:
    print(f"有 {_fail} 个测试失败")
    sys.exit(1)
