# Tasks: Plan/Build extension with sidebar plan card

Stacked-to-main. Each task is a work unit: TDD, conventional commit, checkpoint.

## Wave 1

- [ ] TICKET-01 — Scaffolding: package.json, tsconfig, .npmrc, vitest, no-op index.ts, README stub. Install dev toolchain. (blueprint T1)

## Wave 2 (after 01)

- [ ] TICKET-02 — Core module port: plan-state, plan-execution, plan-markdown, utils, prompts + ported specs. Custom types renamed skill-pi-plan-*. (blueprint T2)
- [ ] TICKET-03 — Plan card: src/theme.ts + src/card.ts (renderPlanCard) + card.spec.ts. (blueprint T3)

## Wave 3 (after 02)

- [ ] TICKET-04 — Context/handoff/question/mode/shortcut-config/tool-presentation port + specs. (blueprint T4)

## Wave 4 (after 03, 04)

- [ ] TICKET-05 — index.ts: flags, tools, commands, shortcuts + registration specs. (blueprint T5)
- [ ] TICKET-06 — index.ts: card wiring + event handlers (session_start replay, tool_execution_end show, context reconciliation, shutdown) + specs. (blueprint T6)

## Wave 5 (after 05, 06)

- [ ] TICKET-07 — Docs: extension README (attribution), root README entry, state.yaml. Full test sweep. (blueprint T7)

## QA gate

- vitest run green (extensions/plan-build)
- tsc --noEmit clean (extensions/plan-build)
- node --test "test/**/*.test.js" green (root)
- acceptance.feature scenarios covered by named tests (map in report.md)

## Review

Two-axis: spec compliance (briefing scope in/out honored) + code quality (patterns match
todo/ask-user, no dead forked code, no comments unless asked).
