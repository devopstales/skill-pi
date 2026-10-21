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

The complete table of `ExtensionAPI` methods (from pi 1.2.0's `@earendil-works/pi-coding-agent` types) with one-line descriptions and a bundled extension that uses each. _Filled in by Task 2._

## 3. Event Taxonomy

All pi events grouped by lifecycle category (session, agent, turn, message, tool, context/prompt, provider, model, input, UI, system) with handler signatures, return-value semantics (which events can block, which can modify, which are void), and a bundled example per event. _Filled in by Task 2._

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

The four patterns: per-session `Map`, hidden transcript messages (prompt-cache-friendly persistence), `Symbol.for()` / `globalThis` for `/reload` idempotency, `WeakMap` keyed by env or object. _Filled in by Task 2._

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
