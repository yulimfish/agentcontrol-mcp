# AgentControl MCP Agent 指南

这个仓库包含 AgentControl 的 MCP 服务。

## 职责

- 向 AI 客户端暴露 MCP 工具。
- 调用 `127.0.0.1` 上的 AgentControl Fabric 端点。
- 默认使用 Fabric 驱动的控制路径。
- 除非设置 `MINECRAFT_MCP_ENABLE_SYSTEM_INPUT=1`，否则保持旧 macOS System Events 工具关闭。

## 相关仓库

- `AgentControl-Fabric` 必须安装到 Minecraft 中，默认工具才能工作。
- `AgentControl-Docs` 记录安装和架构。
- `AgentControl` 总仓包含本项目以及 Fabric 和 Docs。

## 安全规则

- 不要添加服务端控制、机器人账号、RCON 或权限绕过。
- 不要把系统级输入作为默认路径。
- 工具动作必须保持有界、明确。

## 验证

```sh
npm install
node --check src/server.js
```
