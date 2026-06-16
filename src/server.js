#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const clientStateUrl = process.env.MINECRAFT_MCP_CLIENT_STATE_URL ?? "http://127.0.0.1:17777/state";
const clientActionUrl = process.env.MINECRAFT_MCP_CLIENT_ACTION_URL ?? "http://127.0.0.1:17777/action";
const enableSystemInput = process.env.MINECRAFT_MCP_ENABLE_SYSTEM_INPUT === "1";

const keyMap = {
  forward: { char: "w" },
  back: { char: "s" },
  left: { char: "a" },
  right: { char: "d" },
  jump: { code: 49 },
  sneak: { modifier: "shift" },
  sprint: { modifier: "control" },
  inventory: { char: "e" },
  chat: { char: "t" },
  escape: { code: 53 },
  enter: { code: 36 },
};

function result(text) {
  return { content: [{ type: "text", text }] };
}

function jsonResult(value) {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

async function osascript(script, args = []) {
  const { stdout, stderr } = await execFileAsync("osascript", ["-e", script, ...args], {
    timeout: 30_000,
  });
  return `${stdout}${stderr}`.trim();
}

function keyAction(key, action) {
  const spec = keyMap[key];
  if (!spec) throw new Error(`Unsupported key: ${key}`);
  if (spec.char) return `${action} "${spec.char}"`;
  if (spec.modifier) return `${action} ${spec.modifier}`;
  return `key code ${spec.code}`;
}

async function focusMinecraft() {
  await osascript(`
tell application "System Events"
  if exists process "Minecraft" then
    set frontmost of process "Minecraft" to true
  else if exists process "java" then
    set frontmost of process "java" to true
  else if exists process "HMCL" then
    set frontmost of process "HMCL" to true
  else
    error "Minecraft/java/HMCL process not found"
  end if
end tell
`);
}

async function fetchClientAction(params) {
  const url = new URL(clientActionUrl);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  } catch (error) {
    throw new Error(
      `Could not reach Fabric client action endpoint at ${clientActionUrl}. `
        + "Install the mod, start Minecraft with Fabric, and join/open a world before retrying. "
        + `Cause: ${error.message}`,
    );
  }

  const text = await response.text();
  if (!response.ok) throw new Error(`Fabric client action endpoint returned HTTP ${response.status}: ${text}`);

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function ensureScreenClosed() {
  try {
    const state = await fetchClientState();
    if (state.screen && state.screen !== null) {
      await fetchClientAction({ type: "close_screen" });
    }
  } catch {
    // If state endpoint is unavailable, proceed anyway
  }
}

async function fetchClientState(scanRadius, filter) {
  const url = new URL(clientStateUrl);
  if (scanRadius !== undefined && scanRadius !== null) {
    url.searchParams.set("scanRadius", String(scanRadius));
  }
  if (filter !== undefined && filter !== null && filter !== "") {
    url.searchParams.set("filter", String(filter));
  }

  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
  } catch (error) {
    throw new Error(
      `Could not reach Fabric client state mod at ${clientStateUrl}. `
        + "Install the mod, start Minecraft with Fabric, and join/open a world before retrying. "
        + `Cause: ${error.message}`,
    );
  }

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Fabric client state mod returned HTTP ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function tapKey(key) {
  const spec = keyMap[key];
  if (!spec) throw new Error(`Unsupported key: ${key}`);
  if (spec.char) {
    await osascript(`tell application "System Events" to keystroke "${spec.char}"`);
    return;
  }
  if (spec.modifier) {
    await osascript(`tell application "System Events" to key code ${spec.modifier === "shift" ? 56 : 59}`);
    return;
  }
  await osascript(`tell application "System Events" to key code ${spec.code}`);
}

async function holdKey(key, durationMs) {
  const safeDuration = Math.max(50, Math.min(durationMs, 10_000)) / 1000;
  const down = keyAction(key, "key down");
  const up = keyAction(key, "key up");
  if (keyMap[key].code) {
    await tapKey(key);
    return;
  }
  await osascript(`
tell application "System Events"
  ${down}
  delay ${safeDuration}
  ${up}
end tell
`);
}

const server = new McpServer({
  name: "agentcontrol-mcp",
  version: "0.1.0",
});

if (enableSystemInput) {
  server.tool("focus_minecraft", "Bring the local Minecraft client window to the foreground. Disabled by default; set MINECRAFT_MCP_ENABLE_SYSTEM_INPUT=1 to register.", {}, async () => {
    await focusMinecraft();
    return result("Minecraft window focused, or the Java/HMCL process was brought forward.");
  });

  server.tool(
    "press_key",
    "Press or hold a whitelisted Minecraft control key using macOS System Events. Disabled by default.",
    {
      key: z.enum(Object.keys(keyMap)),
      duration_ms: z.number().int().min(50).max(10_000).default(100),
      focus_first: z.boolean().default(true),
    },
    async ({ key, duration_ms, focus_first }) => {
      if (focus_first) await focusMinecraft();
      if (duration_ms <= 150) await tapKey(key);
      else await holdKey(key, duration_ms);
      return result(`Pressed ${key} for ${duration_ms}ms.`);
    },
  );

  server.tool(
    "move_player",
    "Move the current player with WASD using macOS System Events. Disabled by default; prefer mod_move_player.",
    {
      direction: z.enum(["forward", "back", "left", "right"]),
      duration_ms: z.number().int().min(50).max(10_000).default(1000),
      sprint: z.boolean().default(false),
      focus_first: z.boolean().default(true),
    },
    async ({ direction, duration_ms, sprint, focus_first }) => {
      if (focus_first) await focusMinecraft();
      const safeDuration = Math.max(50, Math.min(duration_ms, 10_000)) / 1000;
      const down = keyAction(direction, "key down");
      const up = keyAction(direction, "key up");
      const sprintDown = sprint ? "key down control" : "";
      const sprintUp = sprint ? "key up control" : "";
      await osascript(`
tell application "System Events"
  ${sprintDown}
  ${down}
  delay ${safeDuration}
  ${up}
  ${sprintUp}
end tell
`);
      return result(`Moved ${direction} for ${duration_ms}ms${sprint ? " while sprinting" : ""}.`);
    },
  );

  server.tool(
    "send_chat",
    "Open chat and type using macOS System Events. Disabled by default.",
    {
      message: z.string().min(1).max(256),
      focus_first: z.boolean().default(true),
    },
    async ({ message, focus_first }) => {
      if (focus_first) await focusMinecraft();
      await osascript(`
on run argv
  tell application "System Events"
    keystroke "t"
    delay 0.2
    keystroke item 1 of argv
    key code 36
  end tell
end run
`, [message]);
      return result("Chat message sent.");
    },
  );

  server.tool(
    "send_command",
    "Open chat and submit a slash command using macOS System Events. Disabled by default.",
    {
      command: z.string().min(1).max(256),
      focus_first: z.boolean().default(true),
    },
    async ({ command, focus_first }) => {
      const normalized = command.startsWith("/") ? command : `/${command}`;
      if (focus_first) await focusMinecraft();
      await osascript(`
on run argv
  tell application "System Events"
    keystroke "t"
    delay 0.2
    keystroke item 1 of argv
    key code 36
  end tell
end run
`, [normalized]);
      return result("Command submitted. If the server rejects it, that is normal without permissions.");
    },
  );
}

server.tool(
  "get_client_state",
  "Read local Fabric client state exposed by the optional AgentControl Fabric mod. The 'screen' field indicates whether a menu is open; this is handled automatically by action tools. Use 'filter' to efficiently search for specific blocks (e.g. 'shulker_box' or 'chest') without flooding the response with stone/dirt. The 'crosshairTarget.properties' field reveals block variants like color, orientation, or facing.",
  {
    scan_radius: z.number().int().min(1).max(16).optional().describe("Radius for nearby block scan (1-16 blocks). Default is 4. Larger values return more blocks but increase response size."),
    filter: z.string().optional().describe("Filter nearbyBlocks by block ID substring. Only blocks whose ID contains this string are returned. Use this to efficiently locate specific blocks (e.g. 'shulker_box', 'lantern', 'chest') without receiving thousands of stone/dirt entries."),
  },
  async ({ scan_radius, filter }) => {
    try {
      return jsonResult(await fetchClientState(scan_radius, filter));
    } catch (error) {
      throw new Error(error.message);
    }
  },
);

server.tool(
  "mod_move_player",
  "Move the current player through the Fabric client mod. For moving to specific coordinates, prefer mod_move_to which auto-calculates direction and estimates duration. This tool is for fine adjustments or when you need to move in the player's current facing direction. Movement is frame-rate dependent and imprecise (~4-5 blocks/sec walking). Use longer durations (3-5s) for big moves, 500-1000ms for fine adjustments. Always verify position with get_client_state after moving. Coordinate directions: forward/back align with current yaw; x increases=east, decreases=west; z increases=south, decreases=north.",
  {
    direction: z.enum(["forward", "back", "left", "right", "jump", "sneak", "sprint"]),
    duration_ms: z.number().int().min(50).max(10_000).default(1000).describe("Duration in milliseconds. Use 3000-5000 for longer moves, 500-1000 for fine adjustments."),
  },
  async ({ direction, duration_ms }) => {
    await ensureScreenClosed();
    return jsonResult(
      await fetchClientAction({ type: "move", direction, durationMs: duration_ms }),
    );
  },
);

server.tool(
  "mod_move_multi",
  "Move the player with multiple simultaneous key presses (e.g. jump+forward to jump over obstacles). The screen will be closed automatically if needed. Combine directions with '+'. Example: 'jump+forward' jumps while moving forward.",
  {
    directions: z.string().describe("Comma-separated directions to press simultaneously. Options: forward, back, left, right, jump, sneak, sprint. Example: 'jump,forward'"),
    duration_ms: z.number().int().min(50).max(10_000).default(1000).describe("Duration in milliseconds."),
  },
  async ({ directions, duration_ms }) => {
    await ensureScreenClosed();
    const dirs = directions.replace(/\+/g, ",");
    return jsonResult(
      await fetchClientAction({ type: "move_multi", directions: dirs, durationMs: duration_ms }),
    );
  },
);

server.tool(
  "mod_look",
  "Set the current player's yaw and pitch through the Fabric client mod. The screen will be closed automatically if needed.",
  {
    yaw: z.number().min(-180).max(180),
    pitch: z.number().min(-90).max(90),
  },
  async ({ yaw, pitch }) => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "look", yaw, pitch }));
  },
);

