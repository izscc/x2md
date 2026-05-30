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
from email.utils import parsedate_to_datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import Optional
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
        d = os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "X2MD")
    else:
        if getattr(sys, 'frozen', False):
            return os.path.dirname(sys.executable)
        return os.path.dirname(os.path.abspath(__file__))
    os.makedirs(d, exist_ok=True)
    return d


APP_DIR = get_app_dir()
CONFIG_FILE = os.path.join(APP_DIR, "config.json")
PROFILE_CAPTURE_STATE_FILE = os.path.join(APP_DIR, "profile_capture_state.json")

HOME = os.path.expanduser("~")
DEFAULT_CONFIG = {
    "port": 9527,
    "save_paths": [
        os.path.join(HOME, "Desktop", "X2MD", "MD")
    ],
    # X/Twitter 书签按钮悬停菜单：命名保存路径（只在用户点击菜单项时使用）
    "custom_save_paths": [],
    "filename_format": "{summary}_{date}_{author}",
    "max_filename_length": 60,
    "video_save_path": os.path.join(HOME, "Desktop", "X2MD", "Videos"),
    "show_site_save_icon": True,
    "show_x_profile_capture_button": True,
    "profile_capture_range": "today",
    "profile_capture_custom_days": 7,
    "profile_capture_save_path": "",
    "setup_completed": False,
}

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(APP_DIR, "x2md.log"), encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("x2md")

# 全局配置缓存和视频下载线程池
_config_cache: Optional[dict] = None
_video_executor = ThreadPoolExecutor(max_workers=3)


def sanitize_unicode_text(value) -> str:
    """移除 JSON/网页里偶发的孤立 surrogate，避免 UTF-8 写文件失败。"""
    return re.sub(r"[\ud800-\udfff]", "", str(value or ""))


def sanitize_unicode_payload(value):
    """递归清理 payload 中无法编码为 UTF-8 的非法 Unicode 片段。"""
    if isinstance(value, str):
        return sanitize_unicode_text(value)
    if isinstance(value, list):
        return [sanitize_unicode_payload(item) for item in value]
    if isinstance(value, dict):
        return {
            sanitize_unicode_text(key): sanitize_unicode_payload(item)
            for key, item in value.items()
        }
    return value


def load_config() -> dict:
    """加载配置文件，优先返回缓存，不存在则从磁盘读取"""
    global _config_cache
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
    """保存配置到文件并刷新缓存"""
    global _config_cache
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)
    _config_cache = cfg


def normalize_custom_save_paths(cfg: dict) -> list[dict]:
    """返回已配置的命名保存路径，过滤空名称或空路径。"""
    entries = cfg.get("custom_save_paths", [])
    if not isinstance(entries, list):
        return []
    normalized = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        name = str(entry.get("name", "")).strip()
        path = str(entry.get("path", "")).strip()
        if name and path:
            normalized.append({"name": name, "path": path})
    return normalized


def resolve_save_paths_for_request(cfg: dict, data: dict) -> tuple[list[str], bool]:
    """根据请求解析实际保存路径；自定义路径必须来自本地配置。"""
    target_path = str(data.get("custom_save_path", "")).strip()
    target_name = str(data.get("custom_save_path_name", "")).strip()
    if not target_path:
        return cfg.get("save_paths", []), False

    for entry in normalize_custom_save_paths(cfg):
        if entry["path"] == target_path and (not target_name or entry["name"] == target_name):
            return [entry["path"]], True
    raise ValueError("自定义保存路径无效或未在设置中配置")


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
    """清理文件名中的非法字符"""
    name = re.sub(r'[\\/:*?"<>|]', "_", name)
    name = re.sub(r'\s+', " ", name.strip())
    return name[:max_len]


def load_profile_capture_state() -> dict:
    """读取 X 博主批量抓取记录。"""
    if os.path.exists(PROFILE_CAPTURE_STATE_FILE):
        try:
            with open(PROFILE_CAPTURE_STATE_FILE, "r", encoding="utf-8") as f:
                state = json.load(f)
                if isinstance(state, dict):
                    state.setdefault("profiles", {})
                    return state
        except Exception as e:
            logger.warning(f"博主抓取记录读取失败，使用空记录：{e}")
    return {"profiles": {}}


