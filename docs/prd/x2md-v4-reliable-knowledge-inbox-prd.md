# PRD：X2MD v4 — Reliable Knowledge Inbox

| 字段 | 内容 |
| --- | --- |
| PRD 版本 | 1.0 |
| 日期 | 2026-07-10 |
| 状态 | 建议方案，待进入逐任务实施 |
| 产品方向 | X-first Local Knowledge Inbox |
| 交付节奏 | v3.1.x Release Reset → v3.2 Reliable Core → v4.0 Knowledge Inbox |
| 关联审计 | [`../audit/x2md-reassessment-2026-07-10.md`](../audit/x2md-reassessment-2026-07-10.md) |

## 1. 产品摘要

X2MD v4 不再以“继续增加网站和内容类型”为主线，而是把现有最强能力收敛成一个可信产品：

> 用户可以将 X 的推文、串帖、长文、书签和博主内容，可靠、去重、可恢复、可追溯地保存进自己的 Obsidian；所有数据留在本机，X2MD 不建立云端资料库。

v4 的核心不是新的采集按钮，而是补齐以下闭环：

1. 安装后能完成配对、目录检查和首条保存。
2. 单条保存有统一契约、明确去重和稳定错误码。
3. 媒体、Markdown、索引和历史不会因并发或崩溃留下不一致状态。
4. Bookmarks 和 Profile 任务可暂停、恢复、重试并生成报告。
5. 桌面 App 是唯一设置中心，已实现的知识整理能力真正可用。
6. 仓库、发布物、安装态和文档只有一个产品真相。

## 2. 假设与产品决策

本 PRD 采用以下明确决策：

1. **X-first**：X 是主要产品面；LINUX DO、飞书、微信公众号只做兼容维护和共享能力升级。
2. **Local-first**：不增加云账号、云数据库或远端同步服务。
3. **固定端口**：v4 固定使用 `127.0.0.1:9527`，普通用户不再修改端口。
4. **TypeScript 单一核心**：Mac、Node fallback 和未来 Windows 共享 `app/core/`；Python legacy 冻结并退出 stable 发布。
5. **Mac stable / Windows beta**：Windows 只有在 TypeScript 真实 artifact 通过 smoke 后才恢复 stable 标签。
6. **不引入重型框架**：持久状态继续使用本地文件，但必须原子写入并有进程内串行保护。
7. **兼容现有 Markdown**：默认 Front Matter 与正文语义不做破坏性删除；新增字段必须可选或向后兼容。

## 3. Problem Statement

X2MD 的采集能力已经超过普通脚本，但用户实际体验仍被以下问题限制：

- 安装、扩展加载、目录配置和首条验证需要用户自己拼接。
- 端口和 token 配置看似存在，实际会使扩展失联或保存失败。
- 普通保存没有统一去重，批量任务关闭页面后无法恢复。
- 图片、视频、Markdown、历史和索引的完成状态不一致。
- tags、规则、Front Matter、图片本地化等能力存在于后端，却没有 UI。
- App 设置和扩展 options 重复维护并发生漂移。
- 安全、Windows、版本、README 和 release artifact 各自描述不同产品。
- 巨石入口和双实现使每次修复都可能产生新的站点回归。

用户需要的不是更多选项，而是对“点下保存后一定发生什么”有稳定预期。

## 4. 目标用户与核心任务

### 4.1 主要用户

1. **Obsidian 重度用户**：希望收藏内容直接进入既有目录、标签和 Dataview 工作流。
2. **X 素材收集者**：长期保存 AI、技术、商业和创作资料。
3. **研究者和创作者**：需要批量回捞 Bookmarks、追踪特定 Profile 和保存 Article。

### 4.2 Jobs To Be Done

- 当我在 X 看到有价值内容时，我希望一次操作得到完整、可长期保存的 Markdown，而不是一个容易失效的链接。
- 当我第二次保存同一内容时，我希望系统告诉我已存在，并按我的策略跳过、更新或另存。
- 当我导出大量书签或博主内容时，我希望任务可控、可恢复，并知道哪些成功、跳过或失败。
- 当保存失败时，我希望看到可执行的原因，而不是“保存失败”。
- 当保存成功时，我希望立即打开笔记、显示文件或复制路径。
- 当我升级应用时，我希望 App、扩展和文档版本一致，并能确认运行的是新版本。

