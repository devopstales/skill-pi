---
id: TASK-4.1
title: >-
  TICKET-01: Vendor pi-free base + entry shim + load test (tracer thread, door
  check part 1)
status: Done
assignee: []
created_date: '2026-10-15 08:22'
updated_date: '2026-10-15 09:16'
labels: []
dependencies: []
references:
  - .skillgrid/specs/2026-10-14-unified-providers/briefing.md
  - .skillgrid/specs/2026-10-14-unified-providers/tasks.md
  - .skillgrid/specs/2026-10-14-unified-providers/acceptance.feature
parent_task_id: TASK-4
priority: high
type: feature
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scope: Vendor the entire pi-free@2.8.4 dist/ tree as-is into extensions/providers/pi-free/ (+ package.json manifest with main: ./dist/index.js, LICENSE, CHANGELOG.md); create the pi-free/base.js re-export shim; create the first-version composition entry extensions/providers/index.ts (await base(pi) only); add the ./providers/index.ts registration to extensions/package.json pi.extensions and the runtime deps re-derived from the actual import graph (RED-driven, NOT guessed); add test/providers.load.test.js (stub ExtensionAPI capturing registerProvider/registerCommand/on/registerTool) + task providers:test in Taskfile.yml.

DOOR CHECK part 1: if the base does not load under skill-pi jiti + hoisted deps, STOP before TICKET-02+.

One-way: vendoring ~20k LOC into the tree is the core decision of the change; human checkpoint before the vendor commit.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 node --test test/providers.load.test.js GREEN: base(stubPi) returns without throwing; registerProvider called >= 20 times; registerCommand called for toggle-free and pi-free-health
- [ ] #2 find extensions/providers/pi-free/dist -name "*.js" | wc -l matches the tarball 165 count
- [ ] #3 All non-relative imports in the vendored dist/ tree resolve from the repo root after npm install
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 node --test "test/**/*.test.js" green (full root suite)
- [ ] #2 No writes to ~/.pi or <repo>/.pi (ADR 0002)
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. npm pack pi-free@2.8.4 (or fetch the tarball); verify 165 .js files in dist/
2. Copy dist/ + LICENSE + CHANGELOG.md + package.json into extensions/providers/pi-free/
3. Create pi-free/base.js re-export shim (export { default as base } from "./dist/index.js")
4. Write test/providers.load.test.js RED: stub ExtensionAPI, import base, call await base(stubPi), assert no-throw + >=20 registerProvider + toggle-free/pi-free-health registerCommand
5. Run RED to surface missing deps; grep -rhoE from "<non-relative>" dist/**/*.js | sort -u; add to extensions/package.json dependencies; npm install at root
6. Run GREEN; create extensions/providers/index.ts (await base(pi) only); add ./providers/index.ts to extensions/package.json pi.extensions
7. Add task providers:test to Taskfile.yml
8. Commit (one-way checkpoint: human confirms before the vendor commit)
<!-- SECTION:PLAN:END -->
