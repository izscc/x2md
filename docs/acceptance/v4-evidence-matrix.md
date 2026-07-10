# X2MD v4 Requirement–Evidence Matrix

> 由 `npm run generate:evidence-matrix` 生成。只有“已验证”条目具备当前仓库证据；人工门禁不会自动完成。

| PRD §13 Acceptance Criterion | 状态 | 权威证据 |
|---|---|---|
| Git 不再跟踪 config/log/pid/二进制归档。 | 已验证 | `scripts/check-forbidden-files.mjs`; T01/T02 |
| 普通网页和未配对扩展无法访问任何敏感 API。 | 已验证 | `app/tests/api-origin-auth.test.ts`; `app/tests/job-api.test.ts` |
| 官方扩展配对后所有核心请求正常。 | 已验证 | `extension/tests/pairing.test.js`; `app/tests/api.test.ts` |
| 端口 UI 已移除，所有客户端使用 9527。 | 已验证 | `extension/tests/local_client.test.js`; `app/tests/core.test.ts` |
| tag、App、扩展、artifact、README、live ping 版本一致。 | 已验证 | `npm run check:version`; `npm run smoke:mac:release`; tag workflow equality gate |
| Python Windows legacy 不再进入 stable release。 | 已验证 | `docs/platform-support.md`; `scripts/check-release-artifacts.mjs` |
| 20 个不同 capture key、相同标题并发保存生成 20 个唯一文件且历史不丢。 | 已验证 | `app/tests/api.test.ts` |
| 20 个相同 capture key 并发保存默认得到 1 个 saved 和 19 个 skipped。 | 已验证 | `app/tests/save-index.test.ts` |
| state/config/history/job JSON 在故障测试后仍可解析或可恢复。 | 已验证 | `app/tests/state-store.test.ts`; `app/tests/job-recovery.test.ts` |
| 在事务每个 commit 阶段中断后，启动 reconciliation 不留下空正式文件、孤立索引或永久 `.part`。 | 已验证 | `app/tests/save-transaction.test.ts` |
| save index 在写入失败时不产生假成功记录。 | 已验证 | `app/tests/save-transaction.test.ts` |
| 多目录附件引用全部有效。 | 已验证 | `app/tests/image-localizer.test.ts`（每个 Markdown 目录及 rollback） |
| 视频失败不会被报告为完整成功。 | 已验证 | `app/tests/core.test.ts`; `app/tests/fixtures.test.ts` |
| 下载器拒绝私网/危险 URL、超时和超限响应。 | 已验证 | `app/tests/safe-download.test.ts` |
| 新用户可通过 Setup Doctor 完成首条样例保存。 | 已验证 | `app/tests/api.test.ts`; `npm run smoke:mac:first-run` |
| tags/FM/图片/重复策略在桌面设置可配置。 | 已验证 | `app/tests/core.test.ts` |
| 重复保存默认跳过并可打开现有文件。 | 已验证 | `app/tests/save-index.test.ts`; `app/tests/api.test.ts` |
| 保存成功可打开 Obsidian、显示文件和复制路径。 | 已验证 | `app/tests/api.test.ts`; `extension/tests/capture_ui.test.js` |
| `removeBookmark` 不触发保存。 | 已验证 | `extension/tests/bookmark_semantics.test.js` |
| 主流程不存在 `window.confirm`。 | 已验证 | `extension/tests/capture_ui.test.js` |
| Bookmarks/Profile 任务可暂停、恢复、取消和重试失败。 | 已验证 | `app/tests/job-api.test.ts`; `app/tests/profile-jobs.test.ts` |
| 扩展或页面重启后任务可继续。 | 已验证 | `app/tests/job-recovery.test.ts`; `extension/tests/job-recovery.test.js` |
| 已完成项不重复写入。 | 已验证 | `app/tests/job-recovery.test.ts`; `extension/tests/job-recovery.test.js` |
| 任务报告中的计数与 item 状态一致。 | 已验证 | `app/tests/job-api.test.ts`; `app/tests/core.test.ts` |
| PR/main CI 全量运行且无 skipped gate。 | 待验证 | workflow 已 fail-closed；仍需远端 PR/main run URL |
| Mac stable 通过签名、公证和真实 artifact smoke。 | 人工门禁 H02 | 需要 Developer ID、notary accepted、stapler validate 证据 |
| Windows 只有在 TS artifact smoke 通过后标记 stable。 | 待验证 | beta workflow gate 已实现；需 windows-latest 成功 run，当前不宣称 Stable |
| GitHub Release 包含 SHA、SBOM 和 provenance。 | 待验证 | fail-closed release workflow 已实现；需候选 Release artifact 证据 |
