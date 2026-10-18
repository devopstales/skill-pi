---
id: TASK-20.2
title: 'TICKET-02 pi-swarm: SwarmManager + spawn/wait/list tools + deferred delivery'
status: To Do
assignee: []
created_date: '2026-10-18 07:33'
labels: []
dependencies:
  - TASK-20.1
references:
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/briefing.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/blueprint.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/tasks.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature
parent_task_id: TASK-20
priority: high
type: feature
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
manager.ts (caps queue-not-reject, LRU by settledAt, wait-interest/consumed, truncation budgets) + spec with fake-child factory; index.ts factory: package scaffold, swarm_spawn/swarm_wait/swarm_list tools, swarm-result renderer, deferred deliver (deliverAs followUp, triggerTurn, empty-finalText fallback), SKILL_PI_SWARM/SKILL_PI_SWARM_MAX env, shutdown-dispose on reason=quit only, manager keyed by session id, skill-pi executable resolution.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 manager.spec green (cap/queue, waitFor-consume, deliver-once, cancel bound, LRU, check non-consuming); tsc clean
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npx vitest run src/manager.spec.ts green
- [ ] #2 tsc --noEmit clean
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. manager spec RED 2. implement manager 3. package scaffold + index.ts tools 4. renderer+delivery 5. GREEN 6. commit
<!-- SECTION:PLAN:END -->
