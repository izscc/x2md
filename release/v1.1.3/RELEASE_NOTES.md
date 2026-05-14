## X2MD v1.1.3

### 重要说明
- 本版本基于 `v1.1.2` / `origin/main` 当前主线发布。
- 不合入旧 `v1.2.x` 分支内容，避免混入另一条历史线的目录结构和功能变更。

### 更新内容
- 新增 X/Twitter 图片 ALT 描述保存。
- 普通推文、线程推文、引用推文和 X Article 中带 ALT 的图片，会在每张图片 Markdown 后追加：

````markdown
![](图片地址)
```
图片描述
```
````

- ALT 来源覆盖 GraphQL 媒体字段与页面 DOM 后备数据。
- 自动忽略 `Image`、`Photo`、`Article cover image`、`图片` 等通用占位 ALT，避免污染 Markdown。
- 修复 `background.js` 中视频占位符兜底代码的重复变量声明。

### 下载
- **Mac 版**：`X2MD_Mac.zip`
- **Windows 版**：`X2MD_Windows.zip`
- **浏览器扩展**：`X2MD_Extension.zip`

### 验证
- `node --check extension/content.js && node --check extension/background.js`
- `node --test extension/tests/*.test.js`
- `python3 -m unittest discover -s tests`
- `python3 -m py_compile server.py setup_wizard.py tray_app.py`
