# X2MD v4 Codex-Executable Task List

本文件是 `docs/prd/x2md-v4-reliable-knowledge-inbox-prd.md` 的可执行拆解。每次只把一个任务章节交给 Codex；不要一次执行整个文件。

## 执行规则

1. 从干净分支或 worktree 开始，先运行 `git status --short`。
2. 不修改用户未要求修改的本机安装、个人目录或浏览器配置。
3. 先写失败测试，再写最小实现。
4. 先跑任务指定的窄测试，再跑 `npm run check`。
5. manifest、扩展入口、打包或桌面启动变化必须跑对应 smoke。
6. 每个任务单独提交，使用任务给出的 Conventional Commit subject。
7. 任务完成必须提供命令输出证据；不能只报告文件已创建。
8. **禁止自动执行 Git 历史净化、force push、签名密钥配置或公开 release。**

---

# Phase 0 — Release Reset and Truth

## T01：仓库禁止文件与隐私清理

**Codex task:** 从当前 Git index 移除已被跟踪的本机配置、日志、PID、`.DS_Store` 等禁止文件；保留用户本地文件不删除。新增无个人路径的 `config.example.json`，并增加一个 CI 可调用的 forbidden-files 检查脚本。只处理当前 index，不执行历史重写。

**Dependencies:** None

**Files:**
- Modify: `.gitignore`
- Create: `config.example.json`
- Create: `scripts/check-forbidden-files.mjs`
- Modify: `package.json`
- Remove from index only: `config.json`, `x2md.log`, `x2md.pid`, tracked `.DS_Store`

**Acceptance:**
- [x] 本地原文件仍存在，但 `git ls-files` 不再命中禁止文件。
- [x] example config 不含真实用户名、绝对个人路径或 token。
- [x] 检查脚本会拒绝 config/log/pid/DS_Store 和常见 secret 文件。
- [x] 文档明确历史净化需要人工另行批准。

**Verify:**
```bash
npm run check:forbidden-files
git ls-files | rg '(^|/)(config\.json|x2md\.log|x2md\.pid|\.DS_Store)$' && exit 1 || true
npm run check
```

**Commit:** `chore: remove local runtime files from git`

## T02：Release 二进制退出 Git

**Codex task:** 停止在 `release/` 中跟踪 zip、dmg、zst、update artifact 和 checksum 生成物；保留每版本 `RELEASE_NOTES.md`。调整忽略规则和发布脚本，使二进制只生成到临时输出目录并由 CI 上传。不要删除 GitHub Release，也不要改写历史。

**Dependencies:** T01

**Files:**
- Modify: `.gitignore`
- Modify: `scripts/package-release.mjs`
- Modify: `scripts/check-release-artifacts.mjs`
- Modify: `BUILD.md`
- Remove from index: `release/**/*.{zip,dmg,zst,json,txt}` 中的生成产物

**Acceptance:**
- [x] `release/` 只保留 release notes 或人工维护文本。
- [x] 本地打包默认输出到 `artifacts/` 或显式临时目录。
- [x] artifact 校验接受显式目录参数，不依赖 Git tracked binary。
- [x] 同版本已存在输出时脚本拒绝静默覆盖。

**Verify:**
```bash
node scripts/package-release.mjs --help
npm run check:release-artifacts -- --help
git ls-files release | rg '\.(zip|dmg|zst)$' && exit 1 || true
npm run check
```

**Commit:** `chore: move release binaries out of git`

## T03：版本与下载文档单一真源

**Codex task:** 将 `package.json` 设为唯一版本真源；为同步脚本增加 `--check` 模式，检查 App 常量、extension manifest、release metadata 和文档。README 下载链接改用 GitHub `releases/latest`，不硬编码具体版本。

**Dependencies:** T01

**Files:**
- Modify: `scripts/sync-extension-version.mjs`
- Modify: `package.json`
- Modify: `README.md`
- Modify: `app/core/config.ts`
- Test: `scripts/version-consistency.test.mjs`

**Acceptance:**
- [x] `npm run check:version` 只检查，不修改工作树。
- [x] `npm run sync:extension-version` 显式执行时才修改派生文件。
- [x] README 最新下载不包含 `v3.0.0` 等硬编码版本。
- [x] 构建前先同步/检查版本，不再先 build 后改源文件。

**Verify:**
```bash
npm run check:version
npm run sync:extension-version
git diff --exit-code
npm run check
```

**Commit:** `fix: enforce one release version source`

## T04：拆分 PR CI 与 Release Workflow

**Codex task:** 将当前 tag-only workflow 拆为 PR/main CI 和 tag release。PR CI 至少运行 forbidden-files、version check、`npm ci`、typecheck、全部测试和 dependency audit；release 依赖 CI 结果并运行真实 artifact smoke。删除或真正使用无效的 workflow version input。

**Dependencies:** T01, T02, T03

**Files:**
- Create: `.github/workflows/ci.yml`
- Modify: `.github/workflows/build.yml`
- Modify: `package.json`
- Create: `scripts/check-clean-release.mjs`

**Acceptance:**
- [x] pull_request 和 main push 都触发 CI。
- [x] tag release 不重复定义基础测试逻辑。
- [x] release 检查源码 clean、版本一致和 forbidden files。
- [x] 依赖安全检查失败会阻止合并或 release。

**Verify:**
```bash
npm run check:forbidden-files
npm run check:version
npm run check:clean-release
npm run check
```

**Commit:** `ci: add presubmit and release gates`

## T05：固定 9527 并移除无效端口配置

**Codex task:** 固定本地 endpoint 为 `127.0.0.1:9527`。移除 config/CLI/桌面设置/扩展 options 的用户端口覆盖；同步修改服务启动、background 调用和 manifest host permission。保留端口占用诊断，但不允许通过改端口绕过。Phase 2 的 T18 再把所有调用收敛到 Local Client。

**Dependencies:** T03

**Files:**
- Modify: `app/core/config.ts`
- Modify: `app/main/index.ts`
- Modify: `app/main/http-server.ts`
- Modify: `app/ui/settings/index.html`
- Modify: `app/ui/settings/settings.ts`
- Modify: `extension/options.html`
- Modify: `extension/options.js`
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] 两套 UI 均不再显示端口输入框。
- [x] 旧 config 中 `port` 被 migration 忽略或归一为 9527。
- [x] `--port` 不再改变正式服务端口；测试临时端口只通过测试专用注入使用。
- [x] background 与 manifest 都明确使用 9527。
- [x] 端口占用仍返回明确错误。
- [x] 测试证明设置端口不会产生伪配置。

