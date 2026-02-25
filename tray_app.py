#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
x2md 系统托盘应用 — 主入口
双击运行后：首次弹出设置向导，之后在系统托盘后台运行 HTTP Server。
"""

import os
import sys
import json
import threading
import subprocess
import logging
import urllib.request

# ─────────────────────────────────────────────
# 路径工具
# ─────────────────────────────────────────────
def get_app_dir():
    """获取应用根目录（用户可写目录：config、日志存放于此）"""
    if getattr(sys, 'frozen', False):
        # 打包环境：Mac .app 的 MacOS 同级目录，或 Windows 的 exe 所在目录
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def get_resource_dir():
    """获取打包资源目录（extension 等只读资源存放于此）"""
    if getattr(sys, '_MEIPASS', None):
        return sys._MEIPASS
    return os.path.dirname(os.path.abspath(__file__))


APP_DIR = get_app_dir()
RESOURCE_DIR = get_resource_dir()
CONFIG_FILE = os.path.join(APP_DIR, "config.json")

# extension 文件夹：优先使用 APP_DIR 旁边的副本，否则用打包资源里的
EXT_DIR = os.path.join(APP_DIR, "extension")
if not os.path.isdir(EXT_DIR):
    EXT_DIR = os.path.join(RESOURCE_DIR, "extension")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(APP_DIR, "x2md.log"), encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ]
)
logger = logging.getLogger("x2md_tray")


def is_setup_completed() -> bool:
    """检查是否已完成向导设置"""
    if not os.path.exists(CONFIG_FILE):
        return False
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("setup_completed", False)
    except Exception:
        return False


def run_setup_wizard() -> bool:
    """运行设置向导（在当前进程中）"""
    from setup_wizard import run_wizard
    return run_wizard()


def launch_wizard_subprocess():
    """以子进程方式启动设置向导（从托盘菜单调用，避免线程冲突）"""
    if getattr(sys, 'frozen', False):
        # 打包环境：直接启动自身并附加 --wizard 参数
        subprocess.Popen([sys.executable, "--wizard"])
    else:
        script = os.path.join(APP_DIR, "setup_wizard.py")
        subprocess.Popen([sys.executable, script])


def get_port() -> int:
    """从配置文件读取端口"""
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            return json.load(f).get("port", 9527)
    except Exception:
        return 9527


def check_server_alive(port: int) -> bool:
    """检查服务是否在线"""
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/ping")
        with urllib.request.urlopen(req, timeout=2) as resp:
            return resp.status == 200
    except Exception:
        return False


# ─────────────────────────────────────────────
# HTTP Server 线程管理
# ─────────────────────────────────────────────
_server_ref = None  # 保存 HTTPServer 实例的引用


def start_server_thread():
    """在后台线程中启动 HTTP Server"""
    global _server_ref

    from http.server import HTTPServer
    from server import X2MDHandler, load_config

    cfg = load_config()
    port = cfg.get("port", 9527)
    server = HTTPServer(("127.0.0.1", port), X2MDHandler)
    _server_ref = server

    logger.info(f"🚀 x2md 服务已启动，监听 http://127.0.0.1:{port}")
    logger.info(f"📁 保存路径：{cfg.get('save_paths', [])}")

    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    return t


def stop_server():
    """停止 HTTP Server"""
    global _server_ref
    if _server_ref:
        _server_ref.shutdown()
        _server_ref = None
        logger.info("服务已停止")


def restart_server():
    """重启 HTTP Server"""
    stop_server()
    start_server_thread()
    logger.info("🔄 服务已重启")


# ─────────────────────────────────────────────
# 系统托盘图标
# ─────────────────────────────────────────────
def create_tray_icon_image():
    """生成托盘图标（程序化绘制，无需外部图片文件）"""
    from PIL import Image, ImageDraw, ImageFont

    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 蓝色圆形背景
    draw.ellipse([2, 2, size - 2, size - 2], fill=(29, 155, 240))

    # 白色 "X" 字样
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 36)
    except Exception:
        try:
            font = ImageFont.truetype("arial.ttf", 36)
        except Exception:
            font = ImageFont.load_default()

    bbox = draw.textbbox((0, 0), "X", font=font)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    draw.text(((size - tw) / 2, (size - th) / 2 - 4), "X",
              fill="white", font=font)

    return img


def run_tray():
    """运行系统托盘（阻塞主线程）"""
    import pystray

    icon_image = create_tray_icon_image()
    port = get_port()

    def on_open_wizard(icon, item):
        launch_wizard_subprocess()

    def on_restart(icon, item):
        restart_server()

    def on_open_log(icon, item):
        log_file = os.path.join(APP_DIR, "x2md.log")
        if sys.platform == "darwin":
            subprocess.Popen(["open", log_file])
        elif sys.platform == "win32":
            os.startfile(log_file)
        else:
            subprocess.Popen(["xdg-open", log_file])

    def on_open_ext_folder(icon, item):
        if sys.platform == "darwin":
            subprocess.Popen(["open", EXT_DIR])
        elif sys.platform == "win32":
            os.startfile(EXT_DIR)
        else:
            subprocess.Popen(["xdg-open", EXT_DIR])

    def on_quit(icon, item):
        stop_server()
        icon.stop()

    menu = pystray.Menu(
        pystray.MenuItem("X2MD 服务运行中", None, enabled=False),
        pystray.MenuItem(f"端口：{port}", None, enabled=False),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("⚙️ 打开设置向导", on_open_wizard),
        pystray.MenuItem("📂 打开扩展文件夹", on_open_ext_folder),
        pystray.MenuItem("📋 查看日志", on_open_log),
        pystray.MenuItem("🔄 重启服务", on_restart),
        pystray.Menu.SEPARATOR,
        pystray.MenuItem("❌ 退出 X2MD", on_quit),
    )

    icon = pystray.Icon("x2md", icon_image, "X2MD", menu)
    logger.info("系统托盘图标已添加")
    icon.run()


# ─────────────────────────────────────────────
# 主入口（命令行降级模式 — 无 pystray 时使用）
# ─────────────────────────────────────────────
def run_cli_mode():
    """命令行模式（无 GUI 依赖时的降级方案）"""
    logger.info("⚠️ pystray 未安装，进入命令行模式")
    logger.info("🚀 X2MD 服务已启动，按 Ctrl+C 停止")
    t = start_server_thread()
    try:
        t.join()
    except KeyboardInterrupt:
        stop_server()
        logger.info("服务已停止")


# ─────────────────────────────────────────────
# 主函数
# ─────────────────────────────────────────────
def ensure_extension_accessible():
    """确保 extension 文件夹在用户可访问的位置"""
    global EXT_DIR
    target = os.path.join(APP_DIR, "extension")
    if os.path.isdir(target):
        EXT_DIR = target
        return

    # 从打包资源中复制 extension 到 APP_DIR 旁边
    src = os.path.join(RESOURCE_DIR, "extension")
    if os.path.isdir(src):
        import shutil
        shutil.copytree(src, target)
        logger.info(f"已将 extension 复制到: {target}")
        EXT_DIR = target


def main():
    os.chdir(APP_DIR)

    # 处理 --wizard 参数（从托盘菜单调用）
    if "--wizard" in sys.argv:
        run_setup_wizard()
        return

    # 确保 extension 在用户可访问的位置
    ensure_extension_accessible()

    # 首次运行：弹出设置向导
    if not is_setup_completed():
        logger.info("首次运行，启动设置向导...")
        completed = run_setup_wizard()
        if not completed:
            logger.info("设置向导被取消，退出。")
            sys.exit(0)

    # 启动 HTTP Server
    start_server_thread()

    # 尝试启动系统托盘
    try:
        import pystray  # noqa: F401
        from PIL import Image  # noqa: F401
        run_tray()
    except ImportError:
        run_cli_mode()


if __name__ == "__main__":
    main()
