---
id: TASK-9
title: 'Phase 2b: Deduplicate pi-hooks hook registration'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-16 15:58'
labels: []
dependencies: []
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Eliminate 6 clone pairs in pi-hooks (prompt-hooks.ts, stop-hooks.ts, tool-hooks.ts, shared.ts).

The same hook-registration shape is repeated for each hook type. Extract a registerHook<TEvent, TArgs>(pi, name, handler) helper or small HookGroup builder. Each file becomes a thin config.

Run pi-hooks tests. One commit: refactor: deduplicate pi-hooks registration pattern
<!-- SECTION:DESCRIPTION:END -->