**Verify:**
```bash
rg 'type="number".*port|portInput|id="port"' app/ui/settings extension/options.* && exit 1 || true
node --test app/tests/api.test.ts app/tests/core.test.ts
npm run check
```

**Commit:** `fix: use one fixed local service endpoint`

## T06：Pairing 与全路由 capability token

**Codex task:** 实现持久 install secret、一次性 pairing code、扩展 token 和 App settings session credential。新增 `/pair`，让扩展完成一次配对后把 token 存入 `chrome.storage.local`；桌面打开设置窗口时签发短期 session credential并注入页面，设置页所有请求携带它。除 `/ping` 与有效 `/pair` 外，所有敏感 API 必须校验 credential；`/config` 不返回 secret/token。

**Dependencies:** T05

**Files:**
- Modify: `app/core/config.ts`
- Modify: `app/main/http-server.ts`
- Create: `app/core/pairing.ts`
- Modify: `app/main/desktop.ts`
- Modify: `app/ui/settings/settings.ts`
- Modify: `extension/background.js`
- Test: `app/tests/api.test.ts`
- Test: `app/tests/core.test.ts`
- Create: `extension/tests/pairing.test.js`

**Acceptance:**
- [x] 新安装生成并持久化 secret，不会每次读取变化。
- [x] pairing code 单次使用、短时有效、使用后失效。
- [x] App session credential 短时有效，只在设置窗口运行时注入，不写入持久配置。
- [x] 所有 config/save/history/log/open/autostart/profile 路由统一鉴权。
- [x] `/config` 响应不含 `local_api_token` 或 install secret。
- [x] 扩展配对后可正常保存。
- [x] 设置页在全路由鉴权开启后仍可读写配置、日志和桌面动作。

**Verify:**
```bash
node --test app/tests/api.test.ts app/tests/core.test.ts extension/tests/pairing.test.js
npm run check
```

**Commit:** `feat: require paired local api access`

## T07：收紧 Origin/CORS 与 Abuse Matrix

**Codex task:** 移除 `Access-Control-Allow-Origin: *`。只允许 App session、已配对扩展和必要的 loopback 调试来源；拒绝普通网页、`Origin: null`、任意未认证扩展和伪造 localhost Origin。OPTIONS 必须只返回实际允许的 headers/methods，并设置 `Vary: Origin`。

**Dependencies:** T06

**Files:**
- Modify: `app/main/http-server.ts`
- Create: `app/main/request-policy.ts`
- Test: `app/tests/api-security.test.ts`
- Modify: `app/tests/api.test.ts`

**Acceptance:**
- [x] 普通网页只能访问公开 `/ping`。
- [x] `Origin: null` 和无凭据请求不能访问敏感 API。
- [x] 任意 chrome extension 没有有效 token 时被拒绝。
- [x] 合法扩展请求有精确 CORS 响应，不使用 wildcard。

**Verify:**
```bash
node --test app/tests/api-security.test.ts app/tests/api.test.ts
rg 'Access-Control-Allow-Origin.*\*' app/main && exit 1 || true
npm run check
```

**Commit:** `fix: restrict local api origins`

## T08：冻结 Python Legacy 与重定义 Windows 支持

**Codex task:** 停止 stable workflow 构建 Python Windows 包；将 Python 文件标记为冻结兼容实现，不再宣称与 v4 parity。README 和 BUILD 明确 Mac stable、Windows beta。新增能力矩阵，列出 Windows beta 必须通过的 TypeScript artifact gate。

**Dependencies:** T04

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `README.md`
- Modify: `BUILD.md`
- Create: `docs/platform-support.md`
- Modify: `server.py`

**Acceptance:**
- [x] stable release 不再上传 `X2MD_Windows.zip` Python legacy。
- [x] 文档不再要求不存在或不一致的 `X2MD.exe`/Lite 包。
- [x] Python 文件顶部明确 frozen/EOL 范围。
- [x] Windows 恢复 stable 的条件是 TS artifact 的真实 smoke，而不是 zip 存在。

**Verify:**
```bash
rg 'build-windows-legacy|X2MD_Windows\.zip' .github README.md BUILD.md && exit 1 || true
npm run check
```

**Commit:** `docs: freeze python legacy release path`

---

# Phase 1 — Reliable Save Core

## T09：定义 CaptureDocumentV1、SaveResultV1 和错误码

**Codex task:** 新增版本化保存契约。定义 TypeScript 类型、扩展侧纯 JS normalizer、稳定错误码和脱敏 fixture。类型应覆盖现有 Tweet/Thread/Article/多站点 payload，但不包含 cookie 或鉴权数据。

**Dependencies:** T06, T07

**Files:**
- Create: `app/core/contracts.ts`
- Create: `extension/capture_contract.js`
- Create: `app/tests/contracts.test.ts`
- Create: `extension/tests/capture_contract.test.js`
- Create: `app/tests/fixtures/capture-document-v1.json`

**Acceptance:**
- [x] `schema_version: 1` 是必填字段。
- [x] canonical URL、source ID、content、media、relations、preferences 定义明确。
- [x] SaveResult 包含 outcome、files、media、warnings 和稳定 error。
- [x] fixture 不含 cookie/token/个人路径。

**Verify:**
```bash
node --test app/tests/contracts.test.ts extension/tests/capture_contract.test.js
npm run check
```

**Commit:** `feat: define versioned capture contracts`

## T10：旧 Payload Normalizer 与请求限制

**Codex task:** 在 HTTP 边界把当前旧 payload 转为 CaptureDocumentV1；新旧请求最终进入同一 Save Engine。增加 5 MiB body cap、媒体/数组/正文长度限制和清晰 `INVALID_CAPTURE`/`PAYLOAD_TOO_LARGE` 响应。

**Dependencies:** T09

**Files:**
- Create: `app/core/legacy-capture.ts`
- Modify: `app/main/http-server.ts`
- Modify: `app/core/contracts.ts`
- Create: `app/tests/capture-boundary.test.ts`

**Acceptance:**
- [x] 当前扩展 payload 的 golden 输出不变。
- [x] 超大请求在完整缓冲前终止。
- [x] 媒体数量、字符串长度和嵌套深度有限制。
- [x] 无效请求不创建目录、文件或历史记录。

**Verify:**
```bash
node --test app/tests/capture-boundary.test.ts app/tests/fixtures.test.ts
npm run check
```

**Commit:** `feat: validate capture requests at the boundary`

