# X2MD v4 迁移说明

## 迁移前

1. 退出旧版 X2MD，备份 `~/Library/Application Support/X2MD/` 与保存目录。
2. 不要复制旧版进程、PID、日志或 release 压缩包到仓库。
3. v4 固定使用 `127.0.0.1:9527`；先退出仍占用该端口的旧版服务。

## 安装与首次连接

1. 从同一个候选 Release 下载 `X2MD_Mac.zip` 与 `X2MD_Extension.zip`，并用
   `SHA256SUMS.txt` 校验。v4 stable 在 H02 的 Developer ID/notary/staple 证据完成前保持阻塞。
2. 启动 App，按 Setup Doctor 完成运行环境、保存目录、扩展和本地样例四步检查。
3. 重新加载扩展，在连接页输入桌面设置显示的单次 6 位配对码。旧版无认证连接不会沿用。
4. 如果扩展报告凭据失效，重新生成配对码；不要尝试切换端口或把 token 写入配置/fixture。

## 配置迁移

- 配置会迁移到当前 versioned schema；未知字段被移除，未来版本 schema 会被拒绝。
- 旧 `port` 字段被删除；所有客户端只连接 9527。
- 旧 `overwrite` 语义迁移到统一 `duplicate_policy`：默认 `skip`，另有 `update` 和
  `always_new`。建议先保持默认，确认索引后再调整。
- tags、Front Matter、图片本地化、重复策略和视频策略以桌面设置为准；扩展只保留连接设置。
- 旧博主抓取索引继续作为去重导入来源，新的 Bookmarks/Profile 执行进度写入持久 Job Store。

## 保存与历史行为变化

- 保存先完成校验、去重、媒体计划和事务写入；同标题不会再静默覆盖。
- 默认重复保存返回 `skipped` 和已有文件。保存结果/历史提供 Finder、Obsidian、原文和复制路径动作。
- 图片下载启用后写入每个目标 Markdown 目录的相对附件目录；任一目标失败会回滚该图片并保留远程 URL。
- 视频失败返回 partial/warning，不再报告为完整成功。

## 持久批量任务

- Bookmarks、Profile Posts 和 Articles 都创建 App 持久 job。扩展页面仅收集范围并显示摘要。
- 任务中心支持暂停、继续、取消和只重试失败项；rate limit 自动进入 paused。
- App/扩展/页面重启后从 lease checkpoint 恢复，已保存/已跳过项不会重复执行。

## 平台边界

- macOS arm64 使用 Electrobun App；正式 stable 必须完成 H02 签名、公证和 staple 人工门禁。
- Windows 只提供 `X2MD_Windows_Beta.zip`：自带 Bun compile runtime，支持 `/ping`、pairing、
  config、save、shutdown；暂不支持 tray、设置窗口、autostart/updater，也不宣称 Stable。
- Python 实现仅为冻结 legacy，不进入 v4 stable release。

## 回滚

退出 v4 后恢复迁移前备份即可。不要让旧版与 v4 同时监听 9527。已经由 v4 写入的 Markdown
是普通文件，可以保留；若恢复旧索引，请同时恢复对应的 state/config/history 文件，避免索引与文件不一致。
