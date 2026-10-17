---
id: TASK-14
title: 'Phase 3b: Split antigravity/stream/stream.ts (941L, cx 263)'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-17 08:41'
labels: []
dependencies: []
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Split extensions/providers/antigravity/src/stream/stream.ts by responsibility:

| New file | Contents |
|---|---|
| convert.ts | convertMessages, convertTools, schema normalization, appendTurn |
| request.ts | buildRequest, mapToolChoiceMode |
| error.ts | mapStopReason, friendlyAntigravityError (if-chain → lookup table) |
| stream.ts (kept) | createOutput, streamResponse, createAntigravityStream, streamAntigravity |
| retry.ts | requestWithAccount, resetOutput, writeDebugFailure, requestFailure |

Run antigravity tests. One commit: refactor: split antigravity stream.ts by responsibility
<!-- SECTION:DESCRIPTION:END -->
