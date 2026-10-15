# Tasks: Plan/Build extension with sidebar plan card

Stacked-to-main. Each task is a work unit: TDD, conventional commit, checkpoint.

## Wave 1

- [x] TICKET-01 — Scaffolding: package.json, tsconfig, .npmrc, vitest, no-op index.ts, README stub. Install dev toolchain. (blueprint T1) — 1dcbb09

## Wave 2 (after 01)

- [x] TICKET-02 — Core module port: plan-state, plan-execution, plan-markdown, utils, prompts + ported specs. Custom types renamed skill-pi-plan-*. (blueprint T2) — 9baaa8a
- [x] TICKET-03 — Plan card: src/theme.ts + src/card.ts (renderPlanCard) + card.spec.ts. (blueprint T3) — 9baaa8a

## Wave 3 (after 02)

- [x] TICKET-04 — Context/handoff/question/mode/shortcut-config/tool-presentation port + specs. (blueprint T4) — 9baaa8a

## Wave 4 (after 03, 04)

- [x] TICKET-05 — index.ts: flags, tools, commands, shortcuts + registration specs. (blueprint T5) — dd19cb1
- [x] TICKET-06 — index.ts: card wiring + event handlers (session_start replay, tool_execution_end show, context reconciliation, shutdown) + specs. (blueprint T6) — dd19cb1

## Wave 5 (after 05, 06)

- [x] TICKET-07 — Docs: extension README (attribution), root README entry, state.yaml. Full test sweep. (blueprint T7) — 8a95549

## QA gate — PASS (2026-10-15)

- vitest run green (extensions/plan-build): 53/53
- tsc --noEmit clean (extensions/plan-build): no new errors
- node --test "test/**/*.test.js" green (root): 40 pass, 1 flaky (pre-existing RPC timeout)
- acceptance.feature scenarios covered by named tests (map in report.md)
- skill-pi-tui section order fix: 7aa4f5d

## Review

Two-axis: spec compliance (briefing scope in/out honored) + code quality (patterns match
todo/ask-user, no dead forked code, no comments unless asked).