## T11：统一原子 State Store

**Codex task:** 新增 State Store，统一 config、history、save index、profile state 和未来 job state 的读写策略。按 namespace 使用 promise mutex；写入临时文件后原子 rename；发现坏 JSON 时备份原文件并返回明确错误。

**Dependencies:** T09

**Files:**
- Create: `app/core/state-store.ts`
- Create: `app/tests/state-store.test.ts`
- Modify: `app/core/config.ts`
- Modify: `app/core/save.ts`
- Modify: `app/core/profile-capture.ts`

**Acceptance:**
- [x] 同 namespace 并发更新不会丢数据。
- [x] 正式状态文件不会出现半写 JSON。
- [x] 损坏文件被保留为备份，不被静默覆盖。
- [x] config/history/profile 现有行为保持兼容。

**Verify:**
```bash
node --test app/tests/state-store.test.ts app/tests/core.test.ts app/tests/api.test.ts
npm run check
```

**Commit:** `refactor: centralize atomic state storage`

## T12：保存事务 Journal、No-Clobber 输出与并发保存

**Codex task:** 新增 Save Transaction/Output Store。内容先写入目标目录内的唯一临时文件并 flush；优先用同目录 hard-link publish 原子发布且遇到 EEXIST 选择新候选名。对不支持 hard link 的文件系统，使用 exclusive create/copy，并由 journal 在中断后删除未到 markdown_committed 的目标。禁止先创建空正式占位再 rename 覆盖。journal 记录 prepared/media_committed/markdown_committed/state_committed，并在启动时 reconciliation，替换当前 `existsSync + timestamp` 逻辑。

**Dependencies:** T10, T11

**Files:**
- Create: `app/core/output-store.ts`
- Create: `app/core/save-transaction.ts`
- Modify: `app/core/save.ts`
- Create: `app/tests/output-store.test.ts`
- Create: `app/tests/save-transaction.test.ts`
- Modify: `app/tests/api.test.ts`

**Acceptance:**
- [x] no-clobber commit 在 macOS、Linux 和 Windows 语义下都不覆盖已存在目标；实现不得依赖覆盖空占位的 rename。
- [x] 20 个不同 capture key、相同标题并发保存产生 20 个不同文件。
- [x] 任一文件内容都完整且不是空占位。
- [x] 写入失败不残留 `.part` 或空正式文件。
- [x] 返回文件顺序与 save paths 顺序一致。
- [x] 在每个 journal stage 注入中断后，reconciliation 可完成 state commit 或清理未提交文件，不留下孤立索引。

**Verify:**
```bash
node --test app/tests/output-store.test.ts app/tests/save-transaction.test.ts app/tests/api.test.ts
npm run check
```

**Commit:** `fix: make markdown writes atomic`

## T13：Save Index 与 Duplicate Policy

**Codex task:** 建立基于 `platform + source_id` 或 canonical URL hash 的 save index。实现 `skip`、`update`、`always_new`；默认 `skip`。索引只在正式文件成功提交后更新，update 只操作索引关联的 X2MD 文件。

**Dependencies:** T11, T12

**Files:**
- Create: `app/core/save-index.ts`
- Modify: `app/core/save.ts`
- Modify: `app/core/config.ts`
- Create: `app/tests/save-index.test.ts`
- Modify: `app/tests/api.test.ts`

**Acceptance:**
- [x] 同一 status URL 二次保存默认返回 `outcome: skipped`。
- [x] 20 个相同 capture key 并发进入时，去重临界区只允许 1 个 saved，其余 19 个 skipped。
- [x] update 更新原索引文件，不根据标题猜测。
- [x] always_new 生成唯一新文件并更新最新记录。
- [x] 写盘失败不产生索引记录。

**Verify:**
```bash
node --test app/tests/save-index.test.ts app/tests/api.test.ts
npm run check
```

**Commit:** `feat: add canonical capture deduplication`

## T14：安全媒体下载器

**Codex task:** 新增通用安全下载器，限制协议、地址、redirect、超时、最大 bytes 和 content type；使用流式写入 `.part` 再原子 rename。解析 hostname 后拒绝 loopback/private/link-local/reserved 地址，并让实际连接使用已验证地址；每次 redirect 重新解析和验证，避免 DNS rebinding/redirect 绕过。

**Dependencies:** T10, T12

**Files:**
- Create: `app/core/safe-download.ts`
- Create: `app/tests/safe-download.test.ts`
- Modify: `app/core/media.ts`
- Modify: `app/core/save.ts`

**Acceptance:**
- [x] 私网和危险 redirect 被拒绝。
- [x] DNS 校验与实际连接绑定，每次 redirect 重新验证目标。
- [x] 超时、超限和错误类型不会留下正式文件。
- [x] 成功下载只在完整写入后出现最终文件。
- [x] 调用方得到稳定 error/warning code。

**Verify:**
```bash
node --test app/tests/safe-download.test.ts
npm run check
```

**Commit:** `fix: harden local media downloads`

## T15：图片有限并发与多目录附件语义

**Codex task:** 将图片本地化拆为独立模块，固定并发 4、保持输入顺序、失败回退远程 URL。每个 Markdown 保存目录分别拥有有效相对附件；补齐 X 图片本地化，不再对 Twitter payload 直接跳过。

**Dependencies:** T12, T14

**Files:**
- Create: `app/core/image-localizer.ts`
- Modify: `app/core/save.ts`
- Modify: `app/core/markdown.ts`
- Create: `app/tests/image-localizer.test.ts`
- Modify: `app/tests/api.test.ts`

**Acceptance:**
- [x] 4 个受控延迟图片的总耗时接近一批而非串行总和。
- [x] 图片顺序不变，单图失败不阻止保存。
- [x] X 和非 X 均遵守用户图片策略。
- [x] 两个 save paths 中的相对附件引用都有效。

**Verify:**
```bash
node --test app/tests/image-localizer.test.ts app/tests/api.test.ts
npm run check
```

**Commit:** `feat: localize images with bounded concurrency`

## T16：视频下载移出 Markdown 渲染副作用

**Codex task:** 让 `buildMarkdown()` 变为纯渲染函数，不再启动视频下载。新增媒体计划阶段，先确定视频结果再生成最终 Markdown；单条和 Profile 使用同一策略。失败必须反映在 SaveResult outcome/warnings 中。

**Dependencies:** T14, T15

**Files:**
- Create: `app/core/media-plan.ts`
- Modify: `app/core/markdown.ts`
- Modify: `app/core/save.ts`
- Modify: `app/core/profile-capture.ts`
- Modify: `app/tests/core.test.ts`