## 5. Goals & Non-Goals

### 5.1 Goals

| ID | 目标 | 成功定义 |
| --- | --- | --- |
| G1 | 建立可信的本地安全边界 | 除 `/ping` 和一次性 `/pair` 外的敏感请求全部需要有效凭据 |
| G2 | 统一保存契约 | 所有站点和批量任务生成 `CaptureDocumentV1`，服务返回 `SaveResultV1` |
| G3 | 保证数据完整性 | 并发、失败和进程中断不产生覆盖、坏 JSON 或半成品正式文件 |
| G4 | 形成去重闭环 | 基于规范化 URL/status ID 的索引支持 skip/update/always-new |
| G5 | 形成批量任务闭环 | Bookmarks/Profile 可暂停、恢复、取消、重试和输出报告 |
| G6 | 形成知识整理闭环 | tags、FM 模板、图片、媒体和保存后动作都有正式 UI |
| G7 | 降低维护风险 | 巨石入口收敛为少量深模块，Python 不再承担新功能 |
| G8 | 建立可验证发布 | PR、artifact、安装态和版本一致性都有自动门禁 |

### 5.2 Non-Goals

- 不做云端收藏、账号系统、多人协作或云同步。
- 不做内置 Markdown 编辑器或 Obsidian 替代品。
- 不新增网站支持。
- 不承诺绕过 X 登录、速率限制、受限内容或删除状态。
- 不做长期无人值守的全站抓取。
- 不引入数据库服务器、ORM、消息队列框架或大型前端框架。
- 不在 v4 同时重写所有旧代码；采用契约保护下的渐进迁移。

## 6. 产品原则

1. **保存比采集更多类型重要**：完整、可恢复、可诊断优先于新类型。
2. **一个产品真相**：版本、配置、能力、artifact 和文档必须同源。
3. **一个权威设置中心**：桌面 App 是完整设置入口；扩展只负责连接和快捷操作。
4. **默认安全**：安全能力不是高级开关。
5. **默认少打断**：单条保存保持一次操作；只有重复冲突或高成本媒体才弹出产品化对话框。
6. **失败可继续**：单项失败不摧毁批量任务，失败项可以重试。
7. **输出向后兼容**：升级不能静默破坏用户已有 Obsidian 查询和目录结构。

## 7. 目标架构

```text
Site Adapter
  capture(page) → CaptureDocumentV1
        │
        ▼
Capture Flow
  bookmark semantics / GraphQL enrich / fallback / errors
        │
        ▼
Local Client
  pairing token / fixed endpoint / retry / error mapping
        │
        ▼
POST /save  or  Persistent Job Engine
        │
        ▼
Save Engine
  validate → dedupe → media → render → atomic write → state commit
        │
        ├─ Markdown + attachments
        ├─ save_index.json
        ├─ save_history.json
        └─ jobs/*.json
```

### 7.1 深模块与 interface

| Module | Interface | 隐藏的 implementation |
| --- | --- | --- |
| Capture Adapter | `capture(context) -> CaptureDocumentV1` | DOM 选择器、站点结构和页面等待 |
| Capture Flow | `enrich(document) -> CaptureDocumentV1` | GraphQL、oEmbed、Article fallback、书签语义 |
| Local Client | `save(document) -> SaveResultV1` | base URL、token、headers、超时、错误映射 |
| Save Engine | `execute(request) -> SaveResultV1` | 去重、媒体、Markdown、原子文件、历史 |
| State Store | `read/update(namespace)` | mutex、临时文件、rename、损坏恢复 |
| Job Engine | `create/resume/cancel/retry` | item 状态机、checkpoint、报告 |

### 7.2 迁移原则

- 先定义契约和测试，再移动运行代码。
- 每次只迁移一个流程或一个站点 Adapter。
- `content.js` 和 `background.js` 在迁移期间保留兼容入口。
- 不允许“旧逻辑 + 新逻辑长期双跑”；每个任务完成后删除被替代路径。

## 8. 数据与协议契约

### 8.1 CaptureDocumentV1

