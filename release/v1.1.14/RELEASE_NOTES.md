# X2MD v1.1.14

## 修复

- 修复 X Article 书签保存时，兜底图片列表被追加到正文末尾造成重复图片墙的问题。
- 保存前如果 GraphQL Article 内容包含更多按序图片，会优先采用接口返回的完整 Article Markdown，让封面图回到正文开头。
- 服务端不再为 Article 额外倾倒 `images` 列表，Article 图文顺序只以正文 Markdown 为准。

## 验证

- Python 单元测试：10/10 通过。
- Node 单元测试：48/48 通过。
- 扩展核心脚本语法检查通过。
