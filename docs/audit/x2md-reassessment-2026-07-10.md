# X2MD 项目重新梳理与升级建议

| 字段 | 内容 |
| --- | --- |
| 日期 | 2026-07-10 |
| 审计对象 | 当前 `main` / `v3.1.0` 工作树、测试、发布脚本与本机安装态 |
| 基线验证 | `npm run check` 通过：151 个 JS/TS 测试、11 个 Python 测试 |
| 推荐方向 | X-first Local Knowledge Inbox（可靠的 X → Obsidian 本地采集管道） |

## 1. 执行结论

X2MD 已经不是一个简单的“网页转 Markdown”脚本。它在 X/Twitter 场景下已经形成明显差异化：Tweet、Thread、Article、Quote、图片 ALT、视频、翻译、书签分类、Bookmarks 导出、Profile/Articles 批量、Poll、Community Notes 和链接卡片均有实现基础。

当前主要问题不再是“功能不够”，而是：

1. **仓库、运行态、文档和发布物没有形成同一个产品真相。**
2. **本地 API 的认证和 CORS 边界不成立，Windows legacy 风险更高。**
3. **保存链路缺少原子性、并发保护、任务恢复和明确的媒体完成语义。**
4. **最强能力不可发现，部分已实现配置只能手改 JSON。**
5. **扩展两个巨石入口和 Python/TypeScript 双实现正在放大每次改动的回归范围。**

因此，下一阶段不建议继续横向增加网站或零散功能。推荐先完成一次“产品真相收敛 + 安全发布重置”，再建设统一采集契约、可靠保存引擎、批量任务中心和单一设置中心。

## 2. 当前产品定位

### 2.1 对外定位

当前 README 的定位是：将 X/Twitter、LINUX DO、飞书和微信公众号内容保存为 Obsidian 可用 Markdown。

### 2.2 真实差异化

代码与提交历史表明，X/Twitter 是绝对主产品面：

- X 内容采集深度远高于其他站点。
- 最近主要提交集中在 X GraphQL、Article、媒体、Bookmarks、Profile、翻译和结构化内容。
- `extension/content.js` 与 `extension/background.js` 的主要复杂度来自 X。
- 其他站点更适合作为轻量 Capture Adapter，而不是与 X 并列投入同等深度。

### 2.3 推荐的新定位

> **X2MD：把 X 的推文、串帖、长文、书签和博主内容，可靠地沉淀进你的 Obsidian。Local-first，不建立云端资料库。**

LINUX DO、飞书和微信公众号继续支持，但下一大版本只做兼容性维护与共享能力升级，不继续横向扩张。

## 3. 当前真实架构

```text
Chrome MV3 Extension
├─ content scripts
│  ├─ X DOM、按钮、翻译、复制、批量：extension/content.js
│  └─ 站点提取器：discourse.js / feishu.js / wechat.js / article_markdown.js
│
└─ service worker：extension/background.js
   ├─ X GraphQL / oEmbed / 后台 Tab 富化
   ├─ Profile / Bookmarks / 翻译编排
   └─ HTTP → 127.0.0.1:9527

Electrobun / Bun
└─ app/main/index.ts
   ├─ app/main/http-server.ts
   ├─ Tray / Settings / Autostart / Desktop adapters
   └─ app/core
      ├─ config.ts
      ├─ save.ts
      ├─ markdown.ts
      ├─ media.ts
      └─ profile-capture.ts

持久化
Application Support/X2MD/
├─ config.json
├─ save_history.json
├─ profile_capture_state.json
└─ x2md.log
```

### 3.1 单条保存链路

```text
DOM 初采集
  → background GraphQL / Article / 翻译富化
  → POST /save
  → savePayload()
  → 图片本地化
  → buildMarkdown()
  → 启动视频下载副作用
  → 同步写 Markdown
  → 更新 history
```

### 3.2 批量链路