```ts
type CaptureDocumentV1 = {
  schema_version: 1;
  source: {
    platform: "x" | "linuxdo" | "feishu" | "wechat";
    url: string;
    canonical_url: string;
    source_id?: string;
    captured_at: string;
  };
  content: {
    type: "tweet" | "thread" | "article" | "profile-item" | "web-article";
    title?: string;
    text?: string;
    markdown?: string;
    author?: { name?: string; handle?: string; url?: string };
    published_at?: string;
  };
  media: Array<{
    kind: "image" | "video" | "gif";
    url: string;
    alt?: string;
    duration_seconds?: number;
  }>;
  relations?: {
    quote?: unknown;
    thread?: unknown[];
    poll?: unknown;
    community_notes?: unknown[];
    link_card?: unknown;
  };
  preferences?: {
    custom_save_path_name?: string;
    duplicate_policy?: "skip" | "update" | "always_new";
    download_images?: boolean;
    download_videos?: boolean;
  };
  diagnostics?: {
    capture_path?: string;
    warnings?: string[];
  };
};
```

约束：

- `canonical_url` 必须移除无意义 query，并将 X/Twitter URL 归一化。
- `source_id` 对 X 优先使用 status ID 或 Article ID。
- Adapter 不直接决定文件名、Front Matter 或附件目录。
- 原始 cookie、Authorization、ct0、页面全文日志不得进入 diagnostics。

### 8.2 SaveResultV1

```ts
type SaveResultV1 = {
  success: boolean;
  outcome: "saved" | "updated" | "skipped" | "partial" | "failed";
  capture_key?: string;
  files: Array<{
    path: string;
    relative_path?: string;
    action_urls?: { obsidian?: string };
  }>;
  media: {
    completed: number;
    failed: number;
    pending: number;
  };
  error?: { code: string; message: string; retryable: boolean };
  warnings: Array<{ code: string; message: string }>;
};
```

### 8.3 稳定错误码

| 类别 | 错误码 |
| --- | --- |
| 连接 | `SERVER_OFFLINE`, `PAIRING_REQUIRED`, `AUTH_INVALID` |
| X 数据 | `X_AUTH_REQUIRED`, `X_RATE_LIMITED`, `X_NOT_FOUND`, `X_RESTRICTED`, `ARTICLE_RENDER_TIMEOUT` |
| 输入 | `INVALID_CAPTURE`, `PAYLOAD_TOO_LARGE`, `UNSUPPORTED_MEDIA_URL` |
| 文件 | `PATH_DENIED`, `PATH_UNAVAILABLE`, `WRITE_FAILED`, `STATE_CORRUPT` |
| 任务 | `JOB_CANCELLED`, `JOB_NOT_FOUND`, `JOB_ITEM_FAILED` |

所有失败必须映射到稳定错误码；内部异常文本只进入脱敏诊断，不直接作为产品契约。

## 9. 功能需求

## Epic A — Release Reset 与安全边界

### A1. 仓库隐私和产物治理（P0）

- 停止跟踪本机 config、log、pid、`.DS_Store` 和发布二进制。
- 提供 `config.example.json`，不包含个人路径或 secret。
- CI 增加 forbidden-files 与 secret scan。
- Git 历史净化必须作为独立人工确认步骤执行，不能由普通实现任务自动强推。
- 同一版本的正式 artifact 不允许重发或在 Git 中被覆盖。

**验收：** clean checkout 中 `git ls-files` 不命中禁止文件；CI 对故意加入的 fixture 失败。

### A2. Pairing 与 capability token（P0）

- 首次安装由 App 生成持久 install secret。
- App 显示一次性 pairing code；扩展通过 `/pair` 换取 token 并存入 `chrome.storage.local`。
- token 不通过 `/config`、日志、错误或 popup 回显。
- 除 `/ping` 和有效的一次性 `/pair` 外，所有 config、save、history、log、open、autostart、profile、job 路由都必须鉴权。
- App 设置窗口通过启动时注入的短期 session credential 访问本地服务。

**验收：** 普通网页、任意未配对扩展、`Origin: null`、无 token 请求全部不能读取路径、日志、配置或触发写入。

### A3. 固定端口与连接诊断（P0）

- 删除普通用户端口设置。
- 扩展、本地客户端和 manifest 使用同一个常量来源。
- 端口占用时 Setup Doctor 显示占用、旧版本进程和建议动作。

