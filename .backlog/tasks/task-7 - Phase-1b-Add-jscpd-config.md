---
id: TASK-7
title: 'Phase 1b: Add jscpd config'
status: Done
assignee: []
created_date: '2026-10-16 15:02'
updated_date: '2026-10-16 15:18'
labels: []
dependencies: []
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Create .jscpd.json at repo root:

```json
{
  "ignore": [
    "node_modules",
    "**/dist/**",
    "**/package-lock.json",
    "**/*.md",
    "**/*.svg",
    "**/*.sh",
    ".skillgrid",
    ".backlog"
  ],
  "threshold": 2
}
```

One commit: chore: add jscpd config
<!-- SECTION:DESCRIPTION:END -->
