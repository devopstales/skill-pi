---
id: TASK-6
title: 'Phase 1a: Dead code cleanup (10 files, high confidence)'
status: Done
assignee: []
created_date: '2026-10-16 15:02'
updated_date: '2026-10-16 15:18'
labels: []
dependencies: []
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Remove high-confidence (85+) dead code. Grep-verify each symbol before deleting.

Items:
1. Delete unused import `clip` — extensions/pi-vcc/src/core/build-sections.ts:2 (conf 100)
2. Delete unused import `Message` — extensions/pi-vcc/src/types.ts:1 (conf 100)
3. Delete unused import `buildAcceptHeader` — extensions/webfetch/src/webfetch/tool.ts:12 (conf 100)
4. Delete unused import `matchExtension` — extensions/webfetch/src/webfetch/tool.ts:18 (conf 100)
5. Delete unused import `WebFetchExtension` — extensions/webfetch/src/webfetch/tool.ts:19 (conf 100)
6. Delete unused type `ServerTransport` — extensions/lsp/src/types.ts:3 (conf 85)
7. Delete unused type `HookType` — extensions/pi-hooks/src/types.ts:1 (conf 85)
8. Delete unused export `AskUserAnswerEventPayload` — extensions/ask-user/events.ts:30 (conf 85)
9. Delete unused export `AskUserAnswerEntry` — extensions/ask-user/events.ts:38 (conf 85)
10. Delete file extensions/lsp/fake-lsp-server.ts (conf 95)

Skip: dist/** (vendored), demo-injections/** (standalone scripts), pi-vcc/scripts/** (standalone), all conf 60-70.

Run tests after. One commit: chore: remove dead code (high-confidence findings)
<!-- SECTION:DESCRIPTION:END -->
