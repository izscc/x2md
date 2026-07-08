# X2MD v3 Task Breakdown

## Task 1: 版本单一源与小修复
**Description:** 以根目录 `package.json` version 为唯一真源，同步扩展 manifest 与 `app/core/config.ts`，并修掉已知重复 import / popup 过时文案。
**Acceptance criteria:**
- [x] `package.json`、`extension/manifest.json`、`app/core/config.ts` 显示同一版本。
- [x] `/ping` 返回版本与根 `package.json` 一致。
- [x] `extension/background.js` 不再重复加载 `twitter_graphql.js`。
- [x] popup 不再写「推特书签 → Obsidian」。
**Verification:**
- [x] `npm run sync:extension-version`
- [x] `npm run check`
**Dependencies:** None
**Files likely touched:**
- `scripts/sync-extension-version.mjs`
- `app/core/config.ts`
- `extension/manifest.json`
- `extension/background.js`
- `extension/popup.html`
**Estimated scope:** Small

## Task 2: GraphQL op-id 缓存与错误码契约
**Description:** 为 TweetDetail / TweetResultByRestId 建立 chrome.storage.local 缓存优先级，并统一 AUTH_REQUIRED、RATE_LIMITED 等错误码。
**Acceptance criteria:**
- [x] 缓存命中时不重新探测脚本。
- [x] 429 最多退避重试 3 次，最终返回 RATE_LIMITED。
- [x] 401/403 返回 AUTH_REQUIRED。
- [x] GraphQL 降级保存时把错误码/中文提示贯穿到保存响应与 toast。
**Verification:**
- [x] 新增/更新 `extension/tests/twitter_graphql.test.js`
- [ ] `npm run test:js -- extension/tests/twitter_graphql.test.js`
**Dependencies:** Task 1
**Files likely touched:** `extension/twitter_graphql.js`, `extension/background.js`, `extension/tests/twitter_graphql.test.js`
**Estimated scope:** Medium

## Task 3: GraphQL fixture 基建与回归样例
**Description:** 建立脱敏 GraphQL fixture 与 golden markdown 目录，先覆盖普通帖、thread、quote、article 基线。
**Acceptance criteria:**
- [ ] fixture 不包含 cookie、authorization、ct0。
- [ ] 至少 4 类基础样例可跑快照。
- [ ] CI 中 `npm run test:js` 覆盖 fixture 测试。
**Verification:** `npm run test:js`
**Dependencies:** Task 1
**Files likely touched:** `extension/tests/fixtures/graphql/*`, `extension/tests/twitter_graphql.test.js`
**Estimated scope:** Medium

## Task 4: popup 文案、版本、离线态升级
**Description:** 更新 popup 为多平台表述，显示服务在线/离线、版本、端口与基础恢复指引。
**Acceptance criteria:**
- [x] 在线态显示版本与端口。
- [x] 离线态显示“本机服务未启动”和恢复指引。
- [x] popup 测试覆盖在线/离线。
**Verification:** `npm run test:js -- extension/tests/popup.test.js`
**Dependencies:** Task 1
**Files likely touched:** `extension/popup.html`, `extension/popup.js`, `extension/tests/popup.test.js`
**Estimated scope:** Small

## Task 5: 视频确认 Modal 替换 confirm
**Description:** 用注入页内 modal 替换主流程 `window.confirm`，保留“只存链接 / 下载并保存”语义。
**Acceptance criteria:**
- [ ] 主流程无 `window.confirm`。
- [ ] modal 可 Esc 关闭，按钮可键盘聚焦。
- [ ] 用户选择正确传递到保存请求。
**Verification:** `rg "confirm\\(" extension`；相关手测
**Dependencies:** Task 4
**Files likely touched:** `extension/content.js`
**Estimated scope:** Medium

