# Briefing: Pi Extension Cookbook

**Date:** 2026-10-20
**Status:** PROPOSED

## Goal

A curated, in-repo reference document (`extensions/COOKBOOK.md`) that captures the extension-building patterns, API surface, and conventions every bundled skill-pi extension follows — distilled from gentle-shell's `extensions/` directory (20 extensions, ~1.5 MB of TypeScript) and our own 14 extensions — so that a new extension can be built in an afternoon instead of a week of reverse-engineering.

## Why (product context)

We now ship **14 bundled extensions** (ask-user, command-plate, file-search, lsp, permission, pi-context-view, pi-hooks, pi-swarm, pi-vcc, plan-build, providers, skill-pi-tui, todo, webfetch) plus a 15th in progress (pi-context-include). Each one was built by:

1. Finding a reference implementation (gentle-shell, janvitos/pi-plan-build, hsingjui/pi-hooks, jtepe/pi-lsp, code-yeongyu/pi-webfetch, dimk90/pi-context-view, d3ara1n/pi-context-include).
2. Reading the reference, understanding pi's `ExtensionAPI` surface.
3. Homogenizing for the isolated agent dir, ADR constraints, and project conventions.
4. Building the package scaffold, tests, README.

The **patterns repeat** — the factory shape, the event wiring, the TypeBox schemas, the dual-mode TUI/RPC fallback, the env kill-switch, the conf.d config, the sidebar card integration, the `context` event for prompt-cache-friendly state. But the knowledge is **distributed** across 14 codebases, 6 upstream repos, and tribal memory. There is no single document that says "here's how you build a pi extension for skill-pi."

Gentle-shell's `extensions/` directory is the most complete reference: 20 extensions covering every API surface (tools, commands, shortcuts, providers, MCP servers, message renderers, entry renderers, tool renderers, markdown transformers, the full event taxonomy, dual-mode UI, process-wide state for `/reload` idempotency, prompt-cache-aware design). We should distill it.

**The cookbook is the answer to "how do I add extension #16?"**

## Requirements

