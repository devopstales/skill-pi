---
id: TASK-20.6
title: 'TICKET-05 pi-swarm: FleetView transcript overlay + stop'
status: Done
assignee: []
created_date: '2026-10-18 07:35'
updated_date: '2026-10-18 12:40'
labels: []
dependencies:
  - TASK-20.4
references:
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/briefing.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/blueprint.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/tasks.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature
parent_task_id: TASK-20
priority: high
type: feature
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Overlay mode in the FleetView component: selected agent transcript (ANSI-stripped, one-line tool entries), auto-follow with scroll-up-to-pause, 50ms render throttle; x two-press confirm -> manager.cancel; reuse cardTop/cardBottom from ../skill-pi-tui/src/card.ts when importable.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 fleetview.spec green (new lines render on update, auto-follow, x-twice cancels, x-once doesn't); tsc clean
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npx vitest run src/ui/fleetview.spec.ts green
- [ ] #2 tsc --noEmit clean
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. extend fleetview spec RED 2. overlay+transcript render 3. stop confirm 4. GREEN 5. commit
<!-- SECTION:PLAN:END -->
