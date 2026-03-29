#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
x2md 本地服务器
监听 localhost:9527，接收 Chrome 扩展推送的推文/X Article 数据，
转换为 Obsidian 兼容的 Markdown 文件并保存到指定目录。
"""

import json
import os
import re
import ssl
import sys
import logging
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse


def _build_ssl_context():
    """构建 SSL 上下文：优先使用 certifi 证书包，否则回退到不验证模式"""
    try:
        import certifi
        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        # certifi 未安装，创建不验证证书的上下文（仅用于下载媒体文件）
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    return ctx


# ─────────────────────────────────────────────
# 路径工具（兼容 PyInstaller 打包后的目录结构）
# ─────────────────────────────────────────────
def get_app_dir():
    """获取应用根目录（兼容 PyInstaller 打包后的路径）
    Mac: ~/Library/Application Support/X2MD
    Windows: %APPDATA%/X2MD
    这样升级 app 不丢配置。"""
    if sys.platform == "darwin":
        d = os.path.join(os.path.expanduser("~"), "Library", "Application Support", "X2MD")
    elif sys.platform == "win32":
        d = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "X2MD")
    else:
        if getattr(sys, 'frozen', False):
            return os.path.dirname(sys.executable)
        return os.path.dirname(os.path.abspath(__file__))
    os.makedirs(d, exist_ok=True)
    return d


APP_DIR = get_app_dir()
CONFIG_FILE = os.path.join(APP_DIR, "config.json")

HOME = os.path.expanduser("~")
DEFAULT_CONFIG = {
    "port": 9527,
    "save_paths": [
        os.path.join(HOME, "Desktop", "X2MD", "MD")
    ],
    "filename_format": "{summary}_{date}_{author}",
    "max_filename_length": 60,
    "video_save_path": os.path.join(HOME, "Desktop", "X2MD", "Videos"),
    "show_site_save_icon": True,
    "setup_completed": False,
    # 视频下载（扩展侧使用）
    "enable_video_download": True,
    "video_duration_threshold": 5,
    # 按平台分类子文件夹（V1.2 新增）
    "enable_platform_folders": True,
    "platform_folder_names": {
        "Twitter/X": "Twitter",
        "LinuxDo": "LinuxDo",
        "Feishu": "Feishu",
        "WeChat": "WeChat",
    },
    # 图片下载到本地（V1.2 新增）
    "download_images": True,
    "image_subfolder": "assets",
    # 覆盖已有同源文件（默认关闭）
    "overwrite_existing": False,
    # 跨设备同步（默认开启）
    "sync_enabled": True,
    # 评论/回复提取（默认关闭）
    "enable_comments": False,
    "comments_display": "details",   # "details" = 折叠, "heading" = 标题
    "max_comments": 200,
    "comment_floor_range": "",       # 楼层范围，如 "1-10" 或 "2,5,8"，空=全部
    # Discourse 论坛域名列表（支持任意 Discourse 实例）
    "discourse_domains": ["linux.do"],
    # 嵌入模式：iframe = 用 iframe 嵌入视频, local = 下载到本地引用
    "embed_mode": "local",
}

_log_handlers = [logging.FileHandler(os.path.join(APP_DIR, "x2md.log"), encoding="utf-8")]
if sys.stdout is not None:
    try:
        _stream_out = (open(sys.stdout.fileno(), mode='w', encoding='utf-8', closefd=False)
                       if sys.platform == "win32" else sys.stdout)
        _log_handlers.append(logging.StreamHandler(_stream_out))
    except (AttributeError, OSError):
        pass
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=_log_handlers,
)
logger = logging.getLogger("x2md")

# 全局配置缓存和媒体下载线程池
_config_cache: dict | None = None
_config_lock = threading.Lock()
_save_lock = threading.Lock()           # 保护文件写入，防止并发写冲突
_media_executor = ThreadPoolExecutor(max_workers=5)


def load_config() -> dict:
    """加载配置文件，优先返回缓存，不存在则从磁盘读取（线程安全）"""
    global _config_cache
    if _config_cache is not None:
        return _config_cache

    with _config_lock:
        # double-check after acquiring lock
        if _config_cache is not None:
            return _config_cache

        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    cfg = json.load(f)
                    for k, v in DEFAULT_CONFIG.items():
                        if k not in cfg:
                            cfg[k] = v
                    _config_cache = cfg
                    return cfg
            except Exception as e:
                logger.warning(f"配置文件读取失败，使用默认配置：{e}")
        _config_cache = DEFAULT_CONFIG.copy()
        save_config(_config_cache)
        return _config_cache


def save_config(cfg: dict):
    """保存配置到文件并刷新缓存（线程安全）"""
    global _config_cache
    with _config_lock:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        _config_cache = cfg


def normalize_image_url(url: str) -> str:
    """将推特图片链接中的 name 参数统一替换为 name=orig"""
    if not url or "pbs.twimg.com" not in url:
        return url
    parsed = urlparse(url)
    params = parse_qs(parsed.query, keep_blank_values=True)
    params["name"] = ["orig"]
    new_query = urlencode({k: v[0] for k, v in params.items()})
    return urlunparse(parsed._replace(query=new_query))


def sanitize_filename(name: str, max_len: int = 60) -> str:
    """清理文件名中的非法字符（兼容 Windows + Markdown 路径安全）"""
    # Windows 非法字符 + Markdown/URL 特殊字符（# 会被解析为 anchor，[] 破坏链接语法，% 导致编码歧义）
    name = re.sub(r'[\\/:*?"<>|#%\[\]]', "_", name)
    name = re.sub(r'\s+', " ", name.strip())
    name = name[:max_len]
    # Windows 不允许文件名以 . 或空格结尾
    name = name.rstrip(". ")
    return name or "untitled"


def find_existing_file_by_source_url(directory: str, source_url: str) -> str | None:
    """在目录中查找 front matter 里 源: 字段匹配的 .md 文件，返回文件路径或 None"""
    if not source_url or not os.path.isdir(directory):
        return None
    try:
        for fname in os.listdir(directory):
            if not fname.endswith(".md"):
                continue
            fpath = os.path.join(directory, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    # 只读取前 15 行检查 front matter
                    in_fm = False
                    for i, line in enumerate(f):
                        if i == 0 and line.strip() == "---":
                            in_fm = True
                            continue
                        if in_fm and line.strip() == "---":
                            break
                        if in_fm and line.startswith('源:'):
                            existing_url = line.split(':', 1)[1].strip().strip('"').strip("'")
                            if existing_url == source_url:
                                return fpath
                        if i > 30:
                            break
            except Exception:
                continue
    except Exception:
        pass
    return None


def _download_file(url: str, out_file: str, label: str = "文件"):
    """通用文件下载（阻塞），供线程池任务调用"""
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        ssl_ctx = _build_ssl_context()
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=60) as response, \
                open(out_file, 'wb') as fh:
            while True:
                chunk = response.read(8192)
                if not chunk:
                    break
                fh.write(chunk)
        return True
    except Exception as e:
        logger.error(f"❌ {label}下载失败 [{url[:80]}]: {e}")
        return False


def download_video_async(url: str, save_path: str, filename: str):
    """提交视频下载任务到线程池，避免阻塞 HTTP 响应"""
    def _download():
        logger.info(f"开启视频下载: {url[:80]} -> {save_path}/{filename}")
        os.makedirs(save_path, exist_ok=True)
        out_file = os.path.join(save_path, filename)
        if _download_file(url, out_file, "视频"):
            logger.info(f"✅ 视频下载成功: {out_file}")

    _media_executor.submit(_download)


def download_image_async(url: str, save_dir: str, filename: str):
    """提交图片下载任务到线程池"""
    def _download():
        os.makedirs(save_dir, exist_ok=True)
        out_file = os.path.join(save_dir, filename)
        if os.path.exists(out_file):
            return  # 已存在则跳过
        if _download_file(url, out_file, "图片"):
            logger.info(f"✅ 图片下载成功: {out_file}")

    _media_executor.submit(_download)


def _guess_image_ext(url: str) -> str:
    """从 URL 中猜测图片扩展名"""
    parsed = urlparse(url)
    path = parsed.path.lower()
    for ext in ('.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'):
        if ext in path:
            return ext
    # 检查 format 参数（微信/推特常用）
    params = parse_qs(parsed.query)
    fmt = params.get('wx_fmt', params.get('format', ['']))[0].lower()
    ext_map = {'jpeg': '.jpg', 'jpg': '.jpg', 'png': '.png', 'gif': '.gif', 'webp': '.webp'}
    return ext_map.get(fmt, '.jpg')


def _normalize_publish_time(raw: str) -> str:
    """将各平台不同格式的发布时间统一为北京时间 YYYY-MM-DD HH:MM"""
    if not raw or not raw.strip():
        return ""
    raw = raw.strip()
    from zoneinfo import ZoneInfo
    beijing = ZoneInfo("Asia/Shanghai")

    # Twitter RFC 2822: "Wed Mar 25 10:00:00 +0000 2026"
    try:
        from email.utils import parsedate_to_datetime
        dt = parsedate_to_datetime(raw)
        dt = dt.astimezone(beijing)
        return dt.strftime("%Y-%m-%d %H:%M")
    except Exception:
        pass
    # ISO 8601 with timezone offset: "2026-03-25T10:00:00+08:00" / "...Z"
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        dt = dt.astimezone(beijing)
        return dt.strftime("%Y-%m-%d %H:%M")
    except (ValueError, AttributeError):
        pass
    # 其他常见格式（无时区信息，假定为 UTC）
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            from datetime import timezone
            dt = datetime.strptime(raw, fmt).replace(tzinfo=timezone.utc)
            dt = dt.astimezone(beijing)
            return dt.strftime("%Y-%m-%d %H:%M")
        except ValueError:
            continue
    # 已经是 YYYY-MM-DD 格式
    if re.match(r'^\d{4}-\d{2}-\d{2}$', raw):
        return raw
    # 无法解析，原样返回
    return raw


def parse_floor_range(range_str: str) -> set | None:
    """解析楼层范围字符串，返回楼层号集合，空字符串返回 None（表示全部）
    支持格式: "2,5,8" | "1-10" | "1-3,7,10" """
    if not range_str or not range_str.strip():
        return None
    floors = set()
    for part in range_str.split(","):
        part = part.strip()
        if "-" in part:
            try:
                start, end = part.split("-", 1)
                floors.update(range(int(start), int(end) + 1))
            except (ValueError, TypeError):
                continue
        elif part.isdigit():
            floors.add(int(part))
    return floors or None


def _is_embeddable_video(url: str) -> bool:
    """判断视频 URL 是否可以用 iframe 嵌入（YouTube / Bilibili）"""
    if not url:
        return False
    lower = url.lower()
    return any(p in lower for p in [
        "youtube.com/watch", "youtu.be/", "youtube.com/embed/",
        "bilibili.com/video/", "player.bilibili.com",
    ])


def _make_video_iframe(url: str) -> str:
    """为可嵌入的视频 URL 生成 iframe HTML"""
    # YouTube
    yt_match = re.search(r'(?:watch\?v=|youtu\.be/|embed/)([a-zA-Z0-9_-]+)', url)
    if yt_match:
        return f'\n<iframe width="560" height="315" src="https://www.youtube.com/embed/{yt_match.group(1)}" frameborder="0" allowfullscreen></iframe>\n'
    # Bilibili
    bv_match = re.search(r'bilibili\.com/video/(BV[a-zA-Z0-9]+)', url, re.IGNORECASE)
    if bv_match:
        return f'\n<iframe width="560" height="315" src="https://player.bilibili.com/player.html?bvid={bv_match.group(1)}" frameborder="0" allowfullscreen></iframe>\n'
    # Bilibili player 直接链接
    if "player.bilibili.com" in url:
        return f'\n<iframe width="560" height="315" src="{url}" frameborder="0" allowfullscreen></iframe>\n'
    # fallback
    return f"[视频：点击播放]({url})"


def build_markdown(data: dict, cfg: dict) -> tuple[str, str, list]:
    """
    将接收到的推文/文章数据构建为 Markdown 字符串。
    返回 (文件名不含后缀, markdown内容, 图片下载任务列表)
    图片下载任务: [(url, save_dir, filename), ...]
    """
    author = data.get("author", "unknown")
    handle = data.get("handle", "")
    text = data.get("text", "")
    url = data.get("url", "")
    published = data.get("published", "")
    content_type = data.get("type", "tweet")  # "tweet" | "article"
    images = data.get("images", [])           # 图片 URL 列表
    videos = data.get("videos", [])           # 视频 URL 列表
    download_video = data.get("download_video", False) # 客户端最终确认的下载标识
    article_content = data.get("article_content", "")  # X Article 正文
    article_title = data.get("article_title", "")
    thread_tweets = data.get("thread_tweets", [])  # 线程推文列表
    platform = data.get("platform", "Twitter/X")

    # 标签：优先使用平台提供的 tags，其次使用 hashtags（Twitter）
    raw_tags = data.get("tags", []) or []
    raw_hashtags = data.get("hashtags", []) or []
    # 合并去重
    all_tags = list(dict.fromkeys(raw_tags + raw_hashtags))

    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    datetime_str = now.strftime("%Y-%m-%d %H:%M")

    # 规范化发布时间格式（各平台格式不一，统一为 YYYY-MM-DD HH:MM 或 YYYY-MM-DD）
    published = _normalize_publish_time(published)

    # ── 文件名（按配置格式构建）─────────────
    summary_src = article_title if article_title else text
    # 清理可能残留的视频/媒体占位符（避免污染文件名）
    summary_src = re.sub(r'\[MEDIA_VIDEO_URL:[^\]]*\]', '', summary_src)
    summary_src = re.sub(r'\[\[VIDEO_HOLDER_\d+\]\]', '', summary_src)
    summary_src = summary_src.strip()
    max_len = cfg.get("max_filename_length", 60)
    summary_short = sanitize_filename(summary_src[:30] if summary_src else "untitled", max_len)
    author_clean = sanitize_filename(handle.lstrip("@") if handle else author, 20)
    handle_clean = sanitize_filename(handle.lstrip("@") if handle else "", 20)
    timestamp_str = now.strftime("%Y%m%d_%H%M%S")
    fmt = cfg.get("filename_format", "{summary}_{date}_{author}")
    filename = (fmt
        .replace("{date}", date_str)
        .replace("{author}", author_clean)
        .replace("{handle}", handle_clean)
        .replace("{timestamp}", timestamp_str)
        .replace("{summary}", summary_short))
    # 去除文件名里可能产生的多余下划线，并限制最终长度（Windows 255 字符限制）
    filename = re.sub(r'_+', '_', filename).strip('_')
    filename = sanitize_filename(filename, max_len)

    # ── Front Matter ──────────────────────────
    title_src = article_title if article_title else text
    # 去除换行和多余空白，保证 Front Matter 单行合法
    title = " ".join(title_src.split())
    # 清理 title 中可能残留的视频/媒体占位符
    title = re.sub(r'\[MEDIA_VIDEO_URL:[^\]]*\]', '', title)
    title = re.sub(r'\[\[VIDEO_HOLDER_\d+\]\]', '', title)
    title = " ".join(title.split()).strip()
    title = title[:80] + ("…" if len(title) > 80 else "")
    title = title.replace('"', "'")

    author_url = data.get("author_url") or ""
    if not author_url and handle:
        author_url = f"https://x.com/{handle.lstrip('@')}"

    tags_yaml = "[" + ", ".join(f'"{t}"' for t in all_tags) + "]" if all_tags else "[]"

    front_matter = f"""---
