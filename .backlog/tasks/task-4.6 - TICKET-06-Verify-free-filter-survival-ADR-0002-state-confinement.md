---
id: TASK-4.6
title: 'TICKET-06: Verify free-filter survival + ADR-0002 state confinement'
status: To Do
assignee: []
created_date: '2026-10-15 08:24'
labels: []
dependencies:
  - TASK-4.5
references:
  - .skillgrid/specs/2026-10-14-unified-providers/tasks.md
  - .skillgrid/specs/2026-10-14-unified-providers/acceptance.feature
parent_task_id: TASK-4
priority: high
type: feature
ordinal: 10000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scope: (a) test/providers.free-filter.test.js — run the full entry against a stub pi that captures every registerProvider id + its filterModels; assert the final registry contains opencode-zen and antigravity and that their filter behavior is the upstream's, not pi-free's; if a provider IS wiped, apply the minimal fix in index.ts (register after the filter pass, or re-register after applyGlobalFilter) and re-run. (b) test/providers.separation.test.js — set PI_CODING_AGENT_DIR to a temp dir, run the entry against a stub pi, trigger a state write path (Antigravity account store init OR pi-free's telemetry getTelemetryPath); assert NO file appears under ~/.pi and the state file IS under the temp agent dir. (c) Grep the vendored code for literal ~/.pi/agent / HOME / os.homedir / /home/ paths; record every hit in extensions/providers/README.md (provenance table) as either (a) resolves through pi's credential store (safe) or (b) a confirmed hardcoded write (fix minimally + record).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 node --test test/providers.free-filter.test.js test/providers.separation.test.js GREEN
- [ ] #2 grep -rn "\\.pi/agent\\|os.homedir\\|/home/" extensions/providers/ hits are all recorded in the README provenance table with their classification
- [ ] #3 Any confirmed hardcoded write is fixed (minimal edit, recorded)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 node --test "test/**/*.test.js" green
- [ ] #2 No writes to ~/.pi or <repo>/.pi (ADR 0002 backstop)
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Grep the vendored code for literal home paths; classify each hit
2. Write test/providers.free-filter.test.js (stub registry capture; assert opencode-zen + antigravity survive the pi-free filter pass)
3. Write test/providers.separation.test.js (temp agent dir; assert no ~/.pi writes)
4. Fix any confirmed hardcoded write (minimal edit, recorded in README provenance table)
5. Run both tests GREEN
6. Commit
<!-- SECTION:PLAN:END -->