def save_profile_capture_state(state: dict):
    """保存 X 博主批量抓取记录。"""
    with open(PROFILE_CAPTURE_STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=2, sort_keys=True)


def get_profile_state_bucket(state: dict, handle: str) -> dict:
    key = normalize_profile_handle(handle) or "unknown"
    profiles = state.setdefault("profiles", {})
    bucket = profiles.setdefault(key, {})
    bucket.setdefault("tweets", {"captured_ids": {}, "daily": {}})
    bucket.setdefault("articles", {"captured_urls": {}})
    return bucket


def normalize_profile_handle(handle: str) -> str:
    return re.sub(r"[^A-Za-z0-9_]", "", str(handle or "").lstrip("@")).lower()


def parse_twitter_datetime(value: str) -> Optional[datetime]:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone()
    except Exception:
        pass
    try:
        return parsedate_to_datetime(raw).astimezone()
    except Exception:
        return None


def profile_date_key(value: str) -> str:
    dt = parse_twitter_datetime(value)
    return (dt or datetime.now().astimezone()).strftime("%Y-%m-%d")


def profile_time_label(value: str) -> str:
    dt = parse_twitter_datetime(value)
    return dt.strftime("%H:%M") if dt else "时间未知"


def extract_status_id(url: str) -> str:
    match = re.search(r"/status/(\d+)", str(url or ""))
    return match.group(1) if match else ""


def resolve_profile_capture_dir(cfg: dict, profile: dict) -> str:
    base = str(cfg.get("profile_capture_save_path") or "").strip()
    if not base:
        save_paths = cfg.get("save_paths") or []
        base = save_paths[0] if save_paths else os.path.join(HOME, "Desktop", "X2MD", "MD")

    display = (
        str(profile.get("displayName") or "").strip() or
        str(profile.get("display_name") or "").strip() or
        normalize_profile_handle(profile.get("handle", "")) or
        "X博主"
    )
    handle = normalize_profile_handle(profile.get("handle", ""))
    dirname = sanitize_filename(display, 60) or handle or "X博主"
    if handle and handle not in dirname.lower():
        dirname = sanitize_filename(f"{dirname}_{handle}", 80)
    return os.path.join(base, dirname)


def profile_author_label(profile: dict) -> str:
    return (
        str(profile.get("displayName") or "").strip() or
        str(profile.get("display_name") or "").strip() or
        normalize_profile_handle(profile.get("handle", "")) or
        "X博主"
    )


def normalize_article_url(url: str) -> str:
    raw = str(url or "").strip().replace("twitter.com", "x.com")
    return raw.split("?")[0].rstrip("/")


def _normalize_translation_text(value: str) -> str:
    return str(value or "").replace("\u00a0", " ").strip()


def apply_translation_override(data: dict) -> dict:
    """保存端兜底：如果扩展传入已显示译文，则以译文作为 Markdown 主体。"""
    if not data.get("prefer_translated_content") or not isinstance(data.get("translation_override"), dict):
        return data

    result = dict(data)
    override = result.get("translation_override") or {}
    override_type = str(override.get("type") or "").lower()

    if override_type == "article" or result.get("type") == "article":
        title = _normalize_translation_text(override.get("article_title") or override.get("title") or "")
        content = _normalize_translation_text(
            override.get("article_content") or override.get("content") or override.get("text") or ""
        )
        if title:
            result["article_title"] = title
        if content:
            result["article_content"] = content
        if title or content:
            result["type"] = "article"
        return result

    text = _normalize_translation_text(override.get("text") or override.get("article_content") or "")
    if text:
        result["text"] = text
    return result


