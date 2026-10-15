---
id: TASK-4.3
title: 'TICKET-03: Add opencode-zen provider (OAuth, device flow)'
status: To Do
assignee: []
created_date: '2026-10-15 08:23'
labels: []
dependencies:
  - TASK-4.2
references:
  - .skillgrid/specs/2026-10-14-unified-providers/tasks.md
  - .skillgrid/specs/2026-10-14-unified-providers/acceptance.feature
parent_task_id: TASK-4
priority: high
type: feature
ordinal: 7000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scope: Vendor opencode-zen-oauth@1.2.6 src/{auth,models,free-tier,v2-gate}.ts verbatim into extensions/providers/zen/ (+ LICENSE); create extensions/providers/zen/provider.ts lifting the upstream src/extension.ts body into a named registerZen(pi) (keeps id: "opencode-zen", the withFreeTierGate/freeModelProtocol helpers, the two pi.on handlers, and pi.registerProvider(provider)); wire registerZen(pi) into index.ts after await base(pi); extend test/providers.seam.test.js (RED first): registerZen(stubPi) -> registerProvider once with id === "opencode-zen", on called for before_agent_start and message_end.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 node --test test/providers.seam.test.js GREEN for the zen seam assertions
- [ ] #2 The vendored zen/ files are byte-identical to upstream src/ (spot-check via diff on models.ts and auth.ts exports)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 node --test "test/**/*.test.js" green
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. npm pack opencode-zen-oauth@1.2.6; copy src/{auth,models,free-tier,v2-gate}.ts + LICENSE into extensions/providers/zen/ verbatim
2. Write test/providers.seam.test.js RED: registerZen(stubPi) -> registerProvider once with id "opencode-zen", on called for before_agent_start + message_end
3. Create extensions/providers/zen/provider.ts (lift upstream src/extension.ts body into registerZen(pi))
4. Run GREEN
5. Wire registerZen(pi) into extensions/providers/index.ts after await base(pi)
6. Commit
<!-- SECTION:PLAN:END -->