- Bookmarks：当前页面内收集已加载 status URL，在扩展内存中顺序执行。
- Profile：扩展采集后提交 `/profile-capture`，服务端按日聚合并写 `profile_capture_state.json`。
- 两者没有统一持久化任务模型；标签页关闭或扩展重载后无法恢复。

## 4. 现有优势

1. **核心价值闭环成立**：浏览器内容能够稳定落到用户自己的 Markdown 目录。
2. **X Article 深度较强**：富文本、代码块、媒体、引用位置与翻译已有多轮真实缺陷修复。
3. **降级策略合理**：GraphQL、oEmbed、DOM 形成多级回退。
4. **本地优先**：无需云账号，数据直接写入用户目录。
5. **批量能力有差异化**：Bookmarks 与 Profile/Articles 是普通剪藏器不常见的能力。
6. **自动测试基线存在**：当前 162 项测试全部通过，适合支撑渐进式重构。
7. **Mac 设置页已有较好的信息架构和视觉基础**。

## 5. 关键问题与优先级

## 5.1 P0：必须先解决

### P0-1 仓库包含不应入库的本机文件和发布二进制

- `config.json`、`x2md.log`、`x2md.pid` 已被 Git 跟踪；忽略规则不能移除已跟踪文件。
- 日志和配置包含本机绝对路径、抓取记录或运行信息。
- `release/` 中长期跟踪二进制包，约 185 MB；本地 `.git` 已膨胀到约 1.2 GiB。
- 这同时违反仓库自身“不要提交日志、PID、配置秘密和生成归档”的约束。

**结论**：先停止继续传播，移除索引文件，评估远端暴露范围，再决定是否执行历史净化。Git 只保留 release notes 和必要 manifest，二进制由 CI 发布到 GitHub Releases。

### P0-2 本地 API 安全模型不成立

- 所有响应默认 `Access-Control-Allow-Origin: *`。
- 任意 `chrome-extension://`、无 Origin、`Origin: null` 和任意 localhost Origin 被视为可信。
- token 默认不强制，且仅保护 `/save`。
- `/config` 可读取或修改 token，`/profile-capture` 等敏感路由不受保护。
- 官方扩展当前没有发送 `x-x2md-token`；用户一旦启用校验，保存反而失败。
- 旧配置缺 token 时，归一化会生成随机 token，但未立即持久化，可能每次读取变化。
- Windows Python legacy 对本地 API 的限制更弱。

**结论**：需要一次完整的 pairing + capability token 改造，而不是继续增加可选开关。

### P0-3 发布与运行态存在多个互相冲突的真相

- 仓库和 tag 是 3.1.0，README 最新下载仍指向 3.0.0。
- 本机已安装并运行的 App 仍为 3.0.0，LaunchAgent 也指向旧安装包。
- CI 发布 Python `X2MD_Windows.zip`；本地脚本发布 Node/TS `X2MD_Windows_Lite.zip`；README 口径又不同。
- `update.json` 被生成，但 App 没有真正消费它的更新流程。
- Mac 产物没有完成 Developer ID 签名和 notarization 的正式分发门禁。

**结论**：必须建立版本、安装态、扩展、artifact、README 和运行态的一致性检查；Python Windows legacy 不再作为 stable 主产品继续发布。

### P0-4 可配置端口是伪能力

- 两套设置页允许修改端口。
- `extension/background.js` 和 manifest 权限仍固定 `9527`。
- 改端口会让主保存链路断联。

**结论**：v4 固定 `127.0.0.1:9527`，移除普通用户端口设置；端口冲突通过诊断页解决。除非未来先实现可靠发现协议，否则不重新开放。

### P0-5 功能完成状态与真实闭环不一致

- `tasks/todo.md` 中多个条目被标为完成，但只验证了局部字段或文件存在。
- 自动更新、Windows 能力、token、保存历史操作、图片本地化等没有完整用户闭环。
- 人工真实站点验收仍有未完成项。

**结论**：建立 requirement → authoritative evidence 矩阵；存在性检查不能替代真实 artifact 或端到端行为。

