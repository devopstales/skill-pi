---
id: TASK-17
title: 'Phase 3e: Split command-plate/model-pick.ts (824L, cx 201)'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-17 09:33'
labels: []
dependencies: []
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split TUI overlays into separate files:
command-plate/
├── model-pick.ts (kept) — getProviders, getModelsForProvider, getEnabledModelSet, loadScopedModels
├── searchable-select.ts — searchableSelect (~140L)
├── thinking-picker.ts   — getThinkingDescription, runThinkingPicker
└── scoped-models.ts     — runScopedModels + buildDisplayRows + helpers (~200L)

Run command-plate tests. One commit: refactor: split model-pick.ts into TUI overlay modules
<!-- SECTION:DESCRIPTION:END -->