**验收：** UI 不再提供无效端口修改；所有请求只由 Local Client 产生。

### A4. 发布真相（P0）

- `package.json` 是版本真源。
- tag、App version、extension manifest、release manifest、README 和 live `/ping` 必须一致。
- README 下载使用 `/releases/latest`，避免硬编码旧版本 URL。
- 安装后 smoke 必须验证实际启动 binary 的版本，不只验证构建目录。

**验收：** 任一版本漂移会阻止 release。

## Epic B — Reliable Save Engine

### B1. Capture 验证和兼容层（P0）

- `/save` 接受 `CaptureDocumentV1`。
- 旧 payload 通过单独 legacy normalizer 转换后进入同一引擎。
- 请求体默认上限 5 MiB；数组、正文和媒体数量有明确上限。
- 不合法字段返回 `INVALID_CAPTURE`，不进入写盘阶段。

### B2. 原子状态存储（P0）

- `config.json`、history、save index、profile state 和 job state 使用统一 State Store。
- 写入流程：同 namespace 串行 → 临时文件 → flush/close → rename。
- 读取损坏时保留原坏文件并返回可诊断错误，不静默覆盖。
- 保存事务使用独立 journal 记录 `prepared / media_committed / markdown_committed / state_committed` 阶段；启动时 reconciliation 必须完成可完成的 state commit，或清理未提交临时文件。

### B3. 原子输出和多目录语义（P0）

- 先在目标目录写入并 flush 唯一临时文件；优先通过 hard-link publish 实现 no-clobber，文件系统不支持时使用 journal 保护的 exclusive create/copy fallback；禁止先创建空正式占位再 rename 覆盖。
- 同标题并发保存不会覆盖。
- 多保存目录的附件策略固定为：每个 Markdown 所在目录拥有自己的相对附件副本；不生成跨目录失效引用。
- 部分目录失败时返回 `partial`，成功目录不回滚。

### B4. 去重与更新策略（P0）

- capture key 优先使用 `platform + source_id`，否则使用规范化 URL hash。
- 默认策略 `skip`；用户可选 `update` 或 `always_new`。
- `update` 只更新由 X2MD 索引关联的文件，不根据标题猜测。
- 索引只在正式文件提交成功后更新。
- 同一 capture key 的并发请求必须在去重临界区串行；默认策略只允许一个 saved，其余返回 skipped。

### B5. 安全媒体管线（P0）

- 只允许 `http:` / `https:`。
- 拒绝 loopback、private、link-local 和 reserved 目标及危险 redirect。
- 图片和视频都有超时、最大 bytes、content type allowlist 和并发上限。
- 下载写入 `.part`，完成后原子 rename；失败删除临时文件。
- 图片按输入顺序回填；失败保留远程 URL 和 warning。

### B6. 视频完成语义（P1）

- `buildMarkdown()` 不再启动下载副作用。
- Save Engine 先完成媒体策略，再渲染最终 Markdown。
- 若选择异步视频，Markdown 明确标记 pending，任务完成后由受控 update 阶段替换；默认单条保存使用同步受控完成。
- Profile 和单条保存共享同一个媒体策略。

### B7. 可观测性（P1）

- 记录 `validate_ms`、`dedupe_ms`、`media_ms`、`render_ms`、`write_ms` 和结果码。
- 默认不记录正文、secret、cookie 或完整媒体 URL。
- 提供一键导出脱敏诊断包。

## Epic C — Capture Modules

### C1. Local Client 单一入口（P0）

- 扩展所有本地 HTTP 请求经 `local-client`。
- Local Client 负责 endpoint、token、headers、timeout、retry、JSON 解析和错误映射。
- `background.js`、popup 和 options 不再直接拼接本地 URL。

### C2. 书签语义修复（P0）

- 只在新增 bookmark 时保存。
- `removeBookmark` 不触发保存。
- 页面注入状态能区分保存中、已保存、已跳过和失败。

### C3. Capture UI（P1）

- 提取 toast、modal、进度和按钮状态为独立模块。
- 长视频使用自绘 modal，支持键盘、Esc、focus trap 和会话级记忆。
- 保存成功 toast 提供显示文件、复制路径、在 Obsidian 打开。

### C4. X Adapter 与 Enrichment（P1）

