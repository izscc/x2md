# X2MD v1.1.17

## 修复

- 修复 X Article GraphQL 富文本中的 `MARKDOWN` 原子实体未被解析的问题。
- 修复类似“当我开始揣摩 Less Is More...”这类 X Article 保存后缺失大段提示词代码块的问题。
- 复制/接口正文的 `plainText` 也会从已渲染 Markdown 派生，避免复制正文时再次漏掉提示词。

## 稳定性

- 更新 X Web 当前真实 `TweetDetail` / `TweetResultByRestId` operation id 兜底值。
- 增强 X JS bundle 中 GraphQL operation id 的自动探测，支持 `params:{id,name,operationKind}` 形式。

## 验证

- 已用当前 X 页面真实 `TweetDetail` / `TweetResultByRestId` 响应验证：Article Markdown 包含提示词 fenced code block。
- Node.js 回归测试通过：`tests/test_media_helpers.js`、`tests/test_twitter_graphql.js`。
- Python 单元测试：11/11 通过。
- 扩展核心脚本语法检查通过。
