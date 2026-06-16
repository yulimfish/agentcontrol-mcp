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
- **破坏方块**：`mod_break_crosshair_block` — 需要准星对准方块，且必须对准方块中心（非完整方块碰撞箱在方块内部，边缘对准会错过）
- **第四组测试（准星对准与灯笼破坏）**
  - `look_at` 对准方块坐标（x=834, y=72, z=544）→ crosshairTarget 为 null，射线从方块边缘穿过，错过 lantern 碰撞箱
  - `look_at` 对准方块中心（x=834.5, y=72.5, z=544.5）→ crosshairTarget 命中 lantern，成功破坏
  - 结论：`look_at` 必须对准方块中心，而非整数方块坐标

- **主副手**：`mod_swap_hands` — 正常
- **丢弃**：`mod_drop` — 正常

### 已修复的问题

1. **MCP 自动关闭屏幕**：`server.js` 新增 `ensureScreenClosed()`，所有动作工具在执行前自动关闭界面，无需 AI 手动检查。如果 `close_screen` 不生效，会自动调用 `release_mouse`。
3. **准星对准精度**：`look_at` 现在对准方块坐标时，如果传入的是整数，自动加 0.5 偏移对准方块中心。以前对准方块坐标（西南下角），射线从方块边缘穿过，100% 错过非完整方块（如灯笼、告示牌）的碰撞箱。
4. **视线高度计算**：`look_at` 使用 `getEyePos()` 而不是 `getY()`，确保从眼睛位置而不是脚部计算角度。

### 新增功能（v0.1.3）

- **crosshairTarget 返回方块属性**：`get_client_state` 的 `crosshairTarget` 现在包含 `properties` 字段，揭示方块变体信息（如 `color: purple`、`facing: east`）。对于潜影盒，可以精确区分颜色。
- **nearbyBlocks 支持过滤**：`get_client_state` 新增 `filter` 参数，传入方块 ID 子串（如 `shulker_box`）即可只返回匹配的方块，避免被数千个石头/泥土淹没。
- **工具描述优化**：所有工具描述强调高效工作流——减少状态查询次数、使用 filter 搜索、一次性移动到位、验证 properties 再破坏。

### 最佳实践（高效搜索与破坏）

#### 1. 使用 `filter` 高效搜索方块
不要不加过滤地扫描所有方块。使用 `filter` 参数只搜索目标方块：
```text
get_client_state(filter="shulker_box", scan_radius=8) → 只返回潜影盒
```
这比返回 2000+ 个 stone/dirt 的列表高效得多。

#### 2. 分析相对位置，一次性移动到位
从初始位置获取状态后，分析目标方块相对于玩家的坐标，判断从哪个角度不会被阻挡：
- 如果目标在东边（x > player.x），且中间可能有阻挡 → 先向东移动绕过，再向北/南接近
- 如果目标在南边（z > player.z）→ 面朝南（yaw=0）移动
- 不要反复短距离移动+检查。估算距离，一次移动 3-5 秒，再验证位置

#### 3. 使用 `mod_look_at` 对准后验证 `properties`
```text
1. get_client_state(filter="shulker_box") → 获取目标坐标
2. mod_look_at(x, y, z) → 模组自动对准方块中心
3. get_client_state → 检查 crosshairTarget.properties.color
4. 如果 color 匹配 → mod_break_crosshair_block
5. 如果 color 不匹配 → 说明命中了其他潜影盒，调整位置重新对准
```
**关键**：不要只检查 `crosshairTarget.block`，必须检查 `crosshairTarget.properties.color` 来区分颜色。

#### 4. 避免无意义的重复状态查询
- 一次移动 3-5 秒后再检查状态，不要每 0.5-1 秒检查一次
- 使用 `filter` 减少 nearbyBlocks 数据量
- 如果 crosshairTarget 为 null，说明当前角度被挡住，应该换个方向移动，而不是反复对准同一位置

#### 5. 推荐的破坏流程（以彩色潜影盒为例）
```text
1. get_client_state(filter="shulker_box", scan_radius=8) → 获取所有潜影盒坐标
2. 分析位置：从玩家位置看，哪些潜影盒会阻挡视线？
3. 选择一个能直接看到目标的角度（如从东侧接近）
4. mod_look_facing + mod_move_player → 移动到该角度
5. mod_look_at(x, y, z) → 对准目标
6. get_client_state → 验证 crosshairTarget.properties.color == "purple"
7. 如果确认 → mod_break_crosshair_block
8. 如果命中的是红色 → 向东/西移动一格，重复步骤 5-7
```

#### 6. 常见错误
- ❌ 不加 filter 扫描所有方块 → 返回 2000+ 行数据，浪费时间和上下文
- ❌ 反复短距离移动+检查 → 应该估算距离，一次移动到位
- ❌ 不检查 properties.color → 可能误破坏红色潜影盒
- ❌ 被挡住时反复对准同一位置 → 应该换个角度移动
- ❌ 混淆 Z 轴方向 → z 增加是向南，减少是向北

### 已知问题与待办

1. **Node.js 20 弃用**：`actions/checkout@v4` 等 Action 基于 Node.js 20，GitHub 将在 2026-09-16 后移除支持。需要关注 Action 更新版本。
2. **移动精度**：当前移动通过 `KeyBinding.setPressed(true)` 实现，在后台线程延迟释放。移动距离取决于帧率，不够精确。估算移动距离：约 4-5 格/秒（正常行走）。

## 验证

```sh
npm install
node --check src/server.js
```