server.tool(
  "mod_look_at",
  "Look at a specific world coordinate through the Fabric client mod. The screen will be closed automatically if needed. If an integer block coordinate is passed (e.g. x=128, y=64, z=-256), the mod automatically adds 0.5 to target the block center, ensuring the raycast hits the block's collision box rather than passing through the block edge. After calling this, ALWAYS call get_client_state to verify crosshairTarget.block and crosshairTarget.properties (e.g. color) match your intended target before breaking or placing. If the target is wrong, move to a different angle (e.g. approach from the east or west side) and try again.",
  {
    x: z.number().describe("Target X coordinate in the world. If integer, mod adds 0.5 to center."),
    y: z.number().describe("Target Y coordinate in the world. If integer, mod adds 0.5 to center."),
    z: z.number().describe("Target Z coordinate in the world. If integer, mod adds 0.5 to center."),
  },
  async ({ x, y, z }) => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "look_at", x, y, z }));
  },
);

server.tool(
  "mod_look_facing",
  "Face a cardinal direction or up/down through the Fabric client mod. The screen will be closed automatically if needed. Useful for orienting the player before movement. Coordinate reference: north=decrease Z, south=increase Z, west=decrease X, east=increase X. Example: to move toward a block at z=543 from z=532, face south (z increases southward).",
  {
    direction: z.enum(["north", "south", "east", "west", "up", "down"]).describe("Direction to face. north=decrease Z, south=increase Z, west=decrease X, east=increase X."),
  },
  async ({ direction }) => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "look_facing", direction }));
  },
);

