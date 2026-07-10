# X2MD 平台支持

| 平台 | 支持级别 | 发布产物 | 说明 |
| --- | --- | --- | --- |
| macOS arm64 | Stable | Electrobun `X2MD.app` | CI 构建后运行本地 API、保存、启动和扩展兼容 smoke |
| Windows | Beta | `X2MD_Windows_Beta.zip` | 自带 Bun 编译运行时的 TypeScript 本地 API；Python legacy 已冻结 |
| Linux | 开发验证 | 无桌面产物 | 可运行 TypeScript 核心和自动化测试，不承诺桌面集成 |

## Windows 能力矩阵

| 能力 | Beta 状态 | 恢复 Stable 的 artifact gate |
| --- | --- | --- |
| TypeScript 本地 API | Beta artifact smoke 验证 `/ping` | 保持 windows-latest artifact gate |
| 配置与固定 endpoint | Beta artifact smoke 验证 pairing/config 与 `127.0.0.1:9527` | 保持固定 endpoint contract |
| Markdown 保存 | Beta artifact 真实执行 `/save` | 扩展跨平台 fixture 与恢复测试 |
| 设置与桌面入口 | 不支持 | 实现原生 Windows 设置与 tray 后另行验收 |
| Chrome 扩展联通 | 支持配对协议；未做真实 Chrome UI smoke | 增加 Windows Chrome 扩展加载 gate |
| 启动、退出与升级 | 支持 CLI 启动和认证 `/shutdown`；无 autostart/updater | 补齐 Windows 原生集成后再评估 Stable |

Windows 只有在 **TypeScript 桌面 artifact** 完成上述真实 smoke 后才能恢复 Stable。
仅证明 zip 存在、运行 Python legacy 测试或打包出 Python 可执行文件都不满足门禁。

## Python legacy 范围

`server.py`、`tray_app.py`、`setup_wizard.py` 等 Python 文件是冻结兼容实现：只接受必要的
安全修复和严重回归修复，不新增 v4 功能，不参与 stable release，也不作为 Windows parity
的依据。
