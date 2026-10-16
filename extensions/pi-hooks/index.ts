/**
 * pi-hooks (skill-pi) — Claude Code-compatible command hooks for the Pi coding
 * agent. Hooks are declared in the `hooks` key of settings.json (project
 * `.skill-pi/settings.json`, merged over `~/.skill-pi/agent/settings.json`) and
 * run as bash commands that receive Claude Code-style JSON on stdin and may
 * answer with Claude Code-style JSON on stdout.
 *
 * Supported events: SessionStart, SessionEnd, PreCompact, PostCompact,
 * PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop.
 *
 * Forked from hsingjui/pi-hooks (MIT), homogenized for skill-pi: config
 * resolves through the isolated agent dir (getAgentDir, never the stock
 * ~/.pi/agent) and the project dir is `.skill-pi`, not `.pi`.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createHookContext } from "./src/hook-context.ts";
import { registerCompactHooks } from "./src/hooks/compact-hooks.ts";
import { registerPromptHooks } from "./src/hooks/prompt-hooks.ts";
import { registerSessionHooks } from "./src/hooks/session-hooks.ts";
import { registerStopHooks } from "./src/hooks/stop-hooks.ts";
import { registerToolHooks } from "./src/hooks/tool-hooks.ts";

export default function (pi: ExtensionAPI) {
  const shared = createHookContext(pi);

  registerSessionHooks(pi, shared);
  registerCompactHooks(pi, shared);
  registerPromptHooks(pi, shared);
  registerStopHooks(pi, shared);
  registerToolHooks(pi, shared);
}
