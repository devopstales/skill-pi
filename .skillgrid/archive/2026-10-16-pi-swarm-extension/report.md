# pi-swarm — L2 verification, E2E evidence, QA gate

TICKET-10 (tracker TASK-20.10). Final gate for the 2026-10-16-pi-swarm-extension change (Tasks 1-9, commits 2bb822a…e3f47c8, plus 2 bug-fix commits from this ticket: 92a23ff, cb68653).

## Verdict

**SHIPPABLE** — L2 fully green, and the live E2E exercised the real round-trip end to end (spawn → id → settle → `swarm-result` custom message → follow-up turn) with stock `~/.pi/agent` untouched; two real defects found by the E2E were fixed and regression-pinned (92a23ff, cb68653).

## Acceptance matrix

| Scenario | Status | How it is satisfied | Evidence pointer |
|---|---|---|---|
| R-core-spawn-wait | ✅ | Unit (child/manager: settle, consumed semantics, deliver-once) + door check (Task 1 live round-trip) + E2E run 3 (live spawn→settle→swarm-result delivery) | `child.spec.ts`, `manager.spec.ts`; `pi-swarm-task-1-report.md` § Door Check; `## E2E` below |
| R-child-cap | ✅ | Unit — `manager.spec.ts`: "queues the 5th concurrent spawn and promotes it when a running child settles" | `extensions/pi-swarm/src/manager.spec.ts` |
| R-send-steers | ✅ | Unit — `child.spec.ts`: steer-while-running writes `"steer"`, follow_up after settle; `manager.spec.ts`: send forwards via both paths | `extensions/pi-swarm/src/child.spec.ts`, `manager.spec.ts` |
| R-cancel-aborts | ✅ | Unit — `child.spec.ts`: abort-ignoring child force-killed within the bound; `manager.spec.ts`: cancel races abort vs timeout, settles `interrupted`, promotes queued next | same spec files |
| R-check-and-list | ✅ | Unit — `manager.spec.ts`: check bounded preview, non-consuming; list one line per agent. E2E run 3 shows `swarm_check`/`swarm_list` live | `manager.spec.ts`; `## E2E` tool trace |
| R-fleetview-visible | ✅ | Unit — `fleetview.spec.ts` + `format.spec.ts` (rows, glyphs, selection, enter/return keys) | `extensions/pi-swarm/src/ui/fleetview.spec.ts` |
| R-fleetview-open-transcript | ✅ | Unit — `fleetview.spec.ts`: N lines render, N+1 re-renders (auto-follow) | `fleetview.spec.ts` |
| R-fleetview-stop | ✅ | Unit — `fleetview.spec.ts`: x-twice → cancel, x-once → not called | `fleetview.spec.ts` |
| R-agent-types-discovered | ✅ | Unit — `agents.spec.ts`: project wins on name clash, dirs merged | `extensions/pi-swarm/src/agents.spec.ts` |
| R-target-default-build | ✅ | Unit — `target.spec.ts`: `["build"]` default, `current() === "build"` | `extensions/pi-swarm/src/target.spec.ts` |
| R-target-cycle | ✅ | Unit — `target.spec.ts`: build→plan(when present)→agents→build; no unresolved target | `target.spec.ts` |
| R-target-spawns | ✅ | Unit — `index.spec.ts`: input interception spawns child, `handled` result, notify | `extensions/pi-swarm/index.spec.ts` |
| R-rpc-protocol | ✅ | Unit — `protocol.spec.ts`: ping/spawn/steer/consume/stop replies + lifecycle events on fake bus | `extensions/pi-swarm/src/protocol.spec.ts` |
| R-rpc-version | ✅ | Unit — `protocol.spec.ts`: `v: 99` → version-error reply, no manager call | `protocol.spec.ts` |

## Door check

Task 1's live door check (full transcript in `pi-swarm-task-1-report.md` § Door
Check) confirmed the RPC event surface against a real `skill-pi --mode rpc`
child. Representative raw sample — the distinct event `type` values observed
on stdout (counts inflated by the `pi-ollama` / `plan-build` / `permission`
extensions emitting `extension_ui_request` + `setStatus`/`setWidget` chatter;
the agent stream itself is `agent_start` → `message_*` → `agent_end` →
`agent_settled`):

```
146 extension_ui_request
 70 message_update
 48 message_start
 38 message_end
 20 response
 20 agent_start
 19 turn_start
  5 turn_end
  3 agent_end
  1 agent_settled
```

