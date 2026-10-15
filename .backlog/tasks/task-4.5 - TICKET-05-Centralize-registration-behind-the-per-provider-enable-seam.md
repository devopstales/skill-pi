---
id: TASK-4.5
title: 'TICKET-05: Centralize registration behind the per-provider enable seam'
status: To Do
assignee: []
created_date: '2026-10-15 08:23'
labels: []
dependencies:
  - TASK-4.3
  - TASK-4.4
references:
  - .skillgrid/specs/2026-10-14-unified-providers/tasks.md
  - .skillgrid/specs/2026-10-14-unified-providers/acceptance.feature
parent_task_id: TASK-4
priority: high
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scope: In extensions/providers/index.ts, resolve SKILL_PI_DISABLE_PROVIDERS (comma-separated ids) into a Set<string>; register each OAuth provider only if not in the set (the pi-free base is always on); the seam is the single decision point — index.ts must NOT call registerZen/registerAntigravity directly outside the gated branch. Extend test/providers.seam.test.js (RED first): default (no env) -> both register; SKILL_PI_DISABLE_PROVIDERS=antigravity -> zen registers, antigravity does not; =opencode-zen -> antigravity registers, zen does not; =opencode-zen,antigravity -> neither registers, base still does.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 node --test test/providers.seam.test.js GREEN for all four seam variants (default-on, disable-zen, disable-antigravity, disable-both)
- [ ] #2 grep -n "registerZen\\|registerAntigravity" extensions/providers/index.ts shows the calls only inside the isEnabled-gated branches
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 node --test "test/**/*.test.js" green
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Write test/providers.seam.test.js RED for the four seam variants
2. Implement the seam in extensions/providers/index.ts (resolve SKILL_PI_DISABLE_PROVIDERS, gate each registerX call)
3. Run GREEN
4. Commit
<!-- SECTION:PLAN:END -->