**Acceptance:**
- [x] 调用 `buildMarkdown()` 不产生文件或网络副作用。
- [x] 视频完成后才写入本地嵌入；失败保留远程链接和 warning。
- [x] Profile 与单条保存的 enable/disable 行为一致。
- [x] HTTP 不再把后续必然失败的视频报告为完整成功。

**Verify:**
```bash
node --test app/tests/core.test.ts app/tests/api.test.ts
npm run check
```

**Commit:** `refactor: separate media work from markdown rendering`

## T17：保存阶段指标与脱敏诊断

**Codex task:** 为 Save Engine 记录 validate/dedupe/media/render/write 时长、媒体数量、目标目录数量、outcome 和稳定错误码。默认不记录正文、token、cookie、完整个人路径或完整媒体 URL。

**Dependencies:** T13, T15, T16

**Files:**
- Create: `app/core/save-metrics.ts`
- Modify: `app/core/save.ts`
- Modify: `app/main/logger.ts`
- Create: `app/tests/save-metrics.test.ts`

**Acceptance:**
- [x] 每次保存有一条结构化、脱敏的阶段摘要。
- [x] 日志不含请求正文和鉴权数据。
- [x] 指标开关默认适合普通用户，不增加大量噪声。
- [x] 测试覆盖敏感字段过滤。

**Verify:**
```bash
node --test app/tests/save-metrics.test.ts
npm run check
```

**Commit:** `feat: add sanitized save pipeline metrics`

---

# Phase 2 — Capture Modules and Core UX

## T18：建立扩展 Local Client

**Codex task:** 新增扩展 Local Client，集中固定 endpoint、pairing token、headers、timeout、retry、JSON 解析和 SaveResult 错误映射。background、popup 和 options 不再直接 fetch 本地 API。

**Dependencies:** T06, T07, T09

**Files:**
- Create: `extension/local_client.js`
- Create: `extension/tests/local_client.test.js`
- Modify: `extension/manifest.json`
- Modify: `extension/background.js`
- Modify: `extension/popup.js`
- Modify: `extension/options.js`

**Acceptance:**
- [x] 只有 Local Client 包含 `127.0.0.1:9527`。
- [x] token 从 `chrome.storage.local` 读取并发送。
- [x] timeout/offline/auth/error codes 映射一致。
- [x] background、popup 和 options 不再直接调用本地 fetch。
- [x] manifest 加载顺序正确。

**Verify:**
```bash
node --test extension/tests/local_client.test.js extension/tests/popup.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `refactor: centralize extension local api access`

## T19：修复 Bookmark/RemoveBookmark 语义

**Codex task:** 修改 X 书签按钮监听，只在新增 bookmark 时触发保存。removeBookmark 不保存；按钮状态更新必须兼容 X 动态 DOM。为状态判定和监听行为增加纯函数/消息测试。

**Dependencies:** T18

**Files:**
- Modify: `extension/content.js`
- Create: `extension/bookmark_semantics.js`
- Create: `extension/tests/bookmark_semantics.test.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] 新增书签触发一次保存。
- [x] 取消书签触发零次保存。
- [x] 重复 DOM bind 不产生多次消息。
- [x] 自定义保存菜单仍正常。

**Verify:**
```bash
node --test extension/tests/bookmark_semantics.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `fix: save only on new x bookmarks`

## T20：提取 Capture UI

**Codex task:** 把 toast、长视频 modal、保存结果动作和按钮状态提取到独立模块。替换 `window.confirm`，实现 Esc、focus trap、键盘操作和会话级选择记忆。Capture Flow 在当前页面内保留最后一次失败的 CaptureDocument/回调；当 SaveResult.error.retryable 为 true 时显示“重试”，重试成功或页面卸载后清除内存数据，不写入 history。

**Dependencies:** T18

**Files:**
- Create: `extension/capture_ui.js`
- Create: `extension/tests/capture_ui.test.js`
- Modify: `extension/content.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] `rg 'window\.confirm|confirm\(' extension` 不命中主流程。
- [x] modal 可通过键盘完成或关闭。
- [x] SaveResult 的 saved/skipped/partial/failed 显示不同状态。
- [x] 成功结果可触发复制路径、显示文件或 Obsidian action 消息。
- [x] retryable 失败在当前页面可重试，非 retryable 失败不显示无效动作。
- [x] 内存重试不会把 CaptureDocument 正文写入 storage、history 或日志。

**Verify:**
```bash
rg 'window\.confirm|confirm\(' extension && exit 1 || true
node --test extension/tests/capture_ui.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `feat: add accessible capture result ui`

## T21：拆分 X 单条 Capture Adapter

**Codex task:** 将 X 单条 DOM 提取移动到 `site-adapters/x-capture.js`，只返回 CaptureDocumentV1 初始数据。不要在 Adapter 内调用 GraphQL、本地 API或操作 toast。保持 Tweet/Article/Quote/thread DOM golden 行为。

**Dependencies:** T09, T20

**Files:**
- Create: `extension/site-adapters/x-capture.js`
- Create: `extension/tests/x-capture.test.js`
- Modify: `extension/content.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] Adapter interface 只有 capture/normalize 所需入口。
- [x] DOM 提取不依赖 background 或 Local Client。
- [x] 当前单条保存 payload 经 normalizer 后保持兼容。
- [x] content.js 删除被迁移实现，不保留复制分支。

**Verify:**
```bash
node --test extension/tests/x-capture.test.js extension/tests/article_markdown.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `refactor: extract x capture adapter`

## T22：拆分 X Enrichment 与 GraphQL 编排

**Codex task:** 将 TweetDetail、TweetResultByRestId、Article、Poll、Community Notes、link card、Quote/Retweet 和错误降级编排移到 `x-enrichment.js`。background 只调用一个 enrich interface。

**Dependencies:** T21

**Files:**
- Create: `extension/x-enrichment.js`
- Create: `extension/tests/x-enrichment.test.js`
- Modify: `extension/background.js`
- Modify: `extension/twitter_graphql.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] background 不再包含大段 X 结果拼装逻辑。
- [x] GraphQL/oEmbed/DOM fallback 顺序有契约测试。
- [x] 稳定错误码贯穿 SaveResult/UI。
- [x] Poll/Notes/card/quote 现有测试保持通过。

