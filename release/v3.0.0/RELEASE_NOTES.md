# X2MD v3.0.0

- X2MD 3.0：增强 X GraphQL 可靠性、结构化 Markdown、书签/Profile 批量导出、图片本地化、升级提示与发布产物校验。
- Twitter/X 图片保存恢复 2.x 行为：只保留 `name=orig` 原图链接，不下载到本地，Markdown 使用 `![](...)`，并保留图片 ALT 文本代码块。
- 修复 Twitter/X 同一图片因 `.jpg?name=orig` 与 `?format=jpg&name=orig` 两种 URL 形态导致重复保存，以及引用推文图片泄漏到主推文图片区的问题。