## 5.2 P1：核心可靠性与产品闭环

### P1-1 保存写入不是原子的

- `existsSync → 秒级时间戳 → writeFileSync` 存在 TOCTOU，并发同标题可能覆盖。
- history、config、profile state 是直接读改写，崩溃或并发可能丢记录或产生坏 JSON。
- 图片逐张串行下载，同步文件 I/O 位于请求路径。
- 请求体、下载体积、下载超时和协议范围没有统一限制。

### P1-2 媒体完成语义不清晰

- 视频下载在 `buildMarkdown()` 中以副作用启动；HTTP 可以先报告成功，之后视频失败。
- Markdown 可能引用尚未完成或最终不存在的文件。
- 多保存目录时，图片只下载到第一个目录，其他 Markdown 的相对附件引用可能失效。
- Twitter/X 主场景当前直接跳过图片本地化。

### P1-3 普通保存没有去重契约

- 同名时只会生成时间戳副本。
- 没有基于规范化 URL/status ID 的统一 save index。
- Bookmarks 界面虽然显示“跳过”，标准 `/save` 并不会返回真正的 duplicate skip。

### P1-4 最强能力不可配置或不可发现

核心配置已经存在：tags、tag rules、Front Matter 模板、图片本地化、API token 等，但 App 和扩展设置页没有对应 UI；大多数用户无法使用。

### P1-5 两套设置页重复并漂移

- App settings 与 extension options 分别维护相似 HTML、样式和脚本。
- 字段和约束已经不同，例如视频阈值、保存通知和高级选项。
- 用户无法判断哪个是权威入口。

### P1-6 保存后没有形成动作闭环

- toast 只有文字。
- popup 只有最近记录和“打开设置”。
- 没有“在 Obsidian 打开”“显示文件”“复制路径”“重试”。

### P1-7 安装与首次成功路径过长

用户需要下载 App、下载扩展、打开开发者模式、加载目录、选择保存路径，再自己验证。当前首次运行只是完整设置页，不是 onboarding 或 Setup Doctor。

### P1-8 浏览器语义存在明显缺陷

- X 的 `bookmark` 和 `removeBookmark` 都可能触发保存。
- 长视频仍使用 `window.confirm`。
- Bookmarks 只导出当前已加载内容，任务关闭页面即丢失。

## 5.3 P2：维护性

- `extension/content.js` 约 3868 行，`extension/background.js` 约 1864 行。
- 两个入口混合 DOM、UI、翻译、GraphQL、批量与保存编排，现有测试没有直接覆盖真实入口消息流。
- `server.py` 与 TypeScript 核心长期双写并已明显漂移。
- TypeScript `strict: false`，大量 `Record<string, any>` 让契约漂移难以及时发现。
- CI 只在 tag 或手动运行，缺少 PR/main 质量门。

## 6. 三个可选升级方向

| 方向 | 内容 | 优点 | 代价 | 结论 |
| --- | --- | --- | --- | --- |
| A. X-first Local Knowledge Inbox | 深化 X → Obsidian 的可靠采集、去重、批量、知识整理和本地隐私 | 最符合现有代码资产与用户价值，差异化最强 | 需要先完成安全、保存和任务架构 | **推荐** |
| B. Universal Local-first Web Clipper | 将所有网站统一为通用剪藏器和 Adapter | 市场更宽，品牌更通用 | 与成熟剪藏器正面竞争，稀释 X 护城河 | A 稳定后再扩展 |
| C. Creator Research Archiver | Watchlist、定时增量、研究 digest、素材队列 | 专业用户价值高 | 风控、调度、长期运行和合规复杂度显著增加 | 作为后续高级层 |

## 7. 推荐升级方案

### Phase 0：Release Reset（立即）

- 清理隐私文件和 Git 二进制产物。
- 统一版本、artifact、README、CI 和安装态验证。
- 固定 9527，移除无效端口设置。
- 建立 mandatory pairing token 和严格 Origin 策略。
- stable 暂停发布 Python Windows legacy；明确 Mac stable / Windows beta 支持矩阵。

