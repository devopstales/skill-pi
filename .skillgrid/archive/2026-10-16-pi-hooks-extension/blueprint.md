# pi-hooks — Test Coverage + Pipeline Completion

**Status:** PROPOSED

**Tier:** T2

**Classification:** small

**Build shape:** Tracer thread (one live E2E hook run first — proves the
wrapper → pi → hook-command pipeline end-to-end — then the unit specs thicken
the pure logic)

**Goal:** Give the vendored `extensions/pi-hooks/` the test coverage and
pipeline artifacts (qa gate, review, ship) it skipped when it landed directly
on main.

**Architecture:** The extension is already implemented and loaded by the
wrapper (ADR 0001 auto-discovery of `extensions/pi-hooks/index.ts`). This plan
adds a vitest suite over the pure logic — `src/config.ts` (settings load/merge,
`globalSettingsPath`), `src/hooks/shared.ts` (`matcherMatches`,
`hookIfMatches`, `globToRegex`-based matching, `parseJsonOutput`,
`extractCommonOutput`), and `src/executor.ts` (`buildHookInput`) — and renders
the QA → review → ship artifacts. The E2E door check is a wrapper launch with a
`.skill-pi/settings.json` hook that writes a marker file, asserted after the
run.

**Tech Stack:** TypeScript (NodeNext, `.ts` extension imports), vitest,
`node:child_process` spawn inside the extension, pi `ExtensionAPI` events.

**Spec:** `./briefing.md`

**Findings:** none (no research/prototype/sketch ran for this topic)

## Terms

None — uses spec/ADR terms only (`agent dir`, `extension`, `hook`).

## Must-Haves (goal-backward verification)

**Truths:**
- A `SessionStart` hook declared in `<project>/.skill-pi/settings.json`
  executes its command when the wrapper launches pi in that project —
  **backstop** (only observable through a live wrapper run; the diff cannot
  prove the event pipeline fires the hook).
- `globalSettingsPath()` resolves under the agent dir from
  `getAgentDir()`, never `~/.pi/agent` — asserted by unit test with the
  module mocked.
- `loadSettings(cwd)` merges global + project hook arrays per event key and
  reads `<cwd>/.skill-pi/settings.json`, never `<cwd>/.pi/settings.json`.
- `matcherMatches` treats `undefined`/`""`/`"*"` as match-all, compiles other
  values as regex, and falls back to exact string match on invalid regex.
- `hookIfMatches` rejects non-tool events, parses `ToolName(pattern)`
  case-insensitively, and wildcard-matches the tool-specific input field
  (`command` for bash, `path`/`file_path` for read/write/edit).
- `buildHookInput` emits Claude Code-shaped JSON per event (verified against
  one representative shape per event family: session, prompt, stop, tool).

**Artifacts:**
- `extensions/pi-hooks/src/config.spec.ts` — settings load/merge + path tests
  + `matcherMatches` regex semantics (all live in `src/config.ts`)
- `extensions/pi-hooks/src/shared.spec.ts` — if-condition + output parse tests
  (`src/hooks/shared.ts` is pure; no mocks)
- `extensions/pi-hooks/src/executor.spec.ts` — hook input shaping tests
- `extensions/pi-hooks/e2e-hook.test.js` — none at root; the live E2E is a
  shell door check recorded in `report.md` (the repo's e2e convention is
  `node --test` at root; a pi-launch test there is out of scope for `small` —
  the door check is run manually and its evidence pasted into the report)

**Key links:**
- `createHookContext` (`src/hook-context.ts`) calls `loadSettings(ctx.cwd)` on
  the first `session_start` — the config tests pin the contract that call
  relies on.
- The E2E marker file must be written by the hook command's own `echo`/`tee`,
  proving the spawned bash received the session cwd, not a test fixture.

**One-way-door decisions:** None.

## Global Constraints

- All new files under `extensions/pi-hooks/` (ADR 0007).
- No new runtime dependency; `vitest`/`typescript`/`@types/node` are already
  the extension's devDependencies (ADR 0007 toolchain).
