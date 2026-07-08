# PRD：X2MD v3 — X/Twitter 深度打磨与产品体验升级

| 字段 | 内容 |
|------|------|
| 版本 | v1.0 |
| 日期 | 2026-07-09 |
| 状态 | 待评审 |
| 目标版本 | X2MD v3.0（分阶段交付：v2.1 → v2.2 → v3.0） |
| 文档类型 | 改进型产品需求（基于现有 2.0.4 代码复盘） |
| 相关文档 | [`electrobun-rearchitecture-prd.md`](./electrobun-rearchitecture-prd.md)、[`../acceptance/electrobun-mac-manual-checklist.md`](../acceptance/electrobun-mac-manual-checklist.md) |

---

## 1. Problem Statement

X2MD 已完成核心价值闭环：**把 X/Twitter（以及 LINUX DO / 飞书 / 微信公众号）内容一键沉淀为 Obsidian 可用 Markdown**。Mac 桌面端完成 Electrobun 迁移后，体积与启动体验显著改善；X 侧对 Tweet / Thread / Note(Article) / 引用 / 媒体 / 翻译 / 博主批量抓取的覆盖，在同类「剪藏工具」中已属偏深。

但产品仍卡在「能用」与「可靠、顺手、可长期维护」之间的断层：

1. **X 平台本身高度动态**  
   页面类型多（Home / Status / Article / Profile / Media / Lists / Bookmarks / Communities / Spaces 卡片等），GraphQL `queryId` 频繁轮换，长文实体与 UI 结构常变。当前依赖「硬编码 op-id + 运行时脚本探测 + DOM 兜底」能工作，但缺少系统化的韧性（429 退避、op-id 持久缓存、失败可诊断、fixture 回放）。

2. **X 内容类型覆盖不均**  
   对「单帖 / 串帖 / 长文 / 引用 / 视频」已较成熟，但对 **投票(Poll)、社群笔记(Community Notes)、链接卡片元数据、列表页批量、书签页回捞、敏感/受限帖、Subscriber-only、Spaces 回放元数据、GIF 语义** 等要么未建模，要么只以残缺 DOM 文本呈现。

3. **Obsidian 知识流未闭环**  
   Front Matter 标签恒为空、图片默认远程链接易失链、保存后无「打开笔记 / 打开文件夹」、无重复检测、无保存历史、无模板/标签规则；重度收藏者仍需大量手工整理。

4. **交互打磨未产品化**  
   视频确认用原生 `confirm()`；扩展 popup 文案仍写「推特书签 → Obsidian」却已是多平台；版本号在 `package.json(2.0.4)` 与 `app/core/config.ts VERSION(2.0.2)` 漂移；端口可改但 MV3 `host_permissions` 写死 `9527`；服务离线时缺少「一键唤起桌面端」路径。

5. **工程债限制迭代速度**  
   `extension/content.js` 约 3600+ 行（保存 + 翻译 + 复制 + 博主抓取 UI 混杂）；Python/TS 双实现仍并行；Windows 仍走 legacy；自动更新缺失；真实 X 页面 E2E 未产品化。

本 PRD 不以「再做一个剪藏工具」为目标，而以 **把 X 采集打磨到可依赖、把 Obsidian 沉淀打磨到可复用、把 UI 打磨到像成熟产品** 为目标，形成可分阶段落地的 v3 路线图。

---

## 2. Solution Overview

在保持现有「扩展采集 + 本机服务写盘 + Electrobun 托盘/设置」架构不变的前提下，按四条主线升级：

```text
┌──────────────────────────────────────────────────────────────┐
│  A. X Capture Reliability   采集可靠：op-id / 退避 / 类型补全 │
│  B. Knowledge Workflow      知识流：标签/模板/去重/本地媒体   │
│  C. Product UX Polish       体验：按钮/反馈/离线/一致性       │
│  D. Platform & Engineering  平台：版本单一源 / Windows / 测试 │
└──────────────────────────────────────────────────────────────┘
```

**产品原则（不可破）：**

- 默认不破坏既有 Markdown 语义与 Front Matter 字段名（可新增字段，旧字段兼容）。
- 本地服务继续只监听 `127.0.0.1`。
- 不引入官方 X Developer API 付费配额作为主路径（继续会话 cookie + 公开 client Bearer 的浏览器侧能力）；对官方 API 仅作为可选未来增强。
- 不做「重型知识库 App」；X2MD 仍是 **剪藏管道**，价值在「稳、准、少打断」。

---

## 3. Goals & Non-Goals

### Goals