- **R1 — Extension anatomy.** The complete shape of a skill-pi extension: directory layout, `package.json` fields (ADR-0005 naming, ADR-0007 self-contained shape), `index.ts` entry point, `src/` module split, `tsconfig.json`, test layout. Reference `extensions/todo/` as the canonical example.
- **R2 — ExtensionAPI surface.** Every method on `ExtensionAPI` (`registerTool`, `registerCommand`, `registerShortcut`, `registerFlag`, `registerProvider`, `registerMcpServer`, `registerVirtualModel`, `registerMessageRenderer`, `registerEntryRenderer`, `registerToolRenderer`, `registerMarkdownTransformer`, `on`, `events`, `sendMessage`, `sendUserMessage`, `appendEntry`, `exec`, `setModel`, `setSessionName`, `getSettings`, `getActiveTools`, `setActiveTools`, `getAllTools`, `getCommands`, `getThinkingLevel`, `setThinkingLevel`, `getFlag`, `getMcpServers`, `getEditorComponent`) with a one-line description and a pointer to the bundled extension that uses it.
- **R3 — Event taxonomy.** All ~40 pi events grouped by lifecycle category (session, agent, turn, message, tool, context/prompt, provider, model, input, UI, system). For each event: the handler signature, the return-value semantics (which events can block, which can modify, which are void), and a bundled extension example.
- **R4 — ToolDefinition reference.** The complete `ToolDefinition` shape: `name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters` (TypeBox), `outputSchema`, `exposure` levels (`direct` / `model-only` / `codemode` / `deferred` / `hidden`), `namespace`, `annotations`, `defaultActive`, `prepareArguments`, `prepareLoadout`, `executionMode`, `renderShell`, `execute` signature, `renderCall` / `renderResult` signatures. Reference `extensions/todo/index.ts` (the simplest full tool) and `extensions/ask-user/index.ts` (dual-mode interactive tool).
- **R5 — Dual-mode UI pattern.** How to build a tool that works in both TUI and RPC/JSON/print modes: check `ctx.mode`, TUI path via `ctx.ui.custom<T>()` (full-screen overlay with `Component`/`Container`), RPC fallback via `ctx.ui.select()` / `ctx.ui.input()`, print-mode graceful degradation. Reference `extensions/ask-user/index.ts`.
- **R6 — State management patterns.** The four patterns we use:
  - Per-session `Map<sessionId, State>` (todo, skill-pi-tui).
  - Hidden transcript messages for prompt-cache-friendly persistence (`pi.sendMessage({ display: false })` + `context` event replay) — reference `extensions/todo/index.ts` lines 151–155, 384–405.
  - `Symbol.for()` / `globalThis` for `/reload` idempotency (gentle-shell's `resume-hint.ts`, `skill-registry.ts`).
  - `WeakMap` keyed by env or object for cross-reload state (gentle-shell's `session-scratch.ts`).
- **R7 — Config patterns.** Two mechanisms:
  - **conf.d** (ADR-0008): `$AGENT_HOME/conf.d/<name>.conf` + `<project-root>/.skill-pi/conf.d/<name>.conf`. Reference `extensions/lsp/`, `extensions/permission/`.
  - **Settings.json block**: `contextInclude` in `<agent-dir>/settings.json` + `<cwd>/.pi/settings.json` (project replaces global). Reference `extensions/pi-context-include/`.
  - **Env kill-switch**: `SKILL_PI_<NAME>` toggle (default on, `0/false/no/off` disables). Reference `extensions/webfetch/index.ts`, `extensions/todo/index.ts`.
- **R8 — Sidebar card integration.** How to add a card to the skill-pi-tui fullscreen sidebar: import `sidebarPart` / `sidebarState` / `invalidateSidebar` from `skill-pi-tui/src/`, build a `Component` with `render(width)` / `invalidate()`, register via `ctx.ui.setWidget()`, wire the `tool_execution_end` event to refresh. Reference `extensions/todo/index.ts` (the canonical example).
- **R9 — Cross-extension communication.** The three channels:
  - **Event bus** (`pi.events.on` / `pi.events.emit`): custom payloads, used by pi-swarm (`swarm:rpc:*` contract) and gentle-notifications.
  - **Tool result `details` field**: machine-readable side channel (todo's `pi-todo` key, read by herdr-activity in gentle-shell).
  - **File handshakes**: `<agent-dir>/<name>-handshake.json` (pi-vcc's `pi-vcc-includes.json` from pi-context-include).
- **R10 — Keybindings.** The `Ctrl+Q` leader prefix convention (ADR-0010): `onTerminalInput` handler, leader → action key, no standalone `Ctrl+Q` re-registration. Reference `extensions/todo/index.ts` (collapse), `extensions/plan-build/index.ts` (mode switch), `extensions/pi-swarm/index.ts` (target cycle).
- **R11 — Defensive coding checklist.** The non-negotiables:
  - Every I/O in try/catch (fail-open, never crash the session).
  - Every external command has a timeout.
  - Structural feature detection for newer pi APIs (`typeof host.registerToolRenderer === "function"`).
  - Env var reads are `?.` chained with fallbacks.
  - Version audit before enabling features (gentle-shell's Vim runtime check).
  - Prompt-cache awareness: hidden messages are append-only, never rewritten.
- **R12 — Testing patterns.** Per-extension test setup (vitest or bun test, per ADR-0007 toolchain), factory injection for testability (`createXExtension(opts)` with faked `env`, `now`, `fetch`), pure function extraction for testability, `__testing` export for internal access, golden file tests for card rendering. Reference `extensions/todo/` (36 tests: model, card, index).
- **R13 — Gentle-shell pattern index.** A table mapping each gentle-shell extension to the pattern(s) it demonstrates, with file paths and line references. This is the "read this file to learn X" index. 20 rows, one per gentle-shell extension.
- **R14 — "Building a new extension" checklist.** A step-by-step numbered checklist (10–15 steps) from "I need extension #16" to "shipped": scaffold → implement → test → README → auto-discovery verification → root suite gate. This is the practical quick-start.

## Out of scope

- **Code changes.** The cookbook is a reference document, not a codebase. No `src/` changes, no new extension, no wrapper edits.
- **Pi source documentation.** We document the `ExtensionAPI` surface as observed from pi 1.2.0's TypeScript types + gentle-shell's usage. We do not fork or patch pi (ADR-0006).
- **Skill documentation.** Skills (`skills/`) are a separate concern; the cookbook covers extensions only.
- **Upstream attribution tracking.** Each extension's README already carries its upstream attribution. The cookbook does not repeat them.

## Success criteria (measurable)

- `extensions/COOKBOOK.md` exists, is ≥ 400 lines, and covers all 14 requirements (R1–R14).
- Every API method in R2 is listed with a pointer to at least one bundled extension that uses it.
- Every event in R3 is grouped by category, has its handler signature, return-value semantics, and a bundled example.
- The ToolDefinition reference (R4) covers all 20+ fields with at least one real example.
- The dual-mode pattern (R5) shows both TUI and RPC paths with real code from `ask-user`.
- The state management section (R6) shows all four patterns with real code.
- The config section (R7) shows all three mechanisms with real code.
- The sidebar card section (R8) shows the complete integration with real code from `todo`.
- The cross-extension section (R9) shows all three channels with real code.
- The gentle-shell pattern index (R13) has 20 rows, each with file path and line reference.
- The checklist (R14) is 10–15 steps, each referencing a specific file or command.
- A developer can build a new extension by following R14 + the relevant R-sections without reading more than one existing extension's source.
- Root wrapper suite `node --test "test/**/*.test.js"` still green (the cookbook is a `.md` file; no code change, but verify no accidental edit).

## ADR constraints (in-force, respected)

- **ADR-0001** (explicit enumeration): the cookbook documents that new extensions are auto-discovered by `collectExtensionFiles` — no wrapper or manifest edit needed.
- **ADR-0005** (naming): package names follow `@devopstales/pi-<name>`.
- **ADR-0006** (never modify pi source): the cookbook documents building on the public `ExtensionAPI` surface only.
- **ADR-0007** (self-contained extensions): the cookbook documents the self-contained package shape (own `package.json`, own toolchain, runtime deps via root `node_modules`).
- **ADR-0008** (conf.d config): the cookbook documents the conf.d pattern as the primary config mechanism.
- **ADR-0010** (Ctrl+Q leader): the cookbook documents the leader prefix convention.

## Source material

- **gentle-shell** (`Gentleman-Programming/gentle-shell`, MIT): `extensions/` directory, 20 files, ~1.5 MB TypeScript. The primary reference.
- **skill-pi bundled extensions** (this repo): 14 extensions, `extensions/` directory. The canonical examples.
- **pi 1.2.0 TypeScript types** (`@earendil-works/pi-coding-agent`): `ExtensionAPI`, `ExtensionContext`, `ToolDefinition`, `ExtensionEvent` type definitions.