## Task 6: 重复检测 save_index.json
**Description:** 服务端以 status_id/url 维护保存索引，支持 skip/overwrite/always_new 基础策略，ask UI 后续接入。
**Acceptance criteria:**
- [ ] 首次保存写入索引。
- [ ] 重复保存按默认策略返回可识别结果。
- [ ] 写文件成功后才更新索引。
**Verification:** `npm run test:js -- app/tests/*.test.ts`
**Dependencies:** Task 1
**Files likely touched:** `app/core/save.ts`, `app/core/config.ts`, `app/tests/core.test.ts`
**Estimated scope:** Medium

## Task 7: 保存后动作基础
**Description:** `/save` 响应包含可用于显示文件、复制路径、Obsidian 打开的字段；扩展 toast 增加操作入口。
**Acceptance criteria:**
- [ ] 保存响应包含绝对文件路径。
- [ ] popup/content 可复制路径。
- [ ] 本地服务提供打开文件夹能力。
**Verification:** `npm run test:js`
**Dependencies:** Task 6
**Files likely touched:** `app/main/http-server.ts`, `extension/save_response.js`, `extension/content.js`
**Estimated scope:** Medium

## Task 8: content.js 拆分第一刀
**Description:** 先抽出 toast、保存响应处理、GraphQL 探测工具，减少巨石文件风险。
**Acceptance criteria:**
- [ ] content 入口行为不变。
- [ ] 新模块有单测或现有测试覆盖。
- [ ] manifest 加载顺序正确。
**Verification:** `npm run test:js && npm run smoke:chrome-extension-load`
**Dependencies:** Task 1–4
**Files likely touched:** `extension/content.js`, `extension/x/*.js`, `extension/manifest.json`, `extension/tests/*.test.js`
**Estimated scope:** Medium

## Later Tasks
详见 `tasks/plan.md` Phase 1 与 Phase 2。每个任务开始前再拆成不超过 3 个可验证增量。


---

# Phase 1 / Phase 2 Detailed Verifiable Tasks

## Task 9: 时间线卡片完整度校验
**Acceptance criteria:**
- [ ] 保存含 statusId 的 Home 卡片时始终触发 `fetchFullTweetData`。
- [ ] GraphQL 媒体数少于 DOM 媒体数时保留 DOM 媒体补集。
- [ ] 新增归一化媒体 URL 对比测试。
**Verification:** `npm run test:js -- extension/tests/twitter_graphql.test.js extension/tests/media_helpers.test.js`

## Task 10: Poll 结构化解析
**Acceptance criteria:**
- [x] 从 GraphQL card/binding_values/unified_card 提取 poll 选项、票数、百分比、截止时间。
- [x] Markdown 追加 `### 投票` 块。
- [x] Front Matter 写入 `poll: true` 与可选 `poll_end`。
- [x] 2/4 选项与已结束 poll fixture 稳定。
**Verification:** `npm run test:js -- app/tests/fixtures.test.ts extension/tests/twitter_graphql.test.js`

## Task 11: Community Notes 结构化解析
**Acceptance criteria:**
- [x] 解析 birdwatch note 正文与来源 URL。
- [x] Markdown 输出 `[!note] 社群笔记` callout。
- [x] 无注记时不输出块。
**Verification:** `npm run test:js -- app/tests/fixtures.test.ts extension/tests/twitter_graphql.test.js`

## Task 12: 链接卡片元数据
**Acceptance criteria:**
- [ ] 提取标题、描述、域名、目标 URL、卡片图。
- [ ] Markdown 输出 `[!info] 链接卡片`。
- [ ] 卡片图不与推文附图混淆。
**Verification:** `npm run test:js -- app/tests/fixtures.test.ts`

## Task 13: Bookmarks 导出 MVP
**Acceptance criteria:**
- [ ] `/i/bookmarks` 注入 X2MD 工具条。
- [ ] “导出可见”收集已加载 statusId，去重后顺序保存。
- [ ] 默认并发 1。
**Verification:** `npm run test:js -- extension/tests/site_actions.test.js` + 手动导出 20 条

