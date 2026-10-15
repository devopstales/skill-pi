---
id: TASK-4.7
title: 'TICKET-07: E2E smoke + provenance docs + full-suite wiring (L4)'
status: To Do
assignee: []
created_date: '2026-10-15 08:24'
labels: []
dependencies:
  - TASK-4.6
references:
  - .skillgrid/specs/2026-10-14-unified-providers/tasks.md
  - .skillgrid/specs/2026-10-14-unified-providers/acceptance.feature
parent_task_id: TASK-4
priority: high
type: feature
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scope: (a) test/providers.e2e.test.js — t.skip() unless process.env.SKILL_PI_E2E === "1"; otherwise shell out to skill-pi --print "reply with exactly: ok" --agent-dir <temp> and assert exit 0 + assistant message contains "ok"; then grep the startup/transcript for the antigravity and opencode-zen provider markers. (b) task providers:e2e in Taskfile.yml. (c) extensions/providers/README.md — provenance table (rows: pi-free@2.8.4 (MIT, apmantza), opencode-zen-oauth@1.2.6 (MIT, Naab2k3), pi-agy@0.6.1 (MIT, shakthi-sagar); columns: upstream, version, license, vendored path, any edits made in TICKET-06) + the SKILL_PI_DISABLE_PROVIDERS seam contract. (d) Update the wrapper README.md "Currently bundled" list. (e) Ensure task providers:test runs all four new test files + the e2e gate; run the full root suite node --test "test/**/*.test.js" (L4). (f) Syntax-parse the new raw-TS files via jiti: for f in $(git diff --name-only origin/main...HEAD -- 'extensions/providers/**/*.ts'); do npx jiti --check "$f" || echo "PARSE FAIL: $f"; done.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 node --test "test/**/*.test.js" GREEN (e2e skipped unless SKILL_PI_E2E=1)
- [ ] #2 SKILL_PI_E2E=1 task providers:e2e GREEN locally (a real free-model round-trip completes; both OAuth providers present)
- [ ] #3 Every new .ts file under extensions/providers/ parses cleanly under jiti
- [ ] #4 extensions/providers/README.md carries the provenance table + seam contract; wrapper README.md lists the new extension
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 node --test "test/**/*.test.js" green (full root suite, L4)
- [ ] #2 extensions/providers/README.md provenance table complete (3 upstreams, version + license + any ADR-0002 edits)
- [ ] #3 Wrapper README.md "Currently bundled" lists the new extension
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write test/providers.e2e.test.js (skip-guarded; skill-pi --print + assert exit 0 + "ok" in reply + provider markers)
2. Add task providers:e2e to Taskfile.yml (SKILL_PI_E2E=1 node --test test/providers.e2e.test.js)
3. Write extensions/providers/README.md (provenance table + SKILL_PI_DISABLE_PROVIDERS seam contract)
4. Update the wrapper README.md "Currently bundled" list
5. Ensure task providers:test runs all four new test files + the e2e gate
6. Run the full root suite (L4): node --test "test/**/*.test.js"
7. Syntax-parse the new raw-TS files via jiti (no tsconfig in the repo — raw TS is loaded by pi's jiti at runtime)\n8. Commit
<!-- SECTION:PLAN:END -->