def download_video_async(url: str, save_path: str, filename: str):
    """提交视频下载任务到线程池（限并发 3），避免阻塞 HTTP 响应"""
    def _download():
        try:
            logger.info(f"开启长视频下载通道: {url} -> {save_path}/{filename}")
            os.makedirs(save_path, exist_ok=True)
            out_file = os.path.join(save_path, filename)

            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            ssl_ctx = _build_ssl_context()
            with urllib.request.urlopen(req, context=ssl_ctx) as response, open(out_file, 'wb') as out_file_handle:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    out_file_handle.write(chunk)

            logger.info(f"✅ 视频文件下载成功: {out_file}")
        except Exception as e:
            logger.error(f"❌ 视频流下载失败: {e}")

    _video_executor.submit(_download)


def append_profile_image(lines: list[str], img_url: str, alt_map: Optional[dict] = None, prefix: str = ""):
    if not img_url:
        return
    orig_url = normalize_image_url(img_url)
    lines.append(f"{prefix}![]({orig_url})")
    alt_map = alt_map or {}
    alt = ""
    if isinstance(alt_map, dict):
        alt = (
            alt_map.get(orig_url) or
            alt_map.get(str(img_url)) or
            alt_map.get(str(img_url).split("?")[0]) or
            ""
        )
    alt = " ".join(str(alt or "").split()).strip()
    if alt:
        lines.append(f"{prefix}```")
        lines.append(f"{prefix}{alt.replace('```', '``\u200b`')}")
        lines.append(f"{prefix}```")


def append_profile_quote(lines: list[str], quote: dict):
    if not isinstance(quote, dict):
        return
    q_text = str(quote.get("text") or "").strip()
    q_images = quote.get("images") or []
    q_videos = quote.get("videos") or []
    q_url = str(quote.get("url") or "").strip()
    if not q_text and not q_images and not q_videos and not q_url:
        return

    lines.append("")
    lines.append("> [!quote] 引用推文")
    if q_text:
        for line in q_text.splitlines():
            lines.append(f"> {line}" if line.strip() else ">")
    for img_url in q_images:
        lines.append(">")
        append_profile_image(lines, img_url, quote.get("image_alt_texts") or {}, prefix="> ")
    for video_url in q_videos:
        lines.append(">")
        lines.append(f"> 🎞️ [视频]({video_url})")
    if q_url:
        lines.append(">")
        lines.append(f"> 原文：{q_url}")


def build_profile_tweet_entry(tweet: dict) -> str:
    url = str(tweet.get("url") or "").strip()
    published = str(tweet.get("published") or "").strip()
    text = str(tweet.get("text") or "").strip()
    lines = [
        f"## {profile_time_label(published)} · [原文]({url})" if url else f"## {profile_time_label(published)}",
        "",
    ]

    if text:
        lines.append(text)
    elif tweet.get("article_title"):
        lines.append(str(tweet.get("article_title")).strip())

    images = tweet.get("images") or []
    if images:
        lines.append("")
        for img_url in images:
            append_profile_image(lines, img_url, tweet.get("image_alt_texts") or {})

    videos = tweet.get("videos") or []
    if videos:
        lines.append("")
        for video_url in videos:
            lines.append(f"🎞️ [视频]({video_url})")

    append_profile_quote(lines, tweet.get("quote_tweet") or {})

    thread_tweets = tweet.get("thread_tweets") or []
    for index, child in enumerate(thread_tweets, start=1):
        if not isinstance(child, dict):
            continue
        child_text = str(child.get("text") or "").strip()
        child_images = child.get("images") or []
        child_videos = child.get("videos") or []
        child_quote = child.get("quote_tweet") or {}
        if not child_text and not child_images and not child_videos and not child_quote:
            continue
        lines.append("")
        lines.append(f"### 续推 {index}")
        lines.append("")
        if child_text:
            lines.append(child_text)
        for img_url in child_images:
            append_profile_image(lines, img_url, child.get("image_alt_texts") or {})
        for video_url in child_videos:
            lines.append(f"🎞️ [视频]({video_url})")
        append_profile_quote(lines, child_quote)

    return "\n".join(lines).strip()


