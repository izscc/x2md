## X2MD v1.1.2

### 重要说明
- 本版本是 `v1.1.1` 的 X Article 翻译显示补丁。
- 继续基于 `v1.0.9` 代码线，不合入旧 `v1.2.x` 目录结构变更。

### 更新内容
- 修复部分 X Article 页面点击翻译后提示成功但正文仍保持英文的问题。
- Article 正文文本块识别增加 `div[dir=auto]`、`div[lang]` 和文本叶子节点兜底，适配 X 当前文章 DOM。
- Article 翻译仍保持原位替换策略：只替换文本块，图片、视频和引用推文保留原位置。

### 下载
- **Mac 版**：`X2MD_Mac.zip`
- **Windows 版**：`X2MD_Windows.zip`
- **浏览器扩展**：`X2MD_Extension.zip`

### 验证
- `node --check extension/content.js && node --check extension/background.js`
- `node --test extension/tests/*.test.js`
- `python3 -m unittest discover -s tests`
- `python3 -m py_compile server.py setup_wizard.py tray_app.py`