- X DOM 提取只生成初始 CaptureDocument。
- GraphQL、Article、Poll、Community Notes、link card、Quote、Retweet 和错误降级集中在 X enrichment 模块。
- 不允许 UI 代码直接修改 GraphQL 结果结构。

### C5. 其他站点 Adapter（P1）

- LINUX DO、飞书、微信分别通过统一 Adapter interface 输出 CaptureDocument。
- 迁移只改变边界，不改变现有 Markdown golden 输出。

### C6. Background 入口收敛（P1）

- background 只负责消息分发和调用 Capture Flow、Local Client、Job Client。
- content 入口只负责页面检测、Adapter 启动和 UI 挂载。
- 两个入口均有可在 Node 环境运行的消息编排测试。

## Epic D — Knowledge Inbox UX

### D1. Setup Doctor（P0）

首次运行按顺序完成：

1. 检查当前运行版本和旧进程。
2. 选择 Obsidian vault 或普通保存目录。
3. 检查目录写入权限。
4. 完成扩展配对。
5. 检查扩展版本与权限。
6. 保存本地样例并在 Finder/Obsidian 打开。

任何一步失败都保留已完成状态，并给出重试。

### D2. 单一设置中心（P0）

- 桌面 App 提供全部配置。
- 扩展 options 只保留连接状态、配对、打开桌面设置、扩展版本和诊断入口。
- 配置使用 `config_version`、严格 schema 和显式 migration。
- 废弃键在 migration 后移除，不永久透传。

### D3. 知识整理配置（P1）

正式 UI 包含：

- 默认 tags。
- 按路径、关键词、作者、平台的 tag rules。
- default/minimal/dataview-full/custom Front Matter 模板。
- duplicate policy。
- 图片本地化和附件目录。
- 图片嵌入格式。
- 视频下载策略和阈值。

### D4. 历史和保存后动作（P1）

- 最近记录默认 50 条，可按结果筛选。
- 每条支持打开 Obsidian、显示文件、复制路径、打开原文。
- 历史不持久化 CaptureDocument 正文，因此不提供跨重启的普通失败重放；当前页面可在内存中重试，批量失败由 Job Engine 重试。
- 历史只记录必要元数据，不记录正文。

## Epic E — Persistent Job Center

### E1. Job 状态机（P0）

```text
queued → running → paused → running → completed
                 ├→ cancelling → cancelled
                 └→ failed → retrying → running
```

每个 item 状态：`pending | leased | saved | updated | skipped | failed`。

- 扩展 service worker 是 X enrichment worker；桌面 App/本地服务保存 job 和 item 状态。
- worker 使用 `claim → renew → complete/fail` 协议；claim 返回 `lease_owner`、`lease_expires_at`、`attempt` 和稳定 idempotency key。
- lease 过期的 item 自动回到 pending；完成提交依赖 Save Engine 的 capture key 幂等性。
- 扩展使用 `chrome.alarms` 定期唤醒并继续未完成 job，页面 UI 不承担任务存活责任。

### E2. Bookmarks 任务（P1）

- 支持“当前已加载”和“继续加载到用户设置上限”两种范围。
- 默认单并发、带抖动间隔，遇到 rate limit 自动暂停。
- checkpoint 持久化；扩展或页面重启后可以继续。
- MV3 worker 被挂起后，由 alarm 或下一次扩展唤醒重新 claim；旧 lease 过期后可安全回收。
- 已成功或已跳过 item 不重复执行。

### E3. Profile 任务（P1）

- Profile Posts 与 Articles 使用同一 Job Engine。
- 范围、视频策略、去重和错误语义与单条保存一致。
- 继续保留按日聚合输出，但状态存储不再由独立实现维护。

### E4. 任务报告（P1）

- 显示总数、成功、更新、跳过、失败和剩余。
- 可复制失败摘要和错误码。
- 支持只重试失败项。

## Epic F — 平台与发布

### F1. Python legacy 退出（P0）

- `server.py`、`tray_app.py`、`setup_wizard.py` 标记冻结。
- stable release 不再构建 Python Windows 包。
- 在 TypeScript Windows artifact 完成前，README 明确 Windows beta/暂不支持范围。
- 迁移期保留一份兼容说明，不继续同步新功能。

### F2. PR/Main CI（P0）

每个 PR 和 main push 必须运行：

