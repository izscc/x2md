# X2MD 构建指南

## 环境准备

```bash
# 安装 Python 依赖
pip3 install -r requirements.txt

# 安装打包工具
pip3 install pyinstaller
```

## 开发模式运行

```bash
# 直接运行（带向导和托盘）
python3 tray_app.py

# 仅运行向导（调试）
python3 setup_wizard.py

# 仅运行服务（无 GUI）
python3 server.py
```

## 打包

### macOS

```bash
# 打包为 .app
pyinstaller x2md.spec

# 产出目录：dist/X2MD.app
# 可直接双击运行，或拖入 /Applications
```

### Windows

```powershell
# 在 Windows 上运行同一个 spec 文件
pyinstaller x2md.spec

# 产出目录：dist\X2MD\X2MD.exe
```

## 分发

打包完成后，`dist/X2MD/` 目录包含：

```
X2MD/
├── X2MD (或 X2MD.exe)    # 主程序
├── extension/            # Chrome 扩展（用户需手动加载）
├── config.json           # 配置文件（首次运行后自动生成）
└── ...                   # 运行时依赖
```

将整个 `X2MD/` 文件夹压缩为 zip 即可分发给用户。

## 用户使用流程

1. 解压 zip 文件
2. 双击 `X2MD`（Mac）或 `X2MD.exe`（Windows）
3. 按照向导完成路径设置
4. 根据向导指引安装 Chrome 扩展
5. 在 X/Twitter 页面使用书签按钮保存内容