| # | 目标 | 成功度量 |
|---|------|----------|
| G1 | X 单帖/Thread/Article 保存成功率在登录会话下稳定 | 内部样例集 ≥ 95% 成功；失败有可读错误码 |
| G2 | 新增关键 X 内容类型的结构化输出（至少 Poll / Community Note / 链接卡片） | 见第 6 节验收 |
| G3 | Obsidian 工作流减少二次整理 | 默认支持标签规则、重复检测、保存后快捷操作 |
| G4 | 媒体链路可控 | 可选本地下载图片；视频有队列与进度；博主抓取视频策略与单帖一致 |
| G5 | UI/文案/版本/状态一致 | 零版本漂移；离线有恢复路径；视频确认非原生弹窗 |
| G6 | 工程可维护 | content 模块化；GraphQL 探测可缓存；关键路径有 fixture 回归 |
| G7 | Windows 用户体验与 Mac 对齐（至少服务 + 设置 + 托盘） | Windows Electrobun 或等价轻量方案可发布 |

### Non-Goals（本 PRD 明确不做）

1. 重写为 Electron / 云端 SaaS。
2. 完整镜像 X 客户端（Timeline 阅读器、发帖、私信）。
3. 自动爬取他人 timeline 的无节制全站抓取（Profile 批量需保留范围限制与去重）。
4. 第一阶段上架 Chrome Web Store 审核通过（可预留合规改造，但不作为 v3.0 阻塞）。
5. 把飞书/微信/LINUX DO 做到与 X 同等深度（仅跟随修复与共享 UX 改进）。
6. 替换 Obsidian 为内置笔记编辑器。

---

## 4. 现状复盘（基于代码与 X 产品面）

### 4.1 当前架构（简述）

```text
Chrome MV3 Extension
  content.js  ──(DOM / 注入 UI)──► background.js
                                      │
                    GraphQL TweetDetail / TweetResultByRestId
                    oEmbed / Grok translation / silent article tab
                                      │
                                      ▼
                         POST http://127.0.0.1:9527/save
                                      │
                         Electrobun Bun API + app/core/*
                                      ▼
                         Obsidian vault (.md + optional mp4)
```

关键路径：

| 层 | 路径 |
|----|------|
| 扩展采集 | `extension/content.js`, `background.js`, `twitter_graphql.js`, `article_markdown.js`, `media_helpers.js` |
| 保存核心 | `app/core/markdown.ts`, `save.ts`, `profile-capture.ts`, `media.ts` |
| 桌面壳 | `app/main/*`, `app/ui/settings/*` |
| 扩展 UI | `popup.html`, `options.html` |

### 4.2 已做得好的部分（应保留）

- **降级链**：GraphQL → oEmbed → DOM，实践上合理。
- **Article 深度**：`withArticleRichContentState`、实体转 Markdown、视频占位符、引用位置、代码块与翻译合并，已有多轮真实缺陷修复（至 v2.0.4）。
- **原图策略**：`name=orig` 对 Obsidian 外链阅读很关键。
- **书签劫持 + 悬停自定义路径**：符合重度用户「分类入库」习惯，且不破坏原生书签行为。
- **博主批量 + 日聚合 + 去重状态文件**：对长期追踪创作者有独特价值。
- **翻译三通道**（Grok / Google / 原生 UI）+ 保存时 `prefer_translated_content`。
- **Mac 设置页信息架构**：侧边栏分区、高级项折叠，整体优于 tkinter 时代。

### 4.3 与 X 产品面的差距矩阵

> 说明：下列「X 页面/能力」按 2025–2026 网页端常见形态归纳；实现状态以当前仓库为准。

| X 页面 / 能力 | 用户典型诉求 | 当前状态 | 缺口严重度 |
|---------------|--------------|----------|------------|
| Status 详情页 | 保存全文、媒体、引用、串帖 | ✅ 主路径 | 低（需韧性） |
| Home / 时间线卡片 | 不进详情也能保存 | ⚠️ 可用，媒体/长文易残缺 | 中 |
| Article / Note 阅读页 | 完整 Markdown | ✅ 深支持 | 中（UI 变更风险） |
| Profile Posts | 批量抓取 | ✅ 🐾 菜单 | 中（速率/媒体） |
| Profile Articles | 批量文章 | ✅ | 中 |
| Profile Media / Likes / Replies 标签 | 按标签批量 | ❌ 未建模 | 低–中 |
| Bookmarks 页 | 把已有书签库倒出 | ❌ 未支持 | **高（场景契合）** |
| Lists 时间线 | 列表源剪藏 | ❌ | 中 |
| Communities 帖 | 社群上下文 | ❌ 或仅当普通帖 | 中 |
| Poll | 选项与票数 | ❌ 文本丢失/半残 | **高** |
| Community Notes | 事实注记 | GraphQL 开了 birdwatch 字段，**输出未结构化** | **高** |
| Link / Product Card | 标题/描述/域名 | 常只抓缩略图 | 中 |
| Quote + 嵌套 Quote | 多层引用 | 单层 quote | 中 |
| Retweet of Quote | 语义清晰 | 部分当普通帖 | 低–中 |
| GIF / animated_gif | 与视频区分 | 多按视频链路 | 低 |
| 敏感媒体 / 年龄门 | 可保存需展开 | 依赖 DOM 是否已点开 | 中 |
| Tombstone / 受限 / 已删除 | 明确失败原因 | 错误信息笼统 | 中 |
| Subscriber-only / Super Follow | 登录态可见内容 | 未专项处理 | 中 |
| Spaces 卡片 | 标题/主持人/回放链 | ❌ | 低 |
| Grok 分析附件 | 是否入库 | feature flag 存在，未产品化 | 低 |
| 编辑历史（Edit） | 最新全文 | 依赖 GraphQL 最新 legacy | 低 |
| 推文统计（赞/转/阅） | 可选元数据 | 未写入 FM | 低（可配置） |