标题: "{title}"
tags: {tags_yaml}
源: "{url}"
作者主页: "{author_url}"
创建时间: "{datetime_str}"
发布时间: "{published}"
平台: "{platform}"
类别: "[[剪报]]"
阅读状态: false
整理: false
---
"""

    # ── 正文构建 ────────────────────────────────────
    # 原则：仅保留原文内容，不包含作者名和时间（那些已在 Front Matter 里）
    lines = []
    image_subfolder = cfg.get("image_subfolder", "assets")

    vid_map = {}
    video_tasks = []  # (url, subfolder, filename) — 与图片同结构，在 _handle_save 中处理
    embed_mode = cfg.get("embed_mode", "local")

    all_videos = list(videos)
    for t in thread_tweets:
        all_videos.extend(t.get("videos", []))

    video_idx = 1
    for vid_url in all_videos:
        if vid_url in vid_map:
            continue
        # iframe 模式：YouTube/Bilibili 用 iframe 嵌入
        if embed_mode == "iframe" and _is_embeddable_video(vid_url):
            vid_map[vid_url] = _make_video_iframe(vid_url)
            video_idx += 1
        elif download_video:
            vid_filename = f"{filename}_video_{video_idx}.mp4"
            video_tasks.append((vid_url, image_subfolder, vid_filename))
            # 使用相对路径引用，与图片一致，Obsidian 可直接识别
            vid_map[vid_url] = f"![video_{video_idx}]({image_subfolder}/{vid_filename})"
            video_idx += 1
        else:
            vid_map[vid_url] = f"[视频：点击播放]({vid_url})"

    # 记录已在正文中内联使用的视频 URL（在占位符被替换前记录）
    _inlined_videos = set()

    def replace_video_placeholders(text_content):
        """替换 [MEDIA_VIDEO_URL:xxx] 占位符为实际视频引用，并记录已内联的视频"""
        result = text_content
        for v_url, md_ref in vid_map.items():
            target = f"[MEDIA_VIDEO_URL:{v_url}]"
            if target in result:
                result = result.replace(target, md_ref)
                _inlined_videos.add(v_url)
        return result

    def append_unused_videos(lines_list, video_list=None):
        """追加未在正文中内联的视频，video_list 默认为主推文 videos"""
        vids = video_list if video_list is not None else videos
        if not vids: return
        unused_vids = [v for v in vids if v in vid_map and v not in _inlined_videos]
        if unused_vids:
            lines_list.append("")
            for v in unused_vids:
                lines_list.append(vid_map[v])

    # [新增过滤器] 如果开启了视频下载，防重踢掉对应的占位图（封面）
    if download_video and videos:
        images = [img for img in images if "video_thumb" not in img]

    # ── 图片本地化处理 ────────────────────────────
    do_download_images = cfg.get("download_images", True)
    image_tasks = []  # (url, save_dir_placeholder, local_filename)
    _img_counter = [0]  # 用列表做闭包可变计数器

    def make_image_ref(img_url: str, alt: str = "") -> str:
        """生成图片引用：本地模式返回相对路径，否则返回远程 URL"""
        orig_url = normalize_image_url(img_url)
        if not do_download_images:
            return f"![{alt}]({orig_url})"
        _img_counter[0] += 1
        ext = _guess_image_ext(orig_url)
        local_name = f"{filename}_img_{_img_counter[0]}{ext}"
        image_tasks.append((orig_url, image_subfolder, local_name))
        ref_path = f"{image_subfolder}/{local_name}"
        # 路径含空格时用尖括号包裹，确保 Markdown 解析正确
        if " " in ref_path:
            return f"![{alt}](<{ref_path}>)"
        return f"![{alt}]({ref_path})"

    # ── 处理 article_content 中已内嵌的远程图片链接 ──
    def localize_article_images(md_text: str) -> str:
        """将 article_content 中的 ![xxx](remote_url) 替换为本地路径"""
        if not do_download_images:
            return md_text
        def _repl(m):
            alt_text = m.group(1)
            img_url = m.group(2)
            # 跳过非 HTTP(S) 的 URL（如 feishu-image://token），保留原始引用
            if not img_url.startswith(("http://", "https://")):
                return m.group(0)
            return make_image_ref(img_url, alt_text)
        return re.sub(r'!\[([^\]]*)\]\(([^)]+)\)', _repl, md_text)

    if content_type == "article":
        # X Article 图片嵌入（作为封面或母贴遗留的前导图放在顶端）
        if images:
            for i, img_url in enumerate(images):
                lines.append(make_image_ref(img_url, str(i + 1)))
            lines.append("")

        # X Article：直接输出正文（已由 content.js 转换为 Markdown 段落）
        if article_content:
            text_result = replace_video_placeholders(article_content.strip())
            text_result = localize_article_images(text_result)
            lines.append(text_result)

        append_unused_videos(lines)
    else:
        # 普通推文：只输出推文原文
        text_result = replace_video_placeholders(text.strip())
        lines.append(text_result)

        # ── 图片嵌入（首条推文的图片）
        if images:
            lines.append("")
            for i, img_url in enumerate(images):
                lines.append(make_image_ref(img_url, str(i + 1)))

        append_unused_videos(lines)

        # ── 线程推文（长推文）───────────────────────────
        for idx, tw in enumerate(thread_tweets):
            tw_text = tw.get("text", "").strip()
            tw_images = tw.get("images", [])
            tw_videos = tw.get("videos", [])

            if not tw_text and not tw_images and not tw_videos:
                continue
            lines.append("\n---\n")
            if tw_text:
                lines.append(tw_text)

            if tw_images:
                lines.append("")
                for i, img_url in enumerate(tw_images):
                    lines.append(make_image_ref(img_url, f"{idx+2}-{i+1}"))

            if tw_videos:
                lines.append("")
                for v_url in tw_videos:
                    if v_url in vid_map:
                        lines.append(vid_map[v_url])
                        _inlined_videos.add(v_url)

    body = "\n".join(lines)

    # ── 评论/回复渲染 ────────────────────────────────
    comments = data.get("comments", [])
    if cfg.get("enable_comments") and comments:
        allowed_floors = parse_floor_range(cfg.get("comment_floor_range", ""))
        max_count = cfg.get("max_comments", 200)
        display = cfg.get("comments_display", "details")

        filtered = []
        for i, c in enumerate(comments):
            floor = c.get("floor") or (i + 2)
            if allowed_floors and floor not in allowed_floors:
                continue
            filtered.append((floor, c))
            if len(filtered) >= max_count:
                break

        if filtered:
            body += "\n\n---\n\n"
            if display == "heading":
                body += "## 评论/回复\n\n"
                for floor, c in filtered:
                    c_author = c.get("author", "匿名")
                    c_content = c.get("content", "").strip()
                    c_published = _normalize_publish_time(c.get("published", ""))
                    body += f"### #{floor} {c_author}"
                    if c_published:
                        body += f" ({c_published})"
                    body += f"\n\n{c_content}\n\n"
            else:  # details
                body += "<details>\n<summary>评论/回复</summary>\n\n"
                for floor, c in filtered:
                    c_author = c.get("author", "匿名")
                    c_content = c.get("content", "").strip()
                    c_published = _normalize_publish_time(c.get("published", ""))
                    body += f"**#{floor} {c_author}**"
                    if c_published:
                        body += f" *{c_published}*"
                    body += f"\n\n{c_content}\n\n---\n\n"
                body += "</details>\n"

    return filename, front_matter + "\n" + body, image_tasks, video_tasks


class X2MDHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        """覆盖默认日志，使用自定义 logger"""
        logger.info(f"{self.address_string()} - {format % args}")

    # 允许访问本地服务的来源白名单
    ALLOWED_ORIGINS = {
        "chrome-extension://",   # Chrome 扩展（前缀匹配）
        "http://127.0.0.1",
        "http://localhost",
    }

    def _get_allowed_origin(self):
        """检查请求来源是否合法，返回允许的 Origin 或 None"""
        origin = self.headers.get("Origin", "")
        if not origin:
            return "http://127.0.0.1"  # 无 Origin 的本地请求（如直接 curl）
        for allowed in self.ALLOWED_ORIGINS:
            if origin.startswith(allowed):
                return origin
        return None

    def _send_cors_headers(self):
        origin = self._get_allowed_origin()
        self.send_header("Access-Control-Allow-Origin", origin or "http://127.0.0.1")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        """处理 CORS 预检请求"""
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/ping":
            # 心跳检测
            self._respond(200, {"status": "ok", "version": "1.2.4"})

        elif path == "/config":
            # 返回当前配置
            cfg = load_config()
            self._respond(200, cfg)

        else:
            self._respond(404, {"error": "Not Found"})

    MAX_REQUEST_SIZE = 10 * 1024 * 1024  # 10MB 请求体上限

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        if length > self.MAX_REQUEST_SIZE:
            self._respond(413, {"error": f"请求体过大（{length} 字节），上限 {self.MAX_REQUEST_SIZE} 字节"})
            return
        body = self.rfile.read(length)

        try:
            data = json.loads(body.decode("utf-8"))
            logger.info(f"接收到请求: type={data.get('type','?')} platform={data.get('platform','?')} url={data.get('url','')[:80]}")
        except json.JSONDecodeError:
            self._respond(400, {"error": "Invalid JSON"})
            return

        if path == "/save":
            self._handle_save(data)
        elif path == "/config":
            self._handle_config_update(data)
        else:
            self._respond(404, {"error": "Not Found"})

    def _handle_save(self, data: dict):
        """核心：接收推文数据，写入 Markdown 文件"""
        cfg = load_config()
        save_paths = cfg.get("save_paths", [])

        if not save_paths:
            self._respond(500, {"error": "未配置保存路径"})
            return

        try:
            filename, content, image_tasks, video_tasks = build_markdown(data, cfg)
        except Exception as e:
            logger.error(f"Markdown 构建失败：{e}")
            self._respond(500, {"error": str(e)})
            return

        # ── 平台子文件夹 ──────────────────────────
        platform = data.get("platform", "Twitter/X")
        enable_platform_folders = cfg.get("enable_platform_folders", True)
        platform_folder_names = cfg.get("platform_folder_names", {})

        saved_files = []
        errors = []
        for save_path in save_paths:
            try:
                # 计算最终保存目录
                final_dir = save_path
                if enable_platform_folders:
                    folder_name = platform_folder_names.get(platform, platform.replace("/", "_"))
                    folder_name = sanitize_filename(folder_name, 50)
                    final_dir = os.path.join(save_path, folder_name)

                os.makedirs(final_dir, exist_ok=True)

                # 加锁保护文件查找+写入的原子性，防止并发请求写同一文件
                with _save_lock:
                    filepath = os.path.join(final_dir, filename + ".md")
                    overwrite = cfg.get("overwrite_existing", False)
                    source_url = data.get("url", "")

                    if overwrite and source_url:
                        existing = find_existing_file_by_source_url(final_dir, source_url)
                        if existing:
                            filepath = existing
                            logger.info(f"🔁 覆盖已有文件：{filepath}")
                    elif os.path.exists(filepath):
                        ts = datetime.now().strftime("%H%M%S")
                        filepath = os.path.join(final_dir, f"{filename}_{ts}.md")
                    with open(filepath, "w", encoding="utf-8") as f:
                        f.write(content)

                logger.info(f"✅ 已保存：{filepath}")
                saved_files.append(filepath)

                # ── 媒体下载到本地（异步，不需要锁）──
                if image_tasks:
                    for img_url, subfolder, local_name in image_tasks:
                        img_dir = os.path.join(final_dir, subfolder)
                        download_image_async(img_url, img_dir, local_name)
                if video_tasks:
                    for vid_url, subfolder, local_name in video_tasks:
                        vid_dir = os.path.join(final_dir, subfolder)
                        download_video_async(vid_url, vid_dir, local_name)

            except Exception as e:
                logger.error(f"写入失败 [{save_path}]：{e}")
                errors.append(str(e))

        if saved_files:
            self._respond(200, {
                "success": True,
                "saved": saved_files,
                "errors": errors
            })
        else:
            self._respond(500, {"success": False, "errors": errors})

    # 允许通过 API 更新的配置字段白名单
    ALLOWED_CONFIG_KEYS = {
        "port", "save_paths", "filename_format", "max_filename_length",
        "video_save_path", "enable_video_download", "video_duration_threshold",
        "show_site_save_icon", "setup_completed",
        "enable_platform_folders", "platform_folder_names",
        "download_images", "image_subfolder",
        "overwrite_existing", "sync_enabled",
        "enable_comments", "comments_display", "max_comments", "comment_floor_range",
        "discourse_domains", "embed_mode",
        # 飞书 Bitable
        "feishu_api_domain", "feishu_app_id", "feishu_app_secret",
        "feishu_app_token", "feishu_table_id",
        "feishu_upload_md", "feishu_upload_html",
        # Notion Database
        "notion_token", "notion_database_id",
        "notion_prop_title", "notion_prop_url", "notion_prop_author",
        "notion_prop_tags", "notion_prop_saved_date", "notion_prop_type",
        # HTML 导出
        "html_export_folder",
        # 飞书一键复制
        "enable_copy_unlock",
    }

    def _handle_config_update(self, data: dict):
        """更新配置（仅允许白名单内的字段）"""
        filtered = {k: v for k, v in data.items() if k in self.ALLOWED_CONFIG_KEYS}
        if not filtered:
            self._respond(400, {"error": "没有有效的配置字段"})
            return
        with _config_lock:
            cfg = dict(load_config())  # 深拷贝，避免竞态修改共享引用
            cfg.update(filtered)
        save_config(cfg)
        logger.info(f"配置已更新：{filtered}")
        self._respond(200, {"success": True, "config": cfg})

    def _respond(self, code: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)


def main():
    cfg = load_config()
    port = cfg.get("port", 9527)
    server = ThreadingHTTPServer(("127.0.0.1", port), X2MDHandler)
    server.daemon_threads = True  # 随主线程退出，不阻塞关闭
    logger.info(f"🚀 x2md 服务已启动，监听 http://127.0.0.1:{port}")
    logger.info(f"📁 保存路径：{cfg.get('save_paths', [])}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("服务已停止")
        server.shutdown()


if __name__ == "__main__":
    main()
