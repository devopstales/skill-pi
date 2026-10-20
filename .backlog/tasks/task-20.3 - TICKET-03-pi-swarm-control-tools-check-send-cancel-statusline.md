---
id: TASK-20.3
title: 'TICKET-03 pi-swarm: control tools check/send/cancel + statusline'
status: Done
assignee: []
created_date: '2026-10-18 07:34'
updated_date: '2026-10-18 10:38'
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
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Register swarm_check (2KB AND 20-line preview, non-consuming, unknown-id lists known ids), swarm_send (steer running / follow_up settled), swarm_cancel (bounded abort + SIGKILL, per-id outcome); ctx.ui.setStatus swarm segment; manager.spec: cancel-of-queued promotes next.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 vitest green incl. new cases (steer/follow_up, check bounds+non-consuming, cancel-queued promotion); tsc clean
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npx vitest run green
- [ ] #2 tsc --noEmit clean
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. extend manager.spec RED 2. register 3 tools 3. statusline 4. GREEN 5. commit
<!-- SECTION:PLAN:END -->
