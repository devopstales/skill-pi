---
id: TASK-20.5
title: 'TICKET-06 pi-swarm: agent types discovery + frontmatter'
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
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
agents.ts: discoverAgentTypes(projectDir, agentDir) reading .skill-pi/agents/*.md then <agentDir>/agents/*.md (project wins on clash, pi parseFrontmatter, skip-unparseable with warn), resolveAgentType; wire into swarm_spawn agent_type (unknown -> tool error listing known; resolved -> systemPrompt prepended with '## Agent instructions' marker).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 agents.spec green (project-only, global-only, clash->project, max_turns, name-override, broken frontmatter skipped+warn); tsc clean
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 npx vitest run src/agents.spec.ts green
- [ ] #2 tsc --noEmit clean
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. agents spec RED 2. implement discovery 3. wire swarm_spawn 4. GREEN 5. commit
<!-- SECTION:PLAN:END -->
