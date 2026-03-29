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
import traceback
import urllib.request

# ─────────────────────────────────────────────
# Windows 崩溃弹窗（console=False 时唯一的错误通知方式）
# ─────────────────────────────────────────────
def _show_crash_dialog(title, message):
    """在 Windows 上弹出错误对话框（仅 console=False 打包环境使用）"""
    try:
        if sys.platform == "win32":
            import ctypes
            ctypes.windll.user32.MessageBoxW(0, str(message), str(title), 0x10)  # MB_ICONERROR
    except Exception:
        pass  # 弹窗本身失败则静默（最后防线）


def _write_crash_log(message):
    """紧急崩溃日志写入（logging 尚未初始化或已损坏时使用）"""
    try:
        crash_dir = os.path.join(os.environ.get("APPDATA") or os.path.expanduser("~"), "X2MD")
        os.makedirs(crash_dir, exist_ok=True)
        crash_file = os.path.join(crash_dir, "crash.log")
        with open(crash_file, "a", encoding="utf-8") as f:
            from datetime import datetime
            f.write(f"\n{'='*60}\n")
            f.write(f"CRASH at {datetime.now().isoformat()}\n")
            f.write(f"Python: {sys.version}\n")
            f.write(f"Platform: {sys.platform}\n")
            f.write(f"Executable: {sys.executable}\n")
            f.write(f"Frozen: {getattr(sys, 'frozen', False)}\n")
            f.write(f"_MEIPASS: {getattr(sys, '_MEIPASS', 'N/A')}\n")
            f.write(f"\n{message}\n")
    except Exception:
        pass