**Verify:**
```bash
node --test extension/tests/x-enrichment.test.js extension/tests/twitter_graphql.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `refactor: isolate x enrichment flow`

## T23：拆分 X 翻译与复制流程

**Codex task:** 将 inline translation、Article translation、copy HTML/plain text 和 translation override 编排从 content 入口迁到 `x-translation-ui.js`。保留现有 translation helpers 和测试契约。

**Dependencies:** T20, T21

**Files:**
- Create: `extension/x-translation-ui.js`
- Create: `extension/tests/x-translation-ui.test.js`
- Modify: `extension/content.js`
- Modify: `extension/translation_helpers.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] content 入口不再包含具体翻译 DOM 算法。
- [x] Tweet/Article/Quote 的译文切换和复制行为不变。
- [x] translation override 仍能进入 CaptureDocument。
- [x] 迁移代码被删除而非双份保留。

**Verify:**
```bash
node --test extension/tests/x-translation-ui.test.js extension/tests/translation_helpers.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `refactor: isolate x translation and copy ui`

## T24：拆分 X Bookmarks/Profile 采集入口

**Codex task:** 把 Bookmarks toolbar、Profile menu、范围选择和 item 收集迁到 `x-batch-capture.js`。此任务只迁 UI 和采集，不实现持久 Job Engine；保持现有消息协议。

**Dependencies:** T20, T21

**Files:**
- Create: `extension/x-batch-capture.js`
- Create: `extension/tests/x-batch-capture.test.js`
- Modify: `extension/content.js`
- Modify: `extension/site_actions.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] Bookmarks/Profile UI 和范围收集行为不变。
- [x] content 入口不再包含批量工具条和 Profile 菜单实现。
- [x] 暂停/取消/重试现有内存行为保持。
- [x] 纯收集函数有测试。

**Verify:**
```bash
node --test extension/tests/x-batch-capture.test.js extension/tests/site_actions.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `refactor: extract x batch capture ui`

## T25：迁移 LINUX DO、飞书、微信 Adapter

**Codex task:** 为 LINUX DO、飞书和微信增加统一 Capture Adapter wrapper，输出 CaptureDocumentV1；复用已有提取纯函数。content 只做站点检测和调用，不再手工拼装三种 payload。

**Dependencies:** T09, T21

**Files:**
- Create: `extension/site-adapters/web-capture.js`
- Modify: `extension/content.js`
- Modify: `extension/discourse.js`
- Modify: `extension/feishu.js`
- Modify: `extension/wechat.js`
- Create: `extension/tests/web-capture.test.js`

**Acceptance:**
- [x] 三站点都输出 schema_version 1。
- [x] 现有 URL 清理、正文、代码块和图片规则不变。
- [x] 站点特有逻辑仍局限在各自文件。
- [x] app golden Markdown 输出不变。

**Verify:**
```bash
node --test extension/tests/web-capture.test.js extension/tests/discourse.test.js extension/tests/feishu.test.js extension/tests/wechat.test.js app/tests/fixtures.test.ts
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `refactor: normalize non-x capture adapters`

## T26：收敛 Content/Background 入口和消息编排测试

**Codex task:** 将 content/background 收敛为启动、站点挂载和消息分发。把消息路由提取为可在 Node 测试的纯 dispatcher；新增测试覆盖 capture → enrich → local save 和 batch message 路径。

**Dependencies:** T22, T23, T24, T25

**Files:**
- Create: `extension/message_dispatcher.js`
- Create: `extension/tests/message_dispatcher.test.js`
- Modify: `extension/content.js`
- Modify: `extension/background.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] 两个入口不再承载可独立测试的业务实现。
- [x] 单条保存、翻译、复制、配置和批量消息均有 dispatcher 测试。
- [x] 未知消息返回稳定错误而非静默挂起。
- [x] Chrome service worker 加载 smoke 通过。

**Verify:**
```bash
node --test extension/tests/message_dispatcher.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `refactor: reduce extension entrypoints to dispatchers`

---

# Phase 3 — Knowledge Inbox UX

## T27：配置 Schema Version 与显式 Migrations

**Codex task:** 将宽松 `Record<string, unknown>` 配置迁为版本化 schema。新增 `config_version` 和逐版本 migration，清理已废弃的 platform folders、旧 overwrite、无效 port 等键。未知键不再永久透传。

**Dependencies:** T05, T11, T13

**Files:**
- Create: `app/core/config-schema.ts`
- Create: `app/core/config-migrations.ts`
- Modify: `app/core/config.ts`
- Create: `app/tests/config-migrations.test.ts`

**Acceptance:**
- [x] 当前历史配置 fixture 可无损迁移核心字段。
- [x] 废弃键被明确移除。
- [x] secret 字段不会由公共 config response 返回。
- [x] 无效字段返回默认值并产生 migration warning。

**Verify:**
```bash
node --test app/tests/config-migrations.test.ts app/tests/core.test.ts
npm run check
```

**Commit:** `refactor: version the x2md config schema`

## T28：扩展 Options 降级为连接与配对页

**Codex task:** 删除扩展 options 中重复的完整设置表单，只保留 App 在线状态、扩展/App 版本、pairing、打开桌面设置、打开诊断文档。所有业务配置在桌面 App 修改。

**Dependencies:** T18, T27

**Files:**
- Modify: `extension/options.html`
- Modify: `extension/options.js`
- Create: `extension/tests/options.test.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] options 不再编辑保存路径、媒体、Profile 或文件名配置。
- [x] 未配对时有明确 pairing 流程。
- [x] 已配对时可打开桌面设置。
- [x] 版本不兼容有升级提示。

**Verify:**
```bash
node --test extension/tests/options.test.js
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `refactor: make desktop app the settings authority`

## T29：桌面设置开放 Tags 与 Front Matter

**Codex task:** 在桌面设置增加“整理规则”面板，正式配置默认 tags、路径/关键词/作者/平台规则、Front Matter preset 和 custom template。使用现有 config/schema，不在 UI 内重新实现规则逻辑。

**Dependencies:** T27

**Files:**
- Modify: `app/ui/settings/index.html`
- Modify: `app/ui/settings/settings.ts`
- Modify: `app/ui/settings/styles.css`
- Modify: `app/tests/core.test.ts`

**Acceptance:**
- [x] 所有后端已有 tags/FM 字段可在 UI 读取和保存。
- [x] custom template 显示允许变量和预览。
- [x] 无效规则不能保存并有明确提示。
- [x] 设置重开后字段保持一致。

**Verify:**
```bash
node --test app/tests/core.test.ts app/tests/api.test.ts
npm run check
```

**Commit:** `feat: expose knowledge organization settings`

