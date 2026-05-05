## X2MD v1.1.0

### 重要说明
- 本版本继续基于 `v1.0.9` 代码线修改，不合入旧 `v1.2.x` 的目录结构变更。
- 图片与视频保存策略沿用 v1.0.9：Markdown 保留远程原图链接，视频按配置决定下载或保留链接。
- 本版本重点修复 X/Twitter 翻译与翻译后收藏保存链路。

### 更新内容
- 新增长按翻译按钮的自动翻译模式：在推文详情页或 X Article 页面长按翻译按钮，会自动翻译主正文和已加载评论。
- 自动翻译模式会监听后续新加载评论并自动排队翻译，使用小并发与去重机制避免重复请求和页面卡顿。
- 翻译前会优先点击推文内的“显示更多 / Show more”，确保折叠长推文展开后再翻译完整内容。
- 修复 X Article 页面翻译不完整的问题：标题与正文分段提取、分段翻译，并排除订阅提示、互动栏等非正文内容。
- 当推文或文章已显示译文时，点击收藏保存 Markdown 会优先保存译文正文/标题，同时保留原链接、媒体和元数据。
- 增加译文覆盖与文章噪声过滤的回归测试。

### 下载
- **Mac 版**：`X2MD_Mac.zip`
- **Windows 版**：`X2MD_Windows.zip`
- **浏览器扩展**：`X2MD_Extension.zip`

### 验证
- `node --check extension/content.js && node --check extension/background.js`
- `node --test extension/tests/*.test.js`
- `python3 -m unittest discover -s tests`
- `python3 -m py_compile server.py setup_wizard.py tray_app.py`
