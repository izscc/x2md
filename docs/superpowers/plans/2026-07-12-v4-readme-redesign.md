# X2MD V4 README Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 把 X2MD V4 仓库首页重构为普通用户一分钟内可理解、三步可上手，同时保留简短开发入口的产品说明页。

**Architecture:** `README.md` 负责文字信息层级和下载入口，三张独立 SVG 分别负责品牌首屏、使用流程和保存前后对比。高级配置、平台边界和构建细节继续由现有独立文档承载，README 只提供准确入口。

**Tech Stack:** GitHub Flavored Markdown、原生 SVG、现有 GitHub Release 链接。

---

### Task 1: 首屏品牌图

**Files:**
- Create: `docs/images/v4-hero.svg`

- [x] **Step 1: 绘制 1200×480 的浅蓝首屏横幅**

横幅必须包含 `X2MD`、口号“看到好内容，一键存进 Obsidian”、四个来源标签和“网页 → Markdown”的视觉关系。使用 SVG 原生渐变、圆角卡片和内联文字，不引用外部资源。

- [x] **Step 2: 验证 SVG 语法和可见文本**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
ET.parse('docs/images/v4-hero.svg')
text = open('docs/images/v4-hero.svg').read()
assert 'X2MD' in text and '一键存进 Obsidian' in text
PY
```

Expected: exit 0。

### Task 2: 工作流程和结果对比图

**Files:**
- Create: `docs/images/v4-how-it-works.svg`
- Create: `docs/images/v4-before-after.svg`

- [x] **Step 1: 绘制四步工作流程**

`v4-how-it-works.svg` 使用四张编号卡片表达“发现内容 → 点击保存 → 自动整理 → 本地笔记”，每张卡片包含一个简单图标、一行标题和一句说明。

- [x] **Step 2: 绘制保存前后对比**

`v4-before-after.svg` 左侧展示只有标题与 URL 的收藏夹，右侧展示包含 Front Matter、正文、链接、图片的 Markdown 笔记，中间用 X2MD 转换箭头连接。

- [x] **Step 3: 验证两张 SVG**

Run:

```bash
python3 - <<'PY'
import xml.etree.ElementTree as ET
for path in ('docs/images/v4-how-it-works.svg', 'docs/images/v4-before-after.svg'):
    ET.parse(path)
PY
```

Expected: exit 0。

### Task 3: 重写仓库首页

**Files:**
- Modify: `README.md`

- [x] **Step 1: 重写首屏与产品说明**

首屏依次展示 Hero、产品简介、Mac App 与 Chrome 扩展下载入口、版本和构建徽章。第一屏不得出现 API、GraphQL、MV3 或配置 schema。

- [x] **Step 2: 写入普通用户主流程**

按以下顺序组织：为什么需要 X2MD、工作方式图、保存前后对比图、支持网站、三步安装、V4 核心能力、保存结果示例、常见问题。

- [x] **Step 3: 保留简短开发入口**

README 末尾只保留 `bun install`、`bun run dev`、`npm run check`、`bun run build:mac`，并链接 `BUILD.md`、`docs/platform-support.md`、`docs/migrations/x2md-v4.md` 和 V4 PRD。

### Task 4: 内容与视觉验证

**Files:**
- Verify: `README.md`
- Verify: `docs/images/v4-hero.svg`
- Verify: `docs/images/v4-how-it-works.svg`
- Verify: `docs/images/v4-before-after.svg`

- [x] **Step 1: 校验 README 本地路径**

运行 Python 脚本解析 Markdown 中非锚点相对链接和图片路径，确保每个路径存在。

- [x] **Step 2: 校验 SVG 与仓库文档门禁**

Run:

```bash
npm run check:forbidden-files
npm run check:fixture-privacy
git diff --check
```

Expected: 全部 exit 0。

- [x] **Step 3: 浏览器视觉检查**

使用浏览器打开三张 SVG 和 GitHub 风格 Markdown 预览，确认无文本截断、卡片重叠或低对比度，并分别检查桌面宽度和窄屏缩放。

### Task 5: 提交与推送

**Files:**
- Commit: `README.md`
- Commit: `docs/images/v4-hero.svg`
- Commit: `docs/images/v4-how-it-works.svg`
- Commit: `docs/images/v4-before-after.svg`
- Commit: `docs/superpowers/plans/2026-07-12-v4-readme-redesign.md`

- [x] **Step 1: 审查完整差异**

Run:

```bash
git diff --check
git diff --stat
git status --short
```

- [x] **Step 2: 提交文档重构**

```bash
git add README.md docs/images/v4-*.svg docs/superpowers/plans/2026-07-12-v4-readme-redesign.md
git commit -m "docs: redesign readme for x2md v4"
```

- [x] **Step 3: 推送 main**

```bash
git push origin main
```