### 4.4 工程与体验债（直接影响迭代）

| 问题 | 证据 / 影响 |
|------|-------------|
| 版本漂移 | `package.json`/`extension` 2.0.4 vs `VERSION = "2.0.2"`；支持成本高 |
| `content.js` 巨石 | ~3678 行，改一处易伤翻译/保存/抓取 |
| GraphQL op-id | 硬编码列表 + 探测；**无本地持久缓存、无 429 策略** |
| 端口 vs 权限 | options 可改端口；manifest 写死 `127.0.0.1:9527` |
| 视频 UX | 原生 `confirm`；无队列进度；Profile 日更多为链接 |
| 图片易失链 | 仅远程 URL，账号删除/媒体失效后笔记空壳 |
| Front Matter | `tags: []` 恒空；无模板 |
| 双实现 | Python legacy + TS，行为可能漂移 |
| 文案滞后 | popup「推特书签」与多平台现实不符 |
| 真实 X E2E | acceptance checklist 仍大量依赖人工 |

---

## 5. User Stories（按角色）

### 5.1 日常收藏者

1. 作为浏览 Home 的用户，我想在不点进详情的情况下可靠保存完整媒体与长文，所以时间线效率不下降。
2. 作为保存 Article 的用户，我想失败时看到「GraphQL 失败 / 需登录 / 文章未渲染完」等明确原因，而不是笼统「保存失败」。
3. 作为常保存视频的用户，我想用统一样式的确认面板（时长、预估大小、是否本次下载），而不是浏览器原生弹窗。
4. 作为中文用户，我想「翻译后保存」与「保存原文」在按钮上可预期，保存结果与屏幕所见一致。

### 5.2 知识库重度用户（Obsidian）

5. 我想按规则自动打标签（如 `#AI` `#生图` 或路径映射），所以入库即可检索。
6. 我想可选本地下载图片到 vault 附件目录，所以外链失效后笔记仍可用。
7. 我想重复保存同一 status 时被提示「已存在，覆盖 / 跳过 / 另存」，所以库不膨胀。
8. 我想保存成功后一键「在 Obsidian 打开」或「在 Finder 显示」，所以闭环不中断。
9. 我想自定义 Front Matter 模板（保留默认兼容），所以匹配自己的 Dataview 字段。

### 5.3 创作者 / 素材追踪者

10. 我想从 **自己的 Bookmarks 页** 批量导出历史收藏，所以不必一篇篇点。
11. 我想博主批量抓取显示进度（已处理 / 跳过 / 失败）并可暂停，所以长任务可控。
12. 我想抓取结果里的视频策略与单帖一致（可配置下载），所以素材库完整。
13. 我想 Poll 与 Community Notes 以结构化 Markdown 呈现，所以观点与注记不丢。

### 5.4 多设备 / 跨平台用户

14. 作为 Windows 用户，我想有与 Mac 同代的轻量客户端与设置页。
15. 作为改端口用户，我想扩展自动对齐本地服务端口，所以不需改 manifest 重装。

### 5.5 维护者 / 支持者

16. 我想 `/ping` 与安装包、扩展版本同源，所以排障不互相矛盾。
17. 我想关键 GraphQL 失败可落盘「匿名化 fixture」供回归（不含 cookie），所以 UI 变更可快速修。

---

## 6. 功能需求详述（细节打磨重点）

### 6.1 Epic A — X 采集可靠性与类型补全

#### A1. GraphQL 韧性层（P0）

**问题：** op-id 轮换与瞬时 429/5xx 导致「有时完整、有时残缺」。