- No comments in code unless asked; minimal scoped changes.
- No behavior change to `extensions/pi-hooks/src/*.ts` source files — tests
  only. (A RED test that exposes a real bug is an exception: fix it, record it
  in `report.md` as a scope note, and re-run.)
- Commit per work unit; spec-zone artifacts (this folder, `state.yaml`,
  `report.md`, `review.md`) committed separately from code (work-unit-commits
  zone guard).

## File Structure

- `extensions/pi-hooks/src/config.spec.ts` — new; tests for `src/config.ts`
  (pure fs + mocked `getAgentDir`)
- `extensions/pi-hooks/src/shared.spec.ts` — new; tests for `src/hooks/shared.ts`
  pure functions (no mocks needed — all pure)
- `extensions/pi-hooks/src/executor.spec.ts` — new; tests for
  `src/executor.ts` `buildHookInput` (pure)
- `.skillgrid/specs/2026-10-16-pi-hooks-extension/acceptance.feature` — new;
  BDD scenarios for the truths above
- `.skillgrid/specs/2026-10-16-pi-hooks-extension/report.md` — new; QA gate
  render + door-check evidence
- `.skillgrid/specs/2026-10-16-pi-hooks-extension/review.md` — new; three-axis
  review
- `.skillgrid/state.yaml` — modified; `current_change` → this topic, phase
  transitions

---

### Task 1: E2E door check — one live hook fires through the wrapper

> **Door check:** this is the hypothesis test. If the configured hook command
> does NOT run when the wrapper launches pi, STOP — the extension's event
> wiring is broken at the pipeline level and the unit tests would be testing
> dead code.

**Files:**
- Create: (no source files — a scratch project dir in the temp dir)
- Modify: (none)

**Interfaces:**
- Consumes: `bin/skill-pi.js` (wrapper), `extensions/pi-hooks/index.ts`
  (already committed)
- Produces: evidence for `report.md` (marker file contents + exit code)
- Seam: none (in-process — the wrapper spawns pi; the hook spawns bash)
- Deletion test: n/a (verification task)
- Adapters: n/a

**SATISFIES:** R-E2E-hook-fires

- [ ] **Step 1: Set up a scratch project with a hook**

```bash
E2E=$(mktemp -d /private/var/folders/g1/c0fkk4s12mv4rqxrypxlndqc0000gq/T/opencode/pi-hooks-e2e.XXXXXX)
mkdir -p "$E2E/.skill-pi"
cat > "$E2E/.skill-pi/settings.json" <<EOF
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          { "type": "command", "command": "echo HOOK_FIRED \$(date +%s) > $E2E/hook-fired.txt" }
        ]
      }
    ]
  }
}
EOF
```

- [ ] **Step 2: Launch the wrapper in the scratch project**

```bash
node /Users/paladm/git/ai-test/skill-pi/bin/skill-pi.js -- --print "ok" "$E2E"
```

Expected: exit 0, output contains the model's reply.

- [ ] **Step 3: Assert the hook ran**

```bash
test -s "$E2E/hook-fired.txt" && grep -q HOOK_FIRED "$E2E/hook-fired.txt" && echo DOOR_CHECK_PASS
```

Expected: `DOOR_CHECK_PASS`. If the marker file is missing or empty → the
`session_start` handler never triggered the hook (check `pi.on("session_start")`
registration + `loadSettings` path) — STOP and report.

- [ ] **Step 4: Record evidence**

Paste the marker file contents, the wrapper exit code, and the scratch path
into `report.md` under `## Door Check`.

- [ ] **Step 5: No commit (verification task)**

### Task 2: Unit specs for config, shared, executor

**Files:**
- Create: `extensions/pi-hooks/src/config.spec.ts`
- Create: `extensions/pi-hooks/src/shared.spec.ts`
- Create: `extensions/pi-hooks/src/executor.spec.ts`
- Create: `.skillgrid/specs/2026-10-16-pi-hooks-extension/acceptance.feature`

**Interfaces:**
- Consumes: `src/config.ts` (`loadSettings`, `globalSettingsPath`,
  `matcherMatches`), `src/hooks/shared.ts` (`hookIfMatches`,
  `appendAdditionalContext`, `parseJsonOutput`, `extractCommonOutput`,
  `getStringField`, `extractToolResultPatch`), `src/executor.ts`
  (`buildHookInput`)
