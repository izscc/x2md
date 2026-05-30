# X2MD

把 X/Twitter、LINUX DO、飞书、微信公众号内容一键保存为 Obsidian 可用的 Markdown。

[![GitHub Repo](https://img.shields.io/badge/GitHub-izscc%2Fx2md-181717?logo=github)](https://github.com/izscc/x2md)
[![Latest Release](https://img.shields.io/github/v/release/izscc/x2md)](https://github.com/izscc/x2md/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/izscc/x2md/build.yml?label=build)](https://github.com/izscc/x2md/actions/workflows/build.yml)

## 教程导览图

![X2MD 快速上手流程](docs/images/tutorial-flow.svg)

## 适用场景

- 你会在 X/Twitter 上收藏大量信息，但链接回看效率低。
- 你希望把素材沉淀进 Obsidian，而不是散落在浏览器书签里。
- 你需要把 Thread / Note 长文转成可编辑 Markdown，用于二次创作。
- 你在 LINUX DO 论坛中看到值得收藏的帖子。
- 你在飞书知识库阅读团队文档，想要本地留档。
- 你在微信公众号看到好文章，想保存完整 Markdown 副本。

## 支持平台

| 平台 | 触发方式 | 说明 |
|------|----------|------|
| X / Twitter | 点击书签按钮 | 支持 Tweet、Thread、Note/Article、图片和视频 |
| LINUX DO | 点赞 / 悬浮保存按钮 | 支持话题帖子内容 |
| 飞书 | 悬浮保存按钮 | 支持 wiki 知识库和 docx 云文档（自动滚动收集完整内容） |
| 微信公众号 | 悬浮保存按钮 | 支持公众号文章（含图片、代码块、引用等） |

## 3 分钟快速上手（推荐）

### 第 1 步：下载客户端（基于 GitHub Release）

- 打开 [Releases](https://github.com/izscc/x2md/releases/latest)
- 当前最新版本：[`v1.1.15`](https://github.com/izscc/x2md/releases/tag/v1.1.15)
- 下载对应平台包：
  - Mac: [`X2MD_Mac.zip`](https://github.com/izscc/x2md/releases/download/v1.1.15/X2MD_Mac.zip)
  - Windows: [`X2MD_Windows.zip`](https://github.com/izscc/x2md/releases/download/v1.1.15/X2MD_Windows.zip)
  - 扩展: [`X2MD_Extension.zip`](https://github.com/izscc/x2md/releases/download/v1.1.15/X2MD_Extension.zip)

### 第 2 步：首次运行并完成向导

1. 解压并运行 `X2MD.app`（Mac）或 `X2MD.exe`（Windows）。
2. 按向导设置：
   - Markdown 保存目录
   - 视频保存目录
3. 向导完成后，服务会在本地启动（默认 `127.0.0.1:9527`）。

### 第 3 步：安装 Chrome 扩展

1. 打开 `chrome://extensions/`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择解压后的 `X2MD_Extension` 目录，或本项目的 [`extension`](./extension) 目录

### 第 4 步：保存第一条内容

1. **X / Twitter**：打开任意推文页，点击推文操作区的书签按钮。
2. **LINUX DO**：打开话题页，点赞帖子或点击右上角悬浮 MD 按钮。
3. **飞书**：打开 wiki 或 docx 页面，点击右上角悬浮 MD 按钮。
4. **微信公众号**：打开公众号文章页，点击右上角悬浮 MD 按钮。
5. 扩展会将内容发送到本地服务并生成 Markdown。
6. 到你设置的目录查看 `.md` 文件。

### 第 5 步：在 Obsidian 中查看结果

- 生成内容默认包含 Front Matter。
- 图片会写入原图链接（`name=orig`）。
- 视频可配置为下载并写入 Obsidian 嵌入引用。

## 常用配置（进阶）

配置文件为根目录的 `config.json`，常用字段：

- `save_paths`: Markdown 输出目录列表
- `custom_save_paths`: X/Twitter 书签悬停菜单的命名保存路径，例如 `[{ "name": "生图类", "path": "/你的/Obsidian/子目录" }]`
- `filename_format`: 文件名模板，支持 `{summary}` `{date}` `{author}`
- `max_filename_length`: 文件名长度上限
- `video_save_path`: 视频保存路径
- `enable_video_download`: 是否下载视频
- `video_duration_threshold`: 超长视频二次确认阈值（分钟）
- `show_site_save_icon`: 是否在支持的站点显示悬浮保存按钮
- `show_x_profile_capture_button`: 是否在 X 博主主页显示猫爪批量抓取按钮
- `profile_capture_range`: 博主主页推文抓取范围，支持 `today` / `month` / `all` / `days`
- `profile_capture_custom_days`: `days` 模式下抓取最近多少天
- `profile_capture_save_path`: 博主批量抓取保存根路径；留空时使用第一个主保存路径并自动建立博主子目录

推荐模板示例：

```json
{
  "filename_format": "{summary}_{date}_{author}",
  "max_filename_length": 60,
  "enable_video_download": true,
  "video_duration_threshold": 5
}
```

## 使用场景示意

![X2MD 使用场景图](docs/images/usage-scenarios.svg)

### 场景 A：资料收藏

把高价值推文直接沉淀到素材库，避免后续失链或遗忘。

### 场景 B：内容创作

把 Thread / Note 转成 Markdown 后可快速摘录、改写、重组。

### 场景 C：知识库建设

统一命名与元数据，长期形成可检索、可关联的个人知识资产。

## 常见问题

### 1) 扩展提示“服务未启动”

- 确认桌面程序正在运行。
- 检查扩展端口与 `config.json` 中 `port` 一致。
- 访问 `http://127.0.0.1:9527/ping`，应返回 `{"status":"ok"...}`。

### 2) 保存成功但没有文件

- 检查 `save_paths` 是否存在写权限。
- 查看日志 `x2md.log`。

### 3) 视频没有下载

- 检查 `enable_video_download` 是否为 `true`。
- 视频超过阈值时会触发二次确认。
- 检查 `video_save_path` 是否可写。

## 本地开发与打包

安装依赖：

```bash
pip3 install -r requirements.txt
```

开发运行：

```bash
# 向导 + 托盘 + 服务
python3 tray_app.py

# 仅服务
python3 server.py
```

打包说明见 [`BUILD.md`](./BUILD.md)。
CI 工作流见 [`.github/workflows/build.yml`](./.github/workflows/build.yml)。

## 项目结构

```text
.
├── server.py               # 本地 HTTP 服务（/ping /config /save）
├── tray_app.py             # 桌面托盘入口
├── setup_wizard.py         # 首次配置向导
├── extension/              # Chrome 扩展（MV3）
│   ├── dom_utils.js        # 共享 DOM 工具函数
│   ├── article_markdown.js # X Article 富文本转 Markdown
│   ├── discourse.js        # LINUX DO 话题帖子提取
│   ├── feishu.js           # 飞书 wiki/docx block 解析
│   ├── wechat.js           # 微信公众号文章提取
│   ├── site_actions.js     # 站点识别与悬浮按钮配置
│   ├── content.js          # 内容脚本主入口
│   ├── background.js       # Service Worker（API 策略）
│   └── tests/              # Node.js 单元测试
├── BUILD.md                # 打包说明
└── docs/images/            # README 配图
```

## 更新日志

### v1.1.15（2026-05-30）

- 修复个别 X Article 书签保存时报 `utf-8 codec can't encode character` 的问题。
- 保存前会清理网页/API 返回的孤立 Unicode surrogate，正常 emoji 和正文内容不受影响。
- 对响应 JSON、文件名和 Markdown 正文统一做安全写入处理，避免单篇异常文章保存失败。

### v1.1.14（2026-05-29）

- 修复 X Article 保存后正文末尾出现重复图片墙的问题。
- 当接口返回的 Article Markdown 图片更完整时，优先采用接口顺序，封面图会回到正文开头。
- 服务端不再把 Article 的 `images` 兜底列表额外追加到正文，避免重复图和顺序错乱。

### v1.1.13（2026-05-29）

- 修复收藏按钮保存 X Article 时，母贴/预览图片被整体挪到 Markdown 开头的问题。
- 文章正文提取重新限制在 X Article 正文容器内，保留页面原有的图文顺序。
- Article 的兜底图片只在正文缺失时追加到末尾，避免重复图片和置顶图片墙。

### v1.1.12（2026-05-29）

- 彻底修复收藏按钮保存 X Article 时漏掉代码块的问题：当前页内嵌文章也会从完整推文卡片范围提取代码块。
- 识别 X Article 无文字图标复制按钮 + `text` 语言标签的代码卡片，并转换为 Markdown 代码围栏。
- 保存前会再用 status 接口补全 Article 内容；如果翻译覆盖导致代码块丢失，也会把原始代码围栏补回。

### v1.1.11（2026-05-29）

- 修复 X Article 中代码块未进入 Markdown 的问题，支持接口里的 atomic code entity 和 Draft code-block。
- 页面渲染兜底也会识别 X Article 带“复制到剪贴板”的代码块，并保存为 Markdown 代码围栏。
- 新增对应单元测试，覆盖代码块接口解析与页面结构兜底。

### v1.1.10（2026-05-29）

- 新增 X Article GraphQL 富文本解析：优先直接从 status 对应接口生成 Article Markdown，减少后台打开新标签页。
- Article URL 会自动转换为对应 `/status/` 作为接口入口；接口解析失败时再回退到渲染提取。
- 完善 X Article 图片兜底：接口和保存阶段都会补齐原图链接，并避免重复写入已存在图片。

### v1.1.9（2026-05-29）

- 修复 X Article 链接批量抓取时优先进入 `/article/` 页面导致媒体上下文缺失的问题，现在会自动转换到对应 `/status/` 页面提取。
- 完善 X Article 图片兜底：从文章所在 status 卡片收集图片链接并统一保存为 `name=orig` 原图链接。
- 保存博主文章 Markdown 时会补齐未内联成功的图片链接，并避免重复写入已存在图片。

### v1.1.8（2026-05-29）

- 修复 X 博主 Articles 页面批量抓取提示“未发现可抓取文章”的问题。
- Articles 列表现在会识别“文章卡片所在推文”的 `/status/` 链接，不再依赖列表页必须存在 `/article/` 链接。
- 后台抓取文章时会先尝试解析真实 Article URL；若列表页只有 status 链接，则自动打开对应推文页提取完整 Article 正文。

### v1.1.7（2026-05-29）

- X 博主主页猫爪悬浮菜单右上角新增推文抓取范围下拉框，可直接选择当日、最近 7 天、最近 10 天、最近 30 天、当月、全部。
- 下拉框支持“自定义天数”，选择后会在菜单中显示输入框，本次抓取会立即按输入天数执行。
- “开始抓取”和“重新完整抓取”都会读取菜单当前选择，不再必须进入设置页调整时间范围。

### v1.1.6（2026-05-29）

- 新增 X 博主主页猫爪批量抓取菜单：在博主主页标签栏显示 🐾，可抓取当前设置范围内的原创推文并按日期写入每日 Markdown。
- 支持 X 博主 Articles 页面批量抓取：每篇文章单独保存为 Markdown 文件。
- 新增设置项：推文时间范围（当日、当月、全部、自定义天数）和博主批量保存路径。
- 新增本地抓取记录：同一博主后续抓取会自动跳过已保存的推文/文章；菜单中可选择“重新完整抓取”绕过记录。
- 批量推文默认保存到“保存根路径/博主昵称_handle/博主昵称推文YYYY-MM-DD.md”，并按 X 时间线从新到旧排列。

### v1.1.5（2026-05-21）

- 新增 X/Twitter 书签按钮悬停自定义保存菜单：可在设置页添加“生图类”等命名路径，点击菜单项后只保存到对应 Obsidian 子目录。
- 点击自定义菜单项时会同步触发 X/Twitter 原生书签保存，并跳过默认路径写入，避免生成重复 Markdown。
- 菜单采用 Apple 透明玻璃风格，宽度按最长菜单名动态调整，标题最多显示 5 个中文字符，并相对书签按钮居中显示。
- 服务端校验自定义路径必须来自本地设置，避免未配置路径被直接写入。

### v1.1.4（2026-05-14）

- 修复 X Article 保存时混入“查看图片描述 / ALT”界面控件文本的问题。
- 保留真正的图片 ALT 描述 fenced code block，只移除页面 UI chrome，改善 Obsidian 排版观感。

### v1.1.3（2026-05-14）

- 新增 X/Twitter 图片 ALT 描述保存：普通推文、线程、引用推文和 X Article 中带 ALT 的图片，会在图片 Markdown 后追加 fenced code block。
- 支持从 GraphQL 媒体字段和页面 DOM 后备提取图片描述，并忽略 `Image`、`Article cover image` 等通用占位文案。
- 修复长文视频占位符兜底逻辑中的重复变量声明，避免 Service Worker 语法检查失败。

### v1.0.9（2026-05-01）

- 基于 v1.0.8 代码线优化 X Article / 普通 Tweet 内嵌引用推文的 Markdown 排版
- 引用推文仅保留正文、图片和原文链接，不再混入回复/转帖/喜欢/浏览数或 Download 等操作信息
- 普通推文保存时会保留引用推文内容，并避免引用图片误混入主推图片列表
- 线程/评论里原作者回复他人时，自动去掉正文开头的 @账号，仅保留回复正文
- 修复引用推文图片过滤过宽导致 X Article 首图丢失的问题

### v1.0.8（2026-03-24）

- 修复飞书虚拟渲染导致丢失 85% 内容的问题，新增滚动收集机制
- 补充飞书 iframe、table、base_refer、synced_source 等 block 类型
- 提取共享 DOM 工具函数到 `dom_utils.js`，消除 100+ 行重复代码
- 服务端：配置内存缓存、视频下载线程池限流、日志瘦身
- 打包：排除不必要模块减小 Mac 安装包体积

### v1.0.7（2026-03-24）

- 新增微信公众号文章支持（`mp.weixin.qq.com/s/*`）
- 新增飞书知识库/云文档支持
- 新增 LINUX DO / 飞书 / 微信悬浮保存按钮
- 新增站点快捷保存开关

### v1.0.6（2026-03-23）

- 修复 X 长文代码块语言标签未并入 Markdown fenced code block 的问题

## GitHub 数据来源

- 仓库信息: <https://api.github.com/repos/izscc/x2md>
- 语言统计: <https://api.github.com/repos/izscc/x2md/languages>
- 最新发布: <https://api.github.com/repos/izscc/x2md/releases/latest>
