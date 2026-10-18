---
id: TASK-20
title: 'pi-swarm: parallel isolated child agents + FleetView + RPC protocol (pi)'
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
priority: high
type: feature
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Bundled pi extension (extensions/pi-swarm) that spawns parallel isolated child skill-pi agents as --mode rpc subprocesses, with swarm_spawn/wait/send/check/cancel/list tools, a below-prompt FleetView, /swarm dashboard, a prompt-target selector (Ctrl+Q Tab leader, ADR-0010), agent types from .skill-pi/agents/, and a v1 cross-extension RPC protocol (swarm:rpc:*). Sliced into 10 tickets in 6 waves.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 10/10 tickets done and TICKET-10 L2+E2E gate green (report.md shippable verdict)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 All 10 tickets done with clean reviews
- [ ] #2 L2 verification: extension vitest >= 40 tests, tsc clean, root node --test unchanged
<!-- DOD:END -->
