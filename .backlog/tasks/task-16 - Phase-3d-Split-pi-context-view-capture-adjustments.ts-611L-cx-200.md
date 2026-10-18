---
id: TASK-16
title: 'Phase 3d: Split pi-context-view/capture/adjustments.ts (611L, cx 200)'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-17 09:23'
labels: []
dependencies: []
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split serializers into per-API files:
capture/
├── adjustments.ts (kept) — rebuildRequest, resolveSystemMessages, closeToolCalls, images
├── serializers/
│   ├── completions.ts   — completionsUnits
│   ├── responses.ts     — responsesUnits
│   └── anthropic.ts     — anthropicUnits, addAnthropicAssistantBlock

Run capture tests. One commit: refactor: split adjustments.ts serializers into per-API files
<!-- SECTION:DESCRIPTION:END -->