**需求：**

1. **持久化 op-id 缓存**  
   - 探测成功后写入 `chrome.storage.local`（键：`graphql_ops_v1`，含 `TweetDetail` / `TweetResultByRestId` / `UserTweets` / `UserArticlesTweets` / `UserByScreenName` 及时间戳）。  
   - 启动优先用缓存 → 失败再探测 → 再 fallback 硬编码。  
2. **请求策略**  
   - 对 429：尊重 `x-rate-limit-reset` 或指数退避（上限 3 次）。  
   - 对 401/403：明确错误码 `AUTH_REQUIRED`（提示重新登录 x.com）。  
   - 对空 `threaded_conversation_with_injections_v2`：尝试 `TweetResultByRestId` 再降级。  
3. **错误码契约**（扩展 toast 与日志共用）  

| code | 用户可见文案（中文） |
|------|----------------------|
| `AUTH_REQUIRED` | 需要登录 X 后重试 |
| `RATE_LIMITED` | X 接口繁忙，请稍后再试 |
| `NOT_FOUND` | 推文不存在或已删除 |
| `RESTRICTED` | 内容受限，无法获取完整数据 |
| `ARTICLE_RENDER_TIMEOUT` | 长文未加载完成，请打开文章页后再保存 |
| `SERVER_OFFLINE` | 本机 X2MD 服务未启动 |
| `PATH_DENIED` | 保存路径不可写 |

4. **探测范围**  
   - 现仅深度探测 TweetDetail 系；v3 将 Profile 相关 op-id 一并纳入探测与缓存。

**验收：** 模拟 429 与过期 op-id 时，能自动恢复或给出正确错误码；缓存命中时探测网络次数为 0。

---

#### A2. 时间线卡片「完整度增强」（P0）

**问题：** Home 上点书签时，DOM 常缺 `full_text` / 多图 / 视频最高清源。

**需求：**

1. 凡能解析 `statusId` 的保存，**一律走 background `fetchFullTweetData`**（已有则强制校验「媒体数 ≥ DOM 媒体数」）。  
2. 若 GraphQL 成功但 thread 为空、用户在详情页，再合并 DOM thread。  
3. 长文卡片：若检测到 article 链，走现有 Note 富化；超时 ≤ 12s，超时返回 `ARTICLE_RENDER_TIMEOUT` 且仍保存 status 摘要 + article URL。  
4. Toast 文案分两阶段：`正在获取完整推文…` → `正在解析长文…`（仅 article）。

**验收：** 同一条含 4 图 + 视频的时间线卡片，与详情页保存的 images/videos 集合一致（允许 URL query 差异，归一化后比较）。

---

#### A3. Poll 结构化（P0）

**数据来源：** GraphQL `card` / `tweet_card` / `unified_card` 或 legacy `binding_values`（以实际 payload 探测为准）；DOM 兜底 `aria-label` 选项列表。

**Markdown 输出约定（默认，可配置关闭）：**

```markdown
### 投票
- [ ] 选项 A — 42%（120 票）
- [ ] 选项 B — 58%（166 票）

截止：2026-07-10 12:00 UTC · 总计 286 票
```

Front Matter 可选：

```yaml
poll: true
poll_end: "..."
```

**交互：** 无额外按钮；保存时自动附带。翻译模式下选项文本跟随 `prefer_translated_content`（若无法译则保留原文）。

**验收：** 对至少 3 种 poll 卡片 fixture（2 选项 / 4 选项 / 已结束）快照稳定。

---

#### A4. Community Notes 结构化（P0）

**数据来源：** 已开 `withBirdwatchNotes`；解析 `birdwatch_pivot` / `birdwatch_note` 类字段（实现时以真实 GraphQL 为准，并补 fixture）。

**Markdown：**

```markdown
> [!note] 社群笔记
> 注记正文…
>
> 来源：https://...
```

多条注记按相关度排序；无注记不输出块。

**验收：** 有/无 Community Notes 的对照 fixture；翻译时注记默认 **不翻译**（可设置「翻译注记」开关，默认关，避免误导）。

---

#### A5. 链接卡片元数据（P1）

保存时输出：

```markdown
> [!info] 链接卡片
> **标题**
> 描述摘要
> example.com
> https://...
```

图片：卡片大图进 `images` 或单独 `card_image`，避免与推文附图混淆（附图优先，卡片图可配置 `include_card_image` 默认 true）。

---

#### A6. 引用链与转推语义（P1）

1. Quote：支持 **两层**（主帖 quote → 内层 quote），第三层折叠为「原文链接」。  
2. Retweet：Front Matter `repost: true` + 正文标注「转发自 @user」；被转内容按 quote 块或完整解析。  
3. 纯 RT 无附加评：文件名优先用原作者 summary。

