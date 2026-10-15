---
id: TASK-4.4
title: 'TICKET-04: Add antigravity provider (OAuth, multi-account, custom stream)'
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
ordinal: 8000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scope: Vendor the full pi-agy@0.6.1 src/** tree verbatim into extensions/providers/antigravity/src/ (+ LICENSE); create extensions/providers/antigravity/provider.ts lifting upstream index.ts default function (pi) into a named registerAntigravity(pi) (keeps PROVIDER_ID/PROVIDER_NAME, model/endpoint constants, the emitCommandOutput/withUsage helpers, the account pool, session_start/session_shutdown, and the 4 /antigravity* commands); wire registerAntigravity(pi) into index.ts after registerZen(pi); ensure undici is a declared + hoisted dep (add + npm install if TICKET-01 did not catch it); extend test/providers.seam.test.js (RED first): registerAntigravity(stubPi) -> registerProvider with PROVIDER_ID, registerCommand for antigravity/antigravity.usage/antigravity.models/antigravity.doctor, on for session_start/session_shutdown.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 node --test test/providers.seam.test.js GREEN for both zen AND antigravity seam assertions
- [ ] #2 The upstream index.ts imports (./src/auth/index.js, etc.) resolve under jiti (the seam test is the proof)
- [ ] #3 undici appears in extensions/package.json dependencies and in root node_modules/undici
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 node --test "test/**/*.test.js" green
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. npm pack pi-agy@0.6.1; copy src/** + LICENSE into extensions/providers/antigravity/ verbatim
2. Ensure undici is in extensions/package.json dependencies + npm install at root
3. Write test/providers.seam.test.js RED (extend): registerAntigravity(stubPi) -> registerProvider with PROVIDER_ID, registerCommand x4, on for session_start + session_shutdown
4. Create extensions/providers/antigravity/provider.ts (lift upstream index.ts body into registerAntigravity(pi))
5. Run GREEN for both zen + antigravity seams
6. Wire registerAntigravity(pi) into extensions/providers/index.ts after registerZen(pi)
7. Commit
<!-- SECTION:PLAN:END -->