- Produces: green vitest suite; the acceptance scenarios map 1:1 to the truth
  list above
- Seam: `vi.mock("@earendil-works/pi-coding-agent")` for `getAgentDir` in
  `config.spec.ts` (the only impure module under test)
- Deletion test: deleting a spec file removes its truth from the verification
  surface — each spec file pins one source file's contract
- Adapters: 1 (the mocked `getAgentDir`) — justified because the real agent
  dir is a user-environment fact the unit must not depend on

**SATISFIES:** R-config-load, R-matcher, R-if-condition, R-hook-input

- [ ] **Step 1: Write the failing tests**

`extensions/pi-hooks/src/shared.spec.ts` (pure — no mocks):

```ts
import { describe, it, expect } from "vitest";
import {
  appendAdditionalContext,
  extractCommonOutput,
  extractToolResultPatch,
  getStringField,
  hookIfMatches,
  parseJsonOutput,
} from "./hooks/shared.ts";
import type { HookExecutionContext } from "./types.ts";
```

Cover at minimum (all pure — no mocks):

`hookIfMatches` (build a `HookExecutionContext` literal per case):
- non-tool event (`hookEventName: "Stop"`) with any `if` → false
- `if: "Bash(git push*)"` vs `toolName: "bash"`, `toolInput: {command: "git push origin"}` → true
- same `if` vs `toolInput: {command: "git status"}` → false
- `if: "Edit(*.ts)"` vs `toolName: "edit"`, `toolInput: {path: "a/b.ts"}` → true
- `if: "Edit(*.md)"` vs same → false
- `if: undefined` → true (no condition = run)

`parseJsonOutput`: `"{}"` → `{}`; `"not json"` → undefined; `""` → undefined.
`extractCommonOutput`: `continue: false` → `stopProcessing: true`;
`hookSpecificOutput` with mismatched `hookEventName` → undefined.
`extractToolResultPatch`: `hookSpecificOutput.updatedToolResult.content` wins
over top-level `content`; `updatedMCPToolOutput` fallback; no patch fields →
all-undefined result.
`appendAdditionalContext`: `("a", "b")` → `"a\nb"`; `(undefined, "b")` → `"b"`;
`("a", undefined)` → `"a"`.
`getStringField`: first non-empty string wins; all empty → undefined.

`extensions/pi-hooks/src/config.spec.ts` (mock `getAgentDir`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: vi.fn(() => "/fake/agent-dir"),
}));