---

#### A7. 敏感 / 受限 / 删除态（P1）

1. 检测 tombstone / “This post is unavailable” / 登录墙。  
2. 若用户已在 UI 点开敏感遮罩，DOM 路径应能取到媒体；否则 toast：`请先在页面中显示敏感内容后再保存`。  
3. 写入 FM：`content_state: available | restricted | unavailable`。

---

#### A8. Bookmarks 页批量导出（P0，高价值新能力）

**动机：** 产品触发器本就是「书签」；用户最大存量往往在 `/i/bookmarks`。

**范围：**

1. 在 Bookmarks 页注入工具条：`导出可见` / `继续向下加载并导出` / `范围：全部已加载`。  
2. 策略：滚动加载 → 收集 statusId 列表 → 去重 → 顺序 GraphQL 富化 → `/save` 或批量 API。  
3. 默认并发 1（可配置 1–2），内置 rate limit 友好间隔（默认 400–800ms 抖动）。  
4. 进度面板：成功 / 跳过(重复) / 失败；可暂停 / 继续 / 取消。  
5. 失败项可「仅重试失败」。

**非范围：** 不绕过 X 对 bookmarks 的登录与分页限制；不提供云同步书签。

**验收：** 人工账号下导出 ≥ 30 条可见书签，重复执行跳过率正确；中途取消无脏写半文件（单条事务：写完才算成功）。

---

#### A9. Profile 抓取体验升级（P1）

1. 进度：`12/40 · 跳过 5 · 失败 1`。  
2. 暂停 / 取消。  
3. 范围增量：`Media` 标签（可选 P2）、`Replies` 默认排除（已有 RT 过滤则保持）。  
4. 视频：尊重全局 `enable_video_download`；日更文件中嵌入 `![[...]]` 与单帖一致。  
5. 失败摘要可复制。

---

#### A10. GIF / 多视频语义（P2）

- `animated_gif` 在 Markdown 标注 `GIF` 而非「视频」误导。  
- 多段视频索引稳定：`_video_1` 与占位符对应关系有测试。

---

### 6.2 Epic B — Obsidian 知识工作流

#### B1. 标签与规则引擎（P0）

**配置项（设置页新分组「整理规则」）：**

| 规则 | 示例 |
|------|------|
| 默认 tags | `["剪报", "X"]` |
| 路径映射 | `custom_save_path_name=生图类` → tags `["生图"]` |
| 关键词 | 正文含 `Stable Diffusion` → `#生图` |
| 作者映射 | `@handle` → `#创作者/xxx` |
| 平台映射 | LINUX DO → `["论坛"]` |

Front Matter：

```yaml
tags:
  - 剪报
  - X
  - 生图
```

保持 `类别: "[[剪报]]"` 兼容；允许用户关闭自动 tags。

---

#### B2. Front Matter 模板（P1）

- 内置模板：`default` / `minimal` / `dataview-full`。  
- 高级：用户自定义 Mustache 风格字段（安全：仅白名单变量）。  
- 白名单变量：`title,url,author,handle,published,created,platform,type,status_id,tags,poll,repost,...`。

**兼容：** 默认模板必须与当前 2.x 输出字段超集兼容（可多不可少破坏性删除）。

---

#### B3. 重复检测（P0）

1. 以 `status_id` 或规范化 `url` 为键，维护 `save_index.json`（app support 目录）。  
2. 命中时扩展弹 **产品化对话框**：  
   - 跳过  
   - 覆盖（同路径）  
   - 另存为（文件名追加时间）  
3. 配置默认策略：`ask` | `skip` | `overwrite` | `always_new`。

---

#### B4. 图片本地化（P1）

- 开关：`download_images` 默认 **false**（保持现状）。  
- 开启后：下载到 `{vault}/X2MD-attachments/{status_id}/` 或用户指定附件根。  
- Markdown 使用相对路径或 Obsidian `![[...]]`（可配置）。  
- 失败时回退远程 URL，并在文末注明失败列表。

---

#### B5. 保存后动作（P0）

成功 toast 增加次级操作（3s 内可点）：

- 显示文件  
- 复制路径  
- 在 Obsidian 打开（`obsidian://open?path=` 或 `obsidian://vault/…`，需配置 vault 名）

桌面通知点击 → 打开文件目录。

---

#### B6. 保存历史（P2）

- 托盘 / 设置「最近 20 条」：标题、时间、平台、路径。  
- 支持重新打开；不支持云同步。

---

### 6.3 Epic C — 产品 UX / UI 打磨

#### C1. 设计一致性（P0）

