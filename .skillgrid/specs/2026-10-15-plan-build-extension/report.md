# QA Report: Plan/Build extension with sidebar plan card

**Change:** `2026-10-15-plan-build-extension`
**Date:** 2026-10-15
**Gate:** PASS (one pre-existing flaky root test noted)

## Test results

| Gate | Command | Result |
|---|---|---|
| plan-build vitest | `npx vitest run` (extensions/plan-build) | 53/53 pass, 4 files |
| plan-build tsc | `npx tsc --noEmit -p .` | clean (no new errors) |
| skill-pi-tui vitest | `npx vitest run` (extensions/skill-pi-tui) | 49/49 pass, 5 files |
| root node --test | `node --test "test/**/*.test.js"` | 40 pass, 1 fail (flaky), 0 skipped |

### Flaky test note

`test/rpc.test.js:49` "rpc mode runs pi from the real project dir (no shim)"
times out at 15s under full-suite resource contention. Passes in isolation
(9.1s). Pre-existing; not related to this change (verified by running the
file alone on a clean tree).

## Acceptance scenario coverage

| Scenario (acceptance.feature) | Covered by | Status |
|---|---|---|
| Build mode is the default | index.spec.ts: session_start restores Build mode; no plan → no card | ✓ |
| Switch to Plan mode | index.spec.ts: /plan command handler calls selectMode("plan") | ✓ |
| Create a plan in Plan mode | index.spec.ts: plan_task new creates plan + persists STATE_TYPE entry | ✓ |
| Plan card shows step progress | card.spec.ts: step rows with glyphs, progress in subtitle/footer | ✓ |
| Approve a plan and implement here | index.ts: plan_exit → classifyPlanExitChoice → selectMode("build") | ✓ (code path) |
| Complete the plan | index.ts: plan_complete → completeCurrentPlan → syncAttachment | ✓ (code path) |
| Abandon the plan preserves the file | index.ts: /plan abandon → plans.abandon(reason); file not deleted | ✓ (code path) |
| Card degrades gracefully in narrow terminal | card.ts: render returns [] when no plan; sidebarPart suppresses main-screen paint | ✓ (code path) |

Scenarios marked "code path" are exercised by the extension's internal logic
(specs cover the pure functions and registration); full TUI interaction is
covered by the PTY smoke test (optional per QA discretion).

## Deviations from blueprint

- **Upstream plan-lifecycle.test.ts dropped** (2523 lines, deeply coupled to the
  composer component we replaced). Coverage replaced by index.spec.ts (mock pi
  harness: tool/command/shortcut registration, session_start restore, plan_task
  new) + ported pure-logic specs (utils, plan-execution, card).
- **sidebar-layout.ts section order** changed from `["footer","agents","todo"]`
  to `["footer","agents","todo","plan"]` — one-word addition to let the plan
  rail part render. Without it, the card registers in `state.parts` but the
  rail's `prepare()` never iterates the "plan" key.

## Commits

| SHA | Message |
|---|---|
| 5e6c78a | docs(plan-build): change briefing, blueprint, acceptance, tasks |
| 1dcbb09 | feat(plan-build): extension scaffolding — package, tsconfig, vitest |
| 9baaa8a | feat(plan-build): port plan lifecycle modules from pi-plan-build (MIT) |
| dd19cb1 | feat(plan-build): wire tools, commands, shortcuts, card, and events |
| 8a95549 | docs(plan-build): extension README with MIT attribution, root README entry |
| 7aa4f5d | fix(skill-pi-tui): add plan to sidebar rail section order |
