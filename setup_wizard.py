#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
x2md 首次运行向导
使用 tkinter 实现暗色主题的 4 步设置向导
"""

import os
import sys
import json
import platform
import tkinter as tk
from tkinter import filedialog


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

# 字体（Mac 优先 SF Pro，Windows 优先微软雅黑，兜底 Inter）
IS_MAC = platform.system() == "Darwin"
FONT_FAMILY = "PingFang SC" if IS_MAC else "Microsoft YaHei"
FONT = lambda size, weight="normal": (FONT_FAMILY, size, weight)


class SetupWizard:
    """首次运行 4 步设置向导"""

    def __init__(self):
        self.root = tk.Tk()
        self.root.title("X2MD 设置向导")
        self.root.geometry("720x580")
        self.root.resizable(False, False)
        self.root.configure(bg=C["bg"])

        # 居中显示
        self.root.update_idletasks()
        x = (self.root.winfo_screenwidth() - 720) // 2
        y = (self.root.winfo_screenheight() - 580) // 2
        self.root.geometry(f"720x580+{x}+{y}")

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
        tk.Label(self.content_frame, text="🔖", font=("Segoe UI Emoji", 56),
                 bg=C["bg"]).pack(pady=(24, 8))

        tk.Label(self.content_frame, text="欢迎使用 X2MD",
                 font=FONT(24, "bold"), fg=C["text"], bg=C["bg"]).pack(pady=(0, 6))

        tk.Label(self.content_frame,
                 text="一键保存推特/X 内容到 Obsidian Markdown",
                 font=FONT(13), fg=C["muted"], bg=C["bg"]).pack(pady=(0, 20))

        features = [
            "📄  推文 → Markdown 文件，自动保存到指定文件夹",
            "🎞️  视频自动下载，Obsidian 内嵌播放",
            "📰  X Article / Note 长文完整抓取",
            "🧵  Thread 长推文一键保存完整线程",
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
        folder = filedialog.askdirectory(title="选择保存目录", initialdir=init_dir)
        if folder:
            string_var.set(folder)

    # ── 步骤三：扩展安装指引 ─────────────────────
    def _step_extension(self):
        tk.Label(self.content_frame, text="🧩 安装 Chrome 浏览器扩展",
                 font=FONT(20, "bold"), fg=C["text"], bg=C["bg"]).pack(
            anchor="w", pady=(8, 2))

        tk.Label(self.content_frame,
                 text="X2MD 需要安装配套的 Chrome 扩展才能在推特页面上抓取内容",
                 font=FONT(12), fg=C["muted"], bg=C["bg"]).pack(
            anchor="w", pady=(0, 14))

        steps = [
            ("❶", "打开 Chrome 浏览器，地址栏输入 chrome://extensions 并回车"),
            ("❷", "打开右上角的「开发者模式」开关"),
            ("❸", "点击左上角「加载已解压的扩展程序」按钮"),
            ("❹", "选择 X2MD 安装目录下的 extension 文件夹"),
            ("❺", "扩展安装完成！在推特页面上点击推文的书签按钮即可保存"),
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
        tk.Label(self.content_frame, text="✅", font=("Segoe UI Emoji", 48),
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
                 text="点击「启动服务」后，X2MD 将在系统托盘后台运行\n在 Chrome 中使用扩展即可开始保存推文",
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

        # 自动创建目录
        os.makedirs(md, exist_ok=True)
        os.makedirs(vid, exist_ok=True)

        # 读取已有配置
        config = {}
        if os.path.exists(CONFIG_FILE):
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    config = json.load(f)
            except Exception:
                pass

        # 写入配置
        config.update({
            "port": config.get("port", 9527),
            "save_paths": [md],
            "filename_format": config.get("filename_format", "{summary}"),
            "max_filename_length": config.get("max_filename_length", 60),
            "video_save_path": vid,
            "setup_completed": True,
        })

        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(config, f, ensure_ascii=False, indent=2)

        self.completed = True
        self.root.destroy()

    # ── 公开入口 ──────────────────────────────────
    def run(self) -> bool:
        """运行向导，返回是否完成"""
        self.root.protocol("WM_DELETE_WINDOW", self.root.destroy)
        self.root.mainloop()
        return self.completed


def run_wizard() -> bool:
    """运行设置向导的快捷函数"""
    return SetupWizard().run()


if __name__ == "__main__":
    ok = run_wizard()
    print("✅ 向导完成" if ok else "❌ 向导已取消")
