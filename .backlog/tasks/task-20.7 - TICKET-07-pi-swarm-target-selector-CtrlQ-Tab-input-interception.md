---
id: TASK-20.7
title: 'TICKET-07 pi-swarm: target selector Ctrl+Q Tab + input interception'
status: Done
assignee: []
created_date: '2026-10-18 07:35'
updated_date: '2026-10-18 13:19'
labels: []
dependencies:
  - TASK-20.4
  - TASK-20.5
references:
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/briefing.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/blueprint.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/tasks.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature
parent_task_id: TASK-20
priority: high
type: feature
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
target.ts (cycle build -> plan-if-available -> agents -> build; session-scoped in-memory, default build) + spec; armed-leader listener per ADR-0010 (raw onTerminalInput, 2s window mirroring command-plate:263-278, Tab -> cycle, armed hint); SKILL_PI_SWARM_TARGET_KEY (action key, default tab, off); swarm:plan-present lazy probe + SKILL_PI_PLAN_BUILD=1; swarm-target status segment; input interception (interactive + agent target + non-empty + overlay closed -> spawn + handled); PLUS one additive plan-build line: pi.events.emit swarm:plan-present on session start (separate commit).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 target.spec green (cycle list, wrap, matchesAgent); plan-build suite still green after its one-line change; tsc clean
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npx vitest run src/target.spec.ts green
- [ ] #2 plan-build index.spec.ts green
- [ ] #3 tsc --noEmit clean
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. target spec RED 2. implement selector 3. leader listener 4. input interception 5. plan-build emit line (own commit) 6. GREEN 7. commit
<!-- SECTION:PLAN:END -->
