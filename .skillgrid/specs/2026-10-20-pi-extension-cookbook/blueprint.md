# Pi Extension Cookbook — Implementation Blueprint (steps, files, verification)

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-execution (recommended) or simple-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PROPOSED

**Tier:** T1 (documentation-only change; single file; no code; no migration)

**Build shape:** Smallest usable whole — Task 1 produces a working cookbook skeleton with the highest-value sections (extension anatomy, ToolDefinition reference, dual-mode pattern, new-extension checklist) so a developer can start using it immediately; Tasks 2–5 thicken the remaining sections.

**Goal:** Author `extensions/COOKBOOK.md` — a single reference document covering the complete extension-building pattern for skill-pi, distilled from gentle-shell's 20 extensions and our own 14, so that a new extension can be built in an afternoon.

**Architecture:** A single Markdown file in the `extensions/` directory (co-located with the extensions it documents). Content is organized as 14 sections (R1–R14 from the briefing), each with real code snippets from bundled extensions and gentle-shell references. No code changes — pure documentation. The file is discovered by `collectExtensionFiles` only if it matches `*.ts`/`*.js` (it doesn't — `.md` is ignored), so it is invisible to the wrapper's extension loader.

**Tech Stack:** Markdown. No runtime deps, no build step, no test framework. Verification is structural (line count, section presence, cross-reference accuracy) + the root wrapper suite (confirming no accidental code edit).

**Spec:** `./briefing.md` — requirements R1–R14, success criteria, and source material.

**Source material (primary references for code snippets):**

| Source | Path | What it provides |
|---|---|---|
| gentle-shell | `Gentleman-Programming/gentle-shell/extensions/` (20 files) | Full API surface, event taxonomy, dual-mode UI, state patterns, defensive coding, `/reload` idempotency, prompt-cache awareness |
| skill-pi todo | `extensions/todo/index.ts` (417 lines) | Canonical tool + sidebar card + hidden transcript state + Ctrl+Q leader + context event replay |
| skill-pi ask-user | `extensions/ask-user/index.ts` (306 lines) | Dual-mode TUI/RPC interactive tool |
| skill-pi pi-swarm | `extensions/pi-swarm/index.ts` (686 lines) | Cross-extension RPC, event bus, child session management |
| skill-pi skill-pi-tui | `extensions/skill-pi-tui/index.ts` (424 lines) | Sidebar architecture, card chrome, footer/status widgets |
| skill-pi plan-build | `extensions/plan-build/index.ts` (516 lines) | Mode switching, persistent plan, approval flow |
| skill-pi webfetch | `extensions/webfetch/index.ts` (87 lines) | Env kill-switch pattern, tool with renderCall/renderResult |
| pi 1.2.0 types | `node_modules/@earendil-works/pi-coding-agent/` (`.d.ts`) | `ExtensionAPI`, `ExtensionContext`, `ToolDefinition`, `ExtensionEvent` type definitions |

**ADR constraints (in-force, respected):**
- ADR-0001: cookbook documents auto-discovery (no wrapper edit for new extensions).
- ADR-0005: package naming `@devopstales/pi-<name>`.
- ADR-0006: build on public `ExtensionAPI` surface only.
- ADR-0007: self-contained package shape.
- ADR-0008: conf.d config pattern.
- ADR-0010: Ctrl+Q leader prefix.

**Critic:** skipped (T1, documentation-only, no code, no trust boundary, no migration)

## Terms

- **extension** — a TypeScript file (or directory with `index.ts`) that exports a default `ExtensionAPI` factory function, loaded by pi via `--extension` flag. See `extensions/todo/index.ts` line 122.
- **ExtensionAPI** — the interface pi passes to each extension's factory: `registerTool`, `registerCommand`, `on`, `events`, `sendMessage`, etc. Defined in `@earendil-works/pi-coding-agent` types.
- **ToolDefinition** — the shape of a registered tool: `name`, `label`, `description`, `parameters` (TypeBox), `execute`, `renderCall`, `renderResult`, `exposure`, etc.
- **dual-mode** — the pattern where a tool provides a full TUI experience (`ctx.ui.custom`) in interactive mode and a dialog fallback (`ctx.ui.select` / `ctx.ui.input`) in RPC/print mode.
- **sidebar card** — a `Component` registered via `ctx.ui.setWidget()` that renders in the skill-pi-tui fullscreen right sidebar (terminals ≥ 140 columns).
- **hidden transcript message** — a `pi.sendMessage({ display: false })` custom message that persists state in the session branch for replay across `/reload`, compaction, and branch navigation.
- **Ctrl+Q leader** — the keybinding convention (ADR-0010): `Ctrl+Q` arms a leader, the next key triggers an action. Implemented via `ctx.ui.onTerminalInput`.

## Hypothesis

**Claim:** A single ~500–700 line Markdown file, organized as 14 sections with real code snippets, covers the complete extension-building pattern well enough that a developer can build a new skill-pi extension by reading the cookbook + one existing extension, without reverse-engineering pi's API from type definitions or gentle-shell's source.

**Right condition:** After writing the cookbook, a developer who has never built a pi extension can scaffold a working extension (package.json, index.ts, a tool, a test) by following R14 (the checklist) + the relevant R-sections, and the extension auto-loads in a skill-pi session.

**Wrong condition:** The cookbook omits a critical API surface (e.g., the `context` event's return-value semantics, the `exposure` levels, or the sidebar card integration) such that a developer still needs to read a second extension's source or pi's type definitions to get started.

**Thinnest MVP:** Task 1 — the cookbook skeleton with R1 (anatomy), R4 (ToolDefinition), R5 (dual-mode), R14 (checklist). These four sections let a developer scaffold + implement + test a basic tool extension.

**Door check:** Task 1 Step 6 (self-review): if the checklist (R14) references a section that doesn't exist yet (R2, R3, R6, etc.), that's expected — the checklist points forward. But if the ToolDefinition reference (R4) is missing a field that `todo/index.ts` actually uses, the MVP is incomplete — fix before proceeding.

## Must-Haves (goal-backward verification)

**Truths** (observable behaviors that must hold):
- The file `extensions/COOKBOOK.md` exists and is ≥ 400 lines.
- Every section R1–R14 from the briefing is present as a `##` heading in the file.
- R2 (ExtensionAPI surface) lists every method on `ExtensionAPI` with a one-line description and a pointer to at least one bundled extension that uses it.
- R3 (Event taxonomy) groups all events by category, shows handler signatures, return-value semantics (block/modify/void), and a bundled example per event.
- R4 (ToolDefinition) covers all fields present in pi 1.2.0's type definition, with at least one real code example from a bundled extension.
- R5 (Dual-mode) shows both TUI and RPC paths with real code from `ask-user/index.ts`.
- R6 (State patterns) shows all four patterns (per-session Map, hidden transcript messages, Symbol.for, WeakMap) with real code.
- R7 (Config) shows all three mechanisms (conf.d, settings.json block, env kill-switch) with real code.
- R8 (Sidebar card) shows the complete integration with real code from `todo/index.ts`.
- R9 (Cross-extension) shows all three channels (event bus, tool result details, file handshake) with real code.
- R10 (Keybindings) shows the Ctrl+Q leader pattern with real code.
- R11 (Defensive coding) lists all non-negotiables with at least one code example each.
- R12 (Testing) shows the factory injection pattern, pure function extraction, and golden file tests.
- R13 (Gentle-shell index) has 20 rows, each with file path, pattern(s) demonstrated, and a one-line description.
- R14 (Checklist) is 10–15 numbered steps, each referencing a specific file, command, or cookbook section.
- No code files are modified (only `extensions/COOKBOOK.md` is created).
- Root wrapper suite `node --test "test/**/*.test.js"` is still green.

**Artifacts** (files that must exist with real implementation, not stubs):
- `extensions/COOKBOOK.md` — the complete cookbook, ≥ 400 lines, all 14 sections.

**Key links** (critical connections that must work together):
- Every code snippet in the cookbook must be verbatim (or near-verbatim with `// …`) from a real file — not pseudocode. The reader should be able to `grep` for the snippet and find it.
- Every cross-reference (R14 checklist steps pointing to R-sections, R13 gentle-shell index pointing to file paths) must resolve.
- The R2 API method list must match the actual `ExtensionAPI` type in `@earendil-works/pi-coding-agent@1.2.0` — no phantom methods, no missing methods.
- The R3 event taxonomy must match the `ExtensionEvent` type union — no phantom events, no missing events.

**One-way-door decisions:**
- None. A new Markdown file. No code change, no migration, no published contract, no pi source change.

## Global Constraints

- No comments in code unless asked (project convention) — code snippets in the cookbook preserve the source's existing comments (they are documentation, not new code).
- Keep changes minimal and scoped: the only file created is `extensions/COOKBOOK.md`. No edits to any other file.
- Code snippets must be real (from bundled extensions or gentle-shell), not invented.
- The cookbook is in English (project convention for documentation).
- Markdown formatting: GitHub-flavored, consistent heading hierarchy (`#` for title, `##` for sections, `###` for subsections), fenced code blocks with language tag, tables where appropriate.
- Verify before claiming: after writing, run `wc -l extensions/COOKBOOK.md` (≥ 400), `grep -c '^## ' extensions/COOKBOOK.md` (≥ 14), and `node --test "test/**/*.test.js"` (green).

## File Structure

- `extensions/COOKBOOK.md` — **create.** The complete cookbook. ~500–700 lines. 14 sections (R1–R14) + a table of contents.

**Out of scope (do NOT create or modify):** any `.ts`, `.js`, `.json`, `.md` file other than `extensions/COOKBOOK.md`. No changes to `bin/`, `lib/`, `package.json`, `extensions/package.json`, any existing extension, any spec, any ADR.

---

### Task 1: Cookbook skeleton + core sections (tracer thread / door check)

> **Door check task.** Step 6 is a self-review: if the ToolDefinition reference (R4) is missing a field that `todo/index.ts` actually uses, fix before proceeding. If the checklist (R14) references a section that doesn't exist yet, that's expected (forward reference) — note it but don't block.

**Files:**
- Create: `extensions/COOKBOOK.md`

**Interfaces:**
- Consumes: `extensions/todo/index.ts` (417 lines), `extensions/ask-user/index.ts` (306 lines), `extensions/webfetch/index.ts` (87 lines), `@earendil-works/pi-coding-agent` type definitions (for `ExtensionAPI`, `ToolDefinition`), gentle-shell `extensions/` (for pattern references).
- Produces: `extensions/COOKBOOK.md` with sections: TOC, R1 (Extension Anatomy), R4 (ToolDefinition Reference), R5 (Dual-Mode UI Pattern), R14 (Building a New Extension — Checklist).
- Seam: none (in-process, documentation).
- Deletion test: delete the cookbook → no new extension can be built without reading 5+ existing extensions and pi's type definitions.
- Adapters: none (documentation).

**SATISFIES:** skeleton-complete (scenario: "Given a developer who has never built a pi extension, following R14 + R1 + R4 + R5 produces a working extension scaffold with a tool, a test, and a package.json that auto-loads in skill-pi")

- [ ] **Step 1: Survey the codebase for code snippets**

Read and note the key line ranges for each section's code examples:

```bash
# Extension anatomy (R1): todo package shape
cat extensions/todo/package.json
cat extensions/todo/tsconfig.json
ls extensions/todo/ extensions/todo/src/

# ToolDefinition (R4): the full tool registration
grep -n 'registerTool' extensions/todo/index.ts
grep -n 'parameters' extensions/todo/index.ts
grep -n 'renderCall\|renderResult' extensions/todo/index.ts
grep -n 'execute' extensions/todo/index.ts

# Dual-mode (R5): ask-user TUI vs RPC
grep -n 'ctx.mode\|ctx.ui.custom\|ctx.ui.select\|ctx.ui.input' extensions/ask-user/index.ts

# Env kill-switch (R7): webfetch
grep -n 'SKILL_PI_WEBFETCH\|parseEnableEnv' extensions/webfetch/index.ts

# Sidebar card (R8): todo
grep -n 'sidebarPart\|setWidget\|invalidateSidebar' extensions/todo/index.ts

# Ctrl+Q leader (R10): todo
grep -n 'onTerminalInput\|ctrl+q' extensions/todo/index.ts

# Hidden transcript state (R6): todo
grep -n 'sendMessage.*display.*false\|customType\|TODO_STATE_MESSAGE_TYPE' extensions/todo/index.ts

# Cross-extension (R9): pi-swarm event bus
grep -n 'events.emit\|events.on' extensions/pi-swarm/index.ts

# Testing (R12): todo test files
ls extensions/todo/*.spec.ts extensions/todo/src/
```

Also read pi's type definitions:

```bash
find node_modules/@earendil-works/pi-coding-agent -name '*.d.ts' | head -10
grep -n 'interface ExtensionAPI\|interface ToolDefinition\|type ExtensionEvent' node_modules/@earendil-works/pi-coding-agent/dist/*.d.ts
```

- [ ] **Step 2: Write the cookbook skeleton with TOC + R1 + R4 + R5 + R14**

Create `extensions/COOKBOOK.md` with:

```markdown
# Pi Extension Cookbook

Building blocks for skill-pi extensions. This document is the answer to
"how do I add extension #16?" — it covers the complete extension-building
pattern: anatomy, API surface, event taxonomy, tool definition, dual-mode
UI, state management, config, sidebar cards, cross-extension
communication, keybindings, defensive coding, testing, and a
step-by-step checklist.

Source: distilled from gentle-shell's extensions/ (20 files, MIT) and
skill-pi's 14 bundled extensions. Pi 1.2.0.

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

[The complete shape of a skill-pi extension: directory layout, package.json
fields, index.ts entry, src/ split, tsconfig.json, test layout.
Canonical example: extensions/todo/]

## 4. ToolDefinition Reference

[The complete ToolDefinition shape with real code from todo/index.ts and
ask-user/index.ts. All fields: name, label, description, promptSnippet,
promptGuidelines, parameters (TypeBox), outputSchema, exposure, namespace,
annotations, defaultActive, prepareArguments, prepareLoadout, executionMode,
renderShell, execute, renderCall, renderResult.]

## 5. Dual-Mode UI Pattern

[How to build a tool that works in TUI and RPC/print modes. Real code from
ask-user/index.ts: ctx.mode check, ctx.ui.custom<T>() TUI path,
ctx.ui.select()/ctx.ui.input() RPC fallback, print-mode graceful
degradation.]

## 14. Building a New Extension — Checklist

[Step-by-step: 1. Create extensions/<name>/ directory. 2. Write package.json
(ADR-0005 naming, ADR-0007 shape). 3. Write tsconfig.json (copy from todo).
4. Write index.ts (env kill-switch, registerTool, event wiring). 5. Write
src/ modules (pure logic, testable). 6. Write tests (vitest, factory
injection). 7. npm install in extension dir. 8. bun test / npm test. 9.
tsc --noEmit. 10. Write README.md. 11. Verify auto-discovery (node bin/
skill-pi.js in a scratch project). 12. Run root suite. 13. Commit.
Each step references a specific file or cookbook section.]
```

Fill in R1, R4, R5, R14 with **real code snippets** (verbatim from the files, with `// …` for omitted lines). R2, R3, R6, R7, R8, R9, R10, R11, R12, R13 get placeholder headings with a one-line summary (filled in Tasks 2–5).

- [ ] **Step 3: Verify the code snippets are real**

```bash
# Spot-check 5 snippets from the cookbook against their source files
# (the reader should be able to grep for them)
grep -n 'promptSnippet' extensions/todo/index.ts
grep -n 'executionMode' extensions/todo/index.ts
grep -n 'ctx.ui.custom' extensions/ask-user/index.ts
grep -n 'SKILL_PI_WEBFETCH' extensions/webfetch/index.ts
grep -n 'sidebarPart' extensions/todo/index.ts
```

- [ ] **Step 4: Verify structure**

```bash
wc -l extensions/COOKBOOK.md          # expect ≥ 200 lines (skeleton, before thickening)
grep -c '^## ' extensions/COOKBOOK.md # expect ≥ 14 (all section headings present, even if placeholder)
```

- [ ] **Step 5: Root suite gate**

```bash
node --test "test/**/*.test.js"
```

Expected: green (no code change, but verify no accidental edit).

- [ ] **Step 6: Self-review (door check)**

Read the R14 checklist. Verify:
- Every step references a real file or command.
- The ToolDefinition reference (R4) covers every field that `todo/index.ts` line 252–291 uses (`name`, `label`, `description`, `promptSnippet`, `promptGuidelines`, `parameters`, `executionMode`, `renderCall`, `renderResult`, `execute`).
- The dual-mode section (R5) shows both TUI and RPC paths.
- If a field is missing from R4, add it now. If the checklist references a section that doesn't exist yet, that's expected (forward reference).

- [ ] **Step 7: Commit**

```bash
git add extensions/COOKBOOK.md
git commit -m "docs: add pi extension cookbook skeleton (anatomy, tooldef, dual-mode, checklist)"
```

### Task 2: API surface + event taxonomy + state patterns

**Files:**
- Modify: `extensions/COOKBOOK.md` (fill in R2, R3, R6)

**Interfaces:**
- Consumes: `@earendil-works/pi-coding-agent` type definitions (`ExtensionAPI`, `ExtensionEvent`), all 14 bundled extensions (for usage examples), gentle-shell extensions (for patterns not covered by bundled extensions).
- Produces: R2 (complete API method table), R3 (event taxonomy with categories, signatures, return semantics), R6 (four state patterns with code).
- Seam: none.
- Deletion test: delete R2 → a developer can't know what API methods are available without reading pi's `.d.ts`. Delete R3 → a developer can't know which events can block vs. modify. Delete R6 → a developer can't persist state across `/reload`.
- Adapters: none.

**SATISFIES:** api-surface-complete (scenario: "Given a developer who wants to know what `pi.registerMcpServer` does and which extension uses it, R2 answers in one line + pointer"), events-complete (scenario: "Given a developer who wants to know if `tool_call` can block a tool execution, R3 answers: yes, return `{ block: true, reason: '...' }`"), state-patterns-complete (scenario: "Given a developer who needs to persist a counter across `/reload`, R6 shows the `Symbol.for` pattern with real code")

- [ ] **Step 1: Extract the complete ExtensionAPI method list from pi's types**

```bash
grep -n 'registerTool\|registerCommand\|registerShortcut\|registerFlag\|registerProvider\|registerMcpServer\|registerVirtualModel\|registerMessageRenderer\|registerEntryRenderer\|registerToolRenderer\|registerMarkdownTransformer\|on(\|events\|sendMessage\|sendUserMessage\|appendEntry\|exec\|setModel\|setSessionName\|getSessionName\|setLabel\|getSettings\|getActiveTools\|setActiveTools\|getAllTools\|getCommands\|getThinkingLevel\|setThinkingLevel\|getFlag\|getMcpServers\|getEditorComponent' \
  node_modules/@earendil-works/pi-coding-agent/dist/types.d.ts 2>/dev/null || \
  grep -rn 'interface ExtensionAPI' node_modules/@earendil-works/pi-coding-agent/
```

For each method, find at least one bundled extension that uses it:

```bash
grep -l 'registerTool' extensions/*/index.ts
grep -l 'registerCommand' extensions/*/index.ts
grep -l 'registerShortcut' extensions/*/index.ts
grep -l 'registerProvider' extensions/*/index.ts
grep -l 'events.emit\|events.on' extensions/*/index.ts
grep -l 'sendMessage' extensions/*/index.ts
# etc.
```

- [ ] **Step 2: Extract the complete event list from pi's types + bundled usage**

```bash
grep -n 'pi.on(' extensions/*/index.ts | sed 's/.*pi\.on(//' | sort -u
grep -n 'pi.on(' extensions/*/*.ts | sed 's/.*pi\.on(//' | sort -u
# Cross-reference with gentle-shell events
```

Group by category: Session lifecycle, Agent loop, Turn, Message, Tool, Context/Prompt, Provider, Model, Input, UI, System. For each: handler signature, return-value semantics (can block? can modify? void?), bundled example.

- [ ] **Step 3: Extract the four state patterns with real code**

Pattern 1 — Per-session Map: `extensions/todo/index.ts` line 124 (`const sessions = new Map<string, TodoSession>()`).
Pattern 2 — Hidden transcript messages: `extensions/todo/index.ts` lines 151–155 (`pi.sendMessage({ customType, display: false }, { triggerTurn: false })`) + lines 384–405 (`context` event replay).
Pattern 3 — `Symbol.for` / `globalThis`: gentle-shell `resume-hint.ts` (search for `Symbol.for`), gentle-shell `skill-registry.ts` (search for `globalThis`).
Pattern 4 — `WeakMap`: gentle-shell `session-scratch.ts` (search for `WeakMap`).

- [ ] **Step 4: Write R2, R3, R6 into the cookbook**

Fill in the placeholder headings with the extracted content. R2 is a table: `| Method | Description | Used by |`. R3 is a table per category: `| Event | Handler signature | Return semantics | Example |`. R6 is four subsections with code blocks.

- [ ] **Step 5: Verify**

```bash
wc -l extensions/COOKBOOK.md          # expect ≥ 350 lines
grep -c '^## ' extensions/COOKBOOK.md # expect ≥ 14
# Spot-check: every method in R2 has a "Used by" cell
# Spot-check: every event in R3 has a return-semantics cell
```

- [ ] **Step 6: Commit**

```bash
git add extensions/COOKBOOK.md
git commit -m "docs(cookbook): add ExtensionAPI surface, event taxonomy, state patterns"
```

### Task 3: Config + sidebar card + cross-extension + keybindings

**Files:**
- Modify: `extensions/COOKBOOK.md` (fill in R7, R8, R9, R10)

**Interfaces:**
- Consumes: `extensions/lsp/` (conf.d), `extensions/permission/` (conf.d), `extensions/pi-context-include/` (settings.json block), `extensions/webfetch/index.ts` (env kill-switch), `extensions/todo/index.ts` (sidebar card), `extensions/pi-swarm/index.ts` (event bus + file handshake), `extensions/todo/index.ts` + `extensions/plan-build/index.ts` + `extensions/pi-swarm/index.ts` (Ctrl+Q leader).
- Produces: R7 (three config mechanisms), R8 (sidebar card integration), R9 (three cross-extension channels), R10 (Ctrl+Q leader pattern).
- Seam: none.
- Deletion test: delete R7 → a developer doesn't know which config mechanism to use. Delete R8 → a developer can't add a card to the sidebar. Delete R9 → a developer can't communicate between extensions. Delete R10 → a developer invents a conflicting keybinding.
- Adapters: none.

**SATISFIES:** config-complete (scenario: "Given a developer who needs user-configurable roots for a path fence, R7 points to conf.d (ADR-0008) with a real example from lsp"), sidebar-complete (scenario: "Given a developer who wants a live card in the sidebar, R8 shows the complete import + Component + setWidget + tool_execution_end wiring from todo"), cross-extension-complete (scenario: "Given a developer who needs to notify another extension of a state change, R9 shows the event bus pattern from pi-swarm"), keybindings-complete (scenario: "Given a developer who needs a keybinding, R10 shows the Ctrl+Q leader pattern and warns against standalone Ctrl+Q re-registration")

- [ ] **Step 1: Extract config patterns**

```bash
# conf.d pattern (ADR-0008)
grep -n 'conf.d\|confd\|\.conf' extensions/lsp/index.ts extensions/permission/index.ts
# settings.json block
grep -n 'settings.json\|contextInclude' extensions/pi-context-include/src/config.ts 2>/dev/null || \
  grep -rn 'settings.json' extensions/pi-context-include/
# env kill-switch
grep -n 'SKILL_PI_.*=\|parseEnableEnv\|toLowerCase' extensions/webfetch/index.ts extensions/todo/index.ts
```

- [ ] **Step 2: Extract sidebar card integration**

```bash
grep -n 'sidebarPart\|sidebarState\|invalidateSidebar\|setWidget' extensions/todo/index.ts
grep -n 'sidebarPart\|setWidget' extensions/skill-pi-tui/src/sidebar.ts 2>/dev/null || \
  grep -rn 'sidebarPart' extensions/skill-pi-tui/src/
```

- [ ] **Step 3: Extract cross-extension channels**

```bash
# Event bus
grep -n 'events.emit\|events.on' extensions/pi-swarm/index.ts
# Tool result details
grep -n 'details' extensions/todo/index.ts | head -5
# File handshake
grep -rn 'handshake\|pi-vcc-includes' extensions/pi-vcc/ extensions/pi-context-include/ 2>/dev/null
```

- [ ] **Step 4: Extract Ctrl+Q leader pattern**

```bash
grep -n -A5 'onTerminalInput' extensions/todo/index.ts
grep -n -A5 'onTerminalInput' extensions/plan-build/index.ts
grep -n -A5 'onTerminalInput' extensions/pi-swarm/index.ts
```

- [ ] **Step 5: Write R7, R8, R9, R10 into the cookbook**

Fill in the placeholder headings. R7: three subsections (conf.d, settings.json, env kill-switch) with real code. R8: the complete sidebar card integration code from todo. R9: three subsections (event bus, tool details, file handshake) with real code. R10: the leader pattern + the ADR-0010 constraint.

- [ ] **Step 6: Verify**

```bash
wc -l extensions/COOKBOOK.md          # expect ≥ 450 lines
```

- [ ] **Step 7: Commit**

```bash
git add extensions/COOKBOOK.md
git commit -m "docs(cookbook): add config patterns, sidebar card, cross-extension, keybindings"
```

### Task 4: Defensive coding + testing + gentle-shell index

**Files:**
- Modify: `extensions/COOKBOOK.md` (fill in R11, R12, R13)

**Interfaces:**
- Consumes: gentle-shell `extensions/` (for defensive coding examples, testing patterns, the 20-extension index), skill-pi `extensions/todo/` (for testing patterns: `card.spec.ts`, `card-golden.spec.ts`, `model.spec.ts`, `index.spec.ts`).
- Produces: R11 (defensive coding checklist), R12 (testing patterns), R13 (gentle-shell pattern index, 20 rows).
- Seam: none.
- Deletion test: delete R11 → a developer forgets the fail-open pattern and crashes the session. Delete R12 → a developer doesn't know how to test an extension. Delete R13 → a developer doesn't know which gentle-shell file to read for a specific pattern.
- Adapters: none.

**SATISFIES:** defensive-complete (scenario: "Given a developer who's about to add a `fs.readFile` call, R11 reminds them: try/catch, fail-open, never crash the session"), testing-complete (scenario: "Given a developer who needs to test a tool's execute function, R12 shows the factory injection pattern + a real test from todo"), index-complete (scenario: "Given a developer who wants to see how gentle-shell handles `/reload` idempotency, R13 points to `resume-hint.ts` with the `Symbol.for` line number")

- [ ] **Step 1: Extract defensive coding patterns from gentle-shell**

Search for:
- try/catch around I/O: `grep -n 'try {' gentle-shell/extensions/*.ts | head -10`
- Timeouts on exec: `grep -n 'timeout\|Timeout' gentle-shell/extensions/*.ts | head -10`
- Structural feature detection: `grep -n 'typeof.*===.function' gentle-shell/extensions/*.ts | head -10`
- Env var `?.` chaining: `grep -n 'env\.\?\.' gentle-shell/extensions/*.ts | head -10`
- Version audit: `grep -n 'version\|audit' gentle-shell/extensions/gentle-shell.ts | head -10`

- [ ] **Step 2: Extract testing patterns from skill-pi todo**

```bash
ls extensions/todo/*.spec.ts extensions/todo/src/*.ts
head -30 extensions/todo/model.spec.ts
head -30 extensions/todo/card.spec.ts
head -30 extensions/todo/index.spec.ts
head -30 extensions/todo/card-golden.spec.ts
```

Note: factory injection pattern (`createXExtension(opts)` with faked deps), pure function extraction, golden file tests for card rendering.

- [ ] **Step 3: Build the gentle-shell pattern index (R13)**

For each of the 20 gentle-shell extensions, note:
- File path (e.g., `extensions/resume-hint.ts`)
- Pattern(s) demonstrated (e.g., "Symbol.for /reload idempotency, env-var claiming, wx flag")
- One-line description

Create the 20-row table.

- [ ] **Step 4: Write R11, R12, R13 into the cookbook**

Fill in the placeholder headings. R11: a checklist with code examples. R12: the testing patterns with real test code. R13: the 20-row table.

- [ ] **Step 5: Verify**

```bash
wc -l extensions/COOKBOOK.md          # expect ≥ 500 lines
grep -c '^## ' extensions/COOKBOOK.md # expect ≥ 14
# Verify R13 has 20 rows
grep -c '^| `extensions/' extensions/COOKBOOK.md  # expect ≥ 20
```

- [ ] **Step 6: Commit**

```bash
git add extensions/COOKBOOK.md
git commit -m "docs(cookbook): add defensive coding, testing patterns, gentle-shell index"
```

### Task 5: Final review + root suite gate

**Files:**
- Modify: `extensions/COOKBOOK.md` (final pass: fix cross-references, ensure consistency, add any missing details)

**Interfaces:**
- Consumes: all of Tasks 1–4.
- Produces: the complete, verified cookbook.
- Seam: none.
- Deletion test: n/a.
- Adapters: none.

**SATISFIES:** cookbook-complete (scenario: "Given the success criteria from the briefing, all 14 are met; the cookbook is ≥ 400 lines, all sections present, all code snippets real, all cross-references resolve, root suite green")

- [ ] **Step 1: Final structural verification**

```bash
wc -l extensions/COOKBOOK.md
grep -c '^## ' extensions/COOKBOOK.md
grep -c '^### ' extensions/COOKBOOK.md
# Verify TOC links resolve (each TOC entry has a matching heading)
# Verify no placeholder text remains (search for "TBD", "TODO", "fill in", "placeholder")
grep -in 'TBD\|TODO\|fill in\|placeholder' extensions/COOKBOOK.md
```

- [ ] **Step 2: Cross-reference accuracy check**

For each code snippet in the cookbook, verify it exists in the referenced source file:

```bash
# Spot-check 10 snippets (one per section)
# R1: package.json snippet
grep -n 'devopstales/pi-todo' extensions/todo/package.json
# R4: ToolDefinition snippet
grep -n 'promptSnippet' extensions/todo/index.ts
# R5: dual-mode snippet
grep -n 'ctx.ui.custom' extensions/ask-user/index.ts
# R6: hidden transcript snippet
grep -n 'display: false' extensions/todo/index.ts
# R7: env kill-switch snippet
grep -n 'SKILL_PI_WEBFETCH' extensions/webfetch/index.ts
# R8: sidebar card snippet
grep -n 'sidebarPart' extensions/todo/index.ts
# R9: event bus snippet
grep -n 'events.emit' extensions/pi-swarm/index.ts
# R10: Ctrl+Q leader snippet
grep -n 'onTerminalInput' extensions/todo/index.ts
# R11: try/catch snippet (find in any extension)
grep -n 'try {' extensions/webfetch/index.ts
# R12: test snippet
head -5 extensions/todo/model.spec.ts
```

- [ ] **Step 3: Root wrapper suite gate**

```bash
node --test "test/**/*.test.js"
```

Expected: green.

- [ ] **Step 4: Final commit**

```bash
git add extensions/COOKBOOK.md
git commit -m "docs(cookbook): final review, cross-reference fixes, verification"
```

---

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Shell commands | N/A: the cookbook is a `.md` file; no shell commands are executed by it. | n/a | n/a |
| Subprocesses | N/A: no subprocesses. | n/a | n/a |
| Version-control automation | N/A: no git hooks or VCS automation touched. | n/a | n/a |
| Executable-file classification | N/A: `.md` is not executable. | n/a | n/a |
| Process integration | N/A: no process changes. | n/a | n/a |
| Mnemonic tool contracts | N/A: no Mnemonic tool changes. | n/a | n/a |
| `_shared/{planning,craft,verification,knowledge}/` files | N/A: no shared standard files touched. | n/a | n/a |
| Routing | N/A: no routing. | n/a | n/a |

## Rollback Plan

Delete `extensions/COOKBOOK.md`. No other file is touched. `git log --oneline -5` will show the 4–5 commits that created it; revert them if needed.

## Success Criteria (measurable)

- `extensions/COOKBOOK.md` exists, is ≥ 400 lines, and covers all 14 sections (R1–R14).
- Every API method in R2 is listed with a "Used by" pointer.
- Every event in R3 is grouped by category, has its handler signature, return-value semantics, and a bundled example.
- The ToolDefinition reference (R4) covers all fields present in pi 1.2.0's type definition.
- The dual-mode pattern (R5) shows both TUI and RPC paths with real code from `ask-user`.
- The state management section (R6) shows all four patterns with real code.
- The config section (R7) shows all three mechanisms with real code.
- The sidebar card section (R8) shows the complete integration with real code from `todo`.
- The cross-extension section (R9) shows all three channels with real code.
- The gentle-shell pattern index (R13) has 20 rows.
- The checklist (R14) is 10–15 steps, each referencing a specific file or command.
- No code files are modified.
- Root wrapper suite `node --test "test/**/*.test.js"` is green.
