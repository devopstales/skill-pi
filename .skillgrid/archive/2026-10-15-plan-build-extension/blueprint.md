# Blueprint: Plan/Build extension with sidebar plan card

**Change:** `2026-10-15-plan-build-extension`
**Tier:** T2
**Depends on:** `2026-10-14-skill-pi-tui-sidebar` (shipped), `2026-10-13-ask-user` (shipped)

## Architecture

```
extensions/plan-build/
  index.ts                  # extension entry: tools, commands, shortcuts, events, card wiring
  src/
    card.ts                 # NEW: Plan card rows (cardTop/cardBottom from skill-pi-tui)
    theme.ts                # NEW: buildTheme (mirrors todo/src/theme.ts)
    plan-state.ts           # forked: PlanState, collection, restore, STATE_TYPE
    plan-execution.ts       # forked: step execution state machine
    plan-context.ts         # forked: plan context injection + reconciliation
    plan-markdown.ts        # forked: canonical plan file I/O
    handoff.ts              # forked: clean-session handoff
    mode-selection.ts       # forked (trimmed: no per-mode model memory)
    question-ui.ts          # forked (trimmed: no question-tool registration)
    shortcut-config.ts      # forked: config load/save + /plan-settings data
    utils.ts                # forked: mode logic, plan path, title extraction
    prompts.ts              # forked: prompt guidance constants
    tool-presentation.ts    # forked: tool render helpers
  *.spec.ts                 # vitest specs (ported + new)
  package.json / tsconfig.json / .npmrc / README.md
```

**Card surface decision:** the Plan card is a **render function** (`renderPlanCard`),
not a pi-tui `Component` class. Rationale (verified against `skill-pi-tui/src/sidebar-layout.ts`):
the rail calls `component.render(width)` as a plain function each tick and caches by
`digest()` — the todo card (`todo/index.ts` `makeCard`) proves this pattern: state lives
in the extension's session object, `render(width)` reads it, `digest()` returns a JSON
of the inputs that affect output. This drops the upstream `PlanPanel`/`PlanPanelHeader`
component classes (which existed because upstream owned its own HStack layout) and the
`ContainedScrollView` (the rail's own `ScrollView` handles wheel scrolling, with per-part
mouse dispatch already wired in `sidebar-layout.ts`).

**State persistence:** upstream mechanism kept — `pi.appendEntry(STATE_TYPE, snapshot)`
on every state change, replayed from the session branch on `session_start` via
`latestPlanState`/`restoreCollection`. No new transcript-mirroring needed (todo uses
`sendMessage` because it has no entry API usage; upstream already solved this better).

**UI ownership:** the extension does NOT call `setEditorComponent` or `setLayoutRoot`.
Composer feedback = `ctx.ui.setStatus(STATUS_KEY, …)`. Card = `sidebarPart(tui, "plan",
empty, rail)` registered in `tool_execution_end`/state-change handlers exactly like todo
registers in `tool_execution_end`. Narrow terminal → no sidebar rail → card absent,
status line remains.

## Data model (from upstream, unchanged)

- `PlanLifecycle { sequence, status: open|completed|abandoned|transferred, task?, outcome?, abandonReason?, completionSummary? }`
- `PlanTask { title, scope, decisions[] }`
- `PlanOutcome { kind: awaiting_validation|blocked|waiting_for_input|still_working, reason, userAction? }`
- `PlanExecutionState { status: running|paused|completed, panelVisible, steps[] }`
- `PlanStep { id, text, status: pending|ready|active|completed|skipped }`
- `PlanCollection { records[], attached: number|null, counter }`
- `StoredState { version: 4, selectedMode, collection, toolsBeforeModes, planSessionId, … }`

## Card design

`renderPlanCard(state, theme, width, options) -> string[]` where
`state = { mode, plan?, execution?, awaitingValidation? }`:

- **No plan open, no execution** → `[]` (rail hides empty sections automatically).
- **Plan open (no execution)** →
  - `cardTop({ title: plan.title, subtitle: `${mode} · ${status}`, tone: awaiting ? WARNING : INFO, glyph: PLAN_GLYPH })`
  - body: truncated scope line (muted); if outcome: reason + userAction lines (instruction-styled).
  - `cardBottom(tone, theme, width, hint)` with hint = status word.
- **Execution active** →
  - `cardTop({ title: plan.title, subtitle: `${done}/${total} · ${status}`, tone, glyph })`
  - body: step rows — glyph per status (`○ ▷ ▶ ✓ –` colored muted/accent/success),
    `N. text`, wrapped to inner width, done/skipped dimmed (mirrors `todoCardRows` task rows).
  - `cardBottom(…, hint = "paused" | "running" | "complete")`.

