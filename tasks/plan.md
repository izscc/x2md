# Implementation Plan: X2MD Reliable Knowledge Inbox

> **For agentic workers:** Execute `tasks/todo.md` in dependency order. Use a fresh branch/worktree, test-first changes, narrow Conventional Commit commits, and do not perform history rewriting without explicit human approval.

## Overview

本计划落实 `docs/prd/x2md-v4-reliable-knowledge-inbox-prd.md`。顺序不是先做新 UI，而是先收敛产品真相和安全边界，再建立保存契约与原子写入，随后拆分扩展入口、补齐知识工作流，最后交付持久化批量任务和可信发布。

旧 `X2MD v3 Improvement Iteration` 计划已被当前运行事实超越；其中已交付能力保留，未形成用户闭环的条目重新纳入本计划，不沿用旧勾选状态作为完成证据。

## Architecture Decisions

- X/Twitter 是主产品面；其他站点保持 Adapter 兼容，不新增站点。
- `app/core/` 的 TypeScript 实现是唯一功能核心；Python legacy 冻结并退出 stable release。
- 本地服务固定 `127.0.0.1:9527`，移除无效的用户端口设置。
- 所有站点输出 `CaptureDocumentV1`，所有保存返回 `SaveResultV1`。
- 扩展只有一个 Local Client，负责配对、认证、请求和错误映射。
- 保存引擎按 validate → dedupe → media → render → atomic write → state commit 执行。
- 状态继续使用本地文件，但统一经过 mutex + 临时文件 + 原子 rename。
- Bookmarks/Profile 共用持久化 Job Engine。
- 桌面 App 是唯一完整设置中心；扩展 options 只负责连接、配对和跳转。
- 不引入数据库服务器、ORM、队列框架或新的扩展 bundler。

## Dependency Graph

```text
Release truth / privacy cleanup
        │
        ├─ Pairing + fixed endpoint + Local Client
        │                    │
        │                    └─ Setup Doctor / extension connection UX
        │
CaptureDocument + SaveResult contracts
        │
        ├─ State Store ── Save index / history / jobs
        │       │
        │       └─ Atomic output / config / profile state
        │
        ├─ Safe media pipeline
        │
        └─ Extension capture modules
                 │
                 └─ Persistent Bookmarks/Profile Job Center

All core phases
        └─ Artifact smoke / signing / Windows beta gate / v4 release
```

## Phase 0 — Release Reset and Truth

- [x] T01 仓库禁止文件与隐私清理
- [x] T02 Release 二进制退出 Git，建立不可变 artifact 策略
- [x] T03 版本与下载文档单一真源
- [x] T04 拆分 PR CI 与 release workflow
- [x] T05 固定 9527 并移除无效端口配置
- [x] T06 Pairing 与全路由 capability token
- [x] T07 收紧 Origin/CORS 并加入 abuse matrix
- [x] T08 冻结 Python legacy，重定义 Windows 支持矩阵

### Checkpoint 0

- [x] clean checkout 不含 config/log/pid/发布二进制
- [x] 未配对调用不能读取配置、日志、路径或触发写入
- [x] 官方扩展完成配对后 `/config`、`/save`、`/history` 正常
- [x] tag/package/manifest/README/live ping 一致
- [x] PR/main CI 自动运行，无 tag-only 空窗

## Phase 1 — Reliable Save Core

- [x] T09 定义 CaptureDocumentV1 / SaveResultV1 / error codes
- [x] T10 旧 payload normalizer 与请求限制
- [x] T11 统一原子 State Store
- [x] T12 原子输出路径与并发保存
- [x] T13 Save Index 与 duplicate policy
- [x] T14 安全媒体下载器
- [x] T15 图片有限并发与多目录附件语义
- [x] T16 视频下载移出 Markdown 渲染副作用
- [x] T17 保存阶段指标与脱敏诊断

### Checkpoint 1

- [x] 20 个不同 capture key、相同标题并发保存生成 20 个唯一文件
- [x] 20 个相同 capture key 并发保存默认得到 1 个 saved、19 个 skipped
- [x] config/history/index/profile state 故障后可解析或可恢复
- [x] 每个事务 commit 阶段中断后可 reconciliation，无空正式文件或孤立索引
- [x] 私网 URL、超限媒体、错误类型和超时被拒绝或安全回退
- [x] 多目录 Markdown 的附件引用全部有效
- [x] 视频失败不会返回完整成功

## Phase 2 — Capture Modules and Core UX

- [x] T18 建立扩展 Local Client
- [x] T19 修复 bookmark/removeBookmark 语义
- [x] T20 提取 Capture UI：toast/modal/action
- [x] T21 拆分 X 单条 Capture Adapter
- [x] T22 拆分 X enrichment/GraphQL 编排
- [x] T23 拆分 X 翻译与复制流程
- [x] T24 拆分 X Bookmarks/Profile 采集入口
- [x] T25 迁移 LINUX DO/飞书/微信 Adapter
- [x] T26 收敛 content/background 入口和消息编排测试

### Checkpoint 2

- [x] `content.js` 和 `background.js` 只保留启动/分发职责
- [x] 所有本地 HTTP 请求均通过 Local Client
- [x] `removeBookmark` 不触发保存
- [x] 主流程不存在 `window.confirm`
- [x] 现有多站点 golden Markdown 保持兼容

## Phase 3 — Knowledge Inbox UX