## T30：桌面设置开放去重、图片和视频策略

**Codex task:** 在桌面设置增加 duplicate policy、图片本地化、附件路径、嵌入格式和统一视频策略。隐藏危险或已经移除的旧配置；提供清晰默认值和磁盘影响说明。

**Dependencies:** T13, T15, T16, T27, T29

**Files:**
- Modify: `app/ui/settings/index.html`
- Modify: `app/ui/settings/settings.ts`
- Modify: `app/ui/settings/styles.css`
- Modify: `app/tests/core.test.ts`

**Acceptance:**
- [x] skip/update/always_new 可配置，默认 skip。
- [x] X 图片本地化可配置并有附件预览。
- [x] Profile 与单条视频策略只显示一个权威配置。
- [x] 设置保存后 `/config` 返回正确非敏感字段。

**Verify:**
```bash
node --test app/tests/core.test.ts app/tests/api.test.ts
npm run check
```

**Commit:** `feat: expose dedupe and media policies`

## T31：保存历史与安全文件动作

**Codex task:** 将历史扩展为带稳定 ID 的最近 50 条成功/部分成功记录。新增按 history ID 执行的安全动作：打开 Obsidian、显示文件、返回可复制路径数据、打开原文；禁止客户端提交任意本机路径执行 open。普通失败不持久化正文，因此跨重启重试只由 Job Engine 提供。

**Dependencies:** T11, T13, T18

**Files:**
- Modify: `app/core/save.ts`
- Modify: `app/main/http-server.ts`
- Modify: `app/main/desktop.ts`
- Modify: `extension/popup.js`
- Test: `app/tests/api.test.ts`

**Acceptance:**
- [x] history 不记录正文或 secret。
- [x] open/show 动作只接受服务端已知 history ID。
- [x] deleted/moved file 返回明确错误。
- [x] popup 和 Capture UI 可使用返回动作。
- [x] history 不宣称能够重放没有持久 payload 的普通失败。

**Verify:**
```bash
node --test app/tests/api.test.ts extension/tests/popup.test.js
npm run check
```

**Commit:** `feat: add safe actions to save history`

## T32：Setup Doctor 首次激活流程

**Codex task:** 在桌面设置中增加首次激活面板，按顺序检查运行版本、端口冲突、目录权限、扩展配对、扩展版本和样例保存。每步可重试，并持久化完成状态。

**Dependencies:** T06, T28, T30, T31

**Files:**
- Modify: `app/ui/settings/index.html`
- Modify: `app/ui/settings/settings.ts`
- Modify: `app/ui/settings/styles.css`
- Modify: `app/main/http-server.ts`
- Modify: `app/tests/api.test.ts`
- Modify: `scripts/smoke-packaged-mac.mjs`

**Acceptance:**
- [x] 新 config 默认进入 Setup Doctor。
- [x] 样例保存使用真实 Save Engine，但不需要外网。
- [x] 成功后可显示文件或在 Obsidian 打开。
- [x] 任一步失败不会清除已完成步骤。
- [x] packaged first-run smoke 真实覆盖 session credential、样例保存和打开结果 dry-run。

**Verify:**
```bash
node --test app/tests/api.test.ts app/tests/core.test.ts
bun run build:mac
npm run smoke:mac:first-run
npm run check
```

**Commit:** `feat: add first-run setup doctor`

## T33：脱敏诊断包与连接修复页

**Codex task:** 新增诊断导出，包含版本、平台、配对状态、最近稳定错误码、配置字段名和阶段指标，不包含正文、token、cookie、完整个人路径或完整媒体 URL。设置页提供生成与显示导出位置。

**Dependencies:** T17, T27, T32

**Files:**
- Create: `app/core/diagnostics.ts`
- Modify: `app/main/http-server.ts`
- Modify: `app/ui/settings/settings.ts`
- Create: `app/tests/diagnostics.test.ts`
- Modify: `app/ui/settings/index.html`

**Acceptance:**
- [x] 诊断包内容有 allowlist，不是删除式黑名单。
- [x] 测试注入 token/正文/路径后导出不泄露。
- [x] 包含 repo/App/extension/live version 和连接状态。
- [x] 用户能打开导出文件所在位置。

**Verify:**
```bash
node --test app/tests/diagnostics.test.ts
npm run check
```

**Commit:** `feat: export sanitized diagnostics`

---

# Phase 4 — Persistent Job Center

## T34：Job State Machine 与持久存储

**Codex task:** 定义 Job/JobItem 类型和状态机，使用 State Store 持久化。item 支持 pending/leased/saved/updated/skipped/failed，并包含 lease_owner、lease_expires_at、attempt、idempotency_key。实现 create、claim、renew、complete、fail、reclaim expired、pause、resume、cancel、retry failed；非法转换必须拒绝。

**Dependencies:** T11, T13

**Files:**
- Create: `app/core/jobs.ts`
- Create: `app/core/job-store.ts`
- Create: `app/tests/jobs.test.ts`
- Modify: `app/core/contracts.ts`

**Acceptance:**
- [x] 所有状态转换有测试。
- [x] 每个 item 状态独立持久化。
- [x] 重启读取后可继续 pending item。
- [x] completed/skipped item 不会再次 claim。
- [x] 过期 lease 可回收，旧 worker 的迟到 complete 不会覆盖新 attempt。
- [x] complete/fail 使用 idempotency key，重复提交结果一致。

**Verify:**
```bash
node --test app/tests/jobs.test.ts
npm run check
```

**Commit:** `feat: add persistent capture job state machine`

## T35：Job API 与任务控制

**Codex task:** 新增鉴权 Job API：创建、列表、详情、暂停、继续、取消、只重试失败，以及 worker 使用的 claim、renew、complete、fail。HTTP handler 只做协议适配，状态转换调用 Job Engine；返回稳定 JobResult。

**Dependencies:** T34

**Files:**
- Create: `app/main/job-routes.ts`
- Modify: `app/main/http-server.ts`
- Create: `app/tests/job-api.test.ts`
- Modify: `app/core/contracts.ts`

**Acceptance:**
- [x] 所有路由需要配对凭据。
- [x] 非法状态转换返回 409 和稳定错误码。
- [x] 列表不返回 item 正文或敏感 payload。
- [x] 重试只重置 failed item。
- [x] worker endpoint 验证 lease owner、attempt 和 idempotency key。
- [x] lease 过期后旧 worker 无法提交覆盖新结果。

**Verify:**
```bash
node --test app/tests/job-api.test.ts app/tests/api-security.test.ts
npm run check
```