server.tool(
  "mod_attack",
  "Attack through the Fabric client mod. The screen will be closed automatically if needed.",
  {},
  async () => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "attack" }));
  },
);

server.tool(
  "mod_use_item",
  "Use the held item through the Fabric client mod. The screen will be closed automatically if needed.",
  {},
  async () => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "use" }));
  },
);

server.tool(
  "mod_break_crosshair_block",
  "Break the block currently targeted by the crosshair. For breaking blocks at known coordinates, prefer mod_break_block which auto-aims. This tool is for when you already have the crosshair on the right block (e.g. after mod_look_at + verify). CRITICAL: Before calling, verify crosshairTarget is not null and matches the intended block via get_client_state. Check crosshairTarget.block and crosshairTarget.properties (e.g. color:purple) match your target.",
  {},
  async () => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "break_crosshair" }));
  },
);

server.tool(
  "mod_place_crosshair_block",
  "Place/use the held item on the block currently targeted by the crosshair through the Fabric client mod. The screen will be closed automatically if needed. IMPORTANT: Before calling this tool, you MUST verify that crosshairTarget is not null and matches the intended block via get_client_state. If crosshairTarget is null or points to the wrong block, adjust position or use mod_look_at first.",
  {},
  async () => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "place_crosshair" }));
  },
);