- [x] T27 配置 schema version 与显式 migrations
- [x] T28 扩展 options 降级为连接与配对页
- [x] T29 桌面设置开放整理规则与 FM 模板
- [x] T30 桌面设置开放去重、图片和视频策略
- [x] T31 保存历史与打开/显示/复制/打开原文动作
- [x] T32 Setup Doctor 首次激活流程
- [x] T33 脱敏诊断包与连接修复页

### Checkpoint 3

- [x] 新用户能完成目录选择、扩展配对、样例保存和打开结果
- [x] tags/FM/重复/图片/视频全部可在桌面设置配置
- [x] 扩展与 App 不再维护两套完整设置表单
- [x] 保存成功和失败均提供可执行动作

## Phase 4 — Persistent Job Center

- [ ] T34 Job state machine 与持久存储
- [ ] T35 Job API 与任务控制
- [ ] T36 Bookmarks 任务接入 Job Engine
- [ ] T37 Profile/Articles 任务接入 Job Engine
- [ ] T38 任务中心 UI 与报告
- [ ] T39 重启恢复、rate-limit 暂停和失败重试测试

### Checkpoint 4

- [ ] Bookmarks/Profile 可暂停、继续、取消和只重试失败
- [ ] 扩展、页面或 App 重启后任务可恢复
- [ ] 已成功/已跳过 item 不重复执行
- [ ] UI 计数与持久状态一致

## Phase 5 — Release Confidence

- [ ] T40 Fixture privacy、coverage 与 requirement-evidence matrix
- [ ] T41 Mac 真实 artifact 全验收
- [ ] T42 Mac Developer ID 签名与 notarization
- [ ] T43 Windows TypeScript beta artifact spike 与 smoke
- [ ] T44 SBOM、provenance、dependency lock 与 action pinning
- [ ] T45 v4 候选文档、迁移说明和发布前总审计

### Final Checkpoint

- [ ] PRD 第 13 节全部验收项有权威证据
- [ ] `npm run check` 和新增安全、并发、浏览器、artifact gate 全部通过
- [ ] Mac stable artifact 签名、公证和安装态版本正确
- [ ] H02 已在受保护环境完成真实 codesign/notary/staple 验证，并把证据写入矩阵
- [ ] Windows 未达到真实 TS artifact gate 时不宣称 stable 支持
- [ ] GitHub Release 是二进制唯一发布来源
- [ ] 当前任务清单中没有以“文件存在”替代运行验证的完成项

## Parallelization

### 可并行

- T10 与 T11 可在 T09 完成后并行；它们不修改同一组核心文件。
- T29 与 T31 可在 T27 完成后并行；T30 与 T29 修改同一组设置文件，必须串行。
- 其余任务默认串行；扩展迁移任务共享 `content.js`、`background.js` 或 manifest，不在同一工作树并行修改。

### 必须串行

- T06 → T07 → T18：先确定认证，再实现唯一客户端。
- T09 → T10 → T12/T13：先固定契约，再迁保存逻辑。
- T34 → T35 → T36/T37：先状态机和接口，再接具体批量场景。
- T36 → T37：先验证 Bookmarks worker/lease 协议，再迁 Profile/Articles。
- T29 → T30：两个任务修改相同设置文件，避免并行冲突。
- T42 必须在 T41 的 artifact 流程稳定后进行。

## Human Stable-Release Gate

- T45 只产生 release candidate 文档和预发布证据，不代表 stable 完成。
- 完成 T42 与 T45 后，由 H02 在受保护凭据环境运行真实签名、公证和 staple 验证。
- H02 将证据追加到 `docs/acceptance/v4-evidence-matrix.md` 并由仓库负责人批准，之后才能满足 Final Checkpoint。

## Risks and Mitigations

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 历史净化影响所有 clone | 高 | 不放入自动 Task；只生成清单，人工批准后单独执行 |
| 强制配对导致旧扩展断联 | 高 | Setup Doctor 和明确升级提示；不保留永久无鉴权 fallback |
| 大文件拆分引入 X 回归 | 高 | 契约 fixture、每次迁一个流程、旧入口立即删除被替代分支 |
| 原子写入改变文件名行为 | 中 | 保存 golden、并发测试和兼容迁移说明 |
| 媒体安全限制误伤 CDN | 中 | 允许列表基于协议/地址/类型，不硬编码单一域名；记录稳定 warning |
| Windows 路线不确定 | 中 | Mac stable 独立；Windows 只以真实 TS artifact 通过为准 |
| 任务数较多导致半完成 | 中 | 每个 checkpoint 可独立发布，未通过 checkpoint 不进入下一阶段 |

## Commands

```bash
# 基线
npm ci
npm run check

# 扩展真实加载
npm run smoke:chrome-extension-load

# Mac 构建与 smoke
bun run build:mac
npm run smoke:mac
npm run acceptance:mac:auto

# Release artifact
npm run check:release-artifacts
```

## Boundaries

### Always

- 每个行为变更先增加回归测试。
- 先跑窄测试，再跑 `npm run check`。
- 涉及 manifest、打包或入口时运行对应 smoke。
- 每个任务独立 Conventional Commit。

### Ask First

- Git 历史净化和 force push。
- 新增运行时依赖。
- 修改默认 Markdown 字段或目录结构。
- 开启正式签名、公证和 GitHub Environment secrets。

### Never

- 提交真实 config、日志、PID、token、cookie、个人路径或发布二进制。
- 通过关闭测试、删除失败测试或把真实验收改成存在性检查来“完成”任务。
- 为兼容旧客户端保留永久无鉴权本地 API。
- 在没有真实 artifact smoke 时宣称 Windows stable 或自动更新已完成。
