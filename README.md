# X2MD

把 X/Twitter、LINUX DO、飞书、微信公众号内容一键保存为 Obsidian 可用的 Markdown。

[![GitHub Repo](https://img.shields.io/badge/GitHub-AchengBusiness%2Fx2md-181717?logo=github)](https://github.com/AchengBusiness/x2md)
[![Upstream](https://img.shields.io/badge/upstream-izscc%2Fx2md-blue?logo=github)](https://github.com/izscc/x2md)
[![Latest Release](https://img.shields.io/github/v/release/AchengBusiness/x2md)](https://github.com/AchengBusiness/x2md/releases/latest)
[![Build](https://img.shields.io/github/actions/workflow/status/AchengBusiness/x2md/build.yml?label=build)](https://github.com/AchengBusiness/x2md/actions/workflows/build.yml)

> **致谢**: 本项目 Fork 自 [izscc/x2md](https://github.com/izscc/x2md)，感谢原作者 [@izscc](https://github.com/izscc) 创建了这个优秀的工具。本 Fork 在原版基础上进行了大量功能增强和 Bug 修复，详见下方更新日志。

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
- 当前最新版本：[`v1.2.3`](https://github.com/AchengBusiness/x2md/releases/tag/v1.2.3)
- 下载对应平台包：
  - Mac: [`X2MD_Mac.zip`](https://github.com/AchengBusiness/x2md/releases/download/v1.2.3/X2MD_Mac.zip)
  - Windows: [`X2MD_Windows.zip`](https://github.com/AchengBusiness/x2md/releases/download/v1.2.3/X2MD_Windows.zip)
  - 扩展: [`X2MD_Extension.zip`](https://github.com/AchengBusiness/x2md/releases/download/v1.2.3/X2MD_Extension.zip)

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
- `filename_format`: 文件名模板，支持 `{summary}` `{date}` `{author}`
- `max_filename_length`: 文件名长度上限
- `video_save_path`: 视频保存路径
- `enable_video_download`: 是否下载视频
- `video_duration_threshold`: 超长视频二次确认阈值（分钟）
- `show_site_save_icon`: 是否在支持的站点显示悬浮保存按钮
- `platform_folders`: 是否按平台分子文件夹（Twitter/、LinuxDo/、Feishu/、WeChat/）
- `download_images`: 是否下载远程图片到本地（存入 `assets/` 子目录）
- `overwrite_existing`: 是否覆盖已存在的同名文件（基于 Front Matter `源:` URL 去重）

推荐模板示例：

```json
{
  "filename_format": "{summary}_{date}_{author}",
  "max_filename_length": 60,
  "enable_video_download": true,
  "video_duration_threshold": 5,
  "platform_folders": true,
  "download_images": true,
  "overwrite_existing": false
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

### v1.2.3（2026-03-25）

- 修复视频占位符 `[MEDIA_VIDEO_URL:xxx]` 泄漏到 Front Matter title 和文件名的 Bug
- 同步所有组件版本号到 1.2.3（server.py / manifest.json / x2md.spec）
- 新增 43 个 Obsidian 渲染专项测试，全部 66 个测试 100% 通过

### v1.2.2（2026-03-25）

- 修复飞书嵌套列表只输出 children 丢失父级文本的问题
- 修复飞书 `document.head` 为 null 时注入 CSS 崩溃
- 修复 background.js 中 `noteResultVideos` 死代码导致视频合并失败
- 修复 Twitter GraphQL 提取中 `note_tweet` 结构变化的兼容性
- 修复微信公众号代码块 `<br>` 未转换为换行的问题

### v1.2.1（2026-03-25）

- 新增覆盖/去重选项：基于 Front Matter `源:` URL 自动跳过已保存文件
- 新增飞书 JSON API 提取策略（3 层自动降级：JSON API -> DOM -> 滚动收集）
- 修复 LINUX DO 有序列表和嵌套列表缩进
- 修复多个平台 Front Matter 字段缺失问题

### v1.2.0（2026-03-25）

- 新增平台分类文件夹功能（Twitter/、LinuxDo/、Feishu/、WeChat/）
- 新增图片本地下载功能（远程图片 -> assets/ 子目录，相对路径引用）
- 修复跨平台内容提取和 Obsidian 渲染的多个 Bug

### v1.1.0（2026-03-24）

- 新增跨设备配置同步功能
- 修复 Windows 打包后 `sys.stdout` 为 None 导致启动崩溃
- 修复 Windows 设置向导字体乱码和 emoji 渲染问题
- 修复 6 个扩展 Bug（GraphQL 权限、监听器泄漏、有序列表等）

### v1.0.9（2026-03-24）

- 修复 Windows DLL 崩溃（strip 损坏 DLL + UPX 压缩 Python/VC++ DLL）
- 修复 10 个代码 Bug（路径处理、编码、Front Matter 格式等）
- PyInstaller spec 增加 DLL 保护白名单

### v1.0.8（2026-03-24）- 原版最终版本

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

## 致谢

本项目基于 [izscc/x2md](https://github.com/izscc/x2md) 开发，感谢原作者 [@izscc](https://github.com/izscc) 的创意和初始实现。

如果你觉得这个工具有用，也请给原仓库一个 Star。