def build_profile_daily_header(profile: dict, date_key: str, range_label: str) -> str:
    author = profile_author_label(profile)
    handle = normalize_profile_handle(profile.get("handle", ""))
    profile_url = str(profile.get("profileUrl") or profile.get("profile_url") or "").strip()
    if not profile_url and handle:
        profile_url = f"https://x.com/{handle}"
    created = datetime.now().strftime("%Y-%m-%d %H:%M")
    title = f"{author} 推文 {date_key}".replace('"', "'")
    return f"""---
title: "{title}"
tags: []
源: "{profile_url}"
作者主页: "{profile_url}"
创建时间: "{created}"
发布时间: "{date_key}"
平台: "Twitter/X"
类别: "[[剪报]]"
阅读状态: false
整理: false
---

# {author} 推文 {date_key}

> 抓取范围：{range_label or "按设置"}
> 排列方式：按 X 时间线从新到旧排列；已自动排除转发/转载。

<!-- X2MD_PROFILE_TIMELINE -->
"""


def write_profile_daily_file(filepath: str, header: str, entries: list[str], *, prepend: bool, overwrite: bool) -> str:
    body = "\n\n---\n\n".join(entry for entry in entries if entry.strip()).strip()
    if overwrite or not os.path.exists(filepath):
        with open(filepath, "w", encoding="utf-8") as f:
            f.write(header.rstrip() + "\n\n" + body + "\n")
        return filepath

    with open(filepath, "r", encoding="utf-8") as f:
        old = f.read().rstrip()
    marker = "<!-- X2MD_PROFILE_TIMELINE -->"
    if marker in old:
        prefix, rest = old.split(marker, 1)
        if prepend:
            merged = prefix.rstrip() + "\n\n" + marker + "\n\n" + body + "\n\n---\n\n" + rest.strip() + "\n"
        else:
            merged = old + "\n\n---\n\n" + body + "\n"
    else:
        merged = old + "\n\n---\n\n" + body + "\n"
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(merged)
    return filepath


def build_profile_article_markdown(article: dict, profile: dict) -> str:
    title = str(article.get("article_title") or article.get("title") or "Untitled").strip()
    content = str(article.get("article_content") or article.get("content") or "").strip()
    url = normalize_article_url(article.get("url") or article.get("article_url") or "")
    published = str(article.get("published") or "").strip()
    author = profile_author_label(profile)
    profile_url = str(profile.get("profileUrl") or profile.get("profile_url") or "").strip()
    created = datetime.now().strftime("%Y-%m-%d %H:%M")
    safe_title = " ".join(title.split()).replace('"', "'")[:100]

    for video_url in article.get("videos") or []:
        content = content.replace(f"[MEDIA_VIDEO_URL:{video_url}]", f"🎞️ [视频]({video_url})")

    image_lines = []
    for image_url in article.get("images") or []:
        normalized_image_url = normalize_image_url(str(image_url).strip())
        if not normalized_image_url:
            continue
        bare_image_url = normalized_image_url.split("?")[0]
        if normalized_image_url in content or bare_image_url in content:
            continue
        image_lines.append(f"![]({normalized_image_url})")
    if image_lines:
        content = content.rstrip() + "\n\n" + "\n\n".join(dict.fromkeys(image_lines))

    return f"""---
title: "{safe_title}"
tags: []
源: "{url}"
作者主页: "{profile_url}"
创建时间: "{created}"
发布时间: "{published}"
平台: "Twitter/X"
类别: "[[剪报]]"
阅读状态: false
整理: false
---

# {title}

> 作者：{author}
> 原文：{url}

{content}
"""