Scroll budget: the rail renders the full card and scrolls the whole rail
(`ScrollView` in `sidebar-layout.ts`). No per-card budget (simpler than todo's
16-line budget because the rail scrolls; verified the rail's overflow check
`visibleWidth(line) <= contentWidth` only constrains width, not height).

## Per-task WHAT

### T1 — Scaffolding
`extensions/plan-build/{package.json,tsconfig.json,.npmrc,README.md,.gitignore}`
+ empty `index.ts` (no-op default export) + vitest config + one trivial spec.
`package.json`: name `@devopstales/pi-plan-build`, version `0.1.0`, type module,
files `[index.ts, src, README.md]`, publishConfig github, peerDeps
`@earendil-works/pi-coding-agent ^1.2.0`, `@earendil-works/pi-tui *`, `typebox *`,
optional `@devopstales/skill-pi ^0.1.0`; devDeps `typescript`, `vitest`, `@types/node`;
scripts `check`/`test`/`test:watch`. `npm install` in the dir (dev toolchain only, ADR-0007).

### T2 — Core module port (pure logic)
Copy `plan-state.ts`, `plan-execution.ts`, `plan-markdown.ts`, `utils.ts` (trimmed),
`prompts.ts` from pi-plan-build@0.1.120 into `src/`, rename custom types
`pi-plan-build-*` → `skill-pi-plan-*`, keep `LEGACY_*` constants for upstream
compat (harmless). Port `utils.test.ts`, `plan-execution.test.ts`,
`plan-lifecycle.test.ts` specs. No behavior change beyond type-name rename +
trimming per-mode model bits from `utils.ts` if present. `tsc` clean, vitest green.

### T3 — Plan card (new)
`src/theme.ts` (buildTheme, mirror of todo) + `src/card.ts`
(`renderPlanCard`, `planCardTone`, step-row helpers). `card.spec.ts`: assert
row counts, header content, step glyphs, tone on awaiting validation, width
clipping, empty-state returns `[]`. `tsc` clean, vitest green.

### T4 — Context + handoff + question modules
Copy `plan-context.ts`, `handoff.ts`, `question-ui.ts` (trimmed: no
`registerQuestionTool`), `mode-selection.ts` (trimmed: no per-mode model memory),
`shortcut-config.ts` (config path `skill-pi-plan-build.json`), `tool-presentation.ts`.
Port their specs. `tsc` clean, vitest green.

### T5 — index.ts: tools + commands
Wire `index.ts`: `registerFlag(plan/build)`, tools
`plan_task`/`plan_exit`/`plan_complete`/`plan_finish`/`plan_step_control`/
`plan_step_complete`, commands `/plan`/`/build`/`/build-fresh`/`/plan-settings`
(trimmed menu), shortcuts `Alt+M` + editor `Tab`. Port the registration portions
of upstream `index.ts`. `index.spec.ts` for tool/command/shortcut registration
(mock `pi` like todo's spec). `tsc` clean, vitest green.

### T6 — index.ts: card wiring + events
`session_start` replay (restore collection from branch), `tool_execution_end`
`show()` (register `sidebarPart` "plan" rail when a plan is open), state-change
handlers calling `invalidateSidebar`, `context` handler (reconciliation),
`session_shutdown` cleanup. `index.spec.ts` additions: card registered when plan
open, absent when none, invalidated on step change. `tsc` clean, vitest green.

### T7 — Docs + root wiring
Extension `README.md` (usage, MIT attribution, shortcut tradeoff, config).
Root `README.md` "Currently bundled" entry. `.skillgrid/state.yaml` update.
Root `node --test` green (no regressions). Full vitest + tsc green.

## Alternatives considered

- **Keep upstream composer/panel, adapt to skill-pi rail** — rejected: `composer.ts`
  owns `setEditorComponent` + `setLayoutRoot` HStack; two layout owners conflict
  (skill-pi-tui already owns the fullscreen layout via `installSidebar`). Degrades to
  one of them losing.
- **Component-class card (like upstream PlanPanel)** — rejected: the rail calls
  `render(width)` as a plain function; a stateful class adds lifecycle (setState)
  with no benefit over a closure reading the session object (todo precedent).
- **`sendMessage` transcript mirroring (todo pattern)** — rejected: upstream's
  `appendEntry` entry-based persistence is already branch/fork-aware and versioned;
  re-deriving would be redundant state.

## Rollback

Delete `extensions/plan-build/` + root README entry. No other extension imports it.
