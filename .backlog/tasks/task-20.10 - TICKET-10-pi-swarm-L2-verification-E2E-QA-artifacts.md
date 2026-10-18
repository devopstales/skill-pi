---
id: TASK-20.10
title: 'TICKET-10 pi-swarm: L2 verification + E2E + QA artifacts'
status: To Do
assignee: []
created_date: '2026-10-18 07:36'
labels: []
dependencies:
  - TASK-20.9
references:
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/briefing.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/blueprint.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/tasks.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature
parent_task_id: TASK-20
priority: high
type: feature
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Live E2E backstop: real session swarm_spawn -> settle -> swarm-result follow-up turn in transcript; ~/.pi/agent mtime unchanged; L2 run (extension vitest >= 40 tests, tsc clean, root node --test unchanged pass count); report.md QA-gate render + door-check/E2E evidence + recorded unknowns (RPC event names, system-prompt mechanism, plan-present probe behavior, FleetView placement).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 all L2 commands green; report.md with shippable verdict + E2E evidence; root suite 0 new fails
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 L2 green (vitest + tsc + root node --test)
- [ ] #2 report.md shippable verdict rendered
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. live E2E 2. L2 run 3. report.md render 4. commit (spec-zone)
<!-- SECTION:PLAN:END -->