**问题：** popup 深色 Twitter 风、settings 浅色 Apple 风、options 近似 settings、content 注入控件为 inline 样式，品牌碎片化。

**规范：**

| 表面 | 方向 |
|------|------|
| 扩展 popup | 深色保留，但副标题改为「网页 → Obsidian」；展示多平台小图标条；版本号 |
| 扩展 options | 与桌面 settings **共用视觉 token**（可抽 `shared/ui-tokens.css` 构建拷贝） |
| 桌面 settings | 保持现有优秀 IA；补「整理规则」「关于」页 |
| 页内 X 按钮 | 统一 32×32 热区、X 原生间距对齐、focus-visible 环、`aria-label` |

**色板 token（建议）：**

```text
--x2md-accent: #1d9bf0
--x2md-ok: #00ba7c
--x2md-warn: #ffad1f
--x2md-danger: #f4212e
--x2md-surface: ...
--x2md-radius: 12px
```

禁止再新增第三套无文档化色值。

---

#### C2. 页内控件打磨（P0）

1. **书签悬停菜单**  
   - 动画 120–160ms；键盘 ↑↓ 选择 Enter 确认 Esc 关闭。  
   - 显示路径 abbreviated（中间省略）。  
   - 空自定义路径时菜单不闪空态。  
2. **复制 / 翻译按钮**  
   - 与 Grok 按钮避让规则文档化；长按自动翻译有进度点。  
   - 成功/失败用 X 风格 toast，文案 ≤ 18 汉字。  
3. **🐾 Profile 菜单**  
   - 与设置中的 range 默认值双向同步。  
   - 抓取中按钮变为进度环，禁止重复点击。  
4. **视频确认**  
   - 自绘 modal：封面缩略图（若有）、时长、是否下载、记住选择（会话级）。  
   - 禁止 `window.confirm`。

---

#### C3. Popup 升级（P0）

布局建议（宽度 300–320）：

```text
┌ Header: 图标 + X2MD + version ──────────┐
│ ● 服务在线  v3.0.0 · 9527               │
│ 主路径: ~/Documents/Vault/Clippings     │
│ [打开设置] [打开保存目录] [打开日志]      │
│ 最近保存: 标题截断…  12:04              │
│ 平台: X · LINUX DO · 飞书 · 微信        │
└─────────────────────────────────────────┘
```

离线态：

- 文案：`本机服务未启动`  
- 主按钮：`尝试唤醒 X2MD`（自定义协议或 `chrome.runtime.sendNativeMessage` 不可用时，展示「请打开 X2MD.app」+ 复制 `open -a X2MD`）  
- 次按钮：打开排障文档锚点

---

#### C4. 设置页增量（P1）

新增面板：

1. **整理规则**（B1/B2）  
2. **关于**  
   - 版本（单一源）  
   - 检查更新（若 D3 落地）  
   - 开源链接、日志目录、扩展目录一键打开  
3. **开发者**（折叠）  
   - 导出匿名化最近失败 payload  
   - 清空 GraphQL 缓存  

文案原则：延续现有「只改常用项就够了」；高级默认折叠。

---

#### C5. 反馈与动效规范（P1）

| 场景 | 规范 |
|------|------|
| 保存中 | toast 不定宽，左侧 spinner |
| 成功 | 绿点 + 文件名；可选次级 action |
| 失败 | 红点 + 错误码短句 +「详情」展开 |
| 批量 | 底部固定进度条，不挡书签按钮 |
| 减少 | 全屏遮罩；除视频确认与批量面板外不打断浏览 |

---

#### C6. 无障碍与国际化（P2）

- 所有注入按钮 `aria-label` 中英键值表。  
- 第一阶段仍以中文为默认；预留 `i18n` JSON（`zh-CN` / `en`）。  
- 对比度：翻译块与正文层级符合 WCAG AA 于深色 X 背景。

---

### 6.4 Epic D — 平台、安全与工程

#### D1. 版本单一源（P0）

- 根目录 `VERSION` 或 `package.json` version 为唯一真源。  
- `scripts/sync-extension-version.mjs` 扩展到同步 `app/core/config.ts`、`manifest.json`、`/ping`。  
- CI 校验三者一致。

#### D2. 本地服务端口对齐（P0）

方案（选一，推荐 2）：

1. **固定端口产品化**：UI 移除改端口；文档写死 9527。  
2. **推荐：扩展动态探测**  
   - 启动时探测 `9527–9530` `/ping` 特征；  
   - 或桌面写入 `~/Library/Application Support/X2MD/extension-bridge.json`，扩展可读（需 `file://` 不可行）→ 改用 **native messaging** 或 **固定端口 + 副通道**。  
   - 务实折中：设置页改端口后提示「需将扩展 host 权限保持默认；高级用户使用固定 9527」+ 健康检查展示实际端口。

