---
id: TASK-12
title: 'Phase 2e: Deduplicate command-plate/model-pick.ts internal clones'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-16 16:26'
labels: []
dependencies: []
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eliminate 3 clone pairs in extensions/command-plate/model-pick.ts (cx 201, dup 8.3%).

Clone pairs: search/filter blocks at lines 135/662, 185/711, 274/372.

Extract renderSearchWindow(items, query, width) helper used by both searchableSelect and runScopedModels.

Run command-plate tests. One commit: refactor: extract shared search window in model-pick
<!-- SECTION:DESCRIPTION:END -->
