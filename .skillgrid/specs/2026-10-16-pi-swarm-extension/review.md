# Review — pi-swarm

> Change: `.skillgrid/specs/2026-10-16-pi-swarm-extension/` (moves to `.skillgrid/archive/2026-10-16-pi-swarm-extension/` at ship)
> Generated: 2026-10-20T10:15:00Z (requesting-code-review)
> Diff range: `998c6ed..4a5a889`
> Rigor tier: T2 (per `_shared/planning/rigor-tiers.md`)
> Independence: Grade B per axis — see `## Independence`
>
> The durable audit record of the code review. **requesting-code-review** writes this into
> the spec folder, next to `report.md` (which owns the QA gate). It is committed in the spec
> zone before code-zone work continues. **ship** archives it with the folder; **reflect**
> cites it for lineage. The three review axes are reported **side by side, never merged** —
> that separation is the point.

## What Important means

- **Critical** — must fix before merge. Security, data loss, broken functionality, a
  `SATISFIES` scenario whose RED evidence is missing or whose code path does not match the
  Given/When/Then. Blocks `ship`.
- **Important** — should fix before merge. Architecture drift from a term or an in-force
  ADR, a hard standard breach, a missing or partial requirement, a behavior the spec never
  asked for (scope creep). Unfixed Important issues do not proceed (per the skill's
  Red Flags).
- **Minor** — nice to have. Baseline smells, style, optimization, doc polish. These are the
  nits; they are capped and summarized, never one-per-line below the fold.

## Cap the nits

- **Max 5 Minor findings listed per axis.** Beyond that, collapse the rest into a count:
  "N further Minor items (style/smells) — see the raw reviewer report, not this file."
- A Minor finding that is actually a Critical dressed as polish gets re-labeled, not
  capped. Capping is for true nits, not for hiding a real issue behind a count.

## Do not report

- Anything tooling already enforces (lint, typecheck, format).
- Informational context with no required action — `FYI` at most, one line, no cap count.

## Passes

### Standards

- **Worst issue (within this axis):** `swarm_wait` has no timeout — a wedged child (no settle, no exit) blocks the parent model turn indefinitely (security [Medium], corroborated by the standards test-gap finding on the unproven RPC-surface assumption).
- **Findings:** 0 Critical / 5 Important / 10 Minor (capped to 5 listed)
- **Verdict:** met-with-fixes

### Spec

