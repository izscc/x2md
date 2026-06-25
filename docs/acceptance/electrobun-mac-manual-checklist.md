# X2MD Electrobun Mac 人工验收清单

目标：发布前验证 PRD 中无法完全自动化的 Mac 桌面体验与真实站点保存路径。

自动/人工覆盖边界见 [`electrobun-prd-coverage.md`](./electrobun-prd-coverage.md)。

## 先跑自动门禁

```bash
npm run acceptance:mac:auto  # 含 check:release-artifacts

# 可选：需要 osascript 辅助功能权限
npm run smoke:mac:window-visible
```

期望：测试通过，build `.app` 和 release zip 解压 `.app` 的 `smoke:mac` 都输出 `packaged smoke ok: ... /ping + /save + /status + /log + /open`，端口冲突 smoke 输出 `packaged conflict smoke ok`，首次运行 smoke 输出 `first-run config`，自启 smoke 输出 `autostart`，登录模拟 smoke 输出 `login-autostart`，扩展健康 smoke 输出 `extension-health`，Chrome 加载 smoke 输出 `chrome extension load smoke ok`；窗口可见 smoke 需辅助功能权限，可能输出 `window-visible` 或 `window-visible smoke skipped`；菜单栏 smoke 若已安装 X2MD 正在运行会跳过。

## Mac 桌面验收

| 状态 | 项目 | 操作 | 通过标准 |
| --- | --- | --- | --- |
| [x] | 首次打开设置页 | `npm run smoke:mac:first-run`、`npm run smoke:mac:window-visible` | System Events 已看到 `X2MD 设置` 窗口 |
| [x] | 设置保存目录 | `npm run smoke:mac:first-run` | `/config` 返回新路径，目录自动创建 |
| [x] | 扩展真实加载 | `npm run smoke:chrome-extension-load`、`npm run smoke:mac:extension-health`、`npm run check` | 临时 Chrome profile 能加载 X2MD service worker，协议和 popup UI 状态已验证 |
| [ ] | X/Twitter 单条保存 | 在 X/Twitter Tweet 页面点击保存 | Markdown 文件写入保存目录，图片/alt/引用不丢 |
| [ ] | X Article 保存 | 保存含代码块的 X Article | 代码块保留，图片/视频引用不丢 |
| [ ] | LINUX DO 保存 | 在 LINUX DO topic 页面点击保存 | Markdown 标题、链接、正文正常 |
| [ ] | 飞书保存 | 在飞书 wiki/docx 页面点击保存 | Markdown 正文正常，路径安全 |
| [ ] | 微信公众号保存 | 在公众号文章页面点击保存 | Markdown 正文、代码块、链接正常 |
| [ ] | 菜单栏打开日志 | `npm run smoke:mac` 已 dry-run 验证 `/open`；人工再点菜单栏“打开日志” | 能打开/显示 `x2md.log`，含启动和保存记录 |
| [ ] | 菜单栏打开扩展目录 | `npm run smoke:mac` 已 dry-run 验证 `/open`；人工再点菜单栏“打开扩展目录” | 打开 `.app/Contents/Resources/extension` 或开发目录 `extension/` |
| [x] | 开启自启 | `npm run smoke:mac:autostart` | 临时 HOME 中 `com.x2md.app.plist` 存在且指向新版 App |
| [x] | 关闭自启 | `npm run smoke:mac:autostart` | 临时 HOME 中 `com.x2md.app.plist` 和旧 `com.x2md.server.plist` 均不存在 |
| [x] | 登录后服务可用 | `npm run smoke:mac:login-autostart` | 临时 LaunchAgent 通过 `launchctl bootstrap` 启动后 `/ping` 可用 |
| [x] | 无旧版冲突 | `ps` 未发现 `server.py`/`tray_app.py`/`com.x2md.server`；`npm run smoke:mac:port-conflict` 已覆盖占用提示 | 新版正常启动，旧版占端口时有明确提示 |
| [x] | 旧版占端口提示 | `npm run smoke:mac:port-conflict` | 新版日志/终端出现明确“端口 ... 已被占用”提示 |

## 发布前记录

- 本机自动烟测参考（2026-06-25）：`X2MD_Mac.zip` 约 18MB，解压 `.app` 约 19MB，隔离首次自解压启动到 `/ping` 约 5.1–7.8 秒；复用同一 HOME/App 缓存第二次启动需 ≤ 1 秒（`npm run smoke:mac:startup-time`）。
- 本机 v2 发布目录：`release/v2.0.0/X2MD_Mac.zip`、`X2MD_Extension.zip`、`SHA256SUMS.txt` 已生成；Windows legacy 包由 CI Windows runner 生成。
- `X2MD_Mac.zip` 大小：18 MB，目标 ≤ 30MB。
- 解压 `.app` 大小：19 MB，目标 ≤ 90MB。
- 冷启动到 `/ping` 可用：隔离首次自解压约 5.1–7.8 秒；复用同一 HOME/App 缓存第二次启动需 ≤ 1 秒（`npm run smoke:mac:startup-time`）。PRD 的 ≤ 1 秒目标按日常二次启动满足，首次自解压需在 release note 中说明。
- 验收系统：macOS ____，芯片 ____。
- 备注/阻塞：____。
