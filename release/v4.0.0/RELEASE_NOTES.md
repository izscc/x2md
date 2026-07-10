# X2MD v4.0.0

X2MD 4.0 将桌面 App 作为唯一配置与保存核心，重点提升本地保存可靠性、扩展安全边界和批量采集的可恢复性。

## 新增

- 新增版本化采集契约、原子写入、重复策略、图片本地化和安全媒体下载。
- 新增持久化任务中心，书签与博主批量采集支持暂停、继续、取消、失败重试和重启恢复。
- 桌面设置新增整理规则、Front Matter 模板、媒体策略、首次运行检查和脱敏诊断导出。
- Chrome 扩展新增明确的保存结果状态，并拆分 X、飞书、微信公众号和通用网页采集模块。
- 新增 TypeScript Windows Beta 产物；Python 桌面端保留为冻结兼容实现，不再进入 stable release。

## 安全与可靠性

- 本地 API 固定使用 `127.0.0.1:9527`，并要求扩展通过一次性配对码完成认证。
- 收紧 Origin、请求契约、配置 schema、下载地址和文件输出边界。
- Release 流水线增加最终压缩包 smoke、依赖审计、SBOM、Sigstore provenance、SHA256、Developer ID 签名与 Apple 公证门禁。

## 升级说明

- App 与扩展必须升级到同一版本；旧扩展需要在桌面 App 的首次运行检查中重新配对。
- 业务配置统一在桌面 App 中管理，扩展设置页仅保留连接、配对和诊断入口。
- 升级前建议备份 `~/Library/Application Support/X2MD/` 和实际保存目录。

## 发行产物

- `X2MD_Mac.zip`
- `X2MD_Extension.zip`
- `X2MD_Windows_Beta.zip`
- `update.json`
- `SBOM.cdx.json`
- `PROVENANCE.sigstore.json`
- `SHA256SUMS.txt`