def handle_profile_capture_save(data: dict, cfg: dict) -> dict:
    mode = str(data.get("mode") or "tweets").strip()
    profile = data.get("profile") if isinstance(data.get("profile"), dict) else {}
    handle = normalize_profile_handle(profile.get("handle", ""))
    force_full = bool(data.get("force_full"))
    items = data.get("items") if isinstance(data.get("items"), list) else []
    range_label = str(data.get("range_label") or "").strip()

    target_dir = resolve_profile_capture_dir(cfg, profile)
    os.makedirs(target_dir, exist_ok=True)

    state = load_profile_capture_state()
    bucket = get_profile_state_bucket(state, handle)
    saved_files: list[str] = []
    skipped = 0

    if mode == "articles":
        article_state = bucket.setdefault("articles", {"captured_urls": {}})
        captured_urls = article_state.setdefault("captured_urls", {})
        for article in items:
            if not isinstance(article, dict):
                continue
            url = normalize_article_url(article.get("url") or article.get("article_url") or "")
            if not url:
                continue
            if not force_full and url in captured_urls:
                skipped += 1
                continue
            article["url"] = url
            date_key = profile_date_key(article.get("published", ""))
            title = str(article.get("article_title") or article.get("title") or "Untitled").strip()
            filename = sanitize_filename(f"{profile_author_label(profile)}文章{date_key}_{title}", 120) or f"文章{date_key}"
            filepath = os.path.join(target_dir, filename + ".md")
            if os.path.exists(filepath) and not force_full:
                ts = datetime.now().strftime("%H%M%S")
                filepath = os.path.join(target_dir, f"{filename}_{ts}.md")
            with open(filepath, "w", encoding="utf-8") as f:
                f.write(build_profile_article_markdown(article, profile))
            saved_files.append(filepath)
            captured_urls[url] = {
                "published": article.get("published", ""),
                "title": title,
                "saved_at": datetime.now().isoformat(timespec="seconds"),
                "file": filepath,
            }
        article_state["last_captured_at"] = datetime.now().isoformat(timespec="seconds")
        save_profile_capture_state(state)
        return {"success": True, "saved": saved_files, "skipped": skipped, "target_dir": target_dir}

    tweet_state = bucket.setdefault("tweets", {"captured_ids": {}, "daily": {}})
    captured_ids = tweet_state.setdefault("captured_ids", {})
    daily_state = tweet_state.setdefault("daily", {})
    unique: dict[str, dict] = {}
    for tweet in items:
        if not isinstance(tweet, dict):
            continue
        tweet_id = str(tweet.get("tweet_id") or extract_status_id(tweet.get("url", "")) or "").strip()
        if not tweet_id:
            continue
        if tweet_id not in unique:
            tweet["tweet_id"] = tweet_id
            unique[tweet_id] = tweet

    new_tweets = []
    for tweet_id, tweet in unique.items():
        if not force_full and tweet_id in captured_ids:
            skipped += 1
            continue
        new_tweets.append(tweet)

    grouped: dict[str, list[dict]] = {}
    for tweet in new_tweets:
        grouped.setdefault(profile_date_key(tweet.get("published", "")), []).append(tweet)

    for date_key, tweets in grouped.items():
        tweets.sort(
            key=lambda tw: parse_twitter_datetime(tw.get("published", "")) or datetime.fromtimestamp(0).astimezone(),
            reverse=True,
        )
        filename = sanitize_filename(f"{profile_author_label(profile)}推文{date_key}", 100) or f"推文{date_key}"
        filepath = os.path.join(target_dir, filename + ".md")
        entries = [build_profile_tweet_entry(tweet) for tweet in tweets]
        day_bucket = daily_state.setdefault(date_key, {})
        tweet_datetimes = [parse_twitter_datetime(tw.get("published", "")) for tw in tweets]
        tweet_datetimes = [dt for dt in tweet_datetimes if dt]
        newest = max(tweet_datetimes) if tweet_datetimes else None
        previous_latest = parse_twitter_datetime(day_bucket.get("latest_published", ""))
        prepend = not previous_latest or (newest and newest > previous_latest)
        write_profile_daily_file(
            filepath,
            build_profile_daily_header(profile, date_key, range_label),
            entries,
            prepend=prepend,
            overwrite=force_full,
        )
        saved_files.append(filepath)

        for tweet in tweets:
            tweet_id = tweet.get("tweet_id")
            captured_ids[tweet_id] = {
                "published": tweet.get("published", ""),
                "url": tweet.get("url", ""),
                "saved_at": datetime.now().isoformat(timespec="seconds"),
                "file": filepath,
            }
        published_values = [tw.get("published", "") for tw in tweets]
        all_for_day = [
            item.get("published", "")
            for item in captured_ids.values()
            if isinstance(item, dict) and item.get("file") == filepath
        ]
        combined = [v for v in [*published_values, *all_for_day] if v]
        parsed = [parse_twitter_datetime(v) for v in combined]
        parsed = [v for v in parsed if v]
        if parsed:
            day_bucket["latest_published"] = max(parsed).isoformat()
            day_bucket["earliest_published"] = min(parsed).isoformat()
        day_bucket["file"] = filepath

    tweet_state["last_captured_at"] = datetime.now().isoformat(timespec="seconds")
    save_profile_capture_state(state)
    return {"success": True, "saved": saved_files, "skipped": skipped, "target_dir": target_dir}