- **Worst issue (within this axis):** none — all 13 BDD scenarios PASS with matching code paths; two partials flagged (list-mode `x` one-press vs the ticket's two-press confirm; door-check raw event sample lives in `pi-swarm-task-1-report.md` instead of report.md).
- **Findings:** 0 Critical / 0 Important / 2 Minor (partial items)
- **Verdict:** met

### Security

- **Worst issue (within this axis):** `swarm_wait` can block the parent model turn indefinitely when a child wedges (CWE-770, LLM06 Unbounded Consumption, ASI08 Cascading Failures).
- **Findings:** 0 Critical / 0 High / 1 Medium / 2 Low / 1 Info (supply-chain note)
- **Verdict:** secure-with-fixes

## Findings

### Critical

(none)

### Important

- [standards] `extensions/pi-swarm/src/{agents.ts:23, child.ts:104-106, child.spec.ts:24, manager.spec.ts:353, protocol.spec.ts:204}` — hard rule breach: "No comments in code unless asked" (AGENTS.md `### Rules`) — 5 comment sites in production + spec source — delete the comments; move the valuable `agent_end` behavior note to the extension README "How it works" (which already documents the fold).
- [standards] `extensions/pi-swarm/src/child.ts:34` — wrapper env rule drift: the diff *deletes* `PI_PACKAGE_DIR` for children, so a child reads `<project>/.pi/` while the parent reads `<project>/.skill-pi/` — one-directional deviation from ADR-0002 D2 "skill-pi never loads any `.pi` directory", undocumented and unlinked to any ADR — document the exception in the pi-swarm README "How it works" with the reasoning (children run with the isolated agent dir and no brand overlay), or set the child's project config dir to `.skill-pi` for symmetry.
- [standards] (test gap) `extensions/pi-swarm/src/child.ts` + `manager.ts` — the most load-bearing assumption (real `skill-pi --mode rpc` emits `agent_settled`/`message_end`/`tool_execution_*` and accepts `steer`/`follow_up`/`abort`) is verified only with fakes in the committed suite; the live door check (Task 1) and E2E run 3 (Task 10) prove it at session level, but no committed E2E test guards it — add one cheap committed probe (spawn real child, trivial prompt, assert settled snapshot within timeout, mirroring `test/rpc.test.js` style), or accept the session-level evidence and note it in the QA gate.
- [standards] `README.md:201-218` — scope creep / "keep changes minimal and scoped": the diff range adds an 18-line "Bundled npm extensions / mnemonic" section documenting `@devopstales/pi-mnemonic` and a wrapper `node_modules`-sync mechanism that belongs to the mnemonic change — **ruling (2026-10-20):** verified via `git show e3f47c8 -- README.md` (pi-swarm's Task 9 commit touches only the pi-swarm bullet) and `git log 998c6ed..HEAD -- README.md` (the mnemonic section came from `9f8207e`, a separate committed change interleaved on main within the range). NOT pi-swarm scope creep — parked as a range-construction note; the pi-swarm contribution is exactly one bullet, as tasked.
- [standards] `extensions/pi-swarm/src/{manager.ts, protocol.ts:31-33, ui/fleetview.ts:91, ui/dashboard.ts:130-133}` — Shotgun Surgery: `isSettled` (`status === "done" || "error" || "interrupted"`) re-implemented in four files; adding a status means editing four files — export `isSettled` from `domain.ts` (which already owns `SwarmStatus`) and use it everywhere.
- [security] `extensions/pi-swarm/src/manager.ts:184` (waitFor) + `src/child.ts:87,134-141` — `swarm_wait` has no timeout: `Promise.all` over `whenSettled` with no deadline; the abort timer is armed only on explicit cancel, is 5s, and is `unref()`-ed; `child.stdin.on("error")` swallows EPIPE so a dead stdin doesn't settle — a child that stops speaking JSONL without exiting blocks the parent model turn forever (child → parent trust boundary) — give `waitFor` a per-call deadline (or an inactivity watchdog) that force-settles the affected records as `error` and resolves.

### Minor

- [standards] `extensions/pi-swarm/src/ui/fleetview.ts:313-316` vs `31-43` — same `x` gesture cancels with no confirmation in list mode but requires two presses in the overlay; README documents two-press only for the overlay — unify to two-press or document the list-row behavior. (Also flagged by the spec axis as a partial against TICKET-05's "two-press confirm" scope.)
- [standards] `extensions/pi-swarm/src/{domain.ts:42 (SpawnRequest.inheritContext), index.ts:268,370 (void leaderArmed), child.ts:143-145 (public kill)}` — Speculative Generality: dead field, dead hook, test-only public method — delete or wire in.
- [standards] `extensions/pi-swarm/src/manager.ts:340-344` — the 5s bounded-abort path force-settles the *record* to `interrupted` but never actually signals the child process (`SwarmChild.kill` is test-only) — a child that ignores the abort RPC keeps running detached; the tool description/README promise "5s then SIGKILL" — wire `record.child.kill("SIGKILL")` into the timeout path.
- [standards] `extensions/pi-swarm/src/child.ts:121-137` — `tokens` hardcoded 0, `modelLabel` never set; the UI renders `0`/`default` and `swarm:usage` always carries zeros, but the README lists tokens as a feature — README should say tokens are not yet populated (v1 gap).
- [standards] `extensions/pi-swarm/src/manager.ts:317-319` — `deliver` is invoked synchronously from `onData` with no try/catch; a throwing `pi.sendMessage` surfaces as an unhandled rejection — wrap `this.opts.deliver(...)` in `rebalance` or guard the send. (Related: `+0` leftover in `prune()` at manager.ts:348; `swarm_wait` ignores `AbortSignal`; UI-level `void ...cancel(id)).catch(() => {})` swallows cancel failures — 3 further Minor items collapsed.)
- [security] `extensions/pi-swarm/src/jsonl.ts:11-21` + `src/child.ts:180` — unbounded accumulation: the JSONL decode buffer remainder is never size-checked (one giant line grows it without bound → parent OOM) and per-agent `transcript[]` has no line cap — cap the buffer at a high-water mark (e.g. 64KB) and cap transcript length (`shift()` past a max).
- [security] `extensions/pi-swarm/src/child.ts:32-37` — full parent `process.env` spread into every child env (model keys, cloud creds, `GIT_DIR`/`GIT_WORK_TREE`, `NODE_OPTIONS`, proxies) + shared agent dir and working tree — children are intentionally full agents in the same trust domain (documented "no worktree isolation" limitation), but the env spread makes the child's privilege exactly the parent's — build a minimal allowlisted env for the child (defense-in-depth).
- [spec] TICKET-05 partial — list-mode `x` is one-press while the ticket's scope says two-press confirm (scenario R-fleetview-stop still satisfied — the row shows stopped status) — reconcile in the same fix as the standards minor above.
- [spec] report.md documentation gap — the door-check raw event sample is referenced (`pi-swarm-task-1-report.md § Door Check`) rather than inlined under report.md `## Door Check` as blueprint Task 1 Step 6 asked — inline a representative sample or keep the reference with a note.
- FYI [standards] glossary drift — "FleetView", "agent type", "swarm/child", and the `swarm:rpc:*` channel names are new ubiquitous-language candidates not yet in the terms files; add a row or two at ship.
- FYI [security] supply chain — `typebox` is declared `"*"` in the extension `package.json` (matches plan-build/todo precedent and ADR-0007; root pins 1.3.27 while the extension lockfile resolves 1.4.2 — version drift in a schema-validation library); pin to the host version at publish time.

## Independence

| Axis | Grade | Rationale |
|------|-------|-----------|
| Standards | B | fresh subagent context, no session narrative passed; same model family / toolchain as the implementer |
| Spec | B | fresh subagent context, no session narrative passed; same model family / toolchain as the implementer |
| Security | B | fresh subagent context, no session narrative passed; same model family / toolchain as the implementer |

**Reading the grade:** **A** = fresh subagent, no shared history (independent). **B** = fresh
context but same model family / toolchain as the implementer (independent, weaker). **C** =
inline self-review or the implementer's verdict leaked in — **diagnostic only**, cannot stand
as the independent evidence that `ship` or a merge requires.

## Verdict

- **Standards:** met-with-fixes
- **Spec:** met
- **Security:** secure-with-fixes
- **Floor (decides):** met-with-fixes
- **Worst issue (across all three axes):** `swarm_wait` unbounded block on a wedged child (security Medium, standards test-gap corroboration).
- **Unfixed Important count (must be 0 to proceed):** 6 (0 standards-critical; 5 standards Important + 1 security-Medium-as-Important)

## Triage (2026-10-20)

| Finding | Bucket | Ruling |
|---|---|---|
| standards #1 (no-comments, 5 sites) | Fix now | unconditional AGENTS.md rule |
| standards #2 (PI_PACKAGE_DIR deletion undocumented) | Fix now | document the exception in the pi-swarm README "How it works" |
| standards #3 (no committed E2E for the RPC-surface assumption) | Human look | door check + E2E run 3 already prove it live (report.md); a committed probe risks the known 15s model-latency flake (`test/rpc.test.js`) in CI — user decision |
| standards #4 (README mnemonic section) | Parked (verified) | separate committed change interleaved on main, not pi-swarm scope — see finding text |
| standards #5 (isSettled ×4) | Fix now | one domain predicate, four re-implementations |
| security M1 (swarm_wait unbounded) | Fix now | the worst issue; a wedge kills the parent session |
| standards minor: list-mode `x` one-press (also spec partial) | Fix now | unify to two-press; spec's TICKET-05 scope said two-press |
| security L1 (JSONL buffer + transcript unbounded) | Fix now | cheap caps, real OOM path |
| standards minor: force-settle never kills the process | Fix now | the tool description promises SIGKILL; wire `child.kill("SIGKILL")` into the timeout path |
| standards minor: dead code (inheritContext, void leaderArmed, public kill) | Fix now | `kill` gets wired in by the SIGKILL fix; the other two are deletions |
| standards minor: deliver unguarded (unhandled rejection) | Fix now | one try/catch in rebalance |
| security L2 (full parent env spread to children) | Defer | v1 design is "children = full agents, same trust domain" (documented limitation); env allowlisting is a v2 hardening — log in tasks.md |
| standards minor: tokens/modelLabel always 0/default | Defer | v1 gap; README note now (cheap), populating usage data later — log in tasks.md |
| standards minor: swarm_wait ignores AbortSignal; UI cancel failures swallowed; `+0` in prune | Fix now (batched) | one-line each, same commit as adjacent fixes |
| spec minor: door-check sample not inlined in report.md | Fix now | inline the representative sample from the Task 1 report |
| FYI: glossary drift; typebox pin at publish | Defer | ship-time terms-file update; publish-time pin |

All deferred items are tracked in **TASK-20.11** (Backlog.md, child of TASK-20).

## Fix wave (2026-10-20)

All "Fix now" items landed in three commits (ae282d6, 535caca, 868103d):

- **isSettled dedup** — exported from `domain.ts`, used in manager/protocol/fleetview/dashboard
- **swarm_wait deadline** — `WAIT_TIMEOUT_MS` (300s default, constructor-overridable); deadline force-settles pending records to `error` "wait timed out" and resolves; also fires per-record agent listeners (found a second hang path: force-settle bypassed `onChildSnapshot`)
- **JSONL buffer high-water mark** (64KB remainder discard) + **transcript cap** (500 lines, drop-front)
- **kill on abort timeout** — the 5s bounded-abort now actually SIGKILLs the child process (the tool description's promise, now real)
- **list-mode `x`** unified to two-press confirm (spec partial closed)
- **no-comments rule** — zero `//` in extension source; the agent_end fold note moved to the README "How it works"
- **PI_PACKAGE_DIR exception** documented in the extension README
- **dead code** removed (inheritContext, void leaderArmed)
- **deliver guard** in rebalance; `+0` removed; `swarm_wait` wires pi 1.2.0's tool `signal` (exists as the 3rd execute arg — early-resolve on abort)
- **README** tokens/modelLabel v1-placeholder note; **report.md** door-check sample inlined

Verification after the wave: pi-swarm **169/169** (was 161, +8 regression tests), tsc clean, plan-build 55/55, comment scan zero.

**Unfixed Important count (must be 0 to proceed):** 0 — all Important items fixed or parked with a verified ruling (README mnemonic section = separate interleaved change; E2E probe = user ruling, session-level evidence stands, tracked in TASK-20.11).