**Commit:** `feat: expose authenticated capture job controls`

## T36：Bookmarks 任务接入 Job Engine

**Codex task:** 将 Bookmarks 导出从扩展内存循环改为创建持久 job。页面负责收集 URL/状态 ID 和显示控制；extension service worker 通过 claim/renew/complete/fail 执行 enrichment/save，并使用 `chrome.alarms` 在 MV3 worker 被挂起后继续。支持当前已加载和继续加载到用户上限。

**Dependencies:** T24, T35

**Files:**
- Modify: `extension/x-batch-capture.js`
- Create: `extension/job_client.js`
- Modify: `extension/background.js`
- Create: `extension/tests/bookmarks_job.test.js`
- Modify: `extension/manifest.json`

**Acceptance:**
- [x] 创建任务后页面关闭不丢 job 状态。
- [x] manifest 声明 alarms 权限，background 注册可重复安全的唤醒处理。
- [x] 默认单并发并带抖动。
- [x] rate limit 自动暂停并显示原因。
- [x] 已保存/已跳过 item 不重复执行。

**Verify:**
```bash
node --test extension/tests/bookmarks_job.test.js app/tests/job-api.test.ts
npm run smoke:chrome-extension-load
npm run check
```

**Commit:** `feat: persist bookmarks export jobs`

## T37：Profile/Articles 任务接入 Job Engine

**Codex task:** 将 Profile Posts/Articles 批量保存迁到同一 Job Engine。保留范围和按日聚合输出，但去重、媒体策略、错误码和 checkpoint 使用统一实现；逐步替代独立 profile state。

**Dependencies:** T24, T35, T36

**Files:**
- Modify: `extension/x-batch-capture.js`
- Modify: `extension/background.js`
- Modify: `app/core/profile-capture.ts`
- Create: `app/tests/profile-jobs.test.ts`
- Modify: `app/tests/fixtures.test.ts`

**Acceptance:**
- [x] Posts/Articles 任务均可恢复。
- [x] 视频和去重策略与单条保存一致。
- [x] 旧 profile state 可迁移或只读导入。
- [x] 日聚合 Markdown golden 保持兼容。

**Verify:**
```bash
node --test app/tests/profile-jobs.test.ts app/tests/fixtures.test.ts
npm run check
```

**Commit:** `refactor: run profile capture through jobs`

## T38：任务中心 UI 与报告

**Codex task:** 在桌面设置新增任务中心，展示 queued/running/paused/completed/failed，提供暂停、继续、取消、重试失败和打开结果。扩展 toolbar 只显示当前任务摘要并链接桌面任务中心。

**Dependencies:** T35, T36, T37

**Files:**
- Modify: `app/ui/settings/index.html`
- Modify: `app/ui/settings/settings.ts`
- Modify: `app/ui/settings/styles.css`
- Modify: `extension/x-batch-capture.js`
- Modify: `app/tests/core.test.ts`

**Acceptance:**
- [x] UI 计数与 Job API item 状态一致。
- [x] 用户可复制失败摘要和错误码。
- [x] 完成任务可打开生成文件或目录。
- [x] 扩展页面关闭后桌面仍可查看任务。

**Verify:**
```bash
node --test app/tests/core.test.ts app/tests/job-api.test.ts
npm run check
```

**Commit:** `feat: add persistent capture job center`

## T39：重启恢复、Rate Limit 和失败重试测试

**Codex task:** 增加端到端 job 测试：处理中 App 重启、MV3 worker 挂起、alarm 唤醒、lease 过期回收、迟到 worker 提交、页面断开、rate limit 自动暂停、单项永久失败、只重试失败、取消后不再 claim。使用可控 fake enrichment/save adapter，不访问真实 X。

**Dependencies:** T36, T37, T38

**Files:**
- Create: `app/tests/job-recovery.test.ts`
- Create: `extension/tests/job-recovery.test.js`
- Modify: `app/core/jobs.ts`
- Modify: `extension/job_client.js`

**Acceptance:**
- [x] 重启后从最后 checkpoint 继续。
- [x] completed/skipped 项不会重复。
- [x] 过期 lease 被新 worker 回收，旧 attempt 的迟到提交被拒绝或幂等忽略。
- [x] alarm 唤醒后 worker 从持久 job 继续，而不是依赖页面内存。
- [x] rate limit 进入 paused 而不是 failed。
- [x] cancel 后无新 item 开始。

**Verify:**
```bash
node --test app/tests/job-recovery.test.ts extension/tests/job-recovery.test.js
npm run check
```

**Commit:** `test: cover persistent job recovery`

---

# Phase 5 — Release Confidence

## T40：Fixture Privacy、Coverage 与 Evidence Matrix

**Codex task:** 增加 fixture privacy scanner、测试 coverage 报告和 PRD requirement-evidence matrix。先设置可达到的整体门槛，再对 `app/core` 和新模块设置更高门槛；禁止 cookie、Authorization、ct0、token 和个人绝对路径进入 fixture。

**Dependencies:** T26, T39

**Files:**
- Create: `scripts/check-fixture-privacy.mjs`
- Create: `scripts/generate-evidence-matrix.mjs`
- Modify: `package.json`
- Create: `docs/acceptance/v4-evidence-matrix.md`
- Modify: `.github/workflows/ci.yml`

**Acceptance:**
- [x] 故意加入敏感 fixture 时 CI 失败。
- [x] coverage 报告在 CI 可查看并有门槛。
- [x] PRD 每个 acceptance criterion 指向测试、smoke 或人工 gate。
- [x] 未验证项明确为未完成，不自动勾选。

**Verify:**
```bash
npm run check:fixture-privacy
npm run test:coverage
npm run generate:evidence-matrix
npm run check
```

**Commit:** `test: add privacy and evidence gates`

## T41：Mac 真实 Artifact 全验收

**Codex task:** 让 Mac release workflow 对最终压缩包执行解压、启动、版本、pairing、`/ping`、`/save`、first-run、port-conflict、autostart、extension load、window/menu 和 release artifact 校验。禁止关键 smoke 被 skipped 后仍通过。

**Dependencies:** T32, T39, T40

**Files:**
- Modify: `.github/workflows/build.yml`
- Modify: `scripts/smoke-packaged-mac.mjs`
- Modify: `scripts/smoke-mac-startup-time.mjs`
- Modify: `scripts/check-release-artifacts.mjs`
- Modify: `BUILD.md`