import { globalSettingsPath, loadSettings } from "./config.ts";
```

Cover at minimum:
- `globalSettingsPath()` → `"/fake/agent-dir/settings.json"` (never contains
  `~/.pi`)
- `loadSettings(cwd)` with no settings files → `{ settings: undefined, sourcePaths: [] }`
- project-only: write `<cwd>/.skill-pi/settings.json` with a `Stop` hook →
  `settings.hooks.Stop` present, `sourcePaths` = [project path]
- global-only: write `/fake/agent-dir/settings.json` (create the dir) with a
  `Stop` hook → merged result present
- both: global `Stop: [A]` + project `Stop: [B]` → merged `Stop: [A, B]`
  (concatenation order: global first)
- `.pi/settings.json` in the same cwd is IGNORED: write a `Stop` hook only in
  `<cwd>/.pi/settings.json` → `settings` is undefined
- `matcherMatches` (same file, pure): `(undefined, "bash")` → true;
  `("", "x")` → true; `("*", "x")` → true; `("bash", "bash")` → true;
  `("write|edit", "edit")` → true; `("bash", "read")` → false; `("[", "x")`
  → false (invalid regex → exact-match fallback, so `("[", "[")` → true)

Use a real temp dir for `cwd` and clean up in `afterEach`/`rmSync`. The
`getAgentDir` mock returns a second temp dir (created in `beforeEach`) so
`readSettingsFile` can actually read the global file — the fake `"/fake/agent-dir"`
path is only for the `globalSettingsPath()` shape assertion (point the mock at
`"/fake/agent-dir"` for that one test via `vi.mocked(getAgentDir).mockReturnValue(...)`).

`extensions/pi-hooks/src/executor.spec.ts` (pure):

```ts
import { describe, it, expect } from "vitest";
import { buildHookInput } from "./executor.ts";
import type { HookExecutionContext } from "./types.ts";
```

Cover one representative context per event family:
- `SessionStart` with `source: "startup"` → has `session_id`, `cwd`,
  `hook_event_name: "SessionStart"`, `source`, `transcript_path`
- `UserPromptSubmit` with `prompt: "hi"` → has `prompt: "hi"`
- `Stop` with `stopHookActive: true`, `lastAssistantMessage: "done"` → has
  both fields
- `PreToolUse` with `toolName: "bash"`, `toolInput: {command: "ls"}` → has
  `tool_name`, `tool_input`, `tool_use_id`
- `PostToolUse` same + `toolResponse: {output: "ok"}` → has `tool_response`
- `PostToolUseFailure` with `error: "boom"` → has `error`

- [ ] **Step 2: Run to verify they fail (RED)**

```bash
cd /Users/paladm/git/ai-test/skill-pi/extensions/pi-hooks && npx vitest run
```

Expected: the new spec files compile (they import existing functions) — if any
assertion is RED against current source, that's a real bug in the vendored
fork. Record it in `report.md` and fix the source minimally (scope note).
If everything is GREEN on first run, the vendored logic is correct — that is
the expected outcome; the suite is a regression pin, not a bug finder.

- [ ] **Step 3: Write the acceptance.feature**

```gherkin
Feature: pi-hooks vendored extension

  Scenario: R-E2E-hook-fires — a SessionStart hook command runs through the wrapper
    Given a scratch project with .skill-pi/settings.json declaring a SessionStart hook
    When the wrapper launches pi in that project (--print "ok")
    Then the hook command's marker file exists and is non-empty

  Scenario: R-config-load — settings load from the isolated agent dir and .skill-pi
    Given getAgentDir() resolves to a temp agent dir
    When loadSettings(cwd) runs with a .skill-pi/settings.json in cwd
    Then the project hooks are returned and the source path is the .skill-pi file
    And a .pi/settings.json in the same cwd is ignored

  Scenario: R-matcher — matcher regex semantics match Claude Code
    Given a matcher of undefined or "" or "*"
    When matcherMatches is called with any value
    Then it returns true
    And an invalid regex falls back to exact string match

  Scenario: R-if-condition — if conditions gate tool hooks
    Given a PreToolUse context for tool bash with command "git push origin"
    When hookIfMatches is called with "Bash(git push*)"
    Then it returns true
    And for command "git status" it returns false

  Scenario: R-hook-input — hook input is Claude Code-shaped
    Given a HookExecutionContext for each supported event
    When buildHookInput is called
    Then the output has the event-specific fields documented in the README
```

- [ ] **Step 4: Run to verify they pass (GREEN)**

```bash
cd /Users/paladm/git/ai-test/skill-pi/extensions/pi-hooks && npx vitest run && npx tsc --noEmit -p .
cd /Users/paladm/git/ai-test/skill-pi && node --test "test/**/*.test.js"
```

Expected: all green; root suite unchanged (42 pass / 0 fail / 7 skip baseline —
verify against the actual current count, not the stale state.yaml number).

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-hooks/src/*.spec.ts .skillgrid/specs/2026-10-16-pi-hooks-extension/
git commit -m "test(pi-hooks): unit specs for config, shared, and executor

Pins the vendored fork's pure logic: settings load/merge under the
isolated agent dir (.skill-pi project path, getAgentDir global),
matcher regex semantics, if-condition parsing, and Claude Code hook
input shaping. Regression pin for the homogenization edits — the
suite is the backstop the direct-landing session skipped.

[skillgrid-context]
Change: 2026-10-16-pi-hooks-extension
Task: 2
Decisions: mock getAgentDir per ADR 0002; no source behavior change
Remaining: qa gate render + three-axis review + ship"
```
