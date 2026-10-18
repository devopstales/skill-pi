---
id: TASK-11
title: 'Phase 2d: Deduplicate plan-build/card.ts ↔ todo/card.ts'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-16 16:17'
labels: []
dependencies: []
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Cross-extension card component clone between extensions/plan-build/src/card.ts and extensions/todo/src/card.ts.

Move shared card logic to extensions/skill-pi-tui/src/card-base.ts (both already depend on skill-pi-tui). Each extension imports and specializes.

Run plan-build + todo tests. One commit: refactor: extract shared card base for plan-build and todo
<!-- SECTION:DESCRIPTION:END -->
