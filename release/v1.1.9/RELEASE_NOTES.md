# X2MD v1.1.9

本版修复 X 博主 Articles/Article 链接批量抓取时的长文媒体缺失问题。

## 修复

- Article URL 会自动优先转换为对应的 Status URL 再抓取，避免 `/article/` 页面缺少完整媒体上下文。
- X Article 抓取会从文章所在推文卡片补齐图片链接，并统一使用 `name=orig` 原图参数。
- 博主文章 Markdown 保存时会兜底写入未内联成功的图片链接，并跳过已存在图片，避免重复。

## 验证

- `node --check extension/content.js && node --check extension/background.js && node --check extension/options.js`
- `python3 -m unittest discover -s tests -v`
- `node --test extension/tests/*.test.js`
