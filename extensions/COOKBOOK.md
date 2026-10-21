# Pi Extension Cookbook

Building blocks for skill-pi extensions. This document is the answer to "how do I add extension #16?" — it covers the complete extension-building pattern: anatomy, API surface, event taxonomy, tool definition, dual-mode UI, state management, config, sidebar cards, cross-extension communication, keybindings, defensive coding, testing, and a step-by-step checklist.

Source: distilled from gentle-shell's `extensions/` (20 files, MIT) and skill-pi's 14 bundled extensions. Pi 1.2.0.

## Table of Contents

1. [Extension Anatomy](#1-extension-anatomy)
2. [ExtensionAPI Surface](#2-extensionapi-surface)
3. [Event Taxonomy](#3-event-taxonomy)
4. [ToolDefinition Reference](#4-tooldefinition-reference)
5. [Dual-Mode UI Pattern](#5-dual-mode-ui-pattern)
6. [State Management Patterns](#6-state-management-patterns)
7. [Config Patterns](#7-config-patterns)
8. [Sidebar Card Integration](#8-sidebar-card-integration)
9. [Cross-Extension Communication](#9-cross-extension-communication)
10. [Keybindings](#10-keybindings)
11. [Defensive Coding Checklist](#11-defensive-coding-checklist)
12. [Testing Patterns](#12-testing-patterns)
13. [Gentle-Shell Pattern Index](#13-gentle-shell-pattern-index)
14. [Building a New Extension — Checklist](#14-building-a-new-extension--checklist)

## 1. Extension Anatomy

The complete shape of a skill-pi extension: directory layout, `package.json` fields, `index.ts` entry point, `src/` module split, `tsconfig.json`, test layout. Canonical example: `extensions/todo/`.

### Directory layout

```
extensions/<name>/
├── index.ts            # entry point: default export factory, wiring only
├── src/
│   └── *.ts            # pure logic: model, rendering, config, no pi imports
├── *.spec.ts           # tests for index.ts wiring (extension root)
├── package.json        # @devopstales/pi-<name>, self-contained (ADR-0007)
├── tsconfig.json       # extends a bundled extension's tsconfig
└── README.md           # what it does, env vars, attribution
```

Real listing from `extensions/todo/`:

```
extensions/todo/: card-golden.spec.ts  card.spec.ts  index.spec.ts  index.ts
                  model.spec.ts  package.json  README.md  src  tsconfig.json
extensions/todo/src/: card.ts  index.ts  model.ts  theme.ts
```

### package.json

Fields, per ADR-0005 (naming) and ADR-0007 (self-contained):

| Field | Value / rule |
|---|---|
| `name` | `@devopstales/pi-<name>` (ADR-0005) |
| `version` | `0.1.0` |
| `type` | `module` |
| `license` | `MIT` |
| `files` | `index.ts`, `src`, `README.md` |
| `publishConfig` | `access: public`, GitHub npm registry |
| `scripts.check` | `tsc --noEmit -p .` |
| `scripts.test` | `vitest run` |
| `peerDependencies` | `@earendil-works/pi-coding-agent: ^1.2.0` (+ `pi-tui` / `pi-ai` as needed); runtime deps come from the root `node_modules` |
| `devDependencies` | `@types/node`, `typescript`, `vitest` |

Real `extensions/todo/package.json`:

```json
{
  "name": "@devopstales/pi-todo",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "description": "A todo tool and live task card for pi, integrated with the skill-pi-tui sidebar. Based on gentle-shell's gentle-todo (MIT) and juicesharp's rpiv-todo (MIT).",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/devopstales/skill-pi.git"
  },
  "homepage": "https://github.com/devopstales/skill-pi",
  "bugs": {
    "url": "https://github.com/devopstales/skill-pi/issues"
  },
  "keywords": [
    "pi",
    "extension",
    "coding-agent",
    "todo",
    "task-list"
  ],
  "files": [
    "index.ts",
    "src",
    "README.md"
  ],
  "publishConfig": {
    "access": "public",
    "registry": "https://npm.pkg.github.com"
  },
  "scripts": {
    "check": "tsc --noEmit -p .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "typebox": "*"
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": "^1.2.0",
    "@earendil-works/pi-tui": "*",
    "@earendil-works/pi-ai": "*",
    "@devopstales/skill-pi": "^0.1.0"
  },
  "peerDependenciesMeta": {
    "@devopstales/skill-pi": {
      "optional": true
    }
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.5.0",
    "vitest": "^5.0.0"
  }
}
```

### index.ts entry point

The entry point is a default-exported factory taking `pi: ExtensionAPI`. Two rules hold in every bundled extension:

1. **Env kill-switch first.** The factory is callable in every mode, so it guards `SKILL_PI_<NAME>` at the top and returns before any registration side effect when disabled.
2. **Wiring in index.ts, logic in src/.** `index.ts` only calls `pi.registerTool`, `pi.on`, `pi.registerShortcut`, and holds the per-session state. Pure functions live in `src/` and are imported, so they are testable without pi.

Kill-switch from `extensions/webfetch/index.ts` (lines 72–87):

```typescript
export default function (pi: ExtensionAPI): void {
  // When SKILL_PI_WEBFETCH disables the extension, keep the factory callable
  // but skip all registration side effects.
  if (!isWebfetchEnabled()) {
    return;
  }

  const registry = buildRegistry(pi);
  const webfetch = createWebfetchTool({ handlers: registry });

  pi.registerTool({
    ...webfetch,
    renderCall: renderWebfetchCall,
    renderResult: renderWebfetchResult,
  });
}
```

Kill-switch helpers from `extensions/todo/index.ts` (lines 90–99), exported so tests can drive them with a faked env:

```typescript
export function todoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.SKILL_PI_TODO?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

export function todoCollapseKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.SKILL_PI_TODO_KEY?.trim();
  if (value === undefined) return COLLAPSE_KEY_DEFAULT;
  return value === "" || value.toLowerCase() === "off" ? undefined : value;
}
```

Factory shape from `extensions/todo/index.ts` (lines 122–125):

```typescript
export default function piTodo(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
  if (!todoEnabled(env)) return;
  const sessions = new Map<string, TodoSession>();
  const collapseKey = todoCollapseKey(env);
  // …
}
```

### tsconfig.json

Extensions extend an existing bundled tsconfig instead of re-declaring compiler options. Real `extensions/todo/tsconfig.json` (note: the `include` list reaches into `skill-pi-tui/src/` because todo imports from it directly):

```json
{
  "extends": "../skill-pi-tui/tsconfig.json",
  "include": ["index.ts", "src/**/*.ts", "*.spec.ts", "../skill-pi-tui/src/card.ts", "../skill-pi-tui/src/sidebar.ts", "../skill-pi-tui/src/sidebar-layout.ts", "../skill-pi-tui/src/text.ts"]
}
```

The base it extends, `extensions/skill-pi-tui/tsconfig.json`, is the canonical compiler-option set:

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022",
    "types": ["node"],
    "verbatimModuleSyntax": true
  },
  "include": ["index.ts", "src/**/*.ts", "native-tui-loader.mjs", "*.spec.ts"]
}
```

### Test layout

`*.spec.ts` files live at the extension root (for `index.ts` wiring) and next to `src/` modules in practice via root-level files per module: `extensions/todo/` ships `model.spec.ts` (pure model), `card.spec.ts` (rendering), `card-golden.spec.ts` (golden files), and `index.spec.ts` (factory wiring with a mocked `ExtensionAPI`). Running `npm test` in the extension dir executes `vitest run` over all of them.

### Auto-discovery

`bin/skill-pi.js` scans `extensions/` itself (`collectExtensionFiles`): top-level `*.ts`/`*.js` files alphabetically, plus subdirectories that carry an entry point (`index.ts` or `index.js`). A new `extensions/<name>/index.ts` is picked up with **no wrapper or manifest edit** (ADR-0001). A `.md` file like this cookbook is invisible to the loader.

## 2. ExtensionAPI Surface

The complete `ExtensionAPI` interface from pi 1.2.0 (`dist/core/extensions/types.d.ts`). The factory receives `pi: ExtensionAPI`; everything an extension can do is on it. ADR-0006: build on this public surface only — never import pi internals.

Every method, with its signature (from the 1.2.0 `.d.ts`) and at least one bundled extension that uses it.

### Event subscription

| Method | Description | Used by |
|---|---|---|
| `pi.on(event, handler)` | Subscribe to a typed pi event (see Section 3); returns an unsubscribe function | `todo` (`pi.on("context", …)`, line 384), `permission` (line 93), all 14 |
| `pi.events` | `EventBus` — shared extension-to-extension bus, `on`/`emit` | `command-plate` (line 452, 109), `pi-swarm` (line 338, 333), `ask-user` (line 89) |

### Registration

| Method | Description | Used by |
|---|---|---|
| `pi.registerTool(tool: ToolDefinition): void` | Register an LLM-callable tool (Section 4) | `todo` (line 252), `file-search` (lines 210, 261), `ask-user` |
| `pi.registerCommand(name, options): void` | Register a `/slash` command | `permission` (line 56), `pi-vcc` (`src/commands/*.ts`), `plan-build`, `command-plate` |
| `pi.registerShortcut(keyId, options): void` | Register a keyboard shortcut | `todo` (line 333, alt+shift+up/down), `permission` (line 51, configurable auto-accept) |
| `pi.registerFlag(name, options): void` | Register a CLI flag (`boolean` or `string`, optional default) | `plan-build` (`src/ui.ts` line 40: `--plan`, `--build`) |
| `pi.registerProvider(provider \| name, config): void` | Register/override a model provider (models, `baseUrl`, `apiKey`, `oauth`, `streamSimple`); queued during load, immediate after bind | `providers/zen/provider.ts` (line 117), `providers/antigravity/provider.ts` (line 115) |
| `pi.unregisterProvider(name): void` | Remove a provider and restore overridden built-in models | — (no bundled usage; API-only) |
| `pi.registerMcpServer(name, config): void` | Register an MCP server (same config as `mcp.json`); not persisted — re-register on every load | — in production (exercised by `pi-context-view` runtime tests, e.g. `test/payload-runtime.test.ts` line 192) |
| `pi.unregisterMcpServer(name): void` | Remove an MCP server and close its connection | — (API-only) |
| `pi.registerVirtualModel(model): void` | Register a selectable virtual model that routes each request to a physical model | — (API-only) |
| `pi.unregisterVirtualModel(provider, id): void` | Remove a virtual model | — (API-only) |
| `pi.registerMessageRenderer(customType, renderer): void` | Render a `CustomMessageEntry` in the transcript | `pi-swarm` (line 650, swarm result messages) |
| `pi.registerEntryRenderer(customType, renderer): void` | Render a `CustomEntry` (never sent to the LLM) | `plan-build` (`src/question-ui.ts`) |
| `pi.registerToolRenderer(resolver): void` | Choose how tool calls are drawn; resolvers run in extension load order | — (API-only) |
| `pi.registerMarkdownTransformer(transformer): void` | Transform user/assistant Markdown before interactive rendering | — (API-only) |

### Message sending & persistence

| Method | Description | Used by |
|---|---|---|
| `pi.sendMessage(message, options?)` | Append a custom message to the session; `options`: `{ triggerTurn?: boolean, deliverAs?: "steer" \| "followUp" \| "nextTurn" }` | `todo` (hidden state messages, line 153), `skill-loader` (catalog), `pi-hooks` (`src/hook-context.ts` line 45) |
| `pi.sendUserMessage(content, options?)` | Send a user message that always triggers a turn; `options`: `{ deliverAs?: "steer" \| "followUp", expandPromptTemplates?: boolean }` | `pi-vcc` (`src/commands/pi-vcc.ts` line 21), `plan-build` (handoff), `pi-context-view` (`src/probe/trigger.ts` line 88) |
| `pi.appendEntry(customType, data?)` | Append a custom entry for state persistence — **not** sent to the LLM (Section 6, Pattern 2) | `plan-build` (line 154), `pi-context-view` (`src/usage.ts`), `pi-vcc` |

### Session metadata & process

| Method | Description | Used by |
|---|---|---|
| `pi.setSessionName(name): void` | Set the session display name (session selector) | — (session names come from the TUI footer's `ctx.sessionManager.getSessionName()`, `skill-pi-tui/src/footer.ts` line 247) |
| `pi.getSessionName(): string \| undefined` | Get the current session name | — (API-only) |
| `pi.setLabel(entryId, label): void` | Set or clear a user-defined label on an entry (bookmarking) | — (API-only) |
| `pi.exec(command, args, options?): Promise<ExecResult>` | Run a shell command; `options`: `{ signal?, timeout?, cwd? }`, result `{ stdout, stderr, code, killed }` | — in production (extensions run processes via `Effect` `ChildProcess` or `node:child_process` instead, e.g. `file-search/src/process.ts` line 98) |

### Tools & settings queries

| Method | Description | Used by |
|---|---|---|
| `pi.getActiveTools(): string[]` | Names of the tools declared to the model | `plan-build`, `pi-context-view` |
| `pi.setActiveTools(toolNames): void` | Activate tools by name; unknown/`hidden` ignored | `plan-build` |
| `pi.getAllTools(): ToolInfo[]` | Every configured tool: schema, guidelines, exposure, source | `permission`, `pi-context-view`, `skill-pi-tui` (counts custom tools) |
| `pi.getSettings(): Settings` | Effective settings (global + project merged) | `skill-pi-tui` (line 209, wrapped in try/catch), `pi-context-view` (`src/settings.ts`) |
| `pi.getCommands(): SlashCommandInfo[]` | Available slash commands | `permission`, `pi-context-view` |

### Model & thinking level

| Method | Description | Used by |
|---|---|---|
| `pi.setModel(model): Promise<boolean>` | Set the model for this session only (not the default); `false` when the provider has no auth | `plan-build` (`src/handoff.ts` line 44) |
| `pi.getThinkingLevel(): ThinkingLevel` | Current thinking level | `skill-pi-tui` (line 203, behind try/catch — structural feature detection) |
| `pi.setThinkingLevel(level): void` | Set thinking level (clamped to model capabilities) | `plan-build` (`src/handoff.ts` line 49) |
| `pi.getFlag(name): boolean \| string \| undefined` | Read a registered CLI flag | `plan-build` (`hooks.ts` line 291: `pi.getFlag("plan")`) |

### MCP & editor

| Method | Description | Used by |
|---|---|---|
| `pi.getMcpServers(): RegisteredMcpServer[]` | Every MCP server registered by extensions | `skill-pi-tui` (line 234, footer MCP count) |
| `ctx.ui.getEditorComponent(): EditorFactory \| undefined` | Read the active editor factory (lives on `ctx.ui`, not `pi`) | — (API-only) |

Two conventions every bundled extension follows when using this surface:

- **Feature-detect newer APIs.** `skill-pi-tui/index.ts` (lines 201–205) wraps `pi.getThinkingLevel()` in try/catch and stores the function, so an older pi without it degrades instead of crashing:

```typescript
try {
  getThinkingLevelFn = () => pi.getThinkingLevel();
} catch {
  getThinkingLevelFn = undefined;
}
```

- **Guard optional actions.** `todo/index.ts` (line 152) checks `pi.sendMessage` before calling it — the factory runs in every mode, including print, where some actions are absent.

## 3. Event Taxonomy

All pi 1.2.0 events, from the `ExtensionEvent` union in `dist/core/extensions/types.d.ts`, grouped by lifecycle category. Every handler has the same shape — return nothing for a void event, or the event's result type to block/modify:

```typescript
type ExtensionHandler<E, R = undefined> = (event: E, ctx: ExtensionContext) => Promise<R | void> | R | void;
```

`pi.on(...)` returns an unsubscribe function. The only exception is `project_trust`, which uses `ProjectTrustContext` (no `sessionManager`) instead of `ExtensionContext` because it fires before a session exists.

### System

| Event | Return semantics | Example |
|---|---|---|
| `project_trust` | **DECIDES** — must return `{ trusted: "yes" \| "no" \| "undecided", remember? }`; fires before session start, cannot be cancelled by return | — (no bundled extension; trust is pi's default prompt) |
| `resources_discover` | **EXTENDS** — return `{ skillPaths?, promptPaths?, themePaths? }` after `session_start`/`reload` | — (no bundled extension) |
| `mcp_servers_change` | void — fired when an extension registers/unregisters an MCP server after bind; handling it marks your extension as the MCP connector | — (no bundled extension) |

### Session lifecycle

| Event | Return semantics | Example |
|---|---|---|
| `session_start` | void — `{ reason: "startup" \| "reload" \| "new" \| "resume" \| "fork", previousSessionFile? }`; the place to initialize per-session state | `lsp` (line 26, eager server init), `todo` (line 339, replay state), `skill-loader` (line 80), `skill-pi-tui` (line 193) |
| `session_info_changed` | void — `{ name }` when session metadata changes | — (no bundled extension) |
| `session_before_switch` | **CAN CANCEL** — `{ cancel?: boolean }` | — (no bundled extension) |
| `session_before_fork` | **CAN CANCEL** — `{ cancel?, skipConversationRestore? }` | — (no bundled extension) |
| `session_before_compact` | **CAN CANCEL** — `{ cancel?, compaction? }` | `pi-context-view` (`src/compaction.ts` line 41) |
| `session_compact` | void — fired after compaction succeeds | `skill-pi-tui` (line 419, refresh), `pi-context-view` (`src/compaction.ts` line 46) |
| `session_compact_failed` | void — `{ errorMessage?, aborted, willRetry }` | `pi-context-view` (`src/compaction.ts` line 50) |
| `session_before_tree` | **CAN CANCEL** — `{ cancel?, summary?, customInstructions?, replaceInstructions?, label? }` | — (no bundled extension) |
| `session_tree` | void — after tree navigation | `plan-build` (`src/tool-presentation.ts` line 29, re-attach state) |
| `session_shutdown` | void — `{ reason: "quit" \| "reload" \| "new" \| "resume" \| "fork" }`; the place to **delete** per-session state | `todo` (line 359: `sessions.delete(sessionKey(ctx))`), `lsp` (line 46, stop servers), `pi-swarm` (line 662) |

### Agent loop

| Event | Return semantics | Example |
|---|---|---|
| `agent_start` | void — agent loop begins | `skill-pi-tui` (line 332) |
| `agent_end` | void — `{ messages }` — agent loop ends | `todo` (line 412, clear-all flag), `pi-hooks` (`src/hooks/stop-hooks.ts` line 101), `skill-pi-tui` (line 339) |
| `agent_before_settle` | **CAN EXTEND** — return `{ entries?: SessionBoundaryDraft[], continue?: boolean }` to append entries (custom, compaction, context-edit) before settlement and ensure one more provider request | — (no bundled extension) |
| `agent_settled` | void — run fully settled, no retry/compaction/queued continuation will run; `{ aborted }` | `skill-pi-tui` (line 395) |

### Turn

| Event | Return semantics | Example |
|---|---|---|
| `turn_start` | void — `{ turnIndex, timestamp }` | — (no bundled extension) |
| `turn_end` | **CAN EXTEND** — return `{ entries?, continue? }` like `agent_before_settle` | `todo` (line 375, count tool-only turns) |

### Message

| Event | Return semantics | Example |
|---|---|---|
| `message_start` | void — `{ message }` | `skill-pi-tui` (line 348) |
| `message_update` | void — token-by-token assistant stream: `{ message, assistantMessageEvent }` | `skill-pi-tui` (line 357) |
| `message_end` | **CAN REPLACE** — return `{ message? }`; the replacement must keep the original role | `skill-pi-tui` (line 375) |

### Tool

| Event | Return semantics | Example |
|---|---|---|
| `tool_call` | **CAN BLOCK** — return `{ block?, reason?, terminate? }`; to **modify arguments, mutate `event.input` in place** (later handlers see the mutation; no re-validation) | `permission` (line 93: `{ block: true, reason: "…Denied by permission settings…" }`) |
| `tool_result` | **CAN MODIFY** — return `{ content?, details?, structuredContent?, isError?, usage? }`; replacing `content` without `structuredContent` drops the structured content | — (no bundled extension) |
| `tool_execution_start` | void — `{ toolCallId, toolName, args, parentToolCallId? }` | — (observed in `pi-swarm/src/child.ts` line 194 via RPC events) |
| `tool_execution_update` | void — `{ partialResult }` during streaming execution | — (observed in `pi-swarm/src/child.ts` line 195 via RPC events) |
| `tool_execution_end` | void — `{ result, isError, durationMs? }` | `todo` (line 407, refresh card), `skill-pi-tui` (line 415, invalidate sidebar) |

### Context & prompt

| Event | Return semantics | Example |
|---|---|---|
| `before_agent_start` | **CAN OVERRIDE** — return `{ message?, systemPrompt? }` to replace the complete system prompt for this turn (or inject a custom message); `event.systemPromptOptions` is also mutable in place | `todo` (line 363, turn counting), `pi-vcc` (`src/hooks/compact-handler.ts` line 88) |
| `context` | **CAN REPLACE** — return `{ messages? }` for the full replacement of the conversation (without system messages); fires before each LLM call | `todo` (line 384, re-inject hidden state), `skill-loader` (line 55, re-inject catalog) |
| `context_with_system` | **CAN REPLACE** — return `{ messages? }` for the full transcript **including** system messages; the handler owns the prompt and tool declarations (result sent as returned) | — (no bundled extension) |
| `cache_warming_decision` | returns `CacheWarmingDecisionEventResult` — decides prompt-cache warming | — (no bundled extension) |

### Provider

| Event | Return semantics | Example |
|---|---|---|
| `before_provider_request` | **CAN REPLACE** — return a replacement for `event.payload` before the HTTP call | — (no bundled extension) |
| `before_provider_headers` | **MUTATES** — mutate `event.headers` in place (a `null` value deletes a header); return value ignored | — (no bundled extension) |
| `after_provider_response` | void — `{ status, headers }` before the response stream is consumed | — (no bundled extension) |
| `provider_stream_event` | void — parsed provider stream event before normalization: `{ provider, api, model, data }` | — (no bundled extension) |

### Model

| Event | Return semantics | Example |
|---|---|---|
| `model_select` | void — `{ model, previousModel, source: "set" \| "cycle" \| "restore" }` | `skill-pi-tui` (line 407, refresh status) |
| `thinking_level_select` | void — `{ level, previousLevel }` | `skill-pi-tui` (line 411, refresh status) |

### Input

| Event | Return semantics | Example |
|---|---|---|
| `input` | **TRANSFORMS / HANDLES** — return `{ action: "continue" } \| { action: "transform", text, images? } \| { action: "handled" }` | `pi-swarm` (line 363), `pi-context-view` (`src/probe/silent-probe.ts` line 265) |
| `user_bash` | **CAN REPLACE EXECUTION** — return `{ operations }` (custom `BashOperations`) or `{ result }` (full `BashResult` replacement) | — (no bundled extension) |

### UI

| Event | Return semantics | Example |
|---|---|---|
| `ui_prompt_start` | void — pi starts waiting on a blocking extension UI prompt: `{ kind: "select" \| "confirm" \| "input" \| "editor" \| "custom", title? }` | — (no bundled extension) |
| `ui_prompt_end` | void — pi stops waiting on that prompt | — (no bundled extension) |

Summary of the three capabilities:

- **Can block:** `tool_call` (stops tool execution), `session_before_*` (switch/fork/compact/tree via `cancel`), `input` (via `{ action: "handled" }` — swallows the prompt).
- **Can modify:** `tool_call` (`event.input` in place), `tool_result` (returned replacements), `context` / `context_with_system` (message lists), `before_agent_start` (system prompt, per turn), `message_end` (finalized message), `before_provider_request` (payload), `before_provider_headers` (in place), `user_bash` (execution), `input` (transformed prompt).
- **Can extend the transcript:** `agent_before_settle` / `turn_end` (`entries` + `continue`).
- **Everything else is void** — observers only.

`permission/index.ts` (lines 93–112) is the canonical blocking handler — it shows both the `allow` early-return and the blocking path:

```typescript
pi.on("tool_call", async (event, ctx) => {
  // …
  if (mode === "allow") {
    return undefined;
  }

  if (mode === "deny") {
    ctx.abort();
    return {
      block: true,
      reason: `${STATUS_REJECTED} Denied by permission settings (${event.toolName})`,
    };
  }
  // …
  const outcome = await handleToolCallPermission(/* … */);
  return { block: true, reason: outcome.reason };
});
```

## 4. ToolDefinition Reference

The complete `ToolDefinition` shape from pi 1.2.0 (`dist/core/extensions/types.d.ts`), with real code from `extensions/todo/index.ts` and `extensions/ask-user/index.ts`. Register a tool with `pi.registerTool({...})` (ADR-0006: build on the public `ExtensionAPI` surface only).

### Required fields

| Field | Type | Purpose |
|---|---|---|
| `name` | `string` | Tool name, used in LLM tool calls |
| `label` | `string` | Human-readable label for UI |
| `description` | `string` | Description for the LLM |
| `parameters` | `TParams` (TypeBox `TSchema`) | Parameter schema |
| `execute` | `(toolCallId, params, signal, onUpdate, ctx) => Promise<AgentToolResult<TDetails>>` | Runs the tool |

The minimal-but-complete registration from `extensions/todo/index.ts` (lines 252–291) — note it uses `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters`, `executionMode`, `renderCall`, `renderResult`, `execute`:

```typescript
pi.registerTool({
  name: TODO_TOOL_NAME,
  label: "Todo",
  description: TOOL_DESCRIPTION,
  promptSnippet: PROMPT_SNIPPET,
  promptGuidelines: PROMPT_GUIDELINES,
  parameters: todoParameters(),
  executionMode: "sequential",
  renderCall(args, theme) {
    const params = args as TodoParams;
    return new Text(theme.fg("toolTitle", `${TODO_GLYPH} todo · ${params.action}`), 0, 0);
  },
  renderResult(result, options, theme) {
    const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
    return new Text(options.expanded ? text : theme.fg("muted", text.split("\n")[0] ?? ""), 0, 0);
  },
  async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
    const current = session(ctx);
    const result = applyTodo(current.state, params as TodoParams, current.turn);
    if (!result.error) {
      current.state = result.state;
      current.clearOnNextTurn = false;
      if (params.action !== "list") {
        current.lastWriteTurn = current.turn;
        current.toolTurnsSinceWrite = 0;
        current.reminded = false;
        current.wroteThisTurn = true;
        const state = todoStateMessage(current.state) ?? (current.lastSent === undefined ? undefined : TODO_CLOSED_MARKER);
        if (state !== undefined && state !== current.lastSent) persistState(current, state);
      }
      if (current.tui) invalidateSidebar(current.tui);
    }
    const details: Record<string, unknown> = { [TODO_DETAILS_KEY]: result.state };
    if (result.error) details.error = result.error;
    return {
      content: [{ type: "text", text: result.text }],
      details,
    };
  },
});
```

### Prompt fields

**`promptSnippet?: string`** — one-line snippet for the "Available tools" section of the default system prompt. Custom tools are omitted from that section entirely when this is missing, so set it. From `extensions/todo/index.ts`:

```typescript
const PROMPT_SNIPPET = "Track multi-step work; rewrite the whole list as the plan changes";
```

**`promptGuidelines?: string[]`** — guideline bullets appended to the default system prompt's Guidelines section while the tool is active. From `extensions/todo/index.ts`:

```typescript
const PROMPT_GUIDELINES = [
  "Use todo for work with three or more steps or when the user hands you a list. Skip it for single trivial requests.",
  "Mark a task in_progress before starting it and done right after finishing it; keep exactly one task in_progress.",
  // …
];
```

Both fields are overridable at runtime — `extensions/ask-user/index.ts` feeds user config (validated) in front of built-in defaults:

```typescript
pi.registerTool({
  name: ASK_USER_TOOL_NAME,
  label: "Ask User",
  description: guidance.description ?? DEFAULT_TOOL_DESCRIPTION,
  promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
  promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
  parameters: QuestionParamsSchema,
  prepareArguments: prepareQuestionArguments,
  // …
});
```

### `parameters` (TypeBox)

A TypeBox schema (`import { Type } from "typebox"`); `StringEnum` from `@earendil-works/pi-ai` builds string-enum members. Real schema from `extensions/todo/index.ts` (lines 65–88):

```typescript
function todoParameters() {
  return Type.Object({
    action: StringEnum(STATUS_ACTION_ENUM, {
      description: "write replaces the whole list; add appends one task; update changes one task by id; clear empties the list; list reports it.",
    }),
    tasks: Type.Optional(
      Type.Array(
        Type.Object({
          id: Type.Optional(Type.Integer({ description: "Existing task id to keep." })),
          title: Type.String({ description: "Short imperative title, e.g. 'Write the parser'." }),
          status: StringEnum(STATUS_ENUM, {
            description: "Defaults to pending. blocked: open but waiting on something outside the list; dropped: will not be done, on purpose.",
          }),
          note: Type.Optional(Type.String({ description: "What is happening right now, shown while in_progress; required for blocked, naming what it waits for." })),
        }),
        { description: "For write: the complete ordered list. Keep the id of tasks that already exist so their history survives; omit it for new ones." },
      ),
    ),
    id: Type.Optional(Type.Integer({ description: "Task id for update." })),
    title: Type.Optional(Type.String({ description: "Title for add, or a new title for update." })),
    status: StringEnum(STATUS_ENUM, { description: "Status for add or update." }),
    note: Type.Optional(Type.String({ description: "Note for add or update; required for blocked." })),
  });
}
```

### `outputSchema?: TSchema`

JSON Schema of `structuredContent` in successful results. Tools that declare it should always set `structuredContent`; codemode scripts then receive it instead of the text content.

### `exposure?: ToolExposure`

How the model reaches the tool. Default `"direct"`. The five levels, verbatim from pi 1.2.0's types:

- **`direct`** — declared to the model while active, and callable while active.
- **`model-only`** — declared to the model while active, never callable. Use it for orchestrating or interactive tools.
- **`codemode`** — callable whenever registered. Not declared to the model unless explicitly activated.
- **`deferred`** — like `codemode`, but codemode tools do not list it; tool search can find it.
- **`hidden`** — registered but unreachable. Activating it has no effect.

`direct` and `model-only` tools are activated when registered; the others are not. The active set is what `getActiveTools`/`setActiveTools` manage.

### `namespace?: ToolNamespace`

Group the tool belongs to, for example its MCP server: `{ name, aliases?, description?, instructions? }`.

### `annotations?: ToolAnnotations`

MCP-style hints about what the tool does (not verified; permission extensions use them to decide which calls to confirm): `readOnlyHint?`, `destructiveHint?`, `idempotentHint?`, `openWorldHint?`.

### `defaultActive?: boolean`

Whether registering the tool activates it. Default `true` for `direct`/`model-only`; other exposures are never activated on registration. A tool with `defaultActive: false` is activated by naming it in `--tools` or the `defaultTools` setting, or with `setActiveTools()`.

### `prepareArguments?: (args: unknown) => Static<TParams>`

Compatibility shim to prepare raw tool-call arguments before schema validation. Must return an object conforming to `TParams`. Real usage from `extensions/ask-user/index.ts` (registration line 280):

```typescript
parameters: QuestionParamsSchema,
prepareArguments: prepareQuestionArguments,
```

### `prepareLoadout?: (loadout: ToolLoadout) => ToolLoadoutChanges | undefined`

Adjusts how the loadout is presented to the model while this tool is active; called whenever the active tools change. Returns `{ descriptions?, hiddenDeclarations? }` — model-facing description overrides by tool name, or declarations to leave out. Orchestrating tools use it, for example to list the callable tools in their own description.

### `reachesTools?: (input) => "all" | readonly string[]`

For tools that reach other tools (such as `codemode`, which calls them, and `tool_search`, which loads them): which tools a call with `input` may reach.

### `executionMode?: ToolExecutionMode`

Per-tool execution override: `"sequential"` (must execute one at a time with other tool calls) or `"parallel"` (may run concurrently). Omitted → the session default applies. The todo tool mutates shared state, so it pins `"sequential"` (see the registration above).

### `renderShell?: "default" | "self"`

`"default"` lets the standard `ToolExecutionComponent` draw the colored shell around your call/result renderers; `"self"` means the tool renders its own framing and must apply `outputPad` itself.

### `execute` signature

```typescript
execute(
  toolCallId: string,
  params: Static<TParams>,
  signal: AbortSignal | undefined,
  onUpdate: AgentToolUpdateCallback<TDetails> | undefined,
  ctx: ExtensionToolContext,
): Promise<AgentToolResult<TDetails>>
```

The result is `{ content: [{ type: "text", text }], details? }` — `details` is a machine-readable side channel other extensions can read (see Section 9). The todo `execute` body above shows the full shape: apply a pure mutation, persist state, refresh the sidebar, and return `content` + `details`.

### `renderCall` / `renderResult`

```typescript
renderCall?(args: Static<TParams>, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>): Component;
renderResult?(result: AgentToolResult<TDetails>, options: ToolRenderResultOptions, theme: Theme, context: ToolRenderContext<TState, Static<TParams>>): Component;
```

`options` carries render state: `expanded` (is the result view expanded), `isError`, `isPartial`, `durationMs`, `outputPad`, and more. Real renderers from `extensions/todo/index.ts` (lines 260–267) — collapsed results show only the first line, muted:

```typescript
renderCall(args, theme) {
  const params = args as TodoParams;
  return new Text(theme.fg("toolTitle", `${TODO_GLYPH} todo · ${params.action}`), 0, 0);
},
renderResult(result, options, theme) {
  const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
  return new Text(options.expanded ? text : theme.fg("muted", text.split("\n")[0] ?? ""), 0, 0);
},
```

## 5. Dual-Mode UI Pattern

How to build a tool that works in both TUI and RPC/JSON/print modes. Real code from `extensions/ask-user/index.ts`.

### Why dual-mode exists

Pi runs in different modes:

- **TUI** (`--` interactive) — a real terminal is attached; `ctx.ui.custom<T>()` can render a full-screen component.
- **RPC** — pi-swarm children and pendant clients (VSCode, ACP hosts such as Zed or Paseo) talk to pi over a JSON protocol. They report `hasUI: true` because the dialog sub-protocol (`extension_ui_request`/`extension_ui_response`) works, but `ui.custom()` resolves `undefined` without rendering anything.
- **Print/JSON** (`--print`) — no user at all.

`ctx.mode` is `"tui" | "rpc" | "json" | "print"` (pi 1.2.0 types). The pattern: check the mode, run the TUI path when possible, fall back to dialog primitives (`ui.select()` / `ui.input()`) in RPC, and return an explicit "unavailable" result in print mode instead of hanging.

### The mode check

From `extensions/ask-user/index.ts` (lines 295–300) — the `execute` body decides the path:

```typescript
const viaRpc = (ctx as { mode?: string }).mode === "rpc" && hasDialogUI(ctx.ui);
const open = answers.open(toolCallId, typed.questions, viaRpc ? "rpc" : "tui");
try {
  emitAskUserPromptEvent(pi, typed, toolCallId);
  if (viaRpc) return await runRpcPath(pi, ctx.ui, typed, toolCallId);
  return await runTuiPath(pi, ctx, typed, open);
} finally {
  answers.close(open);
}
```

And the no-UI guard at the top of the same `execute` — print mode never blocks (lines 283–284, 106–108):

```typescript
const typed = normalizeQuestionParams(params as QuestionParams);
if (!ctx.hasUI) return rejectWithoutUi();
```

```typescript
function rejectWithoutUi() {
  return buildToolResult(ERROR_NO_UI, { answers: [], cancelled: true, error: "no_ui" });
}
```

### TUI path: `ctx.ui.custom<T>(factory)`

`ctx.ui.custom<T>(factory, options)` opens a full-screen UI. The factory receives `(tui: TUI, theme, keybindings, done)` and must return a `Component` (`{ render(width), invalidate() }`); calling `done(value)` resolves the promise with `value`. Real code from `extensions/ask-user/index.ts` (lines 211–250), showing the component contract, a graceful `undefined` result, and the `overlay: false` option:

```typescript
const result = await ctx.ui.custom<QuestionnaireResult>(
  (tui: TUI, theme, keybindings, done) => {
    if (open.settled) {
      done(open.settled);
      return { render: () => [], invalidate: () => {}, handleInput: () => {} };
    }
    open.attach(done);
    const session = new QuestionnaireSession({
      tui,
      theme,
      params: typed,
      itemsByTab,
      done: (r: QuestionnaireResult) => open.settle(r),
      keybindings,
      // …
    });
    sessionRef.current = session;
    return session.component;
  },
  {
    overlay: false,
  },
);
```

### RPC fallback: `ctx.ui.select()` + `ctx.ui.input()`

When the host is RPC, walk the questions with dialog primitives that the host renders natively. The structural type guard from `extensions/ask-user/rpc-fallback.ts` (lines 44–53):

```typescript
export type DialogUI = {
  select: (title: string, options: string[]) => Promise<string | undefined>;
  input: (title: string, placeholder?: string) => Promise<string | undefined>;
};

export function hasDialogUI(ui: unknown): ui is DialogUI {
  const u = ui as Partial<Record<"select" | "input", unknown>> | null | undefined;
  return typeof u?.select === "function" && typeof u?.input === "function";
}
```

The walker from `extensions/ask-user/rpc-fallback.ts` (lines 88–98) — one dialog per question, `undefined` cancels:

```typescript
export async function runRpcQuestionnaire(ui: DialogUI, params: QuestionParams): Promise<QuestionnaireResult> {
  const answers: QuestionAnswer[] = [];
  for (let qi = 0; qi < params.questions.length; qi++) {
    const q = params.questions[qi];
    const header = q.header ? `[${q.header}] ` : "";
    const answer = q.multiSelect ? await askMultiSelect(ui, q, qi, header) : await askSingleSelect(ui, q, qi, header);
    if (answer === undefined) return { answers, cancelled: true };
    answers.push(answer);
  }
  return { answers, cancelled: false };
}
```

A single-select dialog (from the same file, lines 113–128, elided) — note `ui.select` can return either an offered option line or free text:

```typescript
const chosen = await ui.select(title, options);
if (chosen == null) return undefined;
const reply = chosen.trim();
if (reply.length === 0) return undefined;
const idx = resolveSingleSelectReply(chosen, reply, options, q);
if (idx === undefined) return { questionIndex, question: q.question, kind: "custom", answer: reply };
```

### When `ui.custom()` itself resolves `undefined`

RPC hosts can also reach the TUI path if the mode isn't `"rpc"`. The TUI path checks the result and degrades: from `extensions/ask-user/index.ts` (lines 251–258):

```typescript
if (result === undefined) {
  open.host = "rpc";
  if (hasDialogUI(ctx.ui)) {
    const rpcResult = await runRpcQuestionnaire(ctx.ui, typed);
    emitBackwardCompatEvents(pi, typed, rpcResult);
    return buildQuestionnaireResponse(rpcResult, typed);
  }
  return buildToolResult(ERROR_NO_CUSTOM_UI, { answers: [], cancelled: true, error: "no_custom_ui" });
}
```

### Print-mode degradation rule

If there is no UI (`!ctx.hasUI`), return a result the model can act on — never await a dialog. The error text itself is part of the contract: ask-user tells the model the user never saw the questions and to ask them as plain chat text instead.

## 6. State Management Patterns

Four patterns, matched to the state's lifetime:

1. **Per-session `Map`** — state that dies with the session (counters, UI handles).
2. **Hidden transcript messages** — state that must survive across turns and process restarts (prompt-cache-friendly persistence).
3. **`Symbol.for` / `globalThis`** — state that must survive `/reload` re-evaluation.
4. **`WeakMap` keyed by a stable object** — state keyed by env or an object, without leaks or re-registration.

### Pattern 1 — Per-session `Map`

Key by `ctx.sessionManager.getSessionId()`, create-on-demand, delete on `session_shutdown`. The factory's closure holds the map, so it is re-created per extension load — exactly what you want for per-process, per-session state. From `extensions/todo/index.ts` (lines 118–149, 359–361):

```typescript
function sessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId() ?? "";
}

export default function piTodo(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
  if (!todoEnabled(env)) return;
  const sessions = new Map<string, TodoSession>();
  const collapseKey = todoCollapseKey(env);

  const session = (ctx: ExtensionContext): TodoSession => {
    const key = sessionKey(ctx);
    let current = sessions.get(key);
    if (!current) {
      current = {
        state: emptyTodo(),
        turn: 0,
        // …
      };
      sessions.set(key, current);
    }
    return current;
  };
  // …

  pi.on("session_shutdown", (_event, ctx) => {
    sessions.delete(sessionKey(ctx));
  });
```

Rules: every event handler and `execute` call goes through `session(ctx)` — never a module-level singleton, because pi runs multiple sessions in one process (swarm children, resume). The `session_shutdown` delete is mandatory: without it, every session leaks a map entry for the process lifetime.

### Pattern 2 — Hidden transcript messages

For state that must survive a process restart (resume, `/reload` with new process, fork), persist it **in the transcript** as a custom message with `display: false`. Writing from `extensions/todo/index.ts` (lines 151–156):

```typescript
const persistState = (current: TodoSession, state: string) => {
  if (!pi.sendMessage) return;
  pi.sendMessage({ customType: TODO_STATE_MESSAGE_TYPE, content: state, display: false }, { triggerTurn: false });
  current.lastSent = state;
  current.pending = state;
};
```

Why a hidden **message** instead of an **entry** (`pi.appendEntry`): messages are appended to the LLM context, so the model sees the current state every turn without you injecting it. `display: false` keeps the transcript clean, and `triggerTurn: false` prevents the message itself from starting an agent run.

**Why this is prompt-cache-friendly:** the transcript is append-only — each turn adds a new snapshot, never rewrites the old one. Providers prefix-cache by stable leading bytes: Anthropic's cache breakpoints and OpenAI's delta encoding both keep the cache hit as long as earlier messages are byte-identical. Rewriting an entry in place (or re-sending the whole state as a fresh user message) would invalidate everything downstream of the change.

Re-attach on loss. Compaction and branch navigation can drop the snapshot, so the `context` handler re-injects it: from `extensions/todo/index.ts` (lines 384–405):

```typescript
pi.on("context", (event, ctx) => {
  const current = session(ctx);
  const trailing: Array<{ role: "custom"; customType: string; content: string; display: false; timestamp: number }> = [];
  const last = [...event.messages].reverse().find((message) => (message as { customType?: string }).customType === TODO_STATE_MESSAGE_TYPE) as { content?: unknown } | undefined;
  const seen = typeof last?.content === "string" ? last.content : undefined;
  const state = todoStateMessage(current.state) ?? (seen === undefined || seen === TODO_CLOSED_MARKER ? undefined : TODO_CLOSED_MARKER);
  if (state !== undefined && seen !== state) {
    // The transcript lost the current snapshot (compaction,
    // branch navigation): treat the re-attached list as fresh so the stale counter
    // does not fire on the next few turns.
    current.lastWriteTurn = current.turn;
    trailing.push({ role: "custom", customType: TODO_STATE_MESSAGE_TYPE, content: state, display: false, timestamp: Date.now() });
    if (current.pending !== state) persistState(current, state);
  }
  const actionable = current.state.tasks.some((task) => task.status === "pending" || task.status === "in_progress");
  if (!current.reminded && current.toolTurnsSinceWrite >= REMIND_AFTER_TOOL_TURNS && actionable) {
    current.reminded = true;
    trailing.push({ role: "custom", customType: TODO_REMINDER_MESSAGE_TYPE, content: TODO_REMINDER_TEXT, display: false, timestamp: Date.now() });
  }
  if (trailing.length === 0) return undefined;
  return { messages: [...event.messages, ...trailing] };
});
```

The same pattern with `display: true` is how `pi-vcc` re-injects recall output (`src/commands/vcc-recall.ts` line 32: `pi.sendMessage({ customType: "vcc-recall", content: output, display: true }, { triggerTurn: true })`), and `pi-hooks` injects hook context (`src/hook-context.ts` lines 44–51).

When to use Pattern 2 instead of `pi.appendEntry` (the non-LLM variant): entries never reach the model — `plan-build` uses them for UI state (`index.ts` line 154). Messages reach the model — use them when the model needs to see the state.

### Pattern 3 — `Symbol.for` / `globalThis` for `/reload` idempotency

`/reload` re-runs every extension factory. Module-level singletons re-initialize, which can double-register listeners or reset state mid-session. A `Symbol.for` key on `globalThis` (or on a long-lived pi object such as the TUI terminal) survives re-evaluation: same key, same slot, `??=` skips re-initialization. Real code from `extensions/skill-pi-tui/src/card.ts` (lines 32–41):

```typescript
const CARD_STYLE_SLOT = Symbol.for("skill-pi-tui.card-style");
const styleState = globalThis as typeof globalThis & { [CARD_STYLE_SLOT]?: unknown };

export function cardStyle(): CardStyle {
  return styleState[CARD_STYLE_SLOT] === CARD_STYLE.NEON ? CARD_STYLE.NEON : CARD_STYLE.FLOAT;
}

export function setCardStyle(style: CardStyle): void {
  styleState[CARD_STYLE_SLOT] = style;
}
```

When the state must live on a **pi-owned object** rather than `globalThis` (because pi keeps the object across things that re-create modules — e.g. regular/fullscreen transitions), store it on that object with a `Symbol.for` key. `extensions/skill-pi-tui/src/sidebar.ts` (lines 3–5, 32–35):

```typescript
// Store on the terminal, not a module singleton: extension loaders may isolate
// modules, while Pi keeps this terminal across regular/fullscreen transitions.
const STATE = Symbol.for("skill-pi-tui.sidebar.state");
// …

export function sidebarState(tui: TUI): SidebarState {
  const terminal = tui.terminal as unknown as Record<symbol, SidebarState>;
  return terminal[STATE] ??= { active: false, parts: new Map() };
}
```

The cache variant, `extensions/skill-pi-tui/src/sidebar-layout.ts` (lines 40–45):

```typescript
const CACHE = Symbol.for("skill-pi-tui.sidebar.cache");

function sidebarCache(tui: TUI): SidebarCache {
  const terminal = tui.terminal as unknown as Record<symbol, SidebarCache>;
  return terminal[CACHE] ??= { revision: 0 };
}
```

Two rules: name the symbol `skill-pi.<extension>.<purpose>` (global namespace — collisions are silent), and always initialize with `??=`, never assignment. gentle-shell does the same in `resume-hint.ts` and `skill-registry.ts` (`Symbol.for("gentle-pi.…")` slots on `globalThis`).

### Pattern 4 — `WeakMap` keyed by env or object

When state is naturally keyed by an object (a stream, an env record, a session handle) and should die when the key dies, use a `WeakMap` — no explicit cleanup, no leak, and re-`/reload` simply re-creates the map with the same live keys. The pattern, as used in `extensions/pi-swarm/src/child.spec.ts` (lines 78–82):

```typescript
const fakeStdins = new WeakMap<PassThrough, Buffer[]>();
function stdinText(stdin: PassThrough): string {
  const chunks = fakeStdins.get(stdin) ?? [];
  return Buffer.concat(chunks).toString();
}
```

gentle-shell's production version keys `ProcessEnv`: `new WeakMap<ProcessEnv, ActiveSession>()` in `session-scratch.ts` — one scratch record per env object, garbage-collected when the env object is no longer referenced. Use `WeakMap` over `Map<object, V>` whenever the key is a live object: a plain `Map` pins the key and defeats garbage collection.

Choosing: session-scoped runtime state → Pattern 1; state the model or a resumed process needs → Pattern 2; cross-`/reload` idempotency → Pattern 3; per-object scratch → Pattern 4. They compose: `todo` uses 1 + 2 together (map for the live session, hidden messages for durability).

## 7. Config Patterns

The three mechanisms: conf.d (ADR-0008), settings.json block, env kill-switch (`SKILL_PI_<NAME>`, default on, `0/false/no/off` disables). _Filled in by Task 3._

## 8. Sidebar Card Integration

How to add a card to the skill-pi-tui fullscreen sidebar: import `sidebarPart` / `sidebarState` / `invalidateSidebar` from `skill-pi-tui/src/`, build a `Component`, register via `ctx.ui.setWidget()`, wire `tool_execution_end` to refresh. _Filled in by Task 3._

## 9. Cross-Extension Communication

The three channels: event bus (`pi.events.on` / `pi.events.emit`), tool result `details` field, file handshakes. _Filled in by Task 3._

## 10. Keybindings

The Ctrl+Q leader prefix convention (ADR-0010): `onTerminalInput` handler, leader → action key, no standalone Ctrl+Q re-registration. _Filled in by Task 3._

## 11. Defensive Coding Checklist

The non-negotiables: try/catch around I/O (fail-open), timeouts on external commands, structural feature detection for newer pi APIs, `?.`-chained env reads, version audits, prompt-cache awareness. _Filled in by Task 4._

## 12. Testing Patterns

Per-extension vitest setup, factory injection for testability, pure-function extraction, `__testing` exports, golden file tests. _Filled in by Task 4._

## 13. Gentle-Shell Pattern Index

A 20-row table mapping each gentle-shell extension to the pattern(s) it demonstrates, with file paths and line references. _Filled in by Task 4._

## 14. Building a New Extension — Checklist

From "I need extension #16" to "shipped". Each step names a file, command, or cookbook section.

1. **Create the directory.** `mkdir -p extensions/<name>/src` — one directory per extension, an `index.ts` at its root is the entry point (auto-discovery, ADR-0001: no wrapper or manifest edit needed; see Section 1, Auto-discovery).
2. **Write `package.json`.** Name it `@devopstales/pi-<name>` (ADR-0005), `type: module`, peer-dependency on `@earendil-works/pi-coding-agent ^1.2.0`, `scripts.check` = `tsc --noEmit -p .`, `scripts.test` = `vitest run` (ADR-0007 self-contained shape; see Section 1, package.json — copy `extensions/todo/package.json`).
3. **Write `tsconfig.json`.** Copy the shape from `extensions/todo/tsconfig.json`: extend a bundled extension's tsconfig and include `index.ts`, `src/**/*.ts`, `*.spec.ts` (Section 1, tsconfig.json).
4. **Write `index.ts`.** Default export `function <name>(pi: ExtensionAPI): void` — env kill-switch first (Section 7, env kill-switch; `SKILL_PI_<NAME>` pattern from `extensions/webfetch/index.ts`), then `pi.registerTool` (Section 4), then `pi.on` event wiring (Section 3). Keep it wiring-only.
5. **Write `src/` modules.** Pure logic — model functions, renderers, config parsing — with no `pi` import, so it is testable in isolation (Section 1, Directory layout; `extensions/todo/src/` is the canonical split).
6. **Write tests.** One spec per concern: `model.spec.ts` for pure logic, `index.spec.ts` for factory wiring with a mocked `ExtensionAPI`, golden files for card rendering (Section 12; `extensions/todo/` ships all four patterns).
7. **Install.** `npm install` inside `extensions/<name>/` — runtime deps resolve from the root `node_modules`; dev deps (`typescript`, `vitest`, `@types/node`) install locally.
8. **Run the tests.** `npm test` in `extensions/<name>/` — all green before moving on.
9. **Type-check.** `npm run check` (`tsc --noEmit -p .`) — zero errors.
10. **Write `README.md`.** What the extension does, its env vars (kill-switch, defaults), and upstream attribution (every bundled extension's README carries it).
11. **Verify auto-discovery.** Run `node bin/skill-pi.js` in a scratch project; the extension loads with no wrapper edit (Section 1, Auto-discovery). Confirm the kill-switch: set `SKILL_PI_<NAME>=0` and verify registration side effects are skipped.
12. **Run the root suite.** `node --test "test/**/*.test.js"` from the repo root — still green (guards against accidental edits outside the new extension dir).
13. **Commit.** Conventional commit, e.g. `feat(<name>): add <name> extension`. No AI-attribution trailer.