server.tool(
  "mod_select_slot",
  "Select a hotbar slot (0-8) through the Fabric client mod. The screen will be closed automatically if needed.",
  {
    slot: z.number().int().min(0).max(8),
  },
  async ({ slot }) => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "select_slot", slot }));
  },
);

server.tool(
  "mod_drop",
  "Drop the currently held item through the Fabric client mod. The screen will be closed automatically if needed.",
  {
    stack: z.boolean().default(false).describe("If true, drop the entire stack. If false, drop one item."),
  },
  async ({ stack }) => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "drop", stack }));
  },
);

server.tool(
  "mod_swap_hands",
  "Swap the item in the main hand with the item in the off hand through the Fabric client mod. The screen will be closed automatically if needed.",
  {},
  async () => {
    await ensureScreenClosed();
    return jsonResult(await fetchClientAction({ type: "swap_hands" }));
  },
);

server.tool(
  "mod_break_block",
  "Break a block at specific world coordinates. PREFERRED METHOD for breaking blocks — use this instead of the 3-step look_at + get_client_state(verify) + break_crosshair workflow. Automatically aims at block center and attacks. If the block is covered by another block (e.g. grass covering a bed at y+1), break the covering block FIRST with mod_break_block(x, y+1, z), then break the target. Works within ~4.5 blocks survival reach. Returns ok:true if the block was targeted.",
  {
    x: z.number().describe("X coordinate of the block to break"),
    y: z.number().describe("Y coordinate of the block to break"),
    z: z.number().describe("Z coordinate of the block to break"),
  },
  async ({ x, y, z }) => {
    await ensureScreenClosed();
    return jsonResult(
      await fetchClientAction({ type: "break_block", x, y, z }),
    );
  },
);

server.tool(
  "mod_move_to",
  "Move toward target X/Z coordinates. PREFERRED METHOD for navigation — use this instead of manual look_facing + mod_move_player duration estimation. Automatically calculates direction, estimates travel time (~4.3 blocks/sec), detects 1-block obstacles ahead and auto-jumps. Returns distance, durationMs, and whether it jumped. After movement completes, ALWAYS call get_client_state to verify final position (movement is frame-rate dependent, may overshoot/undershoot by 1-2 blocks). Coordinate reference: x increases=east, x decreases=west; z increases=south, z decreases=north. Only handles horizontal movement — player must already be on correct Y level.",
  {
    x: z.number().describe("Target X coordinate"),
    z: z.number().describe("Target Z coordinate"),
  },
  async ({ x, z }) => {
    await ensureScreenClosed();
    return jsonResult(
      await fetchClientAction({ type: "move_to", x, z }),
    );
  },
);

server.tool(
  "mod_close_screen",
  "Close the current Minecraft client screen (including ESC pause menu) through the Fabric client mod. If this does not fully close the screen, use mod_release_mouse afterward. Minecraft may capture the mouse afterward.",
  {},
  async () => jsonResult(await fetchClientAction({ type: "close_screen" })),
);

server.tool(
  "mod_release_mouse",
  "Open a transparent non-pausing screen through the Fabric client mod so the OS mouse is not captured. Use this when mod_close_screen does not fully close the ESC menu or other screens. This keeps the screen open but releases mouse control.",
  {},
  async () => jsonResult(await fetchClientAction({ type: "release_mouse" })),
);

const transport = new StdioServerTransport();
await server.connect(transport);