PRD 决策：**v3 默认锁定 9527**；高级改端口仅开发者选项并明确「扩展需开发者模式加载补丁版」。

#### D3. 自动更新（P1）

- Mac Electrobun 更新通道（已有 artifacts 痕迹可延续）。  
- 扩展版本提示：桌面 `/ping` 返回 `min_extension_version`，popup 显示升级条。

#### D4. 本地 API 收紧（P1）

- CORS 收敛为扩展 id 白名单 + `views://` + localhost。  
- 可选 `local_api_token`（首次安装生成，扩展 storage 同步）；无 token 拒绝 `/save`。  
- 保持 loopback only。

#### D5. `content.js` 模块化（P0 工程）

拆分为（构建可用简单 concat 或 bundler，保持 MV3 兼容）：

```text
extension/
  x/
    save.js
    thread.js
    article.js
    translate-ui.js
    copy-ui.js
    profile-ui.js
    bookmarks-ui.js
    toasts.js
  content-entry.js
```

对外行为不变；单测按模块增加。

#### D6. Windows 客户端（P1）

- Electrobun Windows 或「精简 TS 服务 + 托盘」二选一；功能对齐：ping/config/save/settings/autostart。  
- 发布物：`X2MD_Windows.zip` 与 Mac 同版本号。

#### D7. 测试资产（P0）

1. GraphQL **脱敏 fixture** 目录：`extension/tests/fixtures/graphql/*.json`。  
2. 每类内容至少 1 个：普通帖、thread、quote、poll、community note、article、敏感遮罩文案。  
3. Playwright（可选）登录态不进 CI；CI 只跑 fixture。  
4. 保留 golden markdown 对比。

#### D8. 退役 Python 主路径（P2）

- 文档标记 legacy；CI 可选 job。  
- 行为以 TS 为准，避免双源修改。

---

## 7. 信息架构与 UI 线框（文字稿）

### 7.1 书签悬停菜单（升级后）

```text
┌ 保存到默认位置 ──────────────┐
│ 生图类                       │
│ 文章库                       │
│ 客户资料                     │
├──────────────────────────────┤
│ 翻译后保存                   │  ← 若当前有译文 override
│ 仅保存原文                   │
└──────────────────────────────┘
```

### 7.2 视频确认 Modal

```text
        下载视频？
   [封面]  时长 03:42 · 约 28MB
   ☑ 本次下载到视频目录
   ☐ 以后低于 5 分钟不再询问

   [ 只存链接 ]     [ 下载并保存 ]
```

### 7.3 Bookmarks 工具条

```text
X2MD 书签导出   已加载 48 条   [导出] [加载更多并导出] [进度 12/48]
```

---

## 8. Markdown 输出契约（增量）

### 8.1 兼容性

- **不得删除** 现有字段：`title, tags, 源, 作者主页, 创建时间, 发布时间, 平台, 类别, 阅读状态, 整理`。  
- 新增字段一律可选；解析端应容忍缺失。

### 8.2 建议新增 FM 字段

```yaml
status_id: "123"
type: "tweet" | "thread" | "article" | "repost"
content_state: "available"
repost: false
poll: false
has_community_notes: false
lang: "zh"
x2md_version: "3.0.0"
```

### 8.3 正文块顺序（单帖）

1. 正文（或译文）  
2. 媒体（图/视频/GIF）  
3. Poll  
4. 链接卡片  
5. Community Notes  
6. Quote 链  
7. Thread 分段  

Article 仍以正文内顺序为最高优先级，末尾只补「未内嵌」媒体（保持 2.0.4 修复语义）。

---

## 9. 分析与埋点（本地）

仅本地日志，默认关闭远程。

可选 `diagnostics_enabled`：

- 保存耗时、降级路径（graphql|oembed|dom）、错误码计数。  
- 日志自动脱敏（去掉 cookie、ct0、authorization）。

---

## 10. 里程碑与优先级

### Phase 0 — 稳定基线（v2.1，约 1–2 周）

- D1 版本单一源  
- A1 GraphQL 韧性 + 错误码  
- C1/C3 popup 文案与离线态  
- C2 视频 modal 替换 confirm  
- B3 重复检测（ask 默认）  
- B5 保存后「显示文件」  
- D5 content 拆分启动（可不一次拆完）  
- D7 fixture 基建  

### Phase 1 — X 深度（v2.2，约 2–4 周）

- A2 时间线完整度  
- A3 Poll  
- A4 Community Notes  
- A5 链接卡片  
- A8 Bookmarks 导出  
- A9 Profile 进度  
- B1 标签规则  
- D4 API token 可选  

