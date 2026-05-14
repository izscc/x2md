## X2MD v1.1.4

### 重要说明
- 本版本基于 `v1.1.3` 发布，并合入 `main` 主线。
- 继续沿用 `v1.1.2` / `origin/main` 这条主线，不合入旧 `v1.2.x` 分支内容。

### 更新内容
- 修复 X Article 保存时混入“查看图片描述 / ALT”界面控件文本的问题。
- 保留真正的图片 ALT 描述 fenced code block：

````markdown
![](图片地址)
```
图片描述
```
````

- 仅移除 X 页面用于展开图片描述的 UI chrome，避免 Obsidian 中出现多余文本块影响排版。

### 下载
- **Mac 版**：`X2MD_Mac.zip`
- **Windows 版**：`X2MD_Windows.zip`
- **浏览器扩展**：`X2MD_Extension.zip`

### 验证
- `node --check extension/content.js && node --check extension/background.js`
- `node --test extension/tests/*.test.js`
- `python3 -m unittest discover -s tests`
- `python3 -m py_compile server.py setup_wizard.py tray_app.py`
