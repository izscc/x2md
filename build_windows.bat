@echo off
REM =============================================
REM x2md Windows 打包脚本
REM 在 Windows 上运行此脚本来打包 X2MD.exe
REM =============================================

echo === X2MD Windows 打包工具 ===
echo.

REM 检查 Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [错误] 未检测到 Python，请先安装 Python 3.10+
    echo 下载地址: https://www.python.org/downloads/
    pause
    exit /b 1
)

REM 创建虚拟环境
if not exist venv (
    echo [1/4] 创建虚拟环境...
    python -m venv venv
)

REM 激活虚拟环境
call venv\Scripts\activate.bat

REM 安装依赖
echo [2/4] 安装依赖...
pip install -r requirements.txt pyinstaller -q

REM 生成 ICO 图标
echo [3/4] 生成 Windows 图标...
python -c "
from PIL import Image
img = Image.open('assets/icon.png')
img.save('assets/icon.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
print('icon.ico 已生成')
"

REM 打包
echo [4/4] 打包中...
pyinstaller x2md.spec --clean --noconfirm

echo.
echo === 打包完成！===
echo 产出目录: dist\X2MD\
echo 可执行文件: dist\X2MD\X2MD.exe
echo.
echo 将 dist\X2MD 文件夹压缩为 zip 即可分发给用户
pause
