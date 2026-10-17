---
id: TASK-13
title: 'Phase 3a: Split plan-build/index.ts (1497L, cx 596) — god file'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-17 08:11'
labels: []
dependencies: []
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split extensions/plan-build/index.ts into 5 modules:

| New file | Lines | Contents |
|---|---|---|
| commands.ts | ~190L | /plan, /build, /build-fresh, /plan-settings handlers |
| tools.ts | ~425L | 6 tool registrations, one function per tool |
| hooks.ts | ~260L | All pi.on(...) handlers + restorePlanState |
| ui.ts | ~80L | Status line, sidebar card, entry/message renderers |
| reconciliation.ts | ~80L | Reconciliation state machine |

Remaining index.ts (~300L): imports, constants, PlanSession, session registry, plan-state core (lines 207-401), piPlanBuild entry.

Mechanism: Each module exports a function receiving a Deps object (pi + PlanSession registry + key helpers). No circular imports — index.ts is the only file that imports all others.

Run plan-build tests. One commit: refactor: split plan-build/index.ts into commands, tools, hooks, ui, reconciliation
<!-- SECTION:DESCRIPTION:END -->
