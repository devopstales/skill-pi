---
id: TASK-5
title: Copy + homogenize hsingjui/pi-hooks extension into skill-pi
status: In Progress
assignee: []
created_date: '2026-10-16 10:00'
updated_date: '2026-10-16 10:30'
labels: []
dependencies: []
ordinal: 5000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Vendor `hsingjui/pi-hooks` (MIT) into `extensions/pi-hooks/` and homogenize to
skill-pi's isolation + self-contained extension contracts.

Homogenization:
- entry point at `extensions/pi-hooks/index.ts` (wrapper auto-discovers, ADR-0001)
- config loads from `getAgentDir()` (i.e. `~/.skill-pi/agent/settings.json`),
  never the stock `~/.pi/agent` (ADR-0002)
- project config reads `.skill-pi/settings.json`, not `.pi/settings.json` (ADR-0002)
- relative imports carry explicit `.ts` extensions (NodeNext tsconfig)
- English-only comments + notify strings
- local toolchain per ADR-0007 (`typescript`, `vitest`, `@types/node`)

Verified: `tsc --noEmit -p .` clean; wrapper load smoke test
(`node bin/skill-pi.js -- --print "Say exactly: hello"` → `hello`)
runs the extension end-to-end with a project `.skill-pi/settings.json`
configuring `SessionStart` + `Stop` hooks.

Supported events: SessionStart, SessionEnd, PreCompact, PostCompact,
PreToolUse, PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop.
<!-- SECTION:DESCRIPTION:END -->
