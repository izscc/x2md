# Implementation Plan: X2MD v3 Improvement Iteration

## Overview
基于 `docs/prd/x2md-v3-improvement-prd.md`，按 PRD 的 Phase 0 → Phase 1 → Phase 2 推进。先做低风险、可验证、能提升后续迭代确定性的基础项：版本单一源、GraphQL 韧性测试基建、重复检测、popup/离线体验与保存后动作；再做 X 内容类型补全与批量能力；最后做模板、图片本地化、跨平台与更新。

## Architecture Decisions
- 根目录 `package.json` 的 `version` 作为唯一真源；同步脚本负责写入扩展 manifest 与 `app/core/config.ts`。
- Phase 0 避免一次性大拆 `content.js`，先抽可测试的小模块或修小确定项，保持行为兼容。
- 所有 X GraphQL 新解析能力先以脱敏 fixture + golden 输出验证，再接入运行时。
- 批量导出默认低并发、可暂停，避免为速度牺牲稳定性。
- Obsidian 输出保持现有 Front Matter 字段不删除，只新增可选字段。

## Task List

### Phase 0: 稳定基线 v2.1
- [ ] Task 1: 版本单一源与小修复
- [ ] Task 2: GraphQL op-id 缓存与错误码契约
- [ ] Task 3: GraphQL fixture 基建与回归样例
- [ ] Task 4: popup 文案、版本、离线态升级
- [ ] Task 5: 视频确认从原生 confirm 改为自绘 modal
- [ ] Task 6: 重复检测 save_index.json 与默认 ask/skip 策略基础
- [ ] Task 7: 保存后显示文件 / 复制路径响应能力
- [ ] Task 8: content.js 拆分第一刀：toast / 保存响应 / GraphQL 探测工具

### Checkpoint: v2.1
- [ ] `npm run check` 通过
- [ ] `/ping`、manifest、配置版本一致
- [ ] 服务离线、重复保存、视频保存三条主流程人工验证

### Phase 1: X 深度 v2.2
- [ ] Task 9: 时间线卡片完整度校验与详情页媒体一致性测试
- [ ] Task 10: Poll 结构化解析与 Markdown 输出
- [ ] Task 11: Community Notes 结构化解析与 Markdown 输出
- [ ] Task 12: 链接卡片元数据解析与输出
- [ ] Task 13: Bookmarks 页工具条与导出可见列表
- [ ] Task 14: Bookmarks 批量进度、暂停/取消、失败重试
- [ ] Task 15: Profile 抓取进度与视频策略对齐
- [ ] Task 16: 标签规则引擎最小版本
- [ ] Task 17: 本地 API token 可选收紧

### Checkpoint: v2.2
- [ ] Poll / Community Notes / Link Card fixture 快照稳定
- [ ] 人工 Bookmarks 导出 ≥ 30 条，重复执行跳过正确
- [ ] Home 卡片与详情页归一化媒体一致

### Phase 2: 知识库与平台 v3.0
- [ ] Task 18: Front Matter 模板内置档位
- [ ] Task 19: 图片本地化下载与失败回退
- [ ] Task 20: Quote 两层链与 Retweet 语义
- [ ] Task 21: 敏感 / 受限 / 删除态错误分类
- [ ] Task 22: Mac 自动更新与扩展升级提示
- [ ] Task 23: Windows 轻量客户端发布链路
- [ ] Task 24: i18n 雏形与注入按钮无障碍补齐
- [ ] Task 25: 最近保存历史

### Checkpoint: v3.0
- [ ] PRD 11.1 AC1–AC10 全部通过
- [ ] PRD 11.2 UX 门禁通过
- [ ] Mac 自动验收与新增 fixture 测试通过

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| X GraphQL / DOM 变化 | 高 | op-id 缓存、错误码、fixture 回放、降级链 |
| 批量导出触发风控 | 中 | 默认并发 1、抖动间隔、暂停/取消、明确范围 |
| content.js 拆分回归 | 高 | 分模块小步迁移，每步保留测试与行为兼容 |
| 重复检测误判覆盖用户文件 | 高 | 默认 ask；写入前索引匹配 status_id/url；保留另存 |
| 图片本地化占磁盘 | 中 | 默认关闭，失败回退远程 URL |

## Open Questions
- Bookmarks 批量是否默认开启：建议默认开启，首次提示风险。
- Community Notes 是否翻译：建议默认不翻译。
- 端口是否继续暴露给普通用户：建议产品层锁定 9527，开发者项保留说明。
