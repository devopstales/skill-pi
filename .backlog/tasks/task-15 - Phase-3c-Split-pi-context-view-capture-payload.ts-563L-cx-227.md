---
id: TASK-15
title: 'Phase 3c: Split pi-context-view/capture/payload.ts (563L, cx 227)'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-17 09:01'
labels: []
dependencies: []
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Same tool-declarations + message-units pair implemented 3× (OpenAI Completions, OpenAI Responses, Anthropic).

Extract per-API parsers:
capture/parsers/
├── types.ts        — PayloadDeclaration, ParsedTools, ParsedMessages (shared)
├── openai-completions.ts
├── openai-responses.ts
├── anthropic.ts
└── index.ts        — copyPayload, PAYLOAD_SHAPE_CHECKS (dispatch by API)

Each parser implements: declarations(), units(), isPayload().
The undefined-as-error-channel pattern stays as-is.

Run capture tests. One commit: refactor: split payload.ts into per-API parsers
<!-- SECTION:DESCRIPTION:END -->
