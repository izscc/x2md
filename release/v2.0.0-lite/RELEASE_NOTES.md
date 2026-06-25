# X2MD v2.0.0-lite

这是 Mac 桌面端迁移到 Electrobun + Bun/TypeScript 的轻量版发布。

## 下载内容

Tag release 会包含：

- `X2MD_Mac.zip`：Mac Electrobun 版 `.app`
- `X2MD_Windows.zip`：迁移期 Windows legacy 版，由 CI Windows runner 生成
- `X2MD_Extension.zip`：Chrome 扩展
- `SHA256SUMS.txt`：校验文件

本仓库内 `release/v2.0.0-lite/` 只保存本机可复验的 Mac 包、扩展包和校验文件；Windows zip 以 CI artifact/release 为准。

## 补丁更新

- 2026-06-25：修复 X/Twitter 页面点击“复制正文”时，遇到“显示更多 / Show more”折叠推文只复制可见截断内容的问题；复制前会自动展开并等待正文更新。

## 主要变化

- Mac 默认使用 Electrobun + 系统 WebView，不再以 PyInstaller Python 包作为主分发路径。
- 本地服务继续监听 `127.0.0.1:9527`，兼容现有 Chrome 扩展协议。
- 已迁移 `/ping`、`/config`、`/save`、`/profile-capture`、`/autostart`、`/status`、`/log`。
- 设置页支持保存目录、视频目录、端口、自定义保存路径、博主抓取、开机自启、成功通知、服务状态和日志尾部查看。
- Mac 包内置 `extension/`，可从设置页或托盘打开扩展目录。

## 兼容与迁移说明

- 旧配置仍读取 `~/Library/Application Support/X2MD/config.json`，缺失字段会自动补默认值。
- 如果旧配置或扩展设置里已经有保存目录，新版会视为已完成首次设置。
- Markdown 保存格式、Front Matter 语义和默认目录结构保持兼容。
- 自定义保存路径仍必须来自配置白名单，避免本地 API 被任意写文件滥用。
- `/config`、`/save`、`/profile-capture`、`/autostart`、`/status`、`/log` 会拒绝普通网页 Origin；Chrome 扩展、本机和设置页仍可访问。
- 启用或关闭新版自启时会清理旧 `com.x2md.server` LaunchAgent，减少双服务抢端口。
- 如果旧 Python 版正在运行并占用端口，请先退出旧版再打开新版。

## 回滚路径

- Python 桌面端源码和 Windows legacy 包仍保留，可作为迁移期回滚路径。
- 如果 Mac Electrobun 版遇到未覆盖站点问题，可临时使用上一版 Python Mac 包或本仓库 legacy 入口运行。

## 已验证

- 自动验收聚合门禁：`npm run acceptance:mac:auto` 覆盖类型检查、测试、Mac 构建、打包 smoke、自启、首次运行、扩展加载、菜单可见性探测、release zip smoke、SHA、扩展 zip 内容和包体积阈值。
- CI Mac job 会构建 Electrobun `.app`，并运行 `smoke:mac`、`smoke:mac:startup-time`、`smoke:mac:extension-health` 后上传 `X2MD_Mac.zip`；扩展包由独立 job 上传，tag release 汇总生成 `SHA256SUMS.txt`。

- 自动测试：TypeScript/API/golden fixtures、扩展 JS 测试、Python legacy 回归测试（103 个 JS/TS 测试 + 11 个 Python 测试），覆盖托盘菜单入口、设置页字段/脚本一致性和扩展 popup 在线/离线状态。
- Mac 打包烟测：稳定 `.app` 和 `X2MD_Mac.zip` 解压后的 `.app` 启动后 `/ping` 可用，并可通过 `/save` 写入 Markdown，同时验证 `/status`、`/log` 和可选菜单栏可见性探测。
- 首次运行烟测：未完成设置的配置启动后会创建设置页窗口，并记录 `设置页已打开`，保存 Markdown/视频目录后立即创建目录并继续保存内容。
- 自启烟测：临时 HOME 中启用自启会生成 `com.x2md.app.plist`，关闭自启会移除新版和旧版 LaunchAgent，并返回正确开关状态；登录模拟烟测会通过 `launchctl bootstrap` 启动临时 LaunchAgent 并验证 `/ping` 可用。
- 扩展健康烟测：验证打包内置扩展包含 `http://127.0.0.1:9527/*` 权限，且 `chrome-extension://` Origin 可访问 `/ping`；真实 Chrome 临时 profile 可加载 X2MD service worker。
- 端口冲突烟测：本地端口被占用时，新版会记录明确的“端口 ... 已被占用”提示。
- 本机实测：`X2MD_Mac.zip` 约 18MB，解压 `.app` 约 19MB，低于 PRD 目标。
- 本机打包隔离首次自解压启动到 `/ping` 约 5.1–7.8 秒；复用同一 HOME/App 缓存第二次启动需 ≤ 1 秒（`npm run smoke:mac:startup-time`）。体积已低于目标，首次自解压耗时会随机器和缓存状态波动。

## 已知限制

- Windows Electrobun 同构后续完成；当前 Windows 包仍是 legacy 版。
- 真实站点点击保存、系统通知弹出仍建议在发布前做人工验收；覆盖边界见 `docs/acceptance/electrobun-prd-coverage.md`。
