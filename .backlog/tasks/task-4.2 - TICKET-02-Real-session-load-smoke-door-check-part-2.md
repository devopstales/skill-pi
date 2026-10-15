---
id: TASK-4.2
title: 'TICKET-02: Real-session load smoke (door check part 2)'
status: In Progress
assignee: []
created_date: '2026-10-15 08:22'
updated_date: '2026-10-15 09:16'
labels: []
dependencies:
  - TASK-4.1
references:
  - .skillgrid/specs/2026-10-14-unified-providers/tasks.md
  - .skillgrid/specs/2026-10-14-unified-providers/acceptance.feature
parent_task_id: TASK-4
priority: high
type: feature
ordinal: 6000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Scope: Add task providers:load to Taskfile.yml: launch skill-pi --print "reply with the word ok" against a throwaway --agent-dir ($TMPDIR/skill-pi-providers-<ts>), capture stdout+stderr, and assert (a) exit 0, (b) the pi-free logStartupSummary marker appears (confirm exact text from extensions/providers/pi-free/dist/lib/startup-timing.js), (c) no ERR_MODULE_NOT_FOUND.

DOOR CHECK part 2: a rejected provider setup in the real session is a finding (name it + reason in the log), not a silent pass.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 task providers:load exits 0 with the startup summary marker present and zero ERR_MODULE_NOT_FOUND lines
- [ ] #2 If any provider setup rejected, the log names it (recorded in the task output)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 task providers:load exits 0
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Confirm the logStartupSummary marker text from dist/lib/startup-timing.js
2. Add task providers:load to Taskfile.yml (skill-pi --print + throwaway --agent-dir + capture + assert exit 0 + marker present + no ERR_MODULE_NOT_FOUND)
3. Run it; read the real output; if any provider setup rejected, name it in the log as a finding
4. Commit
<!-- SECTION:PLAN:END -->
