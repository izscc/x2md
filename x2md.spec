# -*- mode: python ; coding: utf-8 -*-
"""
x2md PyInstaller 打包配置
用法：pyinstaller x2md.spec
"""

import sys
import os

block_cipher = None

a = Analysis(
    ['tray_app.py'],
    pathex=[],
    binaries=[],
    datas=[
        ('extension', 'extension'),       # Chrome 扩展文件夹
        ('config.json', '.'),              # 默认配置
    ],
    hiddenimports=[
        'server',
        'setup_wizard',
        'pystray',
        'pystray._darwin' if sys.platform == 'darwin' else 'pystray._win32',
        'PIL',
        'PIL.Image',
        'PIL.ImageDraw',
        'PIL.ImageFont',
        'certifi',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='X2MD',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=False,          # 不弹出终端窗口
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='assets/icon.icns' if sys.platform == 'darwin' else 'assets/icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='X2MD',
)

# macOS 专用：生成 .app 应用包
if sys.platform == 'darwin':
    app = BUNDLE(
        coll,
        name='X2MD.app',
        icon='assets/icon.icns',
        bundle_identifier='com.x2md.app',
        info_plist={
            'CFBundleName': 'X2MD',
            'CFBundleDisplayName': 'X2MD',
            'CFBundleShortVersionString': '1.0.0',
            'LSUIElement': True,  # 无 Dock 图标，仅菜单栏显示
        },
    )
