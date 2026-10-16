# pi-hooks

Claude Code-compatible command hooks for the Pi coding agent, homogenized into skill-pi.
Based on [hsingjui/pi-hooks](https://github.com/hsingjui/pi-hooks) (MIT).

This package adapts Claude Code's hook configuration format to Pi's extension event
system so existing command hook workflows can be reused with minimal changes.

## Isolation

Unlike stock pi, skill-pi resolves its agent dir from `PI_CODING_AGENT_DIR`
(`~/.skill-pi/agent`, never the stock `~/.pi/agent`). This extension follows that
contract:

- **Global hooks** live in `<agent-dir>/settings.json` (i.e. `~/.skill-pi/agent/settings.json`),
  resolved via `getAgentDir()` — never `~/.pi/agent/settings.json`.
- **Project hooks** live in `<project>/.skill-pi/settings.json` — never
  `<project>/.pi/settings.json`.

Global and project hook groups are merged by concatenating per-event arrays.

## Quick Setup

1. Add hooks to `.skill-pi/settings.json` (project) or `~/.skill-pi/agent/settings.json` (global):

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "echo 'agent finished'"
          }
        ]
      }
    ]
  }
}
```

2. Run `/reload`, then send a message to test it.

## Current Support

- Only `type: "command"` is supported
- Supports the `if` field on individual hook handlers for tool events only
- Supported events:
  - `SessionStart`
  - `SessionEnd`
  - `PreCompact`
  - `PostCompact`
  - `PreToolUse`
  - `PostToolUse`
  - `PostToolUseFailure`
  - `UserPromptSubmit`
  - `Stop`
- Not supported: `http`, `prompt`, `agent`

## Event Mapping

- `SessionStart.startup` → `session_start(reason="startup")`
- `SessionStart.startup` → `session_start(reason="new")`
- `SessionStart.resume` → `session_start(reason="resume")`
- `SessionStart.compact` → `session_compact`
- `SessionEnd.other` → `session_shutdown`
- `Stop` → `agent_end` (best-effort emulation of Claude Code's "after response completes" behavior)

## `matcher` Behavior

To stay aligned with Claude Code, `matcher` is a **single regex string**.

- Omitted `matcher` means match everything
- `""` means match everything
- `"*"` means match everything
- Any other value is treated as a regular expression
- If the regex is invalid, it falls back to exact string matching

Example:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'bash only'"
          }
        ]
      },
      {
        "matcher": "write|edit",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'write or edit'"
          }
        ]
      }
    ]
  }
}
```

Event-specific matching fields:

### SessionStart

Matches `source`: `startup`, `resume`, `compact`.

### SessionEnd

Matches `reason`: `other`.

### PreToolUse / PostToolUse / PostToolUseFailure

Matches `tool_name`. This uses Pi's raw tool names directly, so names are usually
lowercase: `bash`, `read`, `write`, `edit`, `grep`, `find`, `ls`, `mcp__.*`.

Notes:

- `SessionEnd` is triggered from `session_shutdown`
- When `matcher` is omitted, it defaults to `other` for `SessionEnd`
- `UserPromptSubmit` and `Stop` do not support `matcher`; if provided, it is ignored

## `if` Conditions

Following Claude Code's approach, `if` is configured on each individual hook handler and
only works for tool events: `PreToolUse`, `PostToolUse`, `PostToolUseFailure`.
If `if` is set on other event types, that hook will not run.

Currently supported forms:

- `Bash(git *)`
- `bash(git *)`
- `Edit(*.ts)`
- `Write(*.md)`
- `mcp__memory__create_entities(*)`

Rules:

- `if` syntax is `ToolName(pattern)`
- `ToolName` is compared case-insensitively
- `pattern` uses simple wildcard matching where `*` means any string
- `bash` mainly matches `tool_input.command`
- `read`, `write`, and `edit` mainly match `tool_input.path` (or `file_path`)
- Other tools first try common primary fields, then fall back to the JSON string of `tool_input`

Example: block only `git push`

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "bash",
        "hooks": [
          {
            "type": "command",
            "if": "Bash(git push*)",
            "command": "printf '%s\\n' '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"git push is blocked\"}}'"
          }
        ]
      }
    ]
  }
}
```

## Hook Input

Input fields are as close as possible to Claude Code hooks:

- Common fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`
- Event-specific fields such as `source`, `reason`, `tool_name`, `tool_input`, `tool_response`
- Pi-specific extra fields may also be included, but they should not break Claude Code-style scripts