### Phase 2 — 知识库与平台（v3.0，约 3–5 周）

- B2 模板  
- B4 图片本地化  
- A6 引用链  
- A7 敏感/受限态  
- D3 自动更新  
- D6 Windows 对齐  
- C6 i18n 雏形  
- B6 历史记录  

---

## 11. 验收标准（发布门禁）

### 11.1 功能门禁

| ID | 场景 | 期望 |
|----|------|------|
| AC1 | 详情页 4 图 + 视频帖 | 媒体全、视频策略正确 |
| AC2 | 8 帖同作者 thread | 单文件分段完整 |
| AC3 | Article 含代码块 + 中部视频 + 文末引用 | 无重复媒体、引用位置正确（回归 2.0.x） |
| AC4 | 含 Poll 帖 | 选项与票数结构化 |
| AC5 | 含 Community Notes 帖 | callout 输出 |
| AC6 | Home 卡片保存 | 与详情页归一化媒体一致 |
| AC7 | 重复保存 | 对话框策略生效 |
| AC8 | 服务关闭 | popup 离线 + 明确恢复指引 |
| AC9 | Bookmarks 导出 20 条 | 进度正确、可取消 |
| AC10 | 版本三处一致 | CI 强制 |

### 11.2 UX 门禁

- 无 `window.confirm` / `alert` 用于主流程。  
- 主路径 toast 文案审核（无内部堆栈）。  
- 注入按钮不遮挡 X 原生 bookmark/share（抽样 3 种缩放 100%/125%）。  

### 11.3 回归

- `npm run check` 全绿。  
- Mac `acceptance:mac:auto` 全绿。  
- 新增 graphql fixture 测试全绿。

---

## 12. 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| X 变更 GraphQL / DOM | 保存残缺 | 韧性层 + fixture + 快速补丁通道 |
| 批量导出触发风控 | 账号异常 | 低并发、可暂停、文档风险提示 |
| 图片全量本地化占磁盘 | 用户抱怨 | 默认关闭；按帖目录；可清缓存工具 |
| 模块化引入回归 | 发布事故 | 行为对比测试 + 分 PR 拆分 |
| Token 收紧导致旧扩展失败 | 升级摩擦 | 可选 token；升级引导条 |
| Windows 方案延期 | 用户分裂 | Phase2 可先 TS 无 GUI 服务 + 托盘最小集 |

---

## 13. 开放问题（需产品拍板）

1. **Bookmarks 批量** 是否默认展示，或仅 `options` 开启「实验功能」？  
   - 建议：默认开启，首次使用有风险提示。  
2. **图片本地化** 默认策略？  
   - 建议：默认远程；设置中一键「对以后保存启用」。  
3. **Community Notes 是否参与翻译？**  
   - 建议：默认不翻译。  
4. **是否在 FM 写入公开互动数据（赞/转/阅）？**  
   - 建议：默认关，模板 `dataview-full` 可开。  
5. **改端口能力保留程度？**  
   - 建议：UI 隐藏到开发者模式，产品层锁 9527。

---

## 14. 成功定义（一句话）

> 当用户在 X 上随手点书签、从书签库倒出存量、或批量追踪博主时，得到的是 **结构完整、可去重、可检索、媒体策略可控、失败原因可读** 的 Obsidian 笔记；同时 X2MD 的界面与版本表现得像一个 **认真维护的小产品**，而不是脚本集合。

---

## 15. 附录

### 15.1 关键代码索引

| 主题 | 路径 |
|------|------|
| 书签保存 / 注入 UI | `extension/content.js` |
| GraphQL / 富化 | `extension/background.js`, `twitter_graphql.js` |
| Article MD | `extension/article_markdown.js`, `media_helpers.js` |
| Markdown 输出 | `app/core/markdown.ts` |
| 博主聚合 | `app/core/profile-capture.ts` |
| 配置 | `app/core/config.ts` |
| 设置 UI | `app/ui/settings/*` |
| Popup | `extension/popup.html` |
| 既有架构 PRD | `docs/prd/electrobun-rearchitecture-prd.md` |

### 15.2 建议立即修的「小而确定」项（可先于 v2.1 热修）

1. 统一 `VERSION` 到 2.0.4。  
2. 去掉 `background.js` 重复 `importScripts("twitter_graphql.js")`。  
3. popup 副标题改为多平台表述。  
4. README 快速上手版本号与 release 对齐。  

### 15.3 文档维护

本 PRD 随里程碑更新「状态」字段；每个 Phase 结束在 `docs/acceptance/` 增补对应 checklist，并与本文件 AC 表交叉引用。
