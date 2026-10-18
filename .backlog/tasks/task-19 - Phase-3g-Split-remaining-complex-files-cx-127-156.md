---
id: TASK-19
title: 'Phase 3g: Split remaining complex files (cx 127-156)'
status: Done
assignee: []
created_date: '2026-10-16 15:03'
updated_date: '2026-10-17 10:36'
labels: []
dependencies: []
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Lower priority. One commit per file:

| File | cx | Action |
|---|---|---|
| pi-vcc/src/hooks/before-compact.ts | 153 | Extract hook body into compact-handler.ts |
| pi-context-view/src/injections.ts | 150 | Extract registry into injection-registry.ts |
| antigravity/client/client.ts | 148 | Extract request building into request.ts |
| skill-pi-tui/src/sidebar-layout.ts | 139 | Extract layout computation from rendering |
| permission/index.ts | 135 | Extract rule resolution into rules.ts |
| antigravity/usage/usage.ts | 135 | Extract usage calculation into usage-calc.ts |
| antigravity/accounts/ui.ts | 128 | Extract account list rendering |
| lsp/src/config.ts | 127 | Extract config validation into config-validate.ts |

Run affected tests per file. Commit per file.
<!-- SECTION:DESCRIPTION:END -->