### Phase 1：Reliable Save Core

- 定义 `CaptureDocumentV1`、`SaveRequestV1`、`SaveResultV1`。
- 保存引擎拆为准备、去重、媒体、渲染、写入、历史六个阶段。
- 所有 JSON 和输出文件使用临时文件 + 原子替换或 `open("wx")`。
- 图片有限并发、超时、大小和类型限制；视频从 Markdown 渲染副作用中移出。
- 建立基于 URL/status ID 的 save index 与明确 duplicate policy。

### Phase 2：Capture Modules

- `site-adapters/`：只负责从页面得到 CaptureDocument。
- `capture-flow/`：处理书签语义、富化、降级和统一错误。
- `capture-ui/`：按钮、toast、modal、进度 UI。
- `local-client/`：端口、token、请求、重试、错误映射的唯一入口。
- `content.js` / `background.js` 最终只做启动和消息分发。

### Phase 3：Knowledge Inbox UX

- 桌面 App 成为唯一权威设置中心。
- 扩展 options 降为连接状态、配对、打开桌面设置和诊断。
- 正式开放标签规则、FM 模板、X 图片本地化、重复策略、媒体策略。
- 保存成功提供打开 Obsidian、显示文件、复制路径和重试。
- 增加 Setup Doctor：配对、扩展状态、目录权限、样例保存、打开结果。

### Phase 4：Persistent Job Center

- Bookmarks 和 Profile 统一为持久化 job state machine。
- 支持暂停、继续、取消、失败重试和 App/页面重启后恢复。
- 每个 item 保留成功、跳过、失败和错误码。
- 批量任务完成后提供可复制报告。

### Phase 5：Release Confidence

- PR/main 运行测试、安全和 forbidden-files gate。
- Mac artifact 完成真实签名、公证、首次运行、升级和自启验收。
- Windows 只有在 TypeScript 单一核心的真实包通过 `/ping + /config + /save` smoke 后才进入 stable。
- 发布二进制只存在 GitHub Releases，不进入 Git 历史。

## 8. 推荐保留与明确不做

### 保留

- Chrome 扩展采集端。
- 本地 loopback 服务。
- 直接写 Markdown 与附件。
- X GraphQL + DOM 降级。
- Electrobun Mac 壳。
- 其他站点轻量 Adapter。

### v4 不做

- 不做云端账号和云资料库。
- 不做内置笔记编辑器。
- 不继续增加新站点。
- 不做无人值守的大规模账号爬取。
- 不引入重型数据库、队列框架或新的前端构建系统。
- 不继续维护 Python 与 TypeScript 两套功能核心。

## 9. 建议成功指标

| 指标 | 目标 |
| --- | --- |
| 首次安装到首条成功保存 | 中位数 ≤ 5 分钟 |
| 单条保存成功率 | 已登录、支持内容样例集 ≥ 98% |
| 可读错误覆盖率 | 100% 失败进入稳定错误码 |
| 重复文件率 | 同一规范化 URL 重复导出默认 ≤ 1% |
| 20 个不同 capture key、相同标题并发保存 | 生成 20 个唯一文件，0 覆盖、0 丢历史 |
| 20 个相同 capture key 并发保存 | 默认策略下 1 个 saved、19 个 skipped |
| Bookmarks 任务恢复 | App/页面重启后可继续，已成功项不重做 |
| 保存后动作 | 100% 成功结果可打开、显示或复制路径 |
| Release truth | tag、App、扩展、artifact、README、live ping 完全一致 |

## 10. 关联产物

- 新版 PRD：`docs/prd/x2md-v4-reliable-knowledge-inbox-prd.md`
- 实施路线：`tasks/plan.md`
- Codex 可执行任务：`tasks/todo.md`
- 现有保存管线分析：`docs/prd/v3.1-save-pipeline-architecture-prd.md`
