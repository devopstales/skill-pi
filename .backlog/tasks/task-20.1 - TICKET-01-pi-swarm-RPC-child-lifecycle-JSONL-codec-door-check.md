---
id: TASK-20.1
title: 'TICKET-01 pi-swarm: RPC child lifecycle + JSONL codec (door check)'
status: To Do
assignee: []
created_date: '2026-10-18 07:32'
labels: []
dependencies: []
references:
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/briefing.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/blueprint.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/tasks.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature
parent_task_id: TASK-20
priority: high
type: feature
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
domain.ts (types+constants per blueprint), jsonl.ts codec, child.ts SwarmChild RPC subprocess (spawn/steer/abort/settle, tolerant event fold) with fake-child specs; live door check against a real skill-pi --mode rpc child.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 vitest green (jsonl+child specs); live child replies SWARM_DOOR_OK and settles done; ~/.pi/agent mtime unchanged; RPC event type names recorded in report.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 cd extensions/pi-swarm && npx vitest run green
- [ ] #2 tsc --noEmit -p . clean
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. domain.ts types+constants 2. jsonl spec RED 3. child spec RED 4. implement to GREEN 5. live door check 6. commit
<!-- SECTION:PLAN:END -->
