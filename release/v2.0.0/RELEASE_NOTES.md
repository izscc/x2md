# X2MD v2.0.0

这是 Mac 桌面端迁移到 Electrobun + Bun/TypeScript 的正式 2.0.0 发布，去掉 `lite` 版本标签。

## 本次修复

- 修复 X/Twitter 保存“已翻译推文”时，链接会被保存成 `http://` 与域名分行的问题。
- 同时在扩展发送前和本地服务生成 Markdown 前清理该类 X 显示链接换行，兼容旧扩展残留数据。

## 下载内容

Tag release 会包含：

- `X2MD_Mac.zip`：Mac Electrobun 版 `.app`
- `X2MD_Windows.zip`：迁移期 Windows legacy 版，由 CI Windows runner 生成
- `X2MD_Extension.zip`：Chrome 扩展
- `SHA256SUMS.txt`：校验文件

本仓库内 `release/v2.0.0/` 保存本机可复验的 Mac 包、扩展包和校验文件；Windows zip 以 CI artifact/release 为准。

## 主要变化

- Mac 默认使用 Electrobun + 系统 WebView，不再以 PyInstaller Python 包作为主分发路径。
- 本地服务继续监听 `127.0.0.1:9527`，兼容现有 Chrome 扩展协议。
- 已迁移 `/ping`、`/config`、`/save`、`/profile-capture`、`/autostart`、`/status`、`/log`。
- 设置页支持保存目录、视频目录、端口、自定义保存路径、博主抓取、开机自启、成功通知、服务状态和日志尾部查看。
- Mac 包内置 `extension/`，可从设置页或托盘打开扩展目录。

## 已验证

- `npm run check`
- 本机重新构建 Mac 包和 Chrome 扩展包
- `npm run check:release-artifacts`

## 已知限制

- Windows Electrobun 同构后续完成；当前 Windows 包仍是 legacy 版。
- 真实站点点击保存、系统通知弹出仍建议在发布前做人工验收。