## Task 14: Bookmarks 导出进度与控制
**Acceptance criteria:**
- [ ] 显示成功/跳过/失败计数。
- [ ] 支持暂停、继续、取消。
- [ ] 支持仅重试失败。
**Verification:** 手动导出 ≥30 条，取消后无异常半写状态。

## Task 15: Profile 抓取体验升级
**Acceptance criteria:**
- [ ] Profile 抓取按钮显示进度环/计数。
- [ ] 禁止重复点击。
- [ ] 视频策略与单帖 `enable_video_download` 一致。
**Verification:** `npm run test:js` + 手动 Profile 抓取。

## Task 16: 标签规则引擎 MVP
**Acceptance criteria:**
- [ ] 支持默认 tags、路径映射、关键词、作者、平台映射。
- [ ] 保持旧 Front Matter 字段不删除。
- [ ] 默认关闭破坏性行为。
**Verification:** `npm run test:js -- app/tests/core.test.ts`

## Task 17: 本地 API token 可选收紧
**Acceptance criteria:**
- [ ] 首次生成 local_api_token。
- [ ] 启用后 `/save` 校验 token。
- [ ] 默认兼容旧扩展。
**Verification:** `npm run test:js -- app/tests/api.test.ts`

## Task 18: Front Matter 模板
**Acceptance criteria:**
- [ ] 内置 default/minimal/dataview-full。
- [ ] 自定义模板只允许白名单变量。
- [ ] 默认模板兼容 2.x 字段超集。
**Verification:** `npm run test:js -- app/tests/core.test.ts`

## Task 19: 图片本地化
**Acceptance criteria:**
- [ ] `download_images=false` 默认保持远程链接。
- [ ] 开启后下载到附件目录。
- [ ] 下载失败回退远程 URL 并追加失败列表。
**Verification:** `npm run test:js -- app/tests/core.test.ts`

## Task 20: Quote 两层链与 Retweet 语义
**Acceptance criteria:**
- [ ] Quote 支持两层，第三层折叠为链接。
- [ ] Retweet 写入 `repost: true` 并标注原作者。
- [ ] 纯 RT 文件名优先原作者摘要。
**Verification:** `npm run test:js -- app/tests/fixtures.test.ts extension/tests/twitter_graphql.test.js`

## Task 21: 敏感/受限/删除态
**Acceptance criteria:**
- [ ] tombstone / unavailable / 登录墙映射到明确错误码。
- [ ] Front Matter 写入 `content_state`。
- [ ] 敏感媒体未展开时提示用户先显示。
**Verification:** fixture 测试 + 手动敏感遮罩页面。

## Task 22: Mac 自动更新与扩展升级提示
**Acceptance criteria:**
- [ ] `/ping` 返回 `min_extension_version`。
- [ ] popup 显示升级提示。
- [ ] release artifact 检查包含 update.json。
**Verification:** `npm run check:release-artifacts`。

## Task 23: Windows 轻量客户端发布
**Acceptance criteria:**
- [ ] Windows zip 与 Mac 同版本号。
- [ ] 支持 ping/config/save/settings/autostart 最小集。
- [ ] 发布脚本可产物校验。
**Verification:** Windows smoke 或交叉构建 artifact 检查。

## Task 24: i18n 与无障碍
**Acceptance criteria:**
- [ ] 注入按钮有 aria-label。
- [ ] 文案集中到 zh-CN/en JSON 雏形。
- [ ] 关键控件 focus-visible 可见。
**Verification:** DOM 单测 + 手动键盘巡检。

## Task 25: 最近保存历史
**Acceptance criteria:**
- [ ] 保存成功记录最近 20 条。
- [ ] popup/设置页可展示标题、平台、路径、时间。
- [ ] 可重新打开文件或目录。
**Verification:** `npm run test:js -- app/tests/api.test.ts extension/tests/popup.test.js`
