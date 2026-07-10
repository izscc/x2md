# X2MD 平台支持

| 平台 | 支持级别 | 发布产物 | 说明 |
| --- | --- | --- | --- |
| macOS arm64 | Stable | Electrobun `X2MD.app` | CI 构建后运行本地 API、保存、启动和扩展兼容 smoke |
| Windows | Beta | 无 stable 产物 | 仅验证 TypeScript/Node 运行时；Python legacy 已冻结 |
| Linux | 开发验证 | 无桌面产物 | 可运行 TypeScript 核心和自动化测试，不承诺桌面集成 |

## Windows 能力矩阵

| 能力 | Beta 状态 | 恢复 Stable 的 artifact gate |
| --- | --- | --- |
| TypeScript 本地 API | 源码测试覆盖 | 在 Windows CI 启动打包后的 TypeScript artifact，并验证 `/ping` |
| 配置与固定 endpoint | 源码测试覆盖 | 对 artifact 验证配置读写及固定 `127.0.0.1:9527` |
| Markdown 保存 | 源码测试覆盖 | 对 artifact 执行真实 `/save`，校验目标文件内容和路径 |
| 设置与桌面入口 | 未形成稳定产物 | 从 artifact 启动设置界面并完成可见性 smoke |
| Chrome 扩展联通 | 未形成稳定产物 | 加载发布扩展，配对后通过 artifact 完成一次真实保存 |
| 启动、退出与升级 | 未形成稳定产物 | 验证冷启动、端口占用、正常退出和升级包元数据 |

Windows 只有在 **TypeScript 桌面 artifact** 完成上述真实 smoke 后才能恢复 Stable。
仅证明 zip 存在、运行 Python legacy 测试或打包出 Python 可执行文件都不满足门禁。

## Python legacy 范围

`server.py`、`tray_app.py`、`setup_wizard.py` 等 Python 文件是冻结兼容实现：只接受必要的
安全修复和严重回归修复，不新增 v4 功能，不参与 stable release，也不作为 Windows parity
的依据。