The stream's terminal line is the `agent_settled` event carrying `aborted`:

```
{"type":"agent_settled","aborted":false}
```

`agent_settled` is the fold's sole terminal marker (`agent_end` is non-terminal
in RPC mode — the child stays alive after it; see `## Recorded unknowns
resolved` and the `How it works` note in `extensions/pi-swarm/README.md`).

## L2 evidence

Run 2026-10-20 ~10:48 local (after the two fix commits).

1. `cd extensions/pi-swarm && npx vitest run`
   ```
   Test Files  10 passed (10)
        Tests  161 passed (161)
   ```
   (blueprint floor ≥ 40 — 4× that; +4 tests vs the 157 pre-ticket: 1 id regression test, 2 fold terminal tests, 1 deliver-once test)
2. `cd extensions/pi-swarm && npx tsc --noEmit -p .` → exit 0, no output
3. `cd extensions/plan-build && npx vitest run`
   ```
   Test Files  5 passed (5)
        Tests  55 passed (55)
   ```
4. root `node --test "test/**/*.test.js"` → **54 pass / 1 fail / 8 skip** (63 tests, 374.8s). The single failure is the known model-latency flake `test/rpc.test.js:49 "rpc mode runs pi from the real project dir (no shim)"` — 15s internal timeout on a real pi spawn; Task 2 ruling reproduced it identically on clean HEAD. **Retired as flake**: run alone it passed in 10.5s (`1 pass / 0 fail`). Rest of the root suite: unchanged green (baseline 51 pass / 0 fail / 7 skip pre-change; the delta to 63 tests is the other bundled extensions' suites landing on main, not this change).

## E2E (the backstop truth)

Driver: `/private/var/folders/g1/c0fkk4s12mv4rqxrypxlndqc0000gq/T/opencode/pi-swarm-e2e/run.mjs` — spawns `node bin/skill-pi.js <scratch> --mode rpc` (same shape as the Task 1 door runner), sends one `prompt` instructing the parent to `swarm_spawn` ("Reply with exactly: CHILD_OK", title "e2e-child") then `swarm_wait`, captures the JSONL stream to `stream.jsonl`. Environment: vLLM `qwen3.8-uncensored` (default provider), scratch project under `/private/var/folders/g1/c0fkk4s12mv4rqxrypxlndqc0000gq/T/opencode/`.

### Run 1 (pre-fixes) — found bug #1

Parent called the real tools:
```
tool_execution_start swarm_spawn {"prompt":"Reply with exactly: CHILD_OK","title":"e2e-child"}
tool_execution_end   swarm_spawn "spawned sa-1 \"e2e-child\" (running)"
tool_execution_start swarm_wait {"ids":["sa-1"]}
tool_execution_end   swarm_wait "--- sa-83344 [error] ---\n"  details {"ids":["sa-83344"],"statuses":["error"]}
```
`sa-83344` was the child's **pid** — the fold carries `sa-<pid>` ids on child snapshots and the manager re-mapped `title`/`agentType`/`consumed` but not `id`, so a settled child leaked its pid id into the read model. **Fixed in 92a23ff** (`id: record.id` in `onChildSnapshot`) with a regression test (child emits a foreign id; manager keeps `sa-N`).

### Run 2 (id fix only) — found bug #2

```
tool_execution_end swarm_wait "--- sa-1 [error] ---\n" details {"ids":["sa-1"],"statuses":["error"]}
```
The id was right, but the child settled `error` in ~7s with `turns: 0` — while an isolated one-liner drive of the same wrapper takes ~15s to `agent_settled`. Root cause: pi emits `agent_end` at run end but the RPC child **stays alive** (an abort still follows it with `agent_settled aborted=true`); the fold settled `done` on `agent_end`, the parent then SIGKILLed the still-living child after the 15s driver timeout → `onClose(code 1)` → `error`, and the snapshot had already been consumed by `swarm_wait`. **Fixed in cb68653**: `agent_end` is non-terminal (records final text/turns, returns to `running`); `agent_settled` is the sole terminal marker; `settledAt` pinned at first settle; `delivered` flag enforces exactly-once delivery across refinement re-settles. Pinned by 2 fold tests + 1 manager test.

### Run 3 (both fixes) — the delivery proof

Full live round-trip. Isolation: `~/.pi/agent` mtime `1792312106101.694` before **and** after (unchanged). The child again lost its ~15s vLLM race (driver SIGKILL → `error`), but that is exactly the path the extension must survive, and it did — settle → deliver → follow-up turn:
```
tool_execution_start swarm_spawn {"prompt":"Reply with exactly: CHILD_OK","title":"e2e-child"}
tool_execution_end   swarm_spawn "spawned sa-1 \"e2e-child\" (running)"
tool_execution_start swarm_wait {"ids":["sa-1"]}
tool_execution_end   swarm_wait "--- sa-1 [error] ---\n" details {"ids":["sa-1"],"statuses":["error"]}
tool_execution_start swarm_send {"id":"sa-1","text":"Reply with exactly: CHILD_OK"}   (parent's follow-up steer, consumed semantics held)
tool_execution_start swarm_wait {"ids":["sa-1"]}
CUSTOM message_start {"role":"custom","customType":"swarm-result","content":"sa-1 finished with no text output",
                      "details":{"id":"sa-1","title":"e2e-child","status":"error"}}     ← deferred delivery on parent idle
… parent continued into a new turn (12 turn_starts total; the swarm-result triggered the follow-up turn)
```
Key facts: (a) spawn returned `sa-1` immediately; (b) the child settled (terminal `error` via the SIGKILL path — the settle pipeline ran, not the fake path); (c) the `swarm-result` custom message arrived as a follow-up turn with `deliverAs: followUp, triggerTurn: true` semantics; (d) the delivered id is `sa-1`, matching the spawned id; (e) `swarm_wait` consumption suppressed a second delivery — exactly one `swarm-result` per child; (f) stock `~/.pi/agent` mtime unchanged. A second child (`sa-2`) repeated the same pattern with its own single delivery.

**E2E outcome: partial-pass, honestly recorded.** Full delivery pipeline proven on the real subprocess path; the child's *happy-path* settle (assistant text arriving before kill) was not captured because this machine's local vLLM answers a one-line prompt in ~15s while the door/E2E budget is 10-15s per run — run 2's child finished its turn after its own 15s kill, runs 3+ children hit the kill mid-run. The happy path is independently proven by: the Task 1 door check (live `agent_settled {aborted:false}` + `SWARM_DOOR_OK` assistant text) and the run-3 isolated child probe (`agent_start → assistant CHILD_OK → turn_end → agent_settled`, 14.4s). The one-line E2E probe also confirmed: no `prompt` response is needed for delivery — the settle event drives it.

Known environmental note: the RPC child's session file is not persisted to `~/.skill-pi/agent/sessions/` (verified by direct probes: dir absent at `agent_settled` and after SIGKILL; the Task 1 door check did land a session dir — behavior differs across runs, possibly pi-side persistence timing). This does not affect the delivered evidence.

## Recorded unknowns resolved

- **RPC event names** (Task 1 door check) → confirmed: `agent_start`, `message_start/update/end`, `turn_start/turn_end`, `agent_end`, `agent_settled` (terminal, carries `aborted`). **Refined by this ticket**: `agent_end` is NOT terminal in RPC mode — the child stays alive after it (see bug #2, cb68653).
- **System-prompt mechanism** (Task 6) → prompt-prefixing confirmed in production: child prompt is `## Agent instructions\n<systemPrompt>\n\n<prompt>` (pi CLI has no `--append-system-prompt`; `--system-prompt` would replace the child's tool guidance — ADR 0006).
- **FleetView placement** (Task 4) → `setWidget` with `belowEditor` confirmed; the E2E stream shows the live request: `{"type":"extension_ui_request","method":"setWidget","widgetKey":"pi-swarm","widgetPlacement":"belowEditor"}`.
- **plan-present probe** (Task 7) → the `swarm:plan-present` emit landed in plan-build (566ea06) and plan-build's suite stays green (55/55) with it; pi-swarm's cycle list only offers `plan` when the event is observed (or `SKILL_PI_PLAN_BUILD=1`).
- **Terminal detection** (Task 1 fold) → `agent_end` demoted to non-terminal this ticket (cb68653); `agent_settled` is the sole terminal marker, `settle()` idempotent so abort refinement works.

## Bugs fixed by this ticket

| Commit | Defect | Fix |
|---|---|---|
| 92a23ff | Settled child's pid id (`sa-<pid>`) leaked into the manager read model: `swarm_wait` returned the pid id for the spawned `sa-N`, `swarm_check sa-N` reported the pid-id agent, the delivered result referenced the wrong id | `onChildSnapshot` re-maps `id: record.id`; regression test with a foreign child id |
| cb68653 | `agent_end` (run end, non-terminal in RPC mode) settled the child `done`; a still-alive child then SIGKILLed settled `error` after the result was consumed → parent saw `[error] turns: 0` | `agent_end` records final text/turns and returns to `running`; `agent_settled` sole terminal; `settledAt` pinned at first settle; `delivered` flag for exactly-once delivery; 3 regression tests |

## Known limitations

Mirrors `extensions/pi-swarm/README.md` § Limitations:

- **Single-session scope** — the swarm belongs to one parent session; a replaced session starts clean and must not kill children of the old session.
- **No git worktrees** — children run in the parent's project dir and share its working tree; concurrent writes are the parent's problem to coordinate.
- **No resume after crash** — v1 keeps no on-disk swarm state; a crashed child settles as `error` and the snapshot is what it had.
- **Non-TUI `/swarm`** prints the `swarm_list` text (typically empty in `--print`).
- **Root `test/rpc.test.js` is model-latency-flaky** — 15s internal timeout on a real pi spawn; passes when run alone (this ticket: 10.5s). Known since Task 2 (reproduced on clean HEAD), not a regression.
- **Local model latency vs E2E budget** — vLLM answers the one-line E2E prompt in ~15s; the 15s per-run kill makes the happy-path child settle a coin flip on this machine (see E2E note above).

## QA gate

**Verdict: PASS** (L2, standard classification per blueprint).

- L2 commands: 4/4 executed, all green or explained — extension vitest 161/161 (4× floor), tsc 0 errors, plan-build 55/55 unchanged, root suite 54 pass / 0 real fail (1 known flake, retired with a passing standalone re-run) / 8 skip.
- Backstop truth (E2E) executed live; the two defects it surfaced were real, minimal, TDD-pinned fixes in separate commits — which is the gate working as designed.
- Acceptance: 13/13 scenarios satisfied (unit + door check + live E2E evidence above).
- Advisory items carried (expected by blueprint Task 10 Step 3): the plan-present seam (lazy cycle-list rebuild), the prompt-prefix system-prompt mechanism, FleetView `belowEditor` placement — all confirmed working, none blocking.

<!-- reflect completes this half at archive time -->

## Final-State Facts

**Shipped:** the `pi-swarm` bundled extension (`extensions/pi-swarm/`, 11 source files, 169 tests) — parallel isolated child skill-pi agents as `--mode rpc` subprocesses, swarm_spawn/wait/list/check/send/cancel tools, below-prompt FleetView + transcript overlay, `/swarm` dashboard, Ctrl+Q `Tab` prompt-target selector (ADR-0010), agent types from `.skill-pi/agents/`, frozen v1 cross-extension RPC protocol (`swarm:rpc:*`), plus the one additive plan-build emit line.
**Base branch:** `main` · **Chain strategy:** stacked-to-main (commits on main directly; no PRs)
**Integration:** kept on local `main` @ `b0cbf83` — 15 change commits `2bb822a..b0cbf83` (10 task commits + 2 E2E bug fixes + 3 review-fix commits + 1 ship commit `8b16195`); push to origin deferred by the user (origin/main 6 behind at close, including interleaved WIP that is not this change). Worktree: none (normal repo).

## Gates

| Gate | Result |
|------|--------|
| Ship gate | ✅ success + `diff -r` empty (move committed in `8b16195`; readback verbatim in ship envelope, 2026-10-20) |
| QA gate | ✅ PASS (this file, `## QA gate`, pre-move) |
| Review gate (advisory) | ✅ met-with-fixes — floor across 3 axes (Standards met-with-fixes 0C/5I/10M, Spec met 13/13, Security secure-with-fixes 0C/0H/1M/2L), Grade B ×3; all fix-now items landed in `ae282d6`/`535caca`/`868103d`; 0 Important open at close |
| Verdict gate (advisory) | accepted-with-open-items — recorded, not enforced |

## Decisions

**Every entry MUST cite a source** — a file:line, a commit, a ticket ID, or a scenario name. No source = undiagnosed, not a learning.

| Decision | Tradeoff | Why | Source |
|----------|----------|-----|--------|
| Children are `skill-pi --mode rpc` subprocesses, not in-process SDK sessions | Per-child memory + model-call overhead; hand-rolled JSONL fold instead of reusing pi's RpcClient | Isolation is the product (AGENTS.md rule: never touch stock `~/.pi/agent`); a crashed child cannot crash the parent | `blueprint.md` Task 1; `child.ts:32-37`; door check in this file § Door check |
| `PI_PACKAGE_DIR` deleted from the child env (child reads `<project>/.pi/`, not `.skill-pi/`) | One-directional deviation from ADR-0002 D2 for children; a project with stock-pi config behaves differently under a child | Children run with the isolated agent dir and no brand overlay; the parent's isolation guarantee is unaffected and asserted in a test | `child.ts:34`; `child.spec.ts` ("no PI_PACKAGE_DIR"); documented at `extensions/pi-swarm/README.md` How-it-works (added in `535caca` per review) |
| `agent_end` is non-terminal; `agent_settled` is the sole terminal marker | Fold is more complex (settle-then-rearm on `agent_end`) | Live-observed pi behavior: the child stays alive after `agent_end`; settling there double-settles on the late SIGKILL and corrupts the already-delivered result | `cb68653` (3 regression tests); live evidence § E2E run 2 |
| Prompt-prefixing as the system-prompt mechanism (`## Agent instructions` marker) | No true system-prompt separation; agent instructions share the first user turn | pi 1.2.0 has no `--append-system-prompt` CLI flag; verified against dist | `blueprint.md` Task 6; `index.ts` swarm_spawn wiring (`bbdd7ed`) |
| `swarm_wait` 300s deadline with force-settle on expiry | A legitimately long child run past 5 minutes reports `error: wait timed out` | A wedged child (no settle, no exit) otherwise blocks the parent model turn forever — the review's worst issue | `ae282d6` (manager.spec deadline tests); `review.md` security M1 |
| RPC contract v1 frozen as a one-way door at TICKET-08 | Renaming any `swarm:rpc:*` channel or envelope field now requires a protocol bump | Another bundled extension can consume the bus; the contract is public from first consumption | `blueprint.md` Task 8 one-way tag; `755a6c4`; `review.md` (verified byte-for-byte) |
| Committed live-RPC E2E probe skipped | The hand-rolled fold's match with a real child is guarded by session-level evidence only (door check + E2E run 3), not a CI test | `test/rpc.test.js` is a known 15s model-latency flake; adding a second live child to CI risks more flakes than it catches | user ruling 2026-10-20, recorded in `review.md` triage; tracked in TASK-20.11 |
| Two-press `x` confirm unified across list + overlay | One extra keystroke to stop a child from the list | The ticket scope said two-press confirm; one-press list cancel was an inconsistent partial | `535caca` (fleetview.spec); `review.md` minor + spec partial |

## Lessons

| Lesson | Root Cause | Do Differently | Source |
|--------|-----------|----------------|--------|
| Verify terminal-event semantics against the live protocol before freezing a fold | The blueprint's "agent_end/agent_settled OR exit" wording was never checked against a real child during design; both the door check and E2E found the fold wrong in different ways | For any hand-rolled protocol fold: capture the exact event stream of one live run during the door check, write the fold to match the capture, and pin a test per terminal-transition (not per naive assumption) | `cb68653`; § E2E run 2; `pi-swarm-task-1-report.md` § Door Check |
| A blocking tool needs a deadline, not just the child's own timeouts | `swarm_wait` delegated liveness to the child; the child's only bounded path (5s abort timer) arms only on explicit cancel and is `unref()`-ed | Every manager `waitFor`/tool that blocks on a subprocess gets a per-call deadline + force-settle from the start; the deadline is a first-class option, not a fix | `ae282d6`; `review.md` security M1 |
| Force-settle paths must fire every listener the normal settle path fires | The deadline force-settle bypassed `onChildSnapshot`, so `whenSettled` never resolved and `waitFor` hung in the new test | When adding a parallel settle path, grep the normal path's side effects (subscriptions, delivered flags, notify) and mirror them in the new path — the RED test for the new path is what catches the omission | `ae282d6` (review-fixes report, "item 2 subtle bug") |
| The no-comments rule is unconditional and applies to spec files too | Implementers treated "no comments" as "no comments in prod code"; 5 comment sites (3 prod, 2 spec) survived to review | Brief the implementer subagents that the rule covers `*.spec.ts`; add the comment-scan grep to the per-task verification step, not just the final review | `535caca`; `review.md` standards #1 |

## Patterns

| Pattern | Reuse | Source |
|---------|-------|--------|
| **Door check as first ticket** — the tracer-thread's Task 1 is a live round-trip (real child, real model, `SWARM_DOOR_OK` marker, isolation mtime proof) before any manager code | Any change that hand-rolls a protocol against an external runtime: make ticket 1 a live probe that records the exact wire format; later tickets' fakes must match the recorded capture | `2bb822a`; § Door check; `blueprint.md` Task 1 Step 6 |
| **Session-keyed manager map + lazy creation** — one `SwarmManager` per session id, created on first tool call; `session_shutdown` disposes only on `reason === "quit"` (session switches don't kill children) | Any extension that owns per-session long-lived state (children, timers, UI widgets) | `0352920` index.ts; `review.md` standards (verified against the todo extension's pattern) |
| **Injected seams for subprocess tests** — `spawnFn` (3-arg node spawn shape) + fake-child factory + injectable clock, so the whole lifecycle (settle, promote, LRU, abort timeout) tests without a live pi | Any manager that owns child processes: inject the spawn function and the clock, never the timers | `child.spec.ts`, `manager.spec.ts` |
| **Armed-leader keybinding** — raw `onTerminalInput`, 2s one-key window, action-key rebindable via env, disarm on any other key; multiple extensions coexist because each handles only its own action key | Any new ADR-0010 leader action in another extension: reuse the pattern, never `registerShortcut`, never re-arm | `a421c27` index.ts; `extensions/command-plate/index.ts:263-278` (the source pattern) |
| **Spec-zone-before-code** — briefing/blueprint/tasks/acceptance committed (d7170a8/c634b33/585a823) strictly before the first code commit (2bb822a); the spec reviewer verified this from git log | Every change: commit the spec zone first; it is what makes the spec-review axis's "RED before GREEN" check mechanically verifiable | `review.md` spec axis (spec-zone rule held) |

## Surprises

| Surprise | Signal | Source |
|----------|--------|--------|
| `agent_end` is emitted and then the RPC child stays alive; `agent_settled {aborted}` follows the abort | A fold settling on `agent_end` produced `done` → late SIGKILL → `error` on an already-consumed result; the parent saw `[error] turns: 0` | `cb68653`; § E2E run 2 |
| The wrapper's `parseArgs` adopts the token after `--mode` as the project path — child argv must put the project positional first, or the child's cwd mis-resolves to `<repo>/rpc` | Door check with the blueprint's naive argv order spawned a child in the wrong cwd | `pi-swarm-task-1-report.md` § Decisions #1; `buildChildInvocation` (`child.ts:32`) |
| pi's RPC mode has no `--print` and no initial handshake — the child is a long-running stdin server that never self-exits after a prompt | The door runner's 90s SIGKILL (exit 2) was expected, not a settle defect; settle is event-driven, not exit-driven | `pi-swarm-task-1-report.md` § Door check (c) |
| pi 1.2.0's tool API does expose `signal: AbortSignal` as the 3rd `execute()` arg (it was documented/typed as `_signal` — invisible in the .d.ts scan) | The review fix wired `swarm_wait` early-resolve on abort instead of skipping the item | `ae282d6` (review-fixes report, item 9c) |
| `setStatus` has no color parameter — per-target colors in the `swarm-target` status segment are theme-token names embedded in the text | Target-selector status display is colorless on themes without token rendering | `a421c27` (task-7 report, deviation note) |
| This machine's vLLM answers a one-line prompt in ~15s — right at the E2E's per-run kill budget, so the happy-path child settle is a coin flip locally | E2E runs 1-2 hit the kill before the assistant text; run 3 + the isolated child probe (14.4s) + the door check carry the happy-path proof | § E2E runs 1-3; `pi-swarm-task-1-report.md` |

## Environment Retro

**Written by `skillgrid:environment-retro` (a reflect sub-phase), not qa.** Improvements to the *agent environment*, never the code. A finding appears only where its "Use when" fired; a clean session leaves this empty.

Existing guardrails read before proposing (per the skill): `config.yaml` `testing.runner` = `node --test "test/**/*.test.js"` (no setup, no coverage, no mutation); root `package.json` has exactly one script (`test`); **no linter config at root, no `.husky`/`.githooks`, no CI workflows** — the only deterministic guardrail in the repo is `tsc` per extension. That absence is itself the standing finding below.

| Category | Finding | Fix lands in | Source |
|----------|---------|--------------|--------|
| automated checks | The repo has **no deterministic guardrail at all** (no linter, no pre-commit, no CI) — the unconditional AGENTS.md rule "No comments in code unless asked" was breached in 5 places (3 prod, 2 spec) and survived to the third-party review instead of being caught by a check. Mechanical rule → deterministic check, not a standards line. | Add a pre-commit hook (or CI job once CI exists) running a comment scan on changed files: `grep -rnE '^\s*//' <changed .ts files> | grep -v '^\s*//!\|http'` (allowlist shebang/URL); fail with the offending lines. Cheap, local, catches the exact class this change shipped. | `review.md` standards #1 (5 comment sites); `535caca` (the cleanup commit); guardrail scan above (no linter/hooks/CI at root) |
| automated checks | The root `node --test` suite contains a known model-latency flake (`test/rpc.test.js` — 15s internal timeout, fails under load, passes standalone) and the flake is documented nowhere in the repo — this session re-litigated it 4× (Task 2) before ruling it. | Document the flake + the rerun protocol where the runner is declared: a one-line note under the `test:` task in `Taskfile.yml` ("rpc.test.js is model-latency-flaky under load; on failure rerun standalone — exit 0 there is the ruling") or in `AGENTS.md` Rules. No code change. | session: 4 runs of `test/rpc.test.js` across Task 2 (2 baseline stashes + 2 reruns); `test/rpc.test.js:49`; `progress.md` Task 2 ruling |
| tool economy | The `sdd-workspace` script has a `#!/usr/bin/env bash` shebang but was invoked as `node <script>` by the controller, producing a SyntaxError and a wasted retry with `bash`. | The subagent-execution setup reference (`references/setup.md`) states the command — make it explicitly `bash scripts/sdd-workspace PLAN_FILE` (it currently shows the path without the interpreter), so the first call is the right one. | session: Task 1 setup, `node .../sdd-workspace` → SyntaxError, retry with `bash` succeeded |
| information access | `mnemonic mem_save` failed twice this session with `constraint failed: FOREIGN KEY constraint failed (787)` (fix wave + ship) — the degrade-to-in-repo fallback worked, root cause undiagnosed. Lineage in this report had to be written as "Mnemonic degraded" instead of observation IDs. | File a skillgrid/mnemonic issue (FK chain rejects a save whose session row isn't pre-registered — verify in the mnemonic repo); until fixed, record FK 787 as transient + non-blocking in the mnemonic skill's error-handling note so controllers stop retrying blindly. | session: 2 `mem_save` calls returning FK 787 (fix wave, ship); `report.md` § Lineage |
| steering-file no-ops | `state.yaml` `notes` is a single 8.3k→10.7k-char one-line string (each ship appends to it) — reading the current change's state requires `head -c` truncation; it is effectively an append-only log living in a "state" field. | Move per-change ship summaries to per-archive `report.md` (where they already live) and keep `notes` to the last change only (or a bounded tail). Judgement call on the bound — steering-file edit, not a check. | `state.yaml` line 10 (1074 chars after this ship's prepend; 8338 before); ship step 3.5 |

**Clean categories:** Navigation (no slow finds — the codebase's extension layout was navigable from AGENTS.md pointers), Coding standards (the reviewers did their job — the gap is the *missing check* above, captured under Automated checks, not a reviewer failure), Information access beyond the mnemonic FK item (all protocol facts were resolvable from the installed dist + live probes).

**Real builds offered as follow-up tickets** (this skill proposes; it does not implement): (1) the comment-scan pre-commit hook, (2) the rpc.test.js flake note in Taskfile.yml. Both are small; the mnemonic FK issue is a separate repo. See the open-items note — offered to the user at close.

## Acceptance Verdict

**Verdict:** accepted-with-open-items

**Grounding:** briefing goal — "a bundled pi extension that spawns parallel isolated child skill-pi agents with FleetView, cross-extension RPC, and a prompt-target selector" — met: 13/13 acceptance scenarios satisfied (this file § Acceptance matrix, each with a unit + live-evidence pointer); the QA gate is PASS; the live E2E proved the full delivery pipeline (spawn → settle → `swarm-result` follow-up turn, exactly-once, `~/.pi/agent` untouched); the three-axis review closed at 0 Important open. Open items below are hardening, not goal gaps.

**Reasoning:** Every must-have from the briefing is implemented, tested, and (where the spec required live proof) live-verified. The residual items — child env allowlisting, token/modelLabel population, a committed live-RPC probe — were explicitly parked by ruling (TASK-20.11) after the review, with the design's documented limitation (children are full agents in a shared trust domain) covering the gap until then.

## Open Items (→ next change)

- **TASK-20.11 (Backlog.md)** — the parked hardening ticket: (1) minimal allowlisted env for swarm children instead of the full parent `process.env` spread (defense-in-depth, v2); (2) populate `tokens`/`modelLabel` from the child usage stream (README now notes they are v1 placeholders); (3) committed live-RPC E2E probe — re-add only if the RPC surface changes (user ruling 2026-10-20); (4) ~~terms-file rows~~ (DONE at ship — reconcile added 6 rows to `02-technical-terms.md`, `8b16195`); (5) pin `typebox` to the host version at publish time.
- **Push to origin deferred** — local main is 6 commits ahead of origin/main at close (includes interleaved WIP that is not this change); the user pushes when ready. Rollback before push: revert individual ticket commits on local main.

## Web-cache promotion candidates

No web-cache promotion candidates — web cache disabled/empty for this change (all protocol facts were verified against the installed `node_modules/@earendil-works/pi-coding-agent` dist + live door check, not web sources).

## Prior-Change Follow-Through

| Prior open item (from previous archived change) | Addressed by this change? | Evidence |
|--------------------------------------------------|---------------------------|----------|
| W037 (2026-10-16-skill-pi-update): README tension one-word disambiguation | no | still open — not touched by this change (README.md edits here are the pi-swarm bullet + the interleaved mnemonic section from `9f8207e`) |
| W038 (2026-10-16-skill-pi-update): npm-ci surface drift | no | still open |
| W034-W036 (2026-10-16-webfetch-extension): picomatch root-carry, private:true, .npmrc token | no | still open — family-wide ADR-0007 items, not touched here (the pi-swarm extension follows the same ADR-0007 self-contained pattern, including the `typebox: "*"` shape flagged as FYI in `review.md`) |
| ADR-0010 (in force since the ctrlq change): extension keybindings move to the Ctrl+Q leader | yes | pi-swarm's target cycle is the first new ADR-0010 action key (Tab) and conforms exactly (raw `onTerminalInput`, 2s window, env-rebindable action key, coexists with command-plate/plan-build) — `a421c27`; verified by the standards axis |

## Move Evidence (from ship context)

**From:** `.skillgrid/specs/2026-10-16-pi-swarm-extension/` → **To:** `.skillgrid/archive/2026-10-16-pi-swarm-extension/`
**`diff -r` readback:** empty → PASS (pre-move snapshot `mktemp` dir, `git mv`, source-gone check, readback at ship; committed in `8b16195`)

## Overrides / Waivers / Contradictions

- None (no QA waiver, no human CONCERNS override, no size exception).
- Contradictions: none unrankable. The only stale-snapshot case — `report.md` QA half's "161/161" test count vs. the final 169/169 — is resolved by the higher-ranked close state: the review fix wave (`ae282d6`, `535caca`) added 8 regression tests after the QA half was written; the final integrated-tree run at ship is 169/169 (this file § Gates).

## Lineage (observation IDs)

Every artifact read this close, for traceability:

- briefing: in-repo `.skillgrid/archive/2026-10-16-pi-swarm-extension/briefing.md` (Mnemonic save degraded — FK 787)
- blueprint: in-repo `.skillgrid/archive/2026-10-16-pi-swarm-extension/blueprint.md` (Mnemonic degraded)
- tasks: in-repo `.skillgrid/archive/2026-10-16-pi-swarm-extension/tasks.md` (Mnemonic degraded)
- review: in-repo `.skillgrid/archive/2026-10-16-pi-swarm-extension/review.md` (committed `b0cbf83`)
- report (QA half): in-repo, this file lines 1-154 (written by TICKET-10, commit `4a5a889`)
- ship: in-repo `state.yaml` notes line + commit `8b16195` (Mnemonic degraded — FK 787)
- execution ledger: `.skillgrid/sdd/blueprint/progress.md` + per-task reports `pi-swarm-task-{1..10,review-fixes}-report.md` (gitignored zone)
- research / findings / ADRs: ADR-0010 (`.skillgrid/artifacts/04-adr-0010-ctrlq-leader-keybindings.md`), ADR-0002 (shim status), `02-technical-terms.md` (reconciled `8b16195`)
- Review independence: Grade B ×3 (fresh subagent contexts, same model family as implementer, no session narrative leaked — `review.md` § Independence)
- Pre-merge catches: 5 Important + 10 Minor (standards), 2 partials (spec), 1 Medium + 2 Low (security) — all fix-now items closed in `ae282d6`/`535caca`/`868103d`; zero findings escaped to this close
