# @devopstales/pi-plan-build

Plan/Build modes for [pi](https://pi.dev), integrated with the **skill-pi-tui**
fullscreen sidebar. Core lifecycle forked from
[janvitos's pi-plan-build](https://github.com/janvitos/pi-plan-build) (MIT).

## What it does

Adds an explicit **Plan / Build** mode toggle on top of pi's normal agent loop:

- **Plan mode** — the agent reads, analyzes, discusses, and drafts a plan in a
  canonical Markdown file under `~/.skill-pi/agent/plans/`. File mutations outside
  the plan file are blocked. The model sees a read-only guidance block in every
  turn.
- **Build mode** — the agent implements. Tracked plan Markdown is read-only;
  scope changes go through `plan_task` metadata. Step-by-step execution (when
  chosen at approval) gates each step behind an explicit user instruction.
- **Single-current-plan invariant** — one attached plan at a time. Complete it
  (`plan_complete` / `/plan done`) or abandon it (`/plan abandon`) before
  starting another. History is preserved in the transcript.
- **Clean-session handoff** — `plan_exit` → "Start fresh and implement" opens a
  linked child session, copies the plan file, restores the model/thinking level,
  and kicks off implementation with a self-contained prompt. The source session
  records a `transferred` terminal state.
- **Step-by-step execution** — the plan's `## Implementation Steps` section is
  parsed into a state machine. The user says "Proceed" (or the agent calls
  `plan_step_control start`) to begin a step; `plan_step_complete` closes it;
  skip / revise / pause / resume / cancel are all available.

## Visual surface

The plan is drawn as a **card in the skill-pi-tui sidebar rail** (terminals
≥ 140 columns) using the same `cardTop` / `cardBottom` / `renderCard` machinery
as the todo card:

- **Plan open, no execution** — header with plan title + mode; body with scope
  (muted) and, when `plan_finish` recorded an outcome, the kind / reason /
  user-action lines.
- **Execution active** — header with `done/total · status`; one row per step
  with a status glyph (`○ ▷ ▶ ✓ –`); completed/skipped rows dimmed.
- **Awaiting validation** — warning-tone card with the user-action text.

In narrow terminals (no sidebar rail) the card is absent; the mode status line
(footer) and all tools/commands still work.

The mode rail in the footer shows the current mode (`plan` / `build`) in the
mode's theme color, or the plan title when `showPlanTitle` is on.

## Tools

| Tool | Mode | Purpose |
|---|---|---|
| `plan_task` | Plan (new) / both | Create, update, include, discussion, abandon, list the current plan's metadata. |
| `plan_exit` | Plan | Display the saved plan and request approval (implement-here / fresh / step-by-step / stay). |
| `plan_complete` | Build | Complete the entire plan (work + checks passed, or explicit closure). |
| `plan_finish` | Build | Record why the plan remains unfinished: `awaiting_validation`, `blocked`, `waiting_for_input`, `still_working`. |
| `plan_step_control` | Build | Start / complete / skip / revise / pause / resume / cancel / hide / show step execution. |
| `plan_step_complete` | Build | Complete the active step with a concise summary. |

## Commands

| Command | Purpose |
|---|---|
| `/plan` | Switch to Plan mode (no args) or manage the current plan: `new`, `done`, `abandon`, `list`, `show`, `history`. |
| `/build` | Switch to Build mode. |
| `/build-fresh` | Start the clean linked implementation session for a plan selected via `plan_exit` → "Start fresh and implement". |
| `/plan-settings` | Configure default mode, shortcuts, plan-title visibility, and the stable tool catalog. |

## Flags & shortcuts

- `--plan` / `--build` — start a new session in the given mode.
- `Alt+M` — cycle Plan ↔ Build (global).
- `Tab` (in the editor) — cycle Plan ↔ Build when autocomplete is closed.
  This replaces the file-completion trigger; disable via `/plan-settings` if
  that's a problem.

## Configuration

`$PI_CODING_AGENT_DIR/skill-pi-plan-build.json` (i.e.
`~/.skill-pi/agent/skill-pi-plan-build.json`):

```json
{
  "defaultMode": "build",
  "showPlanTitle": true,
  "stableToolCatalog": true,
  "shortcuts": {
    "toggleMode": ["alt+m"],
    "toggleModeInEditor": ["tab"]
  }
}
```

All keys are optional; missing file → defaults. Malformed JSON → warning +
defaults (the file is never overwritten by the extension).

## Persistence

State is persisted as `skill-pi-plan-state` custom entries in the session
transcript (`appendEntry`). On `session_start`, `session_tree`, and fork, the
extension replays the latest entry to restore the collection, mode, and
execution state. Plan files live at
`~/.skill-pi/agent/plans/<sanitized-session-id>[-NNN].md`.

## Differences from upstream pi-plan-build

- **Composer / custom editor dropped** — mode feedback is a status line, not a
  custom editor component. The fullscreen layout is owned by skill-pi-tui.
- **64-column plan panel dropped** — replaced by the sidebar card.
- **Per-mode model/thinking memory dropped** — `/plan-settings` no longer offers
  per-mode model selection.
- **Question tool dropped** — `ask_user` (bundled) covers structured questions.
- **Config file renamed** — `skill-pi-plan-build.json` instead of
  `pi-plan-build.json`.
- **Custom types namespaced** — `skill-pi-plan-*` instead of `pi-plan-build-*`
  (legacy `pi-plan-build-state` entries are still read for compatibility).

## Attribution

Core lifecycle logic (plan state, execution state machine, context injection,
handoff, mode selection, shortcut config, prompts, tool presentation) is forked
from [janvitos/pi-plan-build](https://github.com/janvitos/pi-plan-build)
(MIT, © 2025 Jan Vitós). The sidebar card integration, entry/message type
namespacing, and trimming decisions are skill-pi work.

## Development

```sh
cd extensions/plan-build
npm install       # dev toolchain only (typescript, vitest, @types/node)
npm test          # vitest run
npm run check     # tsc --noEmit
```
