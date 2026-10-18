---
id: TASK-20.8
title: 'TICKET-08 pi-swarm: cross-extension RPC protocol v1'
status: To Do
assignee: []
created_date: '2026-10-18 07:35'
labels: []
dependencies:
  - TASK-20.3
references:
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/briefing.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/blueprint.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/tasks.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature
parent_task_id: TASK-20
priority: high
type: feature
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
protocol.ts installSwarmProtocol(bus, manager): swarm:rpc:ping/spawn/steer/consume/stop, envelope {v,reqId,type,payload}, reply on swarm:rpc:reply, unknown-v -> version-error no side effect, consume non-blocking + marks consumed, swarm:ready on session start, swarm:* lifecycle events, swarm:usage per-run deltas; wired in index.ts. ONE-WAY DOOR: the RPC contract is public - stop and confirm before renaming channels/envelope fields.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 protocol.spec green (ping counts, spawn->id, steer->send, consume->snapshot+consumed, stop->cancel, v:99 version error + no manager call, lifecycle events once each); tsc clean
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npx vitest run src/protocol.spec.ts green
- [ ] #2 tsc --noEmit clean
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. protocol spec RED 2. implement envelope+handlers 3. wire index.ts 4. GREEN 5. commit
<!-- SECTION:PLAN:END -->
