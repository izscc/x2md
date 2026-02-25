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
import sys
import logging
import threading
import urllib.request
from datetime import datetime
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse, parse_qs, urlencode, urlunparse


# ─────────────────────────────────────────────
# 路径工具（兼容 PyInstaller 打包后的目录结构）
# ─────────────────────────────────────────────
def get_app_dir():
    """获取应用根目录（兼容 PyInstaller 打包后的路径）"""
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


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


def load_config() -> dict:
    """加载配置文件，不存在则写入默认配置"""
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
                # 补全缺失字段
                for k, v in DEFAULT_CONFIG.items():
                    if k not in cfg:
                        cfg[k] = v
                return cfg
        except Exception as e:
            logger.warning(f"配置文件读取失败，使用默认配置：{e}")
    save_config(DEFAULT_CONFIG)
    return DEFAULT_CONFIG.copy()


def save_config(cfg: dict):
    """保存配置到文件"""
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


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


def download_video_async(url: str, save_path: str, filename: str):
    """开启后台线程静默下载视频，避免阻塞 HTTP 响应"""
    def _download():
        try:
            logger.info(f"开启长视频下载通道: {url} -> {save_path}/{filename}")
            os.makedirs(save_path, exist_ok=True)
            out_file = os.path.join(save_path, filename)
            
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req) as response, open(out_file, 'wb') as out_file_handle:
                while True:
                    chunk = response.read(8192)
                    if not chunk:
                        break
                    out_file_handle.write(chunk)
            
            logger.info(f"✅ 视频文件下载成功: {out_file}")
        except Exception as e:
            logger.error(f"❌ 视频流下载失败: {e}")
    
    t = threading.Thread(target=_download)
    t.daemon = True
    t.start()


def build_markdown(data: dict, cfg: dict) -> tuple[str, str]:
    """
    将接收到的推文/文章数据构建为 Markdown 字符串。
    返回 (文件名不含后缀, markdown内容)
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

    author_url = f"https://x.com/{handle.lstrip('@')}" if handle else ""

    front_matter = f"""---
title: "{title}"
tags: []
源: "{url}"
作者主页: "{author_url}"
创建时间: "{datetime_str}"
发布时间: "{published}"
平台: "Twitter/X"
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
    for t in thread_tweets:
        all_videos.extend(t.get("videos", []))
        
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

    def append_unused_videos(lines_list, content_text):
        if not videos: return
        unused_vids = [v for v in videos if f"[MEDIA_VIDEO_URL:{v}]" not in (content_text or "")]
        if unused_vids:
            lines_list.append("")
            for v in unused_vids:
                lines_list.append(vid_map[v])

    # [新增过滤器] 如果开启了视频下载，防重踢掉对应的占位图（封面）
    if download_video and videos:
        images = [img for img in images if "video_thumb" not in img]

    if content_type == "article":
        # X Article 图片嵌入（作为封面或母贴遗留的前导图放在顶端）
        if images:
            for i, img_url in enumerate(images):
                orig_url = normalize_image_url(img_url)
                lines.append(f"![{i+1}]({orig_url})")
            lines.append("")

        append_unused_videos(lines, article_content)

        # X Article：直接输出正文（已由 content.js 转换为 Markdown 段落）
        if article_content:
            text_result = article_content.strip()
            for v_url, md_ref in vid_map.items():
                target = f"[MEDIA_VIDEO_URL:{v_url}]"
                text_result = text_result.replace(target, md_ref)
            lines.append(text_result)
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
                orig_url = normalize_image_url(img_url)
                lines.append(f"![{i+1}]({orig_url})")
        
        append_unused_videos(lines, text_result)

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
                    orig_url = normalize_image_url(img_url)
                    lines.append(f"![{idx+2}-{i+1}]({orig_url})")
                    
            if tw_videos:
                lines.append("")
                for v_url in tw_videos:
                    if v_url in vid_map:
                        lines.append(vid_map[v_url])

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
            self._respond(200, {"status": "ok", "version": "1.0.0"})

        elif path == "/config":
            # 返回当前配置
            cfg = load_config()
            self._respond(200, cfg)

        else:
            self._respond(404, {"error": "Not Found"})

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body.decode("utf-8"))
            logger.info(f"接收到的完整数据: {json.dumps(data, ensure_ascii=False)}")
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
                filepath = os.path.join(save_path, filename + ".md")
                # 避免同名文件覆盖
                if os.path.exists(filepath):
                    ts = datetime.now().strftime("%H%M%S")
                    filepath = os.path.join(save_path, f"{filename}_{ts}.md")
                with open(filepath, "w", encoding="utf-8") as f:
                    f.write(content)
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

    def _handle_config_update(self, data: dict):
        """更新配置"""
        cfg = load_config()
        cfg.update(data)
        save_config(cfg)
        logger.info(f"配置已更新：{data}")
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
