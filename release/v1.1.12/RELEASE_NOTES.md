# X2MD v1.1.12

本版针对“收藏按钮保存 X Article 仍然漏掉代码块”继续修复。

## 修复

- 收藏按钮路径不再只从 `twitterArticleRichTextView` 狭窄容器取正文，会从完整推文卡片范围提取，覆盖代码卡片等嵌入组件。
- 页面渲染兜底支持 X Article 无文字图标复制按钮 + `text` 语言标签的代码块结构，输出 Markdown 代码围栏。
- 后台保存前会再用 status 接口尝试补全 Article 内容；若接口或翻译覆盖中含有/丢失代码围栏，会把缺失代码块补回。

## 验证

- `node --check extension/content.js && node --check extension/background.js && node --check extension/options.js && node --check extension/media_helpers.js && node --check extension/article_markdown.js`
- `python3 -m unittest discover -s tests -v`
- `node --test extension/tests/*.test.js`