# ─────────────────────────────────────────────
# 路径工具
# ─────────────────────────────────────────────
def get_app_dir():
    """获取应用根目录（用户可写目录：config、日志存放于此）
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

# ─────────────────────────────────────────────
# 日志初始化（带详细诊断）
# ─────────────────────────────────────────────
_log_file_path = os.path.join(APP_DIR, "x2md.log")
_log_handlers = []
try:
    _log_handlers.append(logging.FileHandler(_log_file_path, encoding="utf-8"))
except Exception as _log_err:
    _write_crash_log(f"Failed to create log FileHandler: {_log_err}\nLog path: {_log_file_path}")

# Windows 打包后无控制台窗口，sys.stdout/stderr 为 None，不能创建 StreamHandler
if sys.stdout is not None:
    try:
        _stream_out = (open(sys.stdout.fileno(), mode='w', encoding='utf-8', closefd=False)
                       if sys.platform == "win32" else sys.stdout)
        _log_handlers.append(logging.StreamHandler(_stream_out))
    except (AttributeError, OSError):
        pass

# 确保至少有一个 handler（兜底用 NullHandler 防止 logging 报错）
if not _log_handlers:
    _log_handlers.append(logging.NullHandler())

logging.basicConfig(
    level=logging.DEBUG,  # 使用 DEBUG 级别以捕获最详细的启动信息
    format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    handlers=_log_handlers,
)
logger = logging.getLogger("x2md_tray")

# ─────────────────────────────────────────────
# 启动环境诊断日志
# ─────────────────────────────────────────────
logger.info("=" * 60)
logger.info("X2MD 启动")
logger.info(f"Python 版本: {sys.version}")
logger.info(f"平台: {sys.platform}")
logger.info(f"可执行文件: {sys.executable}")
logger.info(f"工作目录: {os.getcwd()}")
logger.info(f"打包模式 (frozen): {getattr(sys, 'frozen', False)}")
logger.info(f"_MEIPASS: {getattr(sys, '_MEIPASS', 'N/A')}")
logger.info(f"APP_DIR: {APP_DIR}")
logger.info(f"RESOURCE_DIR: {RESOURCE_DIR}")
logger.info(f"CONFIG_FILE: {CONFIG_FILE}")
logger.info(f"EXT_DIR: {EXT_DIR}")
logger.info(f"日志文件: {_log_file_path}")
logger.info(f"sys.argv: {sys.argv}")
logger.info(f"sys.stdout is None: {sys.stdout is None}")
logger.info(f"sys.stderr is None: {sys.stderr is None}")
logger.debug(f"APP_DIR 存在: {os.path.isdir(APP_DIR)}")
logger.debug(f"CONFIG_FILE 存在: {os.path.isfile(CONFIG_FILE)}")
logger.debug(f"EXT_DIR 存在: {os.path.isdir(EXT_DIR)}")
if os.path.isdir(EXT_DIR):
    try:
        ext_files = os.listdir(EXT_DIR)
        logger.debug(f"EXT_DIR 文件数: {len(ext_files)}, 文件: {ext_files[:10]}")
    except Exception as e:
        logger.warning(f"无法列出 EXT_DIR 内容: {e}")
logger.info("=" * 60)


def is_setup_completed() -> bool:
    """检查是否已完成向导设置"""
    logger.debug(f"检查向导完成状态, CONFIG_FILE={CONFIG_FILE}, 存在={os.path.exists(CONFIG_FILE)}")
    if not os.path.exists(CONFIG_FILE):
        logger.info("配置文件不存在，向导未完成")
        return False
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            completed = cfg.get("setup_completed", False)
            logger.debug(f"setup_completed={completed}")
            return completed
    except Exception as e:
        logger.warning(f"读取配置文件失败: {e}")
        return False


def run_setup_wizard() -> bool:
    """运行设置向导（在当前进程中）"""
    logger.info("正在导入 setup_wizard 模块...")
    try:
        from setup_wizard import run_wizard
        logger.info("setup_wizard 模块导入成功，启动向导")
        result = run_wizard()
        logger.info(f"设置向导返回: completed={result}")
        return result
    except ImportError as e:
        logger.error(f"setup_wizard 模块导入失败: {e}\n{traceback.format_exc()}")
        return False
    except Exception as e:
        logger.error(f"设置向导运行异常: {e}\n{traceback.format_exc()}")
        return False


def launch_wizard_subprocess():
    """以子进程方式启动设置向导（从托盘菜单调用，避免线程冲突）"""
    logger.info("从托盘菜单启动设置向导子进程...")
    try:
        if getattr(sys, 'frozen', False):
            cmd = [sys.executable, "--wizard"]
            logger.debug(f"打包环境，执行命令: {cmd}")
            subprocess.Popen(cmd)
        else:
            source_dir = os.path.dirname(os.path.abspath(__file__))
            script = os.path.join(source_dir, "setup_wizard.py")
            cmd = [sys.executable, script]
            logger.debug(f"开发模式，执行命令: {cmd}")
            subprocess.Popen(cmd)
        logger.info("设置向导子进程已启动")
    except Exception as e:
        logger.error(f"启动设置向导子进程失败: {e}\n{traceback.format_exc()}")


def get_port() -> int:
    """从配置文件读取端口"""
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            port = json.load(f).get("port", 9527)
            logger.debug(f"读取端口配置: {port}")
            return port
    except Exception as e:
        logger.warning(f"读取端口配置失败，使用默认值 9527: {e}")
        return 9527


def check_server_alive(port: int) -> bool:
    """检查服务是否在线"""
    try:
        req = urllib.request.Request(f"http://127.0.0.1:{port}/ping")
        with urllib.request.urlopen(req, timeout=2) as resp:
            alive = resp.status == 200
            logger.debug(f"服务健康检查 port={port}: alive={alive}")
            return alive
    except Exception as e:
        logger.debug(f"服务健康检查 port={port}: 不可达 ({e})")
        return False


# ─────────────────────────────────────────────
# HTTP Server 线程管理
# ─────────────────────────────────────────────
_server_ref = None  # 保存 HTTPServer 实例的引用


def start_server_thread():
    """在后台线程中启动 HTTP Server"""
    global _server_ref

    logger.info("正在导入 server 模块...")
    try:
        from http.server import HTTPServer
        logger.debug("http.server.HTTPServer 导入成功")
    except ImportError as e:
        logger.error(f"http.server 导入失败: {e}")
        raise

    try:
        from server import X2MDHandler, load_config
        logger.debug("server.X2MDHandler 和 load_config 导入成功")
    except ImportError as e:
        logger.error(f"server 模块导入失败: {e}\n{traceback.format_exc()}")
        raise

    logger.info("加载配置...")
    cfg = load_config()
    port = cfg.get("port", 9527)
    logger.info(f"配置加载完成, port={port}, save_paths={cfg.get('save_paths', [])}")

    logger.info(f"正在绑定 127.0.0.1:{port}...")
    try:
        server = HTTPServer(("127.0.0.1", port), X2MDHandler)
    except OSError as e:
        logger.error(f"端口绑定失败 127.0.0.1:{port}: {e}")
        if "Address already in use" in str(e) or "10048" in str(e):
            logger.error(f"端口 {port} 已被占用，可能有另一个 X2MD 实例正在运行")
        raise
    _server_ref = server

    logger.info(f"x2md 服务已启动，监听 http://127.0.0.1:{port}")
    logger.info(f"保存路径: {cfg.get('save_paths', [])}")

    t = threading.Thread(target=server.serve_forever, daemon=True, name="x2md-http-server")
    t.start()
    logger.debug(f"HTTP Server 线程已启动: {t.name}, daemon={t.daemon}")
    return t


def stop_server():
    """停止 HTTP Server"""
    global _server_ref
    if _server_ref:
        logger.info("正在停止 HTTP Server...")
        _server_ref.shutdown()
        _server_ref = None
        logger.info("HTTP Server 已停止")
    else:
        logger.debug("stop_server 调用但无运行中的服务")


def restart_server():
    """重启 HTTP Server"""
    logger.info("正在重启服务...")
    stop_server()
    start_server_thread()
    logger.info("服务已重启")


# ─────────────────────────────────────────────
# 系统托盘图标
# ─────────────────────────────────────────────
def create_tray_icon_image():
    """生成托盘图标（程序化绘制，无需外部图片文件）"""
    logger.debug("正在创建托盘图标...")
    from PIL import Image, ImageDraw, ImageFont

    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 蓝色圆形背景
    draw.ellipse([2, 2, size - 2, size - 2], fill=(29, 155, 240))

    # 白色 "X" 字样
    try:
        if sys.platform == "darwin":
            font = ImageFont.truetype("/System/Library/Fonts/Helvetica.ttc", 36)
        elif sys.platform == "win32":
            font = ImageFont.truetype(os.path.join(os.environ.get("WINDIR", "C:\\Windows"), "Fonts", "arial.ttf"), 36)
        else:
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
    logger.info("正在导入 pystray...")
    import pystray
    logger.debug("pystray 导入成功")

    icon_image = create_tray_icon_image()
    port = get_port()
    logger.info(f"准备创建托盘图标, port={port}")

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
    logger.info("系统托盘图标已创建，开始运行事件循环...")
    try:
        icon.run()
    except Exception as e:
        logger.error(f"托盘事件循环异常退出: {e}\n{traceback.format_exc()}")
        raise
    logger.info("托盘事件循环已退出")


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
    """确保 extension 文件夹在用户可访问的位置，并在版本升级时自动更新。
    使用 .x2md_version 标记文件判断是否需要更新。"""
    global EXT_DIR
    import shutil
    logger.info("检查 extension 文件夹可访问性...")

    target = os.path.join(APP_DIR, "extension")
    src = os.path.join(RESOURCE_DIR, "extension")
    version_file = os.path.join(APP_DIR, ".x2md_version")
    logger.debug(f"extension target={target}, src={src}, version_file={version_file}")
    logger.debug(f"target 存在={os.path.isdir(target)}, src 存在={os.path.isdir(src)}")

    # 读取打包资源中的版本号（从 server.py 的 /ping 接口硬编码值获取，或用 manifest）
    bundled_version = ""
    manifest_src = os.path.join(src, "manifest.json") if os.path.isdir(src) else ""
    if manifest_src and os.path.isfile(manifest_src):
        try:
            with open(manifest_src, "r", encoding="utf-8") as f:
                bundled_version = json.load(f).get("version", "")
        except Exception:
            pass

    # 读取已安装的版本
    installed_version = ""
    if os.path.isfile(version_file):
        try:
            with open(version_file, "r", encoding="utf-8") as f:
                installed_version = f.read().strip()
        except Exception:
            pass

    need_update = False
    if not os.path.isdir(target):
        need_update = True
    elif bundled_version and bundled_version != installed_version:
        need_update = True

    if need_update and os.path.isdir(src):
        if os.path.isdir(target):
            shutil.rmtree(target)
        shutil.copytree(src, target)
        # 写入版本标记
        if bundled_version:
            with open(version_file, "w", encoding="utf-8") as f:
                f.write(bundled_version)
        logger.info(f"已将 extension 更新到: {target} (版本: {bundled_version or 'unknown'})")

    if os.path.isdir(target):
        EXT_DIR = target


def _merge_config_defaults():
    """将打包资源中的默认配置字段合并到用户现有配置中（不覆盖用户已设置的值）。
    这样升级版本后新增的配置字段会自动补全。"""
    src = os.path.join(RESOURCE_DIR, "config.json")
    if not os.path.isfile(src):
        return
    try:
        with open(src, "r", encoding="utf-8") as f:
            defaults = json.load(f)
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            user_cfg = json.load(f)

        changed = False
        for key, value in defaults.items():
            if key not in user_cfg:
                user_cfg[key] = value
                changed = True

        if changed:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(user_cfg, f, ensure_ascii=False, indent=2)
            logger.info("已将新版本默认字段合并到用户配置")
    except Exception as e:
        logger.warning(f"合并配置默认值失败: {e}")


def ensure_config_accessible():
    """确保 config.json 在 APP_DIR（可写位置），打包后首次运行时从资源目录复制。
    同时迁移旧版本遗留在 app 包内的配置。升级时自动补全新增字段。"""
    logger.info(f"检查配置文件可访问性: {CONFIG_FILE}")
    if os.path.exists(CONFIG_FILE):
        # 已有配置：合并新版本可能新增的默认字段
        _merge_config_defaults()
        return

    # 优先迁移旧版遗留在 MacOS/ 目录内的配置（用户升级场景）
    if getattr(sys, 'frozen', False):
        old_config = os.path.join(os.path.dirname(sys.executable), "config.json")
        if os.path.isfile(old_config):
            import shutil
            shutil.copy2(old_config, CONFIG_FILE)
            logger.info(f"已迁移旧版配置: {old_config} -> {CONFIG_FILE}")
            _merge_config_defaults()
            return

    # 从打包资源中复制默认配置
    src = os.path.join(RESOURCE_DIR, "config.json")
    if os.path.isfile(src):
        import shutil
        shutil.copy2(src, CONFIG_FILE)
        logger.info(f"已将默认配置复制到: {CONFIG_FILE}")


def main():
    logger.info("main() 开始执行")
    logger.info(f"切换工作目录到 APP_DIR: {APP_DIR}")
    os.chdir(APP_DIR)

    # 处理 --wizard 参数（从托盘菜单调用）
    if "--wizard" in sys.argv:
        logger.info("检测到 --wizard 参数，启动向导模式")
        run_setup_wizard()
        return

    # 确保 config 和 extension 在用户可访问的位置
    logger.info("[阶段 1/4] 检查配置文件...")
    ensure_config_accessible()
    logger.info("[阶段 2/4] 检查扩展文件夹...")
    ensure_extension_accessible()

    # 首次运行：弹出设置向导
    logger.info("[阶段 3/4] 检查向导完成状态...")
    if not is_setup_completed():
        logger.info("首次运行，启动设置向导...")
        completed = run_setup_wizard()
        if not completed:
            logger.info("设置向导被取消，退出。")
            sys.exit(0)
        logger.info("设置向导已完成")
    else:
        logger.info("向导已完成，跳过")

    # 尝试启动系统托盘
    logger.info("[阶段 4/4] 启动服务和托盘...")
    try:
        logger.info("检查 pystray 可用性...")
        import pystray  # noqa: F401
        logger.debug("pystray 导入成功")
        logger.info("检查 PIL 可用性...")
        from PIL import Image  # noqa: F401
        logger.debug("PIL.Image 导入成功")

        logger.info("启动 HTTP Server 线程...")
        start_server_thread()
        logger.info("启动系统托盘...")
        run_tray()
    except ImportError as e:
        logger.warning(f"GUI 依赖缺失 ({e})，降级到命令行模式")
        run_cli_mode()

    logger.info("main() 正常退出")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        logger.info("程序通过 sys.exit() 退出")
        raise
    except Exception as e:
        # 顶层异常捕获：防止 console=False 时静默崩溃
        error_msg = f"X2MD 启动失败（未捕获异常）:\n\n{type(e).__name__}: {e}\n\n{traceback.format_exc()}"
        logger.critical(error_msg)
        _write_crash_log(error_msg)
        _show_crash_dialog("X2MD 启动失败", f"{type(e).__name__}: {e}\n\n详情请查看日志文件:\n{_log_file_path}")
        sys.exit(1)
