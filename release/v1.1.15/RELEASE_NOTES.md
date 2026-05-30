# X2MD v1.1.15

## 修复

- 修复个别 X Article 书签保存失败：`utf-8 codec can't encode character '\\u...'`。
- 保存前会递归清理网页/API payload 中偶发的孤立 Unicode surrogate，保留正常 emoji 和正文内容。
- 响应 JSON 与文件名/正文写入路径也做同样清理，避免单篇异常文章影响保存。

## 验证

- Python 单元测试：11/11 通过。
- Node 单元测试：48/48 通过。
- 扩展核心脚本语法检查通过。
