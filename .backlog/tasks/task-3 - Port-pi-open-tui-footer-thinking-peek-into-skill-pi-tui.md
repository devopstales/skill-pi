---
id: TASK-3
title: Port pi-open-tui footer + thinking peek into skill-pi-tui
status: To Do
assignee: []
created_date: '2026-10-14 17:58'
updated_date: '2026-10-14 18:10'
labels: []
dependencies: []
ordinal: 3000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Port from https://github.com/OldSuns/pi-open-tui (cloned /tmp/opencode/pi-open-tui @ 766ccab): footer (src/footer.ts + git.ts + runtime.ts + state.ts + utils.ts + icons.ts + session-lifecycle.ts) and thinking peek (src/peek.ts) ported into skill-pi-tui. Footer renders into the sidebar footer slot; peek drives the hidden-thinking label. Commits: 1da908f (RED), 91c893c (modules), 42cfd11 (wiring). Verification: vitest 33/33, tsc clean, node:test 4/4 + 5/5. Door check pending.
<!-- SECTION:DESCRIPTION:END -->
