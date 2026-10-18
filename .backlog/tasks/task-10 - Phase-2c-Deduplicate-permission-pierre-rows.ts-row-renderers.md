---
id: TASK-10
title: 'Phase 2c: Deduplicate permission/pierre-rows.ts row renderers'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-16 16:08'
labels: []
dependencies: []
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eliminate 3 clone pairs of row-rendering blocks in extensions/permission/pierre-rows.ts (cx 117, dup 17.7%).

Extract renderRow(theme, columns, values) helper; the 3 blocks become data-driven column specs.

Run permission tests. One commit: refactor: extract shared row renderer in pierre-rows
<!-- SECTION:DESCRIPTION:END -->
