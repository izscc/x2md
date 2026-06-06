#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""开机自动运行管理。"""

import os
import plistlib
import subprocess
import sys


LABEL = "com.x2md.app"
LEGACY_LABEL = "com.x2md.server"


def _launch_agents_dir() -> str:
    path = os.path.join(os.path.expanduser("~"), "Library", "LaunchAgents")
    os.makedirs(path, exist_ok=True)
    return path


def _plist_path(label: str = LABEL) -> str:
    return os.path.join(_launch_agents_dir(), f"{label}.plist")


def _program_arguments() -> list[str]:
    if getattr(sys, "frozen", False):
        return [sys.executable]
    return [sys.executable, os.path.join(os.path.dirname(os.path.abspath(__file__)), "tray_app.py")]


def _working_directory() -> str:
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))


def _launchctl(*args: str) -> None:
    subprocess.run(["launchctl", *args], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def is_autostart_enabled() -> bool:
    if sys.platform != "darwin":
        return False
    return os.path.exists(_plist_path())


def enable_autostart() -> bool:
    if sys.platform != "darwin":
        raise RuntimeError("当前仅支持 macOS 开机自动运行")

    plist = {
        "Label": LABEL,
        "ProgramArguments": _program_arguments(),
        "WorkingDirectory": _working_directory(),
        "RunAtLoad": True,
        "KeepAlive": False,
        "StandardOutPath": os.path.join(os.path.expanduser("~"), "Library", "Logs", "x2md-autostart.log"),
        "StandardErrorPath": os.path.join(os.path.expanduser("~"), "Library", "Logs", "x2md-autostart.log"),
    }
    path = _plist_path()
    with open(path, "wb") as f:
        plistlib.dump(plist, f)

    # 旧版本可能安装过独立 server.py 自启项；它会和 App 抢 9527 端口。
    disable_autostart(LEGACY_LABEL)

    uid = os.getuid()
    _launchctl("bootout", f"gui/{uid}", path)
    _launchctl("bootstrap", f"gui/{uid}", path)
    return is_autostart_enabled()


def disable_autostart(label: str = LABEL) -> bool:
    if sys.platform != "darwin":
        return True

    path = _plist_path(label)
    uid = os.getuid()
    _launchctl("bootout", f"gui/{uid}", path)
    if os.path.exists(path):
        os.remove(path)
    return not os.path.exists(path)


def set_autostart_enabled(enabled: bool) -> bool:
    if enabled:
        return enable_autostart()
    return disable_autostart()
