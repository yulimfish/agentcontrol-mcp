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

async function fetchClientState(scanRadius) {
  const url = new URL(clientStateUrl);
  if (scanRadius !== undefined && scanRadius !== null) {
    url.searchParams.set("scanRadius", String(scanRadius));
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
  "Read local Fabric client state exposed by the optional AgentControl Fabric mod. IMPORTANT: Check the 'screen' field in the returned state before any action. If 'screen' is not null (e.g., ESC pause menu is open), use mod_close_screen first, then mod_release_mouse if still open. Only proceed with actions when screen is null.",
  {
    scan_radius: z.number().int().min(1).max(16).optional().describe("Radius for nearby block scan (1-16 blocks). Default is 4. Larger values return more blocks but increase response size."),
  },
  async ({ scan_radius }) => {
    try {
      return jsonResult(await fetchClientState(scan_radius));
    } catch (error) {
      throw new Error(error.message);
    }
  },
);

server.tool(
  "mod_move_player",
  "Move the current player through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null (no ESC menu open). If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed. Only then execute this action.",
  {
    direction: z.enum(["forward", "back", "left", "right", "jump", "sneak", "sprint"]),
    duration_ms: z.number().int().min(50).max(10_000).default(1000),
  },
  async ({ direction, duration_ms }) => jsonResult(
    await fetchClientAction({ type: "move", direction, durationMs: duration_ms }),
  ),
);

server.tool(
  "mod_look",
  "Set the current player's yaw and pitch through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null. If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed.",
  {
    yaw: z.number().min(-180).max(180),
    pitch: z.number().min(-90).max(90),
  },
  async ({ yaw, pitch }) => jsonResult(await fetchClientAction({ type: "look", yaw, pitch })),
);

server.tool(
  "mod_attack",
  "Attack through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null. If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed.",
  {},
  async () => jsonResult(await fetchClientAction({ type: "attack" })),
);

server.tool(
  "mod_use_item",
  "Use the held item through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null. If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed.",
  {},
  async () => jsonResult(await fetchClientAction({ type: "use" })),
);

server.tool(
  "mod_break_crosshair_block",
  "Start breaking the block currently targeted by the crosshair through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null. If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed.",
  {},
  async () => jsonResult(await fetchClientAction({ type: "break_crosshair" })),
);

server.tool(
  "mod_place_crosshair_block",
  "Place/use the held item on the block currently targeted by the crosshair through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null. If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed.",
  {},
  async () => jsonResult(await fetchClientAction({ type: "place_crosshair" })),
);

server.tool(
  "mod_select_slot",
  "Select a hotbar slot (0-8) through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null. If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed.",
  {
    slot: z.number().int().min(0).max(8),
  },
  async ({ slot }) => jsonResult(await fetchClientAction({ type: "select_slot", slot })),
);

server.tool(
  "mod_drop",
  "Drop the currently held item through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null. If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed.",
  {
    stack: z.boolean().default(false).describe("If true, drop the entire stack. If false, drop one item."),
  },
  async ({ stack }) => jsonResult(await fetchClientAction({ type: "drop", stack })),
);

server.tool(
  "mod_swap_hands",
  "Swap the item in the main hand with the item in the off hand through the Fabric client mod. IMPORTANT: Must check state first and ensure screen is null. If screen is open, close it with mod_close_screen first, then mod_release_mouse if needed.",
  {},
  async () => jsonResult(await fetchClientAction({ type: "swap_hands" })),
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
