# AgentControl MCP

AgentControl MCP 是 AgentControl 面向 AI 的 Model Context Protocol 服务。它暴露 MCP 工具，并调用运行在用户 Minecraft 客户端中的 AgentControl Fabric 模组。

## 与其他仓库的关系

- `AgentControl`：总仓，协调 Fabric、MCP 和文档项目。
- `AgentControl-Fabric`：默认工具所需的 Minecraft 客户端运行时桥接层。
- `AgentControl-MCP`：本项目。
- `AgentControl-Docs`：安装、安全和架构文档。

正常链路：

```text
AI/MCP 客户端 -> agentcontrol-mcp -> http://127.0.0.1:17777 -> agentcontrol-fabric -> Minecraft 客户端 API
```

`agentcontrol-mcp` 可以在 Minecraft 未启动时启动，但 Fabric 相关工具需要安装 `agentcontrol-fabric` 并运行 Minecraft。

## 已实现工具

- `get_client_state`：从 AgentControl Fabric 读取本地客户端状态。
- `mod_move_player`：通过 Fabric 客户端按键绑定移动。
- `mod_look`：设置 yaw 和 pitch。
- `mod_attack`：攻击当前准星目标。
- `mod_use_item`：使用手持物品或与当前目标交互。
- `mod_break_crosshair_block`：开始破坏准星指向方块。
- `mod_place_crosshair_block`：对准星方块放置/使用。
- `mod_close_screen`：关闭当前 Minecraft 界面。
- `mod_release_mouse`：根据 Fabric 配置执行释放/捕获鼠标行为。

旧的 macOS System Events 工具默认关闭，只有设置下面环境变量时才会注册：

```sh
MINECRAFT_MCP_ENABLE_SYSTEM_INPUT=1
```

## 安装

```sh
npm install
```

## 运行

```sh
node src/server.js
```

MCP 客户端通常会以本地 stdio MCP 服务的方式运行这个命令。

OpenCode 风格配置示例：

```jsonc
"agentcontrol": {
  "type": "local",
  "command": ["node", "/path/to/agentcontrol-mcp/src/server.js"],
  "enabled": true
}
```

## 配置

默认端点：

```text
MINECRAFT_MCP_CLIENT_STATE_URL=http://127.0.0.1:17777/state
MINECRAFT_MCP_CLIENT_ACTION_URL=http://127.0.0.1:17777/action
```

只有当 AgentControl Fabric 使用自定义端口启动时，才需要覆盖这些环境变量。

## 验证

```sh
node --check src/server.js
```

## 安全边界

AgentControl MCP 不提供服务端访问或权限绕过。它调用用户本地 Fabric 客户端模组，远程 Minecraft 服务器仍然拥有最终判定权。
