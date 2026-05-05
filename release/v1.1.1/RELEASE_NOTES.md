## X2MD v1.1.1

### 重要说明
- 本版本是 `v1.1.0` 的翻译显示回归修复补丁。
- 继续基于 `v1.0.9` 代码线，不合入旧 `v1.2.x` 目录结构变更。

### 更新内容
- 修复 X Article 翻译译文被插入到左侧 X 菜单区的问题。
- X Article 翻译改为原位替换标题和正文文本块，不再隐藏/替换整个正文容器。
- 文章内图片、视频占位和引用推文保持原 DOM 位置，不会被纯文本译文替换掉。
- 修复主页/信息流推文翻译后额外增加大段空白高度的问题：普通推文现在直接在原 tweetText 位置替换文本，不再插入额外大块容器。
- 翻译后收藏保存仍优先使用译文；X Article 保存时会从已翻译 DOM 重新提取 Markdown，以尽量保留媒体和引用推文位置。

### 下载
- **Mac 版**：`X2MD_Mac.zip`
- **Windows 版**：`X2MD_Windows.zip`
- **浏览器扩展**：`X2MD_Extension.zip`

### 验证
- `node --check extension/content.js && node --check extension/background.js`
- `node --test extension/tests/*.test.js`
- `python3 -m unittest discover -s tests`
- `python3 -m py_compile server.py setup_wizard.py tray_app.py`