## Hook Output

### UserPromptSubmit: block the prompt or inject extra context

```json
{
  "decision": "block",
  "reason": "Explanation for decision",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "My additional context here"
  }
}
```

Notes:

- The only meaningful `decision` value is `"block"`; omitting `decision` means allow
- `reason` is shown to the user but not injected into context
- `additionalContext` is injected as hidden context into the current turn

### Stop: prevent stopping and continue for one more turn

```json
{
  "decision": "block",
  "reason": "Run a final self-check before stopping",
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "Verify there are no missing tests."
  }
}
```

Notes:

- The only meaningful `decision` value is `"block"`; omitting `decision` means finish normally
- `reason` and `additionalContext` are injected together as hidden context into the follow-up agent turn
- `stop_hook_active` becomes `true` in follow-up `Stop` events triggered by a previous `Stop` hook, which helps avoid infinite loops
- The implementation is based on Pi's `agent_end` + `sendMessage(..., { triggerTurn: true })`, so behavior is best-effort

### PreToolUse: deny or rewrite input

Available output fields:

- `permissionDecision`: `"allow" | "deny" | "ask"`
- `permissionDecisionReason`: the reason shown to the user/caller
- `updatedInput`: rewrites tool input before execution
- `additionalContext`: appends extra context for later processing

Notes:

- `permissionDecision: "deny"` blocks the current tool call and returns `permissionDecisionReason` to the agent
- `permissionDecision: "allow"` lets the tool run; if `updatedInput` is provided, the input is merged before execution
- `permissionDecision: "ask"` is kept for compatibility only; no additional permission UI is opened
- `updatedInput` is merged into `event.input`; unspecified fields keep their original values
- `additionalContext` does not block execution; it is injected as hidden context
- To explicitly stop the current processing flow, use Claude Code's generic field `continue: false`

### PostToolUse: append context or patch tool results

Claude Code-style output:

```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Command succeeded"
  }
}
```

Pi-specific direct result patching is also supported:

```json
{
  "systemMessage": "Hook patched tool result",
  "content": [
    {
      "type": "text",
      "text": "patched result"
    }
  ],
  "isError": false
}
```

Notes:

- `decision: "block"` does not roll back an already executed tool; `reason` is appended to model context as feedback
- `additionalContext` is injected as hidden context into the current agent flow
- `systemMessage` is silent by default for tool-related events
- `continue: false` stops current processing in tool events on a best-effort basis
- Pi-specific patching fields: top-level `content`, `details`, `isError`; `hookSpecificOutput.updatedToolResult`;
  `updatedMCPToolOutput` / `hookSpecificOutput.updatedMCPToolOutput`

## Project Structure

Source code lives in `src/`:

- `index.ts` — extension entry point
- `src/config.ts` — config loading and merging
- `src/executor.ts` — command hook executor
- `src/helpers.ts` — content extraction helpers
- `src/hook-context.ts` — shared module context (settings, dedupe, notify)
- `src/hooks/shared.ts` — shared parsing and execution helpers
- `src/hooks/session-hooks.ts` — `SessionStart` / `SessionEnd`
- `src/hooks/compact-hooks.ts` — `PreCompact` / `PostCompact`
- `src/hooks/prompt-hooks.ts` — `UserPromptSubmit`
- `src/hooks/tool-hooks.ts` — `PreToolUse` / `PostToolUse` / `PostToolUseFailure`
- `src/hooks/stop-hooks.ts` — `Stop`
- `src/types.ts` — type definitions

## Notes

- Hook commands run in the current session `cwd`
- Global config and project config are merged by concatenating event arrays
- `PostToolUse` and `PostToolUseFailure` support Pi result patching
- Input/output aims to be Claude Code-compatible where possible; anything that cannot be
  mapped exactly is handled in a best-effort way using Pi's event model

## Development

This extension is self-contained per ADR-0007: its toolchain (`typescript`, `vitest`,
`@types/node`) is declared locally and installed opt-in by contributors.

```sh
cd extensions/pi-hooks
npm install        # local dev toolchain
npm run check      # tsc --noEmit
npm test           # vitest run
```