- clean/forbidden-files 检查。
- version consistency `--check`。
- `npm ci`、typecheck、JS/TS/Python tests。
- npm audit 和 Python dependency audit。
- API abuse、并发写入和 fixture privacy tests。

### F3. Artifact 验收（P0）

- Mac：真实 artifact 的 `/ping + /save + first-run + autostart + extension-load`。
- Mac stable：Developer ID 签名、notarization、staple validation。
- Windows beta：解压真实包后启动 `/ping + /config + /save + shutdown`。
- 不允许 skipped smoke 作为 release pass。

### F4. 可复现发布（P1）

- 依赖使用 frozen lock。
- release 生成 SHA、SBOM 和 provenance。
- GitHub Actions pin 到明确 commit SHA。
- 二进制仅上传 GitHub Releases。

## 10. 核心用户流程

### 10.1 首次激活

```text
启动 App
→ Setup Doctor 检查旧版本/端口
→ 选择 vault
→ 配对扩展
→ 保存样例
→ 打开样例文件
→ 完成
```

### 10.2 单条保存

```text
点击新增书签或 X2MD 保存按钮
→ Capture Adapter
→ X enrichment / fallback
→ 去重判断
→ 媒体处理
→ 原子写入
→ 返回保存结果和动作
```

重复时：

- 默认 `skip`，toast 显示“已存在”并提供打开现有文件。
- `update` 用户更新原文件。
- `always_new` 生成新的唯一文件。

### 10.3 批量任务

```text
选择范围
→ 创建持久任务
→ 收集 item
→ 逐项 enrichment + save
→ checkpoint
→ 暂停/恢复/取消/重试
→ 报告
```

## 11. UX 文案与信息架构

### 11.1 桌面设置

```text
开始使用
保存与去重
整理规则
媒体与附件
批量任务
历史
连接与隐私
诊断与关于
```

### 11.2 扩展 popup

```text
X2MD  v4.x
● 已连接 / 需要配对 / App 离线
最近保存：标题 · 结果
[保存当前页] [打开最近文件]
[任务中心] [桌面设置]
```

### 11.3 错误原则

- 先说明用户能做什么，再显示技术原因。
- 不暴露内部堆栈、token 或本机完整敏感路径。
- retryable 错误必须提供重试动作。

## 12. Testing Strategy

### 12.1 单元测试

- Capture normalization、URL canonicalization、error mapping。
- Save index、duplicate policy、atomic path reservation。
- State Store 损坏恢复、mutex 和原子替换。
- 媒体 URL 安全、超时、大小、类型和 redirect。
- Job state machine。

### 12.2 契约与 fixture

- 每个站点至少一个脱敏 CaptureDocument fixture。
- X 覆盖 Tweet、Thread、Article、Quote、视频、Poll、Community Notes、restricted。
- fixture privacy gate 禁止 cookie、Authorization、ct0、个人路径。
- golden Markdown 保留现有输出兼容。

### 12.3 集成测试

- 所有敏感 API 的 auth/origin abuse matrix。
- 20 个不同 capture key、相同标题并发保存；以及 20 个相同 capture key 并发去重。
- 多目录部分失败。
- 下载超时、超大响应、错误类型、私网 URL。
- 在事务每个 commit 阶段中断后的 journal/state/json reconciliation。

### 12.4 浏览器和 artifact

- Chrome 临时 profile 加载扩展并完成配对。
- Bookmarks/Profile 消息编排 replay。
- Mac 和 Windows 真实发布包 smoke。
- 人工真实 X 页面验收仍作为发布补充，不替代自动契约测试。

## 13. Acceptance Criteria

### 13.1 P0 Release Reset

- [ ] Git 不再跟踪 config/log/pid/二进制归档。
- [ ] 普通网页和未配对扩展无法访问任何敏感 API。
- [ ] 官方扩展配对后所有核心请求正常。
- [ ] 端口 UI 已移除，所有客户端使用 9527。
- [ ] tag、App、扩展、artifact、README、live ping 版本一致。
- [ ] Python Windows legacy 不再进入 stable release。

### 13.2 Reliable Core

