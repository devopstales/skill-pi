---
id: TASK-20.4
title: 'TICKET-04 pi-swarm: FleetView list + formatting'
status: To Do
assignee: []
created_date: '2026-10-18 07:34'
labels: []
dependencies:
  - TASK-20.2
references:
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/briefing.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/blueprint.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/tasks.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature
parent_task_id: TASK-20
priority: high
type: feature
ordinal: 30000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
format.ts (elapsed/tokens/row) + spec; ui/fleetview.ts pi-tui Component over manager read model (main row + per-agent rows, glyphs, selection, hint); mounted via setWidget belowEditor; empty-prompt key capture (down/left enter, up/down move, esc return, x stop) suppressed while Ctrl+Q leader armed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 format+fleetview specs green; tsc clean; list renders below prompt with a running child (recorded in E2E)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npx vitest run src/format.spec.ts src/ui/fleetview.spec.ts green
- [ ] #2 tsc --noEmit clean
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. format spec RED 2. implement format 3. fleetview component + spec 4. mount+keys 5. GREEN 6. commit
<!-- SECTION:PLAN:END -->
