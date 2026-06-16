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

## 阶段总结

### 已完成的测试轮次

- **基础状态**：`get_client_state` 正常工作，返回完整状态
- **移动**：`mod_move_player` 前进/左转/跳跃 — 正常
- **视角**：`mod_look` 调整 yaw/pitch — 正常
- **快捷栏**：`mod_select_slot` 切换槽位 — 正常
- **攻击/交互**：`mod_attack`, `mod_use_item` — 正常
- **主副手**：`mod_swap_hands` — 正常
- **丢弃**：`mod_drop` — 正常

### 已修复的问题

1. **MCP 自动关闭屏幕**：`server.js` 新增 `ensureScreenClosed()`，所有动作工具在执行前自动关闭界面，无需 AI 手动检查。如果 `close_screen` 不生效，会自动调用 `release_mouse`。
2. **ESC 菜单关闭**：`close_screen` 现在先调用 `screen.close()` 再 `setScreen(null)`，能正确关闭 ESC 菜单。

### 新增功能（v0.1.1）

- **自动关闭屏幕**：`ensureScreenClosed()` 自动检查 screen 状态，关闭所有界面
- **新增工具**：`mod_look_at`（对准坐标）、`mod_look_facing`（面朝方向）
- **工具描述更新**：移除"必须手动检查 screen"的说明，改为"自动关闭屏幕"

### 已知问题与待办

1. **Node.js 20 弃用**：`actions/checkout@v4` 等 Action 基于 Node.js 20，GitHub 将在 2026-09-16 后移除支持。需要关注 Action 更新版本。
2. **移动精度**：当前移动通过 `KeyBinding.setPressed(true)` 实现，在后台线程延迟释放。移动距离取决于帧率，不够精确。

## 验证

```sh
npm install
node --check src/server.js
```
