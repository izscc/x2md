#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
x2md 首次运行向导
使用 tkinter 实现暗色主题的 4 步设置向导
"""

import os
import sys
import json
import logging
import platform
import traceback
import tkinter as tk
from tkinter import filedialog

logger = logging.getLogger("x2md_wizard")

# ─────────────────────────────────────────────
# 路径工具
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
DEFAULT_MD_PATH = os.path.join(HOME, "Desktop", "X2MD", "MD")
DEFAULT_VIDEO_PATH = os.path.join(HOME, "Desktop", "X2MD", "Videos")

# ─────────────────────────────────────────────
# 暗色主题配色（与 Chrome 扩展 options 页面一致）
# ─────────────────────────────────────────────
C = {
    "bg":           "#0f1117",
    "surface":      "#16181c",
    "surface2":     "#1e2028",
    "border":       "#2f3336",
    "accent":       "#1d9bf0",
    "accent_hover": "#1a8cd8",
    "text":         "#e7e9ea",
    "muted":        "#71767b",
    "success":      "#00ba7c",
}

# 字体（Mac 优先 PingFang SC，Windows 优先微软雅黑 UI）
# 注意：Windows 上 tkinter 使用 bold 字重渲染中文可能导致乱码，
# 使用 "Microsoft YaHei UI" 代替 "Microsoft YaHei" 可缓解此问题
IS_MAC = platform.system() == "Darwin"
FONT_FAMILY = "PingFang SC" if IS_MAC else "Microsoft YaHei UI"
FONT = lambda size, weight="normal": (FONT_FAMILY, size, weight)


class SetupWizard:
    """首次运行 4 步设置向导"""

    def __init__(self):
        logger.info("初始化设置向导...")
        logger.debug(f"tkinter 版本: {tk.TkVersion}")
        logger.debug(f"平台: {platform.system()}, 字体: {FONT_FAMILY}")
        self.root = tk.Tk()
        logger.debug("tk.Tk() 创建成功")
        self.root.title("X2MD 设置向导")
        self.root.geometry("720x680")
        self.root.minsize(600, 500)
        self.root.resizable(True, True)
        self.root.configure(bg=C["bg"])

        # 居中显示
        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() - 720) // 2
        y = (self.root.winfo_screenheight() - 680) // 2
        self.root.geometry(f"720x680+{x}+{y}")

        # 确保窗口置顶可见（解决 LSUIElement app 窗口被遮挡的问题）
        self.root.lift()
        self.root.attributes("-topmost", True)
        self.root.after(300, lambda: self.root.attributes("-topmost", False))
        self.root.focus_force()

        # 用户配置数据
        self.md_path = tk.StringVar(value=DEFAULT_MD_PATH)
        self.video_path = tk.StringVar(value=DEFAULT_VIDEO_PATH)

        self.current_step = 0
        self.completed = False

        # 构建 UI 框架
        self.progress_frame = tk.Frame(self.root, bg=C["bg"], height=70)
        self.progress_frame.pack(fill="x", padx=36, pady=(24, 0))
        self.progress_frame.pack_propagate(False)

        self.content_frame = tk.Frame(self.root, bg=C["bg"])
        self.content_frame.pack(fill="both", expand=True, padx=36, pady=10)

        self.button_frame = tk.Frame(self.root, bg=C["bg"], height=70)
        self.button_frame.pack(fill="x", padx=36, pady=(0, 24))
        self.button_frame.pack_propagate(False)

        self._show_step(0)

    # ── 进度指示器 ─────────────────────────────────
    def _draw_progress(self):
        """绘制顶部步骤指示器"""
        for w in self.progress_frame.winfo_children():
            w.destroy()

        steps = ["欢迎", "路径设置", "扩展安装", "完成"]
        bar = tk.Frame(self.progress_frame, bg=C["bg"])
        bar.pack(expand=True)

        for i, name in enumerate(steps):
            active = i <= self.current_step
            # 圆圈
            circle_bg = C["accent"] if active else C["surface2"]
            circle_fg = "#fff" if active else C["muted"]
            circle = tk.Label(bar, text=str(i + 1), font=FONT(11, "bold"),
                              fg=circle_fg, bg=circle_bg, width=3, height=1,
                              relief="flat", padx=2, pady=2)
            circle.grid(row=0, column=i * 2, padx=6)
            # 标签
            label = tk.Label(bar, text=name, font=FONT(10),
                             fg=C["text"] if active else C["muted"], bg=C["bg"])
            label.grid(row=1, column=i * 2, padx=6, pady=(4, 0))
            # 连接线
            if i < len(steps) - 1:
                line_color = C["accent"] if i < self.current_step else C["border"]
                line = tk.Frame(bar, bg=line_color, height=2, width=50)
                line.grid(row=0, column=i * 2 + 1, sticky="ew")

    # ── 通用工具 ──────────────────────────────────
    def _clear(self):
        for w in self.content_frame.winfo_children():
            w.destroy()
        for w in self.button_frame.winfo_children():
            w.destroy()

    def _show_step(self, step):
        logger.info(f"向导切换到步骤 {step + 1}/4")
        self.current_step = step
        self._clear()
        self._draw_progress()
        [self._step_welcome, self._step_paths,
         self._step_extension, self._step_finish][step]()

    def _make_btn(self, parent, text, command, style="primary"):
        """创建按钮（用 Label 模拟，解决 macOS Aqua 主题忽略 Button 颜色的问题）"""
        styles = {
            "primary":   {"fg": "#ffffff", "bg": C["accent"],  "hover": C["accent_hover"]},
            "secondary": {"fg": "#ffffff", "bg": "#3a3d44",    "hover": "#4a4d54"},
            "success":   {"fg": "#ffffff", "bg": C["success"], "hover": "#00a06a"},
        }
        s = styles[style]

        frame = tk.Frame(parent, bg=s["bg"], padx=2, pady=2,
                         highlightbackground=s["bg"], highlightthickness=1)
        lbl = tk.Label(frame, text=text, font=FONT(16, "bold"),
                       fg=s["fg"], bg=s["bg"],
                       padx=32, pady=12, cursor="hand2")
        lbl.pack()

        # 悬停效果 + 点击事件
        def on_enter(e):
            lbl.configure(bg=s["hover"])
            frame.configure(bg=s["hover"], highlightbackground=s["hover"])

        def on_leave(e):
            lbl.configure(bg=s["bg"])
            frame.configure(bg=s["bg"], highlightbackground=s["bg"])

        def on_click(e):
            command()

        lbl.bind("<Enter>", on_enter)
        lbl.bind("<Leave>", on_leave)
        lbl.bind("<Button-1>", on_click)
        frame.bind("<Button-1>", on_click)

        return frame

    def _make_card(self, parent, **kw):
        """创建暗色卡片容器"""
        card = tk.Frame(parent, bg=C["surface"],
                        highlightbackground=C["border"], highlightthickness=1, **kw)
        return card

    # ── 步骤一：欢迎 ─────────────────────────────
    def _step_welcome(self):
        # Windows tkinter 对大号 emoji 渲染不佳，改用 Segoe UI Emoji 小号 + 兜底
        _emoji_font = ("Segoe UI Emoji", 48) if sys.platform == "win32" else (FONT_FAMILY, 56)
        tk.Label(self.content_frame, text="\U0001F516", font=_emoji_font,
                 bg=C["bg"]).pack(pady=(24, 8))

        tk.Label(self.content_frame, text="欢迎使用 X2MD",
                 font=FONT(24, "bold"), fg=C["text"], bg=C["bg"]).pack(pady=(0, 6))

        tk.Label(self.content_frame,
                 text="一键保存网页内容到 Markdown，多平台多目标",
                 font=FONT(13), fg=C["muted"], bg=C["bg"]).pack(pady=(0, 20))

        features = [
            "📄  X/Twitter、LINUX DO、飞书、微信公众号一键转 Markdown",
            "🎞️  视频自动下载，Obsidian 内嵌播放",
            "💾  多目标保存：Obsidian / 飞书多维表格 / Notion / HTML",
            "🖼️  图片本地下载，按平台分类文件夹",
        ]
        card = self._make_card(self.content_frame)
        card.pack(fill="x", padx=30, pady=10)
        for feat in features:
            tk.Label(card, text=feat, font=FONT(12),
                     fg=C["text"], bg=C["surface"], anchor="w").pack(
                fill="x", padx=18, pady=7)

        self._make_btn(self.button_frame, "开始设置 →",
                       lambda: self._show_step(1)).pack(side="right")

    # ── 步骤二：路径设置 ──────────────────────────
    def _step_paths(self):
        tk.Label(self.content_frame, text="📁 设置保存路径",
                 font=FONT(20, "bold"), fg=C["text"], bg=C["bg"]).pack(
            anchor="w", pady=(8, 2))

        tk.Label(self.content_frame,
                 text="选择 Markdown 文件和视频文件的保存位置，文件夹不存在会自动创建",
                 font=FONT(12), fg=C["muted"], bg=C["bg"]).pack(
            anchor="w", pady=(0, 18))

        # Markdown 路径卡片
        self._path_card("📄 Markdown 文件保存路径",
                        "推文和文章将以 .md 文件保存到此目录",
                        self.md_path)

        # 视频路径卡片
        self._path_card("🎞️ 视频文件保存路径",
                        "推文中的视频将下载到此目录，在 Obsidian 中可内嵌播放",
                        self.video_path)

        self._make_btn(self.button_frame, "← 上一步",
                       lambda: self._show_step(0), "secondary").pack(side="left")
        self._make_btn(self.button_frame, "下一步 →",
                       lambda: self._show_step(2)).pack(side="right")

    def _path_card(self, title, hint, string_var):
        """复用的路径选择卡片"""
        card = self._make_card(self.content_frame)
        card.pack(fill="x", pady=(0, 14))

        tk.Label(card, text=title, font=FONT(13, "bold"),
                 fg=C["text"], bg=C["surface"], anchor="w").pack(
            fill="x", padx=18, pady=(14, 2))
        tk.Label(card, text=hint, font=FONT(11),
                 fg=C["muted"], bg=C["surface"], anchor="w").pack(
            fill="x", padx=18, pady=(0, 8))

        row = tk.Frame(card, bg=C["surface"])
        row.pack(fill="x", padx=18, pady=(0, 14))

        entry = tk.Entry(row, textvariable=string_var, font=FONT(12),
                         fg=C["text"], bg=C["surface2"],
                         insertbackground=C["text"],
                         highlightbackground=C["border"], highlightthickness=1,
                         bd=0)
        entry.pack(side="left", fill="x", expand=True, ipady=8, padx=(0, 10))

        # 浏览按钮（同样用 Label 模拟，确保 macOS 上色彩正确）
        browse_frame = tk.Frame(row, bg=C["accent"], padx=1, pady=1,
                                highlightbackground=C["accent"], highlightthickness=1)
        browse_lbl = tk.Label(browse_frame, text="📂 浏览…", font=FONT(12, "bold"),
                              fg="#ffffff", bg=C["accent"],
                              padx=12, pady=4, cursor="hand2")
        browse_lbl.pack()
        browse_frame.pack(side="right")

        def _do_browse(e, sv=string_var):
            self._browse(sv)
        browse_lbl.bind("<Button-1>", _do_browse)
        browse_frame.bind("<Button-1>", _do_browse)

    def _browse(self, string_var):
        init = string_var.get()
        init_dir = init if os.path.isdir(init) else os.path.dirname(init) if init else HOME

        # 记住当前窗口尺寸和位置（Windows 下 filedialog 会导致窗口缩小）
        current_geo = self.root.geometry()

        folder = filedialog.askdirectory(
            title="选择保存目录",
            initialdir=init_dir,
            parent=self.root      # 关键：指定父窗口，防止 Windows 丢失窗口状态
        )

        # 恢复窗口尺寸（Windows 下 filedialog 关闭后可能触发 geometry 重算）
        self.root.geometry(current_geo)
        self.root.deiconify()
        self.root.lift()

        if folder:
            string_var.set(folder)

    # ── 步骤三：扩展安装指引 ─────────────────────
    def _step_extension(self):
        tk.Label(self.content_frame, text="🧩 安装 Chrome 浏览器扩展",
                 font=FONT(20, "bold"), fg=C["text"], bg=C["bg"]).pack(
            anchor="w", pady=(8, 2))

        tk.Label(self.content_frame,
                 text="X2MD 需要安装配套的 Chrome 扩展才能在网页上抓取内容",
                 font=FONT(12), fg=C["muted"], bg=C["bg"]).pack(
            anchor="w", pady=(0, 14))

        steps = [
            ("❶", "打开 Chrome 浏览器，地址栏输入 chrome://extensions 并回车"),
            ("❷", "打开右上角的「开发者模式」开关"),
            ("❸", "点击左上角「加载已解压的扩展程序」按钮"),
            ("❹", "选择 X2MD 安装目录下的 extension 文件夹"),
            ("❺", "安装完成！在 X/Twitter、LINUX DO、飞书、微信公众号页面使用保存按钮即可"),
        ]

        for num, text in steps:
            card = self._make_card(self.content_frame)
            card.pack(fill="x", pady=3)

            row = tk.Frame(card, bg=C["surface"])
            row.pack(fill="x", padx=16, pady=10)

            tk.Label(row, text=num, font=FONT(16),
                     fg=C["accent"], bg=C["surface"]).pack(side="left", padx=(0, 14))
            tk.Label(row, text=text, font=FONT(12),
                     fg=C["text"], bg=C["surface"],
                     wraplength=530, justify="left", anchor="w").pack(
                side="left", fill="x", expand=True)

        # 提示：extension 文件夹位置
        ext_dir = os.path.join(APP_DIR, "extension")
        tk.Label(self.content_frame,
                 text=f"💡 extension 文件夹路径：{ext_dir}",
                 font=FONT(11), fg=C["accent"], bg=C["bg"],
                 anchor="w", wraplength=640).pack(fill="x", pady=(10, 0))

        self._make_btn(self.button_frame, "← 上一步",
                       lambda: self._show_step(1), "secondary").pack(side="left")
        self._make_btn(self.button_frame, "下一步 →",
                       lambda: self._show_step(3)).pack(side="right")

    # ── 步骤四：完成 ─────────────────────────────
    def _step_finish(self):
        _emoji_font = ("Segoe UI Emoji", 42) if sys.platform == "win32" else (FONT_FAMILY, 48)
        tk.Label(self.content_frame, text="\u2705", font=_emoji_font,
                 bg=C["bg"]).pack(pady=(16, 8))

        tk.Label(self.content_frame, text="设置完成！",
                 font=FONT(22, "bold"), fg=C["text"], bg=C["bg"]).pack(
            pady=(0, 14))

        # 配置摘要卡片
        card = self._make_card(self.content_frame)
        card.pack(fill="x", padx=24, pady=(0, 16))

        tk.Label(card, text="📋 配置摘要", font=FONT(13, "bold"),
                 fg=C["text"], bg=C["surface"], anchor="w").pack(
            fill="x", padx=18, pady=(14, 8))

        for icon, label, var in [
            ("📄", "Markdown 保存路径", self.md_path),
            ("🎞️", "视频保存路径", self.video_path),
        ]:
            row = tk.Frame(card, bg=C["surface"])
            row.pack(fill="x", padx=18, pady=4)
            tk.Label(row, text=f"{icon}  {label}：", font=FONT(11),
                     fg=C["muted"], bg=C["surface"]).pack(side="left")
            tk.Label(row, text=var.get(), font=FONT(11),
                     fg=C["text"], bg=C["surface"]).pack(side="left", padx=(4, 0))

        # 底部间距
        tk.Frame(card, bg=C["surface"], height=8).pack()

        tk.Label(self.content_frame,
                 text="点击「启动服务」后，X2MD 将在系统托盘后台运行\n在 Chrome 中使用扩展即可开始保存内容",
                 font=FONT(12), fg=C["muted"], bg=C["bg"],
                 justify="center").pack(pady=(0, 8))

        self._make_btn(self.button_frame, "← 上一步",
                       lambda: self._show_step(2), "secondary").pack(side="left")
        self._make_btn(self.button_frame, "🚀 启动服务",
                       self._finish, "success").pack(side="right")

    # ── 完成逻辑 ──────────────────────────────────
    def _finish(self):
        """保存配置 → 标记完成 → 关闭窗口"""
        md = self.md_path.get().strip()
        vid = self.video_path.get().strip()
        logger.info(f"向导完成, md_path={md}, video_path={vid}")

        # 自动创建目录
        try:
            os.makedirs(md, exist_ok=True)
            logger.debug(f"Markdown 目录已确保存在: {md}")
        except Exception as e:
            logger.error(f"创建 Markdown 目录失败: {md}, 错误: {e}")

        try:
            os.makedirs(vid, exist_ok=True)
            logger.debug(f"视频目录已确保存在: {vid}")
        except Exception as e:
            logger.error(f"创建视频目录失败: {vid}, 错误: {e}")

        # 读取已有配置
        config = {}
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    config = json.load(f)
                logger.debug("已读取现有配置文件")
            except Exception as e:
                logger.warning(f"读取现有配置失败: {e}")

        # 写入配置
        config.update({
            "port": config.get("port", 9527),
            "save_paths": [md],
            "filename_format": config.get("filename_format", "{summary}"),
            "max_filename_length": config.get("max_filename_length", 60),
            "video_save_path": vid,
            "setup_completed": True,
        })

        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
            logger.info(f"配置已保存到: {CONFIG_FILE}")
        except Exception as e:
            logger.error(f"保存配置失败: {e}\n{traceback.format_exc()}")

        self.completed = True
        self.root.destroy()
        logger.info("向导窗口已关闭")

    # ── 公开入口 ──────────────────────────────────
    def run(self) -> bool:
        """运行向导，返回是否完成"""
        logger.info("开始向导主循环")
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)
        self.root.mainloop()
        logger.info(f"向导主循环结束, completed={self.completed}")
        return self.completed

    def _on_close(self):
        """用户关闭窗口"""
        logger.info("用户关闭了向导窗口")
        self.root.destroy()


def run_wizard() -> bool:
    """运行设置向导的快捷函数"""
    logger.info("run_wizard() 被调用")
    try:
        result = SetupWizard().run()
        logger.info(f"run_wizard() 返回: {result}")
        return result
    except Exception as e:
        logger.error(f"向导运行异常: {e}\n{traceback.format_exc()}")
        return False


if __name__ == "__main__":
    # 独立运行时配置基本日志
    logging.basicConfig(
        level=logging.DEBUG,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )
    ok = run_wizard()
    print("向导完成" if ok else "向导已取消")