- [ ] 20 个不同 capture key、相同标题并发保存生成 20 个唯一文件且历史不丢。
- [ ] 20 个相同 capture key 并发保存默认得到 1 个 saved 和 19 个 skipped。
- [ ] state/config/history/job JSON 在故障测试后仍可解析或可恢复。
- [ ] 在事务每个 commit 阶段中断后，启动 reconciliation 不留下空正式文件、孤立索引或永久 `.part`。
- [ ] save index 在写入失败时不产生假成功记录。
- [ ] 多目录附件引用全部有效。
- [ ] 视频失败不会被报告为完整成功。
- [ ] 下载器拒绝私网/危险 URL、超时和超限响应。

### 13.3 Product UX

- [ ] 新用户可通过 Setup Doctor 完成首条样例保存。
- [ ] tags/FM/图片/重复策略在桌面设置可配置。
- [ ] 重复保存默认跳过并可打开现有文件。
- [ ] 保存成功可打开 Obsidian、显示文件和复制路径。
- [ ] `removeBookmark` 不触发保存。
- [ ] 主流程不存在 `window.confirm`。

### 13.4 Job Center

- [ ] Bookmarks/Profile 任务可暂停、恢复、取消和重试失败。
- [ ] 扩展或页面重启后任务可继续。
- [ ] 已完成项不重复写入。
- [ ] 任务报告中的计数与 item 状态一致。

### 13.5 Release

- [ ] PR/main CI 全量运行且无 skipped gate。
- [ ] Mac stable 通过签名、公证和真实 artifact smoke。
- [ ] Windows 只有在 TS artifact smoke 通过后标记 stable。
- [ ] GitHub Release 包含 SHA、SBOM 和 provenance。

## 14. 指标

| 指标 | v4 目标 |
| --- | --- |
| 首次安装到首条成功保存 | p50 ≤ 5 分钟 |
| 单条保存成功率 | 支持样例集 ≥ 98% |
| 失败稳定错误码覆盖 | 100% |
| 默认重复文件率 | ≤ 1% |
| 10 图媒体阶段 p95 | 相对串行基线降低 ≥ 50% |
| `/ping` 在保存压力下 p95 | < 150 ms |
| Bookmarks 任务恢复成功率 | ≥ 99% |
| 版本一致性问题 | 0 |
| 正式文件残留 `.part` | 0 |

## 15. 发布与迁移计划

### v3.1.x：Release Reset

- 仓库清理、安全配对、固定端口、版本和 CI 真相。
- 不新增用户功能。

### v3.2：Reliable Core

- CaptureDocument/SaveResult、State Store、原子写入、去重、安全媒体。
- 保持旧扩展 payload 兼容。

### v3.3：Capture Modules + Setup Doctor

- Local Client、入口拆分、书签语义、自绘 modal、单一设置中心。

### v4.0：Knowledge Inbox

- Persistent Job Center、完整整理规则 UI、历史动作、诊断包。
- 满足全部 release gate 后发布。

## 16. 风险与缓解

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| 安全改造导致旧扩展断联 | 高 | 保留一次明确迁移提示和配对向导，不保留永久无鉴权 fallback |
| Capture 契约遗漏旧字段 | 高 | 旧 payload normalizer + golden fixtures + 逐站点迁移 |
| 原子写入改变文件名 | 中 | 明确 capture key 和唯一命名规则，提供兼容测试 |
| X 页面/GraphQL 变化 | 高 | Adapter/enrichment seam、脱敏 replay fixtures、稳定错误码 |
| 批量任务触发 rate limit | 中 | 单并发、抖动、自动暂停、checkpoint |
| Windows 路线延误 | 中 | Mac stable 不被阻塞；Windows 明确 beta，停止虚假 parity |
| 历史净化破坏协作 | 高 | 单独人工批准、备份 refs、通知贡献者，不放进普通 Codex 自动任务 |

## 17. Definition of Done

v4 只有在以下事实同时成立时才算完成：

1. 第 13 节全部验收项有可执行证据。
2. `npm run check` 和新增安全、并发、浏览器、artifact gate 全部通过。
3. 需求—任务—测试—artifact 证据矩阵无缺口。
4. 文档描述与用户实际安装、设置和保存流程一致。
5. 不存在仍由 Python 与 TypeScript 双写的新功能路径。
6. 不存在以文件存在、mock 通过或手工勾选代替端到端验收的“完成”状态。