def build_markdown(data: dict, cfg: dict) -> tuple[str, str]:
    """
    将接收到的推文/文章数据构建为 Markdown 字符串。
    返回 (文件名不含后缀, markdown内容)
    """
    data = apply_translation_override(data)
    author = data.get("author", "unknown")
    handle = data.get("handle", "")
    text = data.get("text", "")
    url = data.get("url", "")
    published = data.get("published", "")
    content_type = data.get("type", "tweet")  # "tweet" | "article"
    images = data.get("images", [])           # 图片 URL 列表
    image_alt_texts = data.get("image_alt_texts", {}) or {}  # 规范化图片 URL -> ALT 描述
    videos = data.get("videos", [])           # 视频 URL 列表
    download_video = data.get("download_video", False) # 客户端最终确认的下载标识
    article_content = data.get("article_content", "")  # X Article 正文
    article_title = data.get("article_title", "")
    thread_tweets = data.get("thread_tweets", [])  # 线程推文列表
    quote_tweet = data.get("quote_tweet") or {}  # 普通推文中的引用推文
    platform = data.get("platform", "Twitter/X")

    now = datetime.now()
    date_str = now.strftime("%Y-%m-%d")
    datetime_str = now.strftime("%Y-%m-%d %H:%M")

    # ── 文件名（按配置格式构建）─────────────
    summary_src = article_title if article_title else text
    max_len = cfg.get("max_filename_length", 60)
    summary_short = sanitize_filename(summary_src[:30] if summary_src else "untitled", max_len)
    author_clean = sanitize_filename(handle.lstrip("@") if handle else author, 20)
    fmt = cfg.get("filename_format", "{summary}_{date}_{author}")
    filename = (fmt
        .replace("{date}", date_str)
        .replace("{author}", author_clean)
        .replace("{summary}", summary_short))
    # 去除文件名里可能产生的多余下划线
    filename = re.sub(r'_+', '_', filename).strip('_')

    # ── Front Matter ──────────────────────────
    title_src = article_title if article_title else text
    # 去除换行和多余空白，保证 Front Matter 单行合法
    title = " ".join(title_src.split())
    title = title[:80] + ("…" if len(title) > 80 else "")
    title = title.replace('"', "'")

    author_url = data.get("author_url")
    if author_url is None:
        author_url = f"https://x.com/{handle.lstrip('@')}" if handle else ""

    front_matter = f"""---
title: "{title}"
tags: []
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

    vid_map = {}
    save_dir = cfg.get("video_save_path", os.path.join(HOME, "Desktop", "X2MD", "Videos"))
    
    all_videos = list(videos)
    if quote_tweet:
        all_videos.extend(quote_tweet.get("videos", []))
    for t in thread_tweets:
        all_videos.extend(t.get("videos", []))
        if t.get("quote_tweet"):
            all_videos.extend(t["quote_tweet"].get("videos", []))
        
    video_idx = 1
    for vid_url in all_videos:
        if vid_url in vid_map:
            continue
        if download_video:
            vid_filename = f"{filename}_video_{video_idx}.mp4"
            download_video_async(vid_url, save_dir, vid_filename)
            vid_map[vid_url] = f"![[{vid_filename}]]"
            video_idx += 1
        else:
            vid_map[vid_url] = f"🎞️ [推特媒体：点击播放视频]({vid_url})"


    def get_image_alt_text(img_url, alt_map=None):
        alt_map = alt_map or image_alt_texts
        if not isinstance(alt_map, dict):
            return ""
        candidates = []
        if img_url:
            candidates.append(img_url)
            candidates.append(normalize_image_url(img_url))
            candidates.append(str(img_url).split("?")[0])
            candidates.append(normalize_image_url(str(img_url).split("?")[0]))
        for key in candidates:
            value = alt_map.get(key)
            if isinstance(value, str) and value.strip():
                return " ".join(value.split())
        return ""

    def append_alt_fence(lines_list, alt_text, prefix=""):
        alt = " ".join(str(alt_text or "").split()).strip()
        if not alt:
            return
        alt = alt.replace("```", "``\u200b`")
        lines_list.append(f"{prefix}```")
        for line in alt.splitlines() or [alt]:
            lines_list.append(f"{prefix}{line}")
        lines_list.append(f"{prefix}```")

    def append_image(lines_list, img_url, label="", prefix="", alt_map=None):
        orig_url = normalize_image_url(img_url)
        alt_label = label or ""
        lines_list.append(f"{prefix}![{alt_label}]({orig_url})")
        append_alt_fence(lines_list, get_image_alt_text(orig_url, alt_map), prefix)

    def append_unused_videos(lines_list, content_text):
        if not videos: return
        unused_vids = [v for v in videos if f"[MEDIA_VIDEO_URL:{v}]" not in (content_text or "")]
        if unused_vids:
            lines_list.append("")
            for v in unused_vids:
                lines_list.append(vid_map[v])

    def append_quote_tweet(lines_list, quote):
        if not quote:
            return
        q_text = (quote.get("text") or "").strip()
        q_images = quote.get("images") or []
        q_image_alt_texts = quote.get("image_alt_texts") or {}
        q_videos = quote.get("videos") or []
        q_url = (quote.get("url") or "").strip()
        if not q_text and not q_images and not q_videos and not q_url:
            return

        lines_list.append("")
        lines_list.append("> [!quote] 引用推文")
        if q_text:
            for line in q_text.splitlines():
                lines_list.append(f"> {line}" if line.strip() else ">")
        for img_url in q_images:
            lines_list.append(">")
            append_image(lines_list, img_url, prefix="> ", alt_map=q_image_alt_texts)
        for v_url in q_videos:
            if v_url in vid_map:
                lines_list.append(">")
                lines_list.append(f"> {vid_map[v_url]}")
        if q_url:
            lines_list.append(">")
            lines_list.append(f"> 原文：{q_url}")

    # [新增过滤器] 如果开启了视频下载，防重踢掉对应的占位图（封面）
    if download_video and videos:
        images = [img for img in images if "video_thumb" not in img]

    if content_type == "article":
        # X Article：直接输出正文（已由 content.js 转换为 Markdown 段落）
        text_result = ""
        if article_content:
            text_result = article_content.strip()
            for v_url, md_ref in vid_map.items():
                target = f"[MEDIA_VIDEO_URL:{v_url}]"
                text_result = text_result.replace(target, md_ref)
            lines.append(text_result)

        append_unused_videos(lines, text_result)
    else:
        # 普通推文：只输出推文原文
        text_result = text.strip()
        for v_url, md_ref in vid_map.items():
            target = f"[MEDIA_VIDEO_URL:{v_url}]"
            if target in text_result:
                text_result = text_result.replace(target, md_ref)
        lines.append(text_result)

        # ── 图片嵌入（首条推文的图片）
        if images:
            lines.append("")
            for i, img_url in enumerate(images):
                append_image(lines, img_url, label=str(i+1))
        
        append_unused_videos(lines, text_result)
        append_quote_tweet(lines, quote_tweet)

        # ── 线程推文（长推文）───────────────────────────
        for idx, tw in enumerate(thread_tweets):
            tw_text = tw.get("text", "").strip()
            tw_images = tw.get("images", [])
            tw_videos = tw.get("videos", [])
            
            tw_quote = tw.get("quote_tweet") or {}
            if not tw_text and not tw_images and not tw_videos and not tw_quote:
                continue
            lines.append("\n---\n")
            if tw_text:
                lines.append(tw_text)
            
            if tw_images:
                lines.append("")
                tw_image_alt_texts = tw.get("image_alt_texts") or {}
                for i, img_url in enumerate(tw_images):
                    append_image(lines, img_url, label=f"{idx+2}-{i+1}", alt_map=tw_image_alt_texts)
                    
            if tw_videos:
                lines.append("")
                for v_url in tw_videos:
                    if v_url in vid_map:
                        lines.append(vid_map[v_url])

            append_quote_tweet(lines, tw_quote)

    body = "\n".join(lines)
    return filename, front_matter + "\n" + body


class X2MDHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        """覆盖默认日志，使用自定义 logger"""
        logger.info(f"{self.address_string()} - {format % args}")

    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
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
            self._respond(200, {"status": "ok", "version": "1.1.15"})

        elif path == "/config":
            # 返回当前配置
            cfg = load_config()
            self._respond(200, cfg)

        elif path == "/profile-capture/state":
            query = parse_qs(urlparse(self.path).query)
            handle = normalize_profile_handle((query.get("handle") or [""])[0])
            state = load_profile_capture_state()
            bucket = get_profile_state_bucket(state, handle) if handle else {}
            self._respond(200, {"success": True, "handle": handle, "state": bucket})

        else:
            self._respond(404, {"error": "Not Found"})

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body.decode("utf-8"))
            data = sanitize_unicode_payload(data)
            logger.info(f"接收到请求: type={data.get('type','?')} platform={data.get('platform','?')} url={data.get('url','')[:80]}")
        except json.JSONDecodeError:
            self._respond(400, {"error": "Invalid JSON"})
            return

        if path == "/save":
            self._handle_save(data)
        elif path == "/profile-capture":
            self._handle_profile_capture(data)
        elif path == "/config":
            self._handle_config_update(data)
        else:
            self._respond(404, {"error": "Not Found"})

    def _handle_save(self, data: dict):
        """核心：接收推文数据，写入 Markdown 文件"""
        cfg = load_config()
        try:
            save_paths, _using_custom_save_path = resolve_save_paths_for_request(cfg, data)
        except ValueError as e:
            self._respond(400, {"success": False, "error": str(e)})
            return

        if not save_paths:
            self._respond(500, {"error": "未配置保存路径"})
            return

        try:
            filename, content = build_markdown(data, cfg)
        except Exception as e:
            logger.error(f"Markdown 构建失败：{e}")
            self._respond(500, {"error": str(e)})
            return

        saved_files = []
        errors = []
        for save_path in save_paths:
            try:
                os.makedirs(save_path, exist_ok=True)
                safe_filename = sanitize_unicode_text(filename) or "untitled"
                safe_content = sanitize_unicode_text(content)
                filepath = os.path.join(save_path, safe_filename + ".md")
                # 避免同名文件覆盖
                if os.path.exists(filepath):
                    ts = datetime.now().strftime("%H%M%S")
                    filepath = os.path.join(save_path, f"{safe_filename}_{ts}.md")
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(safe_content)
                logger.info(f"✅ 已保存：{filepath}")
                saved_files.append(filepath)
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

    def _handle_profile_capture(self, data: dict):
        """批量保存 X 博主推文/文章。"""
        cfg = load_config()
        try:
            result = handle_profile_capture_save(data, cfg)
            self._respond(200, result)
        except Exception as e:
            logger.error(f"博主批量抓取保存失败：{e}")
            self._respond(500, {"success": False, "error": str(e)})

    def _handle_config_update(self, data: dict):
        """更新配置"""
        cfg = load_config()
        cfg.update(data)
        save_config(cfg)
        logger.info(f"配置已更新：{data}")
        self._respond(200, {"success": True, "config": cfg})

    def _respond(self, code: int, payload: dict):
        payload = sanitize_unicode_payload(payload)
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
    server = HTTPServer(("127.0.0.1", port), X2MDHandler)
    logger.info(f"🚀 x2md 服务已启动，监听 http://127.0.0.1:{port}")
    logger.info(f"📁 保存路径：{cfg.get('save_paths', [])}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        logger.info("服务已停止")
        server.shutdown()


if __name__ == "__main__":
    main()
