---
id: TASK-20.9
title: 'TICKET-09 pi-swarm: /swarm dashboard + README + root README'
status: Done
assignee: []
created_date: '2026-10-18 07:36'
updated_date: '2026-10-20 07:48'
labels: []
dependencies:
  - TASK-20.6
references:
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/briefing.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/blueprint.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/tasks.md
  - .skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature
parent_task_id: TASK-20
priority: high
type: feature
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
ui/dashboard.ts (fullscreen list of all tracked agents; j/k/arrows, Enter -> takeover reusing the TICKET-05 overlay component, x -> cancel, Esc close); /swarm command (non-TUI prints swarm_list text); extensions/pi-swarm/README.md house style (what you get, install, how-it-works, env table, RPC protocol reference, license/sources); root README bundled-extensions bullet.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npx vitest run + tsc green; root README entry present; README documents Ctrl+Q Tab binding
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npx vitest run green
- [ ] #2 tsc --noEmit clean
- [ ] #3 root README.md lists pi-swarm
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. dashboard component 2. /swarm command 3. READMEs 4. full GREEN 5. commit
<!-- SECTION:PLAN:END -->
