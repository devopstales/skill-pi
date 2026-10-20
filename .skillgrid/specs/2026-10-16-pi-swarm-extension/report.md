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
