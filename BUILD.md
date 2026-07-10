# X2MD 构建指南

## 默认架构：Electrobun + Bun（Mac）

```bash
# 安装 Bun 后
bun install

# 开发运行
bun run dev

# 生产构建（当前平台；Mac runner 产出 .app）
bun run build:mac

# 打包产物冒烟测试：启动 bundle，检查 /ping 耗时，并通过 /save 写入 Markdown、通过 /open dry-run 覆盖桌面入口
npm run smoke:mac
npm run smoke:mac:startup-time  # 复用缓存后的第二次启动到 /ping ≤ 1 秒

# 端口占用提示冒烟测试
npm run smoke:mac:port-conflict

# 扩展包健康检查兼容性
npm run smoke:mac:extension-health

# 真实 Chrome 临时 profile 加载扩展
npm run smoke:chrome-extension-load

# 开机自启开关冒烟测试
npm run smoke:mac:autostart

# 模拟登录后 LaunchAgent 启动并验证 /ping
npm run smoke:mac:login-autostart

# 首次运行配置保存冒烟测试
npm run smoke:mac:first-run

# 首次运行设置窗口可见性冒烟测试
npm run smoke:mac:window-visible

# 可选：菜单栏可见性；若已安装 X2MD 正在运行会跳过
npm run smoke:mac:menu-visible

# 可选：验证 release zip 解压后的 .app
npm run smoke:mac:release

# Release SHA 和包体积阈值
npm run check:release-artifacts
```

Electrobun 构建会读取 `electrobun.config.ts`，入口为 `app/main/index.ts`，设置页为 `app/ui/settings/`。构建后会把 `extension/` 复制到 `.app/Contents/Resources/extension`，供菜单和设置页直接打开。设置页内置 `/status` 状态摘要、`/log` 日志尾部查看和可选保存成功通知。

## 测试

```bash
npm run check
```

完整 Mac 自动验收门禁：

```bash
npm run acceptance:mac:auto
```

该命令会先做 TypeScript 类型检查，然后跑：

- TypeScript 新核心、API 与 golden fixture 测试：`app/tests/*.test.ts`
- Chrome 扩展 JS 测试：`extension/tests/*.test.js`、`tests/*.js`
- Python legacy 回归测试：`tests/test_*.py`

## 分发产物

CI 默认产出：

- `X2MD_Mac.zip`：Electrobun `.app`
- `X2MD_Windows.zip`：迁移期 Python legacy 版
- `X2MD_Extension.zip`：Chrome 扩展
- `SHA256SUMS.txt`

发布二进制统一生成到未纳入 Git 的 `artifacts/v<version>/`；也可用
`node scripts/package-release.mjs --output-dir <临时目录>` 指定 CI 临时目录。若目标目录已存在，
打包会直接失败，避免静默覆盖。校验时使用
`npm run check:release-artifacts -- --dir <产物目录>`。`release/` 只保留人工维护的
`RELEASE_NOTES.md`。清理既有 Git 历史中的二进制需要人工另行批准，本次不执行历史改写。

## Python legacy（回滚路径）

迁移期仍保留旧版 Python 桌面端：

```bash
pip3 install -r requirements.txt
pip3 install pyinstaller

# 开发运行
python3 tray_app.py

# 仅运行服务
python3 server.py

# 打包 legacy 版
pyinstaller x2md.spec --clean --noconfirm
```
