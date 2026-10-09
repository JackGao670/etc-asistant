# Phase 0 决策与开发交接

日期：2026-10-09。适用项目：`../src`。

## 开发与认证边界

Phase 0 的原型代码、构建/测试/打包工具与初始契约已交付，可作为后续开发基线。
这里的“开发交接”不等于原技术表的全部验收通过。
按本轮“先完成 Phase 0 开发，再开展剩余开发”的指示，开始 Phase 1 软件开发，
外部认证作为未关闭风险继续追踪，不将 T01～T05 标成验收完成。
正式发布仍必须通过硬件、干净机器、官方宿主和性能门禁。

## 冻结的开发基线

| 决策 | 基线 | 证据/限制 |
| --- | --- | --- |
| 项目根目录 | `d:\workspace\调试工具\src`；一份 package.json/锁文件 | Host 源码、shared、webview、scripts、test 分离 |
| 最低 VS Code 候选 | 1.95.0；Host target Node20/ES2022 | 类型构建通过，真实官方宿主未认证 |
| 构建工具 | TypeScript 5.7.3、esbuild 0.25.10、Vite 6.4.4 | 生产本地静态资源，SerialPort external |
| UI | React/ReactDOM 18.3.1，原生 Tree View + WebviewPanel | 不依赖 CDN 或开发服务器；虚拟列表 |
| 运行时校验 | Zod 3.24.2，strict 消息联合 | type/version/requestId、参数范围、字段长度、未知字段拒绝 |
| 消息数据 | JSON DTO、base64 字节、递增序号、单独控制响应 | ready/会话动作/ACK 分开定义；ACK 重置不复用 ID |
| 软件测试 | Node test runner + tsx；@vscode/test-electron 隔离用户目录 | 不把 mock/Node 测试当成真实设备认证 |
| 串口依赖 | SerialPort 12.0.0 延迟加载 | Windows x64 加载、枚举和解包加载通过；COM1 未操作 |
| 缓存预算 | 每 Session 4 MiB/10000 条，最多 8 Session；批次 64 KiB/4 个未 ACK | 硬边界先落地，性能预算需长时实际测量 |
| 发布包 | Windows x64，静态 JS/CSS + 原生产物；排除日志、测试、开发配置 | 不公开发布；publisher/许可证仍待定 |

## 未关闭的认证项

| 项目 | 状态 | 处理 |
| --- | --- | --- |
| 官方最低/稳定 VS Code | 未完成；Node 下载与限时 curl 代理下载均未成功 | 可指定本地官方 Code.exe 运行 test:extension，保留脚本 |
| Webview 真实 ACK/绘制 | 原型代码完成，实际宿主结果未取得 | 不报告虚构 ACK p95，待实际运行 |
| 串口真实设备/驱动/信号 | 未完成 | 使用明确的测试设备，勿向用途未知 COM1 发送 |
| 干净 Windows 离线安装 | 未完成 | 从最终 VSIX 安装，不依赖开发目录 |
| SSH/WSL/容器与多根 URI | 诊断代码完成，场景未完成 | 分场景检查 local UI Host 与 workspace.fs |
| 长稳与磁盘故障 | 短时 TCP/JSONL 完整性通过，长稳/故障未完成 | 发布候选阶段必须实测 |

## Phase 1 开发交付

新增 TCP Client Transport、SessionManager、串行有界发送队列、
原生 Connections 侧栏、运行时消息校验、React RX/TX 界面、
展示缓存/ACK/重同步与单元/回环测试。
只有 TCP Client 工作台进入开发交付；Serial 工作台、Server、UDP、
重连、快捷/自动发送、项目配置、生产录制/导出和发布认证仍未完成。

后续顺序：Phase 1 实际宿主与 UI 验证；Phase 2 四接口与多会话；
Phase 3 配置/录制/调度；Phase 4 性能/长稳/发布认证。
