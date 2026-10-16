# Briefing: Plan/Build lifecycle extension with sidebar plan card

**Change:** `2026-10-15-plan-build-extension`
**Tier:** T2 (Beta) — new capability, ~15 files, new trust boundary (config file)
**Date:** 2026-10-15

## Intent

Port [janvitos/pi-plan-build](https://github.com/janvitos/pi-plan-build) (MIT) into
skill-pi as a bundled extension, replacing its custom-editor composer and 64-column
step panel with the **todo card's sidebar card component**. Plan/Build modes, the
single-current-plan invariant, approval flow, clean-session handoff, and step-by-step
execution all arrive from the fork; the visual surface is skill-pi-native.

## User decisions (confirmed)

1. **Card content: both** — plan metadata when a plan is open; step-by-step progress
   when execution is active. One card, mirrors the todo card's adaptivity.
2. **Feature scope: core lifecycle** — modes, plan tools, approval, clean-session
   handoff, step-by-step execution. Drop per-mode model memory and the question-tool
   toggle (ask-user already provides structured questions).
3. **Workflow: full T2** — briefing → blueprint → tasks → TDD execution → QA gate
   (L2+L3) → two-axis review → ship.

## Scope

### In

- Fork pi-plan-build core modules (MIT): `plan-state`, `plan-execution`, `plan-context`,
  `plan-markdown`, `handoff`, `mode-selection`, `question-ui`, `shortcut-config`,
  `utils`, `prompts`, `tool-presentation` — namespaced custom types `skill-pi-plan-*`.
- Plan card in the skill-pi-tui sidebar rail via `sidebarPart`/`invalidateSidebar`
  (same machinery as the todo card): `cardTop`/`cardBottom`/`renderCard` from
  `skill-pi-tui/src/card.ts`.
- Tools: `plan_task`, `plan_exit`, `plan_complete`, `plan_finish`, `plan_step_control`,
  `plan_step_complete` — same contracts as upstream.
- Commands: `/plan [new|done|abandon|list|show|history]`, `/build`, `/build-fresh`,
  `/plan-settings` (trimmed menu).
- Flags/shortcuts: `--plan`/`--build`, `Alt+M` + editor `Tab` toggle.
- Mode rail via `ctx.ui.setStatus` (composer feedback, no custom editor).
- Config at `$PI_CODING_AGENT_DIR/skill-pi-plan-build.json`.
- Tests: port pi-plan-build's 11 test files, adapt panel/composer tests to card tests,
  add `card.spec.ts`.
- Package: `@devopstales/pi-plan-build` (own `package.json`, `.npmrc`, `tsconfig.json`,
  vitest) matching todo/ask-user conventions.
- Docs: extension README (MIT attribution) + root README bundle entry.

### Out (deferred)

- Per-mode model/thinking memory (`/plan-settings` entry dropped).
- Question-tool registration + toggle (ask_user covers it).
- Upstream `composer.ts` custom editor (replaced by status line + sidebar card).
- Upstream `plan-panel.ts` 64-col panel (replaced by sidebar card).
- Standalone npm publish (bundled only for now; publish when a standalone consumer appears).

## Constraints (from config)

- No comments in code unless asked.
- Keep changes minimal and scoped.
- TDD: vitest + `tsc --noEmit -p .` per extension; root `node --test "test/**/*.test.js"` green.
- Conventional commits; work-unit checkpoints.
- Never modify pi source (ADR-0006); extension is self-contained (ADR-0007, proposed).
- Config via conf.d convention (ADR-0008, proposed) — config file name follows
  `skill-pi-plan-build.json` in the agent dir (upstream pattern), not conf.d, because
  upstream reads a single JSON and the port keeps that contract.

## Threat matrix

| Threat | Applicable? | Mitigation |
|---|---|---|
| UI ownership conflict with another extension owning the fullscreen layout | Low | Card degrades to no-card; status line + tools still work. Accepted. |
| Config file corruption | Low | Upstream `loadShortcutConfig` returns warning on malformed JSON; never overwrites |
| Upstream API drift (pi 1.2.0 vs 0.84.2 baseline) | Verified | All required APIs present in our installed 1.2.0 (checked `dist/index.d.ts`) |
| Tab shortcut replaces file-completion trigger | Known tradeoff | Documented; user can disable via `/plan-settings` |
| Plan file path collision across sessions | Low | Upstream `planPathFor` keys on session id + sequence |

## Rollback plan

Delete `extensions/plan-build/` + the root README entry. No other extension depends on
it; the config file is orphaned but inert. Zero changes outside the new dir + README.

## Success criteria (measurable)

1. `vitest run` green in `extensions/plan-build/` (ported + new card tests).
2. `tsc --noEmit -p extensions/plan-build` clean.
3. Root `node --test "test/**/*.test.js"` green (no regressions).
4. Plan card renders in the sidebar rail with a plan open (card.spec.ts asserts row
   structure; PTY smoke optional per QA discretion).

## Open items

- None blocking. Upstream `question` tool intentionally dropped; `ask_user` is the
  replacement surface (already bundled).
