# X2MD Electrobun PRD 验收覆盖

## PRD Acceptance Criteria 逐条状态

| # | PRD 验收 | 状态 | 证据 |
| --- | --- | --- | --- |
| 1 | Mac 用户可下载并运行 Electrobun 版 | 自动通过 | `npm run smoke:mac:release`，`release/v2.0.0/X2MD_Mac.zip` |
| 2 | 首次运行可配置保存路径和视频路径 | 自动通过 | `npm run smoke:mac:first-run`、`npm run smoke:mac:window-visible` |
| 3 | Chrome 扩展无需大改连接新服务 | 自动通过 | `npm run smoke:mac:extension-health`、`npm run smoke:chrome-extension-load` |
| 4 | `/ping`、`/config`、`/save`、`/profile-capture`、`/autostart` 协议兼容 | 自动通过 | `npm run check` |
| 5 | X/Twitter Tweet 保存成功 | 自动核心通过；真实页面需人工 | `npm run check` golden fixture；人工清单 |
| 6 | X/Twitter Thread 保存成功 | 自动核心通过；真实页面需人工 | `npm run check` golden fixture；人工清单 |
| 7 | X/Twitter Article 保存成功，代码块、图片、视频不丢 | 自动核心通过；真实页面需人工 | `npm run check` GraphQL/DOM/fixture；人工清单 |
| 8 | LINUX DO 保存成功 | 自动核心通过；真实页面需人工 | `npm run check` fixture；人工清单 |
| 9 | 飞书 wiki/docx 保存成功 | 自动核心通过；真实页面需人工 | `npm run check` fixture；人工清单 |
| 10 | 微信公众号保存成功 | 自动核心通过；真实页面需人工 | `npm run check` fixture；人工清单 |
| 11 | 自定义保存路径只允许白名单路径 | 自动通过 | `npm run check` |
| 12 | 博主批量抓取去重并按预期写入 | 自动通过 | `npm run check` |
| 13 | 菜单栏可打开设置、日志、扩展目录，可退出 | 自动核心通过；真实菜单点击需人工 | `npm run check`、`npm run smoke:mac` `/open` dry-run、`npm run smoke:mac:menu-visible`；人工清单 |
| 14 | 开机自动运行可开启和关闭 | 自动通过 | `npm run smoke:mac:autostart`、`npm run smoke:mac:login-autostart` |
| 15 | 旧配置可自动迁移使用 | 自动通过 | `npm run check` |
| 16 | Mac zip ≤ 30MB | 自动通过 | `npm run check:release-artifacts` |
| 17 | 解压 `.app` ≤ 90MB | 自动通过 | `npm run check:release-artifacts` |
| 18 | 启动到 `/ping` 目标 < 1 秒或明显快于旧版 | 自动通过（日常二次启动） | `npm run smoke:mac:startup-time`；首次自解压仅记录 |
| 19 | 单元、API 集成、扩展测试通过 | 自动通过 | `npm run check` |
| 20 | README 和 BUILD 更新新版流程 | 已更新 | `README.md`、`BUILD.md` |

## 自动已验证

| PRD 验收 | 证据 |
| --- | --- |
| API 兼容：`/ping`、`/config`、`/save`、`/profile-capture`、`/autostart`、CORS | `npm run check` |
| Markdown 输出：Tweet、Thread、Article、Quote、视频、LINUX DO、飞书、微信、博主批量抓取 | `npm run check` |
| 自定义保存路径白名单 | `npm run check` |
| 旧配置迁移和默认值补齐 | `npm run check` |
| 桌面打开目标 API：保存目录、视频目录、日志、扩展目录白名单 | `npm run check`；打包运行态由 `npm run smoke:mac` dry-run 覆盖 |
| 托盘菜单入口、服务状态来自主进程实例、action 分发 | `npm run check` |
| 设置页字段、测试服务按钮和 Chrome 扩展安装说明入口 | `npm run check` |
| 打包 `.app` 服务启动、仅监听 `127.0.0.1`、保存、状态、日志和 `/open` 桌面入口 dry-run | `npm run smoke:mac` |
| release zip 解压 `.app` 可运行 | `npm run smoke:mac:release` |
| 首次运行设置页创建、配置保存后立即生效 | `npm run smoke:mac:first-run` |
| 首次运行设置窗口真实可见 | `npm run smoke:mac:window-visible`；本机已通过，CI/其他机器可能需要辅助功能权限 |
| 自启开启/关闭和旧 LaunchAgent 清理 | `npm run smoke:mac:autostart` |
| 登录后 LaunchAgent 启动服务可用 | `npm run smoke:mac:login-autostart` |
| 扩展包 9527 权限和 `chrome-extension://` Origin `/ping` 兼容 | `npm run smoke:mac:extension-health` |
| 扩展 popup 在线/离线 UI 状态渲染 | `npm run check` |
| 保存成功可选通知正文不泄露完整路径 | `npm run check` |
| 保存失败时扩展保留服务端错误原因 | `npm run check` |
| 日志记录启动监听端口、配置路径、请求摘要、保存成功/失败和自启变更；请求摘要不记录正文隐私 | `npm run check` |
| 真实 Chrome 临时 profile 加载 X2MD 扩展 | `npm run smoke:chrome-extension-load` |
| 端口占用明确提示 | `npm run smoke:mac:port-conflict` |
| 本地服务仅监听 `127.0.0.1` | `npm run smoke:mac` 通过 `lsof` 断言监听地址不是 `*`/`0.0.0.0` |
| Mac 包体积目标、SHA 校验和 release 扩展 zip 内容 | `npm run check:release-artifacts` |
| 启动到 `/ping` 可用 | `npm run smoke:mac:startup-time`；隔离首次自解压仅记录，复用同一 HOME/App 缓存第二次启动要求 ≤ 1 秒 |
| CI 构建新版 Mac 包、Windows legacy 包和扩展包 | `.github/workflows/build.yml` 的 `build-mac`、`build-windows-legacy`、`package-extension`、`release` jobs；Mac job 跑 `smoke:mac`、`smoke:mac:startup-time`、`smoke:mac:extension-health` |
| 自动验收聚合门禁 | `npm run acceptance:mac:auto` |

## 仍需人工验证

| PRD 验收 | 原因 |
| --- | --- |
| X/Twitter、X Article、LINUX DO、飞书、微信公众号真实页面点击保存 | 需要真实登录态/页面 DOM/浏览器扩展环境 |
| 菜单栏真实点击打开日志和扩展目录 | 需要真实 macOS 菜单栏交互；自动 smoke 仅做可见性探测且会避开已安装 App 干扰 |
