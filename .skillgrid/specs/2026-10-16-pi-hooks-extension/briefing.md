# pi-hooks — Design Briefing

> **STATUS:** `accepted` (2026-10-16) — change agreed with user in-session: QA +
> ship the already-landed extension "properly" (spec folder + qa gate + review +
> ship).

## Problem / Intent

`extensions/pi-hooks/` was vendored from [hsingjui/pi-hooks](https://github.com/hsingjui/pi-hooks)
(MIT) and homogenized to skill-pi's isolation contract in a single session
(commits `b2507f9` + `a366aa3`, root README entry in `d7880a0`), but landed
**outside** the SDD pipeline: no change folder, no qa gate, no code review, no
archive. The change is functionally complete (extension loads, tsc clean, wrapper
smoke test green) but carries zero test coverage — the vendored upstream shipped
none, and the homogenization edits (agent-dir resolution, import rewrite) are
untested. This change brings it through the pipeline: a `small` fast-track
covering the missing tests and the full QA → review → ship pass.

## Purpose & Success Criteria

- A vitest suite in `extensions/pi-hooks/` covers the pure logic the vendored
  fork changed or depends on: config loading/merge (global + project, `.skill-pi`
  paths, `getAgentDir()`), matcher regex semantics, `if` condition parsing,
  glob/wildcard matching, and Claude Code JSON input/output shaping.
- `cd extensions/pi-hooks && npx vitest run` is green; `npx tsc --noEmit -p .`
  is clean.
- Root suite `node --test "test/**/*.test.js"` is unchanged and green.
- A live E2E door check proves a configured hook command actually executes when
  the wrapper launches pi (the tsc + unit tests cannot see the wrapper → pi
  event pipeline).
- The change is shipped: `report.md` QA gate rendered, `review.md` floor met,
  change folder archived to `.skillgrid/archive/`, `state.yaml` reconciled.

## Constraints

- Self-contained extension (ADR 0007): all new files stay in
  `extensions/pi-hooks/`; no new runtime dependency (node builtins +
  `@earendil-works/pi-coding-agent` only — already a peerDependency).
- Never modify pi source (ADR 0006); the extension resolves the agent dir via
  `getAgentDir()` (ADR 0002) — tests that need it mock that module.
- No comments in code unless asked. Minimal scoped changes.
- The extension is **already committed and shipping in the wrapper's load set** —
  this change adds tests + pipeline artifacts; it must not alter hook behavior.
  Any behavior fix found by a RED test is recorded in the report, not silently
  re-scoped.

## Out of Scope

- New hook events, `http`/`prompt`/`agent` hook types, or UI surface.
- Backlog/state reconciliation of *other* unshipped work (command-plate,
  dynamic-extension-allow, stale task statuses) — separate cleanup, not part of
  this change.
- Changing the homogenization decisions already made (paths, entry point,
  import style).

## Fast-track

`small` — single concern (test suite + pipeline artifacts for an already-built
extension), no new dependency, no trust-boundary change. Skips: brainstorming,
slicing (1-2 tasks, execute directly).