**Acceptance:**
- [x] smoke 对最终 release zip 而不是中间 build 目录运行。
- [x] `/ping` 版本与 tag 一致。
- [x] pairing 后真实 `/save` 成功。
- [x] 关键 gate 无权限/环境不满足时明确失败或标记非 release job，不能静默 pass。

**Verify:**
```bash
bun run build:mac
npm run acceptance:mac:auto
npm run check:release-artifacts
```

**Commit:** `ci: validate final mac release artifacts`

## T42：实现 Mac 签名与 Notarization 流水线

**Codex task:** 为 release workflow 编写 Developer ID codesign、notarytool、staple 和验证步骤。所有 credential 只通过 GitHub Environment secrets 注入；本地无 secret 时只允许非 stable 构建。此任务交付 fail-closed 流水线代码和 dry-run/static tests，不负责提供真实凭据或批准 stable release。

**Dependencies:** T41

**Files:**
- Modify: `.github/workflows/build.yml`
- Create: `scripts/sign-and-notarize-mac.sh`
- Create: `scripts/sign-and-notarize-mac.test.mjs`
- Modify: `scripts/check-release-artifacts.mjs`
- Modify: `BUILD.md`

**Acceptance:**
- [x] workflow 明确执行 `codesign --verify --deep --strict`、notarytool submit/wait 和 `stapler validate`。
- [x] 缺少任一正式 credential 时 stable release job 失败，而不是降级为 unsigned。
- [x] shell 支持 dry-run，并可用 fake command runner 验证调用顺序和错误传播。
- [x] unsigned artifact 不能进入 stable GitHub Release job。

**Verify:**
```bash
bash -n scripts/sign-and-notarize-mac.sh
node --test scripts/sign-and-notarize-mac.test.mjs
npm run check
# 真实 notarization accepted/stapler evidence 由 H02 人工批准环境完成
```

**Commit:** `ci: sign and notarize mac releases`

## T43：Windows TypeScript Beta Artifact Spike 与 Smoke

**Codex task:** 在 `windows-latest` 构建一个只使用 TypeScript 核心的 beta artifact，必须包含可启动 runtime，不要求用户预装 Node。实现最小 `/ping + pairing + config + save + shutdown` smoke。若 Electrobun 不支持目标平台，使用 Bun compile 或等价轻量打包，但不得回退 Python 核心。

**Dependencies:** T08, T35, T40

**Files:**
- Create: `scripts/build-windows-beta.mjs`
- Create: `scripts/smoke-windows-beta.mjs`
- Modify: `.github/workflows/build.yml`
- Modify: `docs/platform-support.md`
- Modify: `app/main/autostart.ts`

**Acceptance:**
- [ ] artifact 不要求系统已安装 Node/Python。
- [ ] 使用同一 `app/core` 和相同版本常量。
- [ ] windows-latest 解压后真实保存 Markdown。
- [x] 不支持的 tray/settings/autostart 能力在矩阵中明确，而非虚假宣称。

**Verify:**
```bash
node scripts/build-windows-beta.mjs --help
node scripts/smoke-windows-beta.mjs --help
npm run check
# 完整验证在 windows-latest workflow 执行
```

**Commit:** `feat: add typescript windows beta artifact`

## T44：SBOM、Provenance、依赖锁与 Actions Pinning

**Codex task:** 发布使用 frozen dependency lock；固定 Python legacy 仅测试所需依赖；生成 SBOM 和 provenance；GitHub Actions 使用明确 commit SHA。release checksum 覆盖所有 artifact、SBOM 和 update metadata。

**Dependencies:** T04, T41, T43

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/build.yml`
- Modify: `package.json`
- Modify: `requirements.txt`
- Modify: `scripts/check-release-artifacts.mjs`

**Acceptance:**
- [x] CI 使用 frozen lock，依赖漂移会失败。
- [x] npm/Python audit 在 PR 和 release 执行。
- [ ] release 包含 SBOM/provenance。
- [x] Actions 不再只 pin major tag。

**Verify:**
```bash
npm ci
npm audit --audit-level=high
python3 -m pip install pip-audit
python3 -m pip_audit -r requirements.txt
npm run check
```

**Commit:** `ci: harden release provenance`

## T45：v4 候选文档、迁移说明与发布前总审计

**Codex task:** 在自动功能、测试和流水线代码完成后，更新 README、BUILD、平台支持、迁移说明和 release-candidate evidence matrix。逐条审计 PRD 第 13 节；只有权威证据存在时才勾选完成。真实 Developer ID/notary/staple 证据保持为 H02 待办，不能在本任务中伪装完成。

**Dependencies:** T40, T41, T42, T43, T44

**Files:**
- Modify: `README.md`
- Modify: `BUILD.md`
- Modify: `docs/platform-support.md`
- Create: `docs/migrations/x2md-v4.md`
- Modify: `docs/acceptance/v4-evidence-matrix.md`

**Acceptance:**
- [x] 用户安装和设置步骤与真实 artifact 一致。
- [x] Windows/Mac 支持边界准确。
- [x] 安全配对、重复策略、任务恢复和历史动作有用户说明。
- [x] PRD 所有 AC 都有测试、artifact 或明确人工验收证据。
- [x] 没有旧版本硬编码下载链接或未经证明的“已完成”。
- [x] evidence matrix 明确标记 H02 未完成时 stable 仍被阻塞。

**Verify:**
```bash
npm run check:forbidden-files
npm run check:version
npm run check:fixture-privacy
npm run generate:evidence-matrix
npm run check
npm run acceptance:mac:auto
npm run check:release-artifacts
```

**Commit:** `docs: finalize x2md v4 release guidance`

---

# Human-Approval-Only Follow-up

以下工作故意不作为普通 Codex 自动任务：

## H01：Git 历史净化

- 先确认远端公开范围和备份 refs。
- 使用 `git filter-repo` 移除历史中的 config/log/pid/发布二进制。
- 运行 secret scanner 和内容审计。
- 通知所有贡献者重新 clone/rebase。
- 只有仓库负责人明确批准后才能 force push。

## H02：正式签名与发布权限

- 前置：T42 与 T45 已完成。
- 配置 Apple Developer ID、notary credentials 和 GitHub Environment protection。
- 审核 release workflow 权限与 artifact provenance。
- 在受保护的正式环境运行 T42 流水线，保存 `codesign --verify`、notary accepted 和 `stapler validate` 证据。
- 将真实证据追加到 `docs/acceptance/v4-evidence-matrix.md`，完成最终 requirement audit。
- 由仓库负责人批准正式 stable release。
