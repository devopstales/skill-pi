# pi-swarm Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skillgrid:subagent-execution (recommended) or skillgrid:simple-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PROPOSED

**Tier:** T2

**Classification:** standard

**Build shape:** Tracer thread (one live child round-trip through every layer —
tool → manager → RPC subprocess → settle → result delivery → TUI — works first,
then thickens with steering, FleetView, agent types, and the RPC protocol)

**Goal:** A bundled pi extension that spawns, tracks, steers, and inspects
parallel isolated child skill-pi agents, with a FleetView UI, an agent-target
prompt selector (`shift+tab`), and a versioned cross-extension RPC protocol.

**Architecture:** Children are `skill-pi --mode rpc` subprocesses (JSONL
commands on stdin, JSONL events on stdout — pi 1.2.0 `dist/modes/rpc/`), each
inheriting `PI_CODING_AGENT_DIR` so it is itself a fully isolated skill-pi
instance. An in-extension `SwarmManager` folds each child's event stream into
an immutable per-agent snapshot exposed through a synchronous read model (the
TUI renders synchronously and cannot await). Results are delivered deferred —
on parent idle — so a `swarm_wait` can consume them first. A `pi.events`-bus
RPC protocol lets other extensions spawn/steer/stop children.

**Tech Stack:** TypeScript (NodeNext, `.ts` extension imports — house pattern
from `extensions/todo/`), `typebox` + `@earendil-works/pi-ai` `StringEnum` for
tool schemas, `@earendil-works/pi-tui` components, `node:child_process` for
spawning, vitest. No new runtime dependencies beyond the root
`node_modules`.

**Spec:** `./briefing.md`

**Findings:** none (no research/prototype/sketch ran for this topic; the
reference implementations were read in-session — see briefing Sources)

## Hypothesis

**Claim:** skill-pi can drive isolated child agents as `--mode rpc`
subprocesses and fold their JSONL event streams into a live per-agent snapshot
that both tools and the TUI consume.
**Right condition:** a live `swarm_spawn` → child settle → deferred result
message triggering a follow-up turn in the parent (door check, Task 1).
**Wrong condition:** the child never settles (stream parsing dead-locks, the
session event carries no terminal marker, or settle never fires) or the child
is not isolated (it touches `~/.pi/agent` or the real project `.pi/`).
**Thinnest MVP:** Task 1 + the three tools of Task 2 (`swarm_spawn`,
`swarm_wait`, `swarm_list`) + deferred delivery.
**Door check:** Task 1. If the door check fails, STOP — the whole plan rests
on the RPC stream contract.

## Terms

- **Swarm** — the set of child agents tracked by one parent session. (New term;
  used in this plan and in user-visible copy.)
- **Agent type** — a `.skill-pi/agents/<name>.md` definition (frontmatter +
  system prompt) that a swarm child can be spawned with. (Sharpened from
  tintinweb's "custom agent types": same idea, our `.skill-pi` paths.)
- **Prompt target** — the selector state: which agent (or `build`/`plan`) the
  next submitted prompt goes to. (New term.)
- `agent dir`, `shim`, `extension` — per `.skillgrid/artifacts/` terms files.

## Must-Haves (goal-backward verification)

**Truths:**
- `swarm_spawn` returns an agent id immediately; the child runs as a
  `skill-pi --mode rpc` subprocess whose `PI_CODING_AGENT_DIR` equals the
  parent's — **backstop** (only a live run proves the subprocess + isolation;
  unit tests pin the argv/env, the door check proves the round-trip).
- A settled child's final text reaches the parent as a `swarm-result` message
  with `deliverAs: followUp, triggerTurn: true`, exactly once; a prior
  `swarm_wait` on that id suppresses the auto-delivery (consumed semantics).
- `swarm_send` on a running child writes an RPC `steer`; on a settled child it
  writes a `follow_up` that starts a new run.
- `swarm_cancel` sends RPC `abort`, waits up to 5s, then force-kills; the
  agent settles with `interrupted` status.
- `MAX_RUNNING` (default 4) extra `swarm_spawn`s are **queued**, not rejected;
  they start as running children settle. `MAX_TRACKED` (64) prunes the
  **least-recently-settled** settled agent first (LRU by `settledAt` ascending; never prunes a running/queued agent or one with active wait interest).
- `swarm_check` returns status/turns/≤2KB preview **without** consuming;
  `swarm_list` returns one describe line per tracked agent.
- With ≥1 running child and an empty prompt, `↓` enters the FleetView; `↑`
  (above `main`) or `Esc` returns; `Enter` on a child opens its live
  transcript; `x` aborts the selected child.
- The target selector shows `build` by default with no agent config; the
  `shift+tab` cycle is `build → plan (only if plan-build is loaded) → <agent
  types, load order> → build…`; submitting a prompt while an agent type is
  selected spawns that child and the text does NOT enter the main
  conversation.
- `swarm:rpc:spawn` from another extension spawns a child and replies with the
  agent id; `swarm:rpc:ping` replies with protocol version + counts; an
  unsupported protocol `v` gets a version-error reply with no side effect;
  `swarm:created` / `swarm:completed` / `swarm:usage` are emitted on the bus.
- Result truncation budgets: 24KB delivered result, 48KB total for
  `swarm_wait` output, 16KB per agent inside wait, 2KB/20-line `swarm_check`
  preview, 4KB error text.

**Artifacts:**
- `extensions/pi-swarm/src/domain.ts` — types, constants, budget/cap pure logic
- `extensions/pi-swarm/src/jsonl.ts` — JSONL line codec
- `extensions/pi-swarm/src/child.ts` — RPC subprocess lifecycle (spawn/steer/abort/settle)
- `extensions/pi-swarm/src/manager.ts` — SwarmManager (registry, caps, wait, deferred delivery)
- `extensions/pi-swarm/src/agents.ts` — agent-type discovery + frontmatter
- `extensions/pi-swarm/src/protocol.ts` — cross-extension RPC envelope + handlers
- `extensions/pi-swarm/src/target.ts` — prompt-target selector state
- `extensions/pi-swarm/src/format.ts` — elapsed/tokens/status formatting
- `extensions/pi-swarm/src/ui/fleetview.ts` — below-prompt fleet list + transcript overlay
- `extensions/pi-swarm/src/ui/dashboard.ts` — `/swarm` fullscreen list + takeover view
- `extensions/pi-swarm/index.ts` — tools, command, statusline, bus wiring, lifecycle
- `extensions/pi-swarm/{package.json,tsconfig.json,vitest.config.ts,README.md}` — house package scaffold (per `extensions/todo/package.json` shape, ADR 0005 name `@devopstales/pi-swarm`)
- `extensions/pi-swarm/src/*.spec.ts` — vitest suites per module
- `.skillgrid/specs/2026-10-16-pi-swarm-extension/acceptance.feature` — the 13 scenarios above (already written)

**Key links:**
- `index.ts` tool handlers must pass the parent's resolved
  `PI_CODING_AGENT_DIR` + skill-pi executable path into `child.ts` spawn (the
  isolation contract — a child without them is a stock-pi child).
- `manager.ts` deferred delivery must mark the agent consumed when
  `swarm_wait` resolves it, and the `swarm-result` renderer must read the
  snapshot, not the raw child stream.
- `target.ts` cycle list must be built from `agents.ts` discovery + a
  plan-build presence probe, so the selector never offers a target whose
  source does not resolve.
- `protocol.ts` handlers must route into the same `manager.ts` API the tools
  use (one code path for spawn/steer/stop — bus and tools are interchangeable).

**One-way-door decisions:**
- The cross-extension RPC protocol shape (`swarm:rpc:*` channel names,
  envelope `{v, reqId, type, payload}`, version `1`) — once another extension
  consumes it, renaming channels or changing the envelope breaks the
  contract. Tagged on Task 9.

## Global Constraints

- All new files under `extensions/pi-swarm/` (per `.skillgrid/artifacts/04-adr-0007-self-contained-extensions.md`).
- No new runtime dependency (per ADR 0007): runtime imports limited to
  `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`,
  `@earendil-works/pi-ai`, `typebox` — all already root `node_modules`.
- Never modify pi source (per ADR 0006); the child is driven exclusively
  through the `--mode rpc` CLI surface (verified: `dist/modes/rpc/rpc-types.d.ts`).
- Children must inherit `PI_CODING_AGENT_DIR` and never set `PI_PACKAGE_DIR`
  (per ASSUMPTIONS.md § VERIFIED — isolation is the product).
- No comments in code unless asked; minimal scoped changes.
- Commit per work unit; spec-zone artifacts (this folder, `state.yaml`)
  committed separately from code (work-unit-commits zone guard).
- Keybinding `shift+tab` is claimed by pi-swarm; plan-build keeps `alt+m`
  (its mode toggle) — the two are independent handles.
- Verification floor L2 (standard): full extension vitest + `tsc --noEmit` +
  root `node --test` unchanged green + one live door-check E2E recorded in
  `report.md`.

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Subprocess spawn (child process lifecycle) | Applicable — children are spawned pi instances with the user's credentials | argv/env built by a pure `buildChildInvocation()`; 5s bounded abort + SIGKILL fallback; child cwd = parent cwd (explicit, never inherited-by-accident) | `child.spec.ts`: fake child that ignores `abort` is force-killed within the bound; env contains `PI_CODING_AGENT_DIR` and never `PI_PACKAGE_DIR` |
| Version-control automation | N/A — v1 children run in the parent cwd; no worktree/branch/merge lifecycle (out of scope per briefing) | — | — |
| Shell command execution | N/A — the child *is* pi; no shell commands are constructed by pi-swarm | — | — |
| Routing | N/A — no HTTP server in v1 (monotyka's harness server is deliberately not adopted; bus + stdin/stdout only) | — | — |
| Executable-file classification | N/A — no downloaded/interpreted binaries | — | — |
| Process integration | Applicable — JSONL over the child's stdio is an untrusted-by-structure stream: a child crash, partial line, or malformed JSON must not take down the parent | codec (`jsonl.ts`) returns `undefined` for partial/invalid lines instead of throwing; child `error`/`close` events settle the agent as `error`; a settled agent's dead stream is ignored | `jsonl.spec.ts`: partial line + invalid JSON + complete line interleave; `child.spec.ts`: child that emits garbage then exits settles `error` |

## File Structure

- `extensions/pi-swarm/package.json` — new; house package (`@devopstales/pi-swarm`, ADR 0005), scripts `check`/`test`, peerDeps on pi packages, devDeps vitest/typescript/@types/node (copy `extensions/todo/package.json` shape)
- `extensions/pi-swarm/tsconfig.json` — new; copy `extensions/todo/tsconfig.json`
- `extensions/pi-swarm/vitest.config.ts` — new; default config with `include: ["src/**/*.spec.ts"]` (todo has no vitest config file to copy — verified)
- `extensions/pi-swarm/src/domain.ts` — new; all shared types + constants (pure)
- `extensions/pi-swarm/src/jsonl.ts` — new; line codec (pure)
- `extensions/pi-swarm/src/child.ts` — new; `SwarmChild` lifecycle
- `extensions/pi-swarm/src/child.spec.ts` — new
- `extensions/pi-swarm/src/manager.ts` — new; `SwarmManager`
- `extensions/pi-swarm/src/manager.spec.ts` — new (uses a fake child adapter)
- `extensions/pi-swarm/src/agents.ts` — new; agent-type discovery (pure fs + frontmatter)
- `extensions/pi-swarm/src/agents.spec.ts` — new
- `extensions/pi-swarm/src/protocol.ts` — new; RPC envelope + handler wiring
- `extensions/pi-swarm/src/protocol.spec.ts` — new
- `extensions/pi-swarm/src/target.ts` — new; selector state (pure)
- `extensions/pi-swarm/src/target.spec.ts` — new
- `extensions/pi-swarm/src/format.ts` — new; pure formatting
- `extensions/pi-swarm/src/format.spec.ts` — new
- `extensions/pi-swarm/src/jsonl.spec.ts` — new
- `extensions/pi-swarm/src/ui/fleetview.ts` — new
- `extensions/pi-swarm/src/ui/dashboard.ts` — new
- `extensions/pi-swarm/index.ts` — new; extension factory
- `extensions/pi-swarm/README.md` — new; house style (per `extensions/todo/README.md`)
- `extensions/plan-build/index.ts` — modified (one additive line: emit `swarm:plan-present` on session start — the only edit outside `extensions/pi-swarm/`, committed as its own work unit per Task 7 Step 3)
- `.skillgrid/state.yaml` — modified; `current_change` → `2026-10-16-pi-swarm-extension`, phase `blueprint`

## Types & Constants (single source — every task references these names)

Defined in `src/domain.ts` (Task 1). Later tasks MUST use exactly these names.

```ts
export const MAX_RUNNING = 4;
export const MAX_TRACKED = 64;
export const ABORT_TIMEOUT_MS = 5000;
export const RESULT_BUDGET = 24 * 1024;
export const WAIT_BUDGET_TOTAL = 48 * 1024;
export const WAIT_BUDGET_PER_AGENT = 16 * 1024;
export const CHECK_BUDGET = 2 * 1024;
export const CHECK_MAX_LINES = 20;
export const ERROR_TEXT_BUDGET = 4 * 1024;
export const PROTOCOL_VERSION = 1;
export const RESULT_CUSTOM_TYPE = "swarm-result";

export type SwarmStatus = "queued" | "running" | "done" | "error" | "interrupted";

export interface AgentSnapshot {
  id: string;
  title: string;
  agentType: string;
  status: SwarmStatus;
  createdAt: number;
  settledAt?: number;
  errorText?: string;
  modelLabel?: string;
  turns: number;
  tokens: number;
  finalText: string;
  latestText: string;
  consumed: boolean;
  transcript: readonly TranscriptLine[];
}

export interface TranscriptLine {
  kind: "user" | "assistant" | "tool" | "error";
  text: string;
}

export interface SpawnRequest {
  prompt: string;
  title?: string;
  agentType?: string;
  model?: string;
  inheritContext?: boolean;
}

export interface SwarmChildHandle {
  readonly id: string;
  readonly snapshot: AgentSnapshot;
  send(text: string): void;
  abort(): Promise<void>;
  onSnapshot(listener: (s: AgentSnapshot) => void): () => void;
}
```

Child event names (folded from the child's stdout JSONL; exact event `type`
values confirmed against pi 1.2.0 during Task 1 door check — the fold is
deliberately tolerant: unknown event types are ignored, terminal detection is
`agent_end`/`agent_settled` event OR process exit):

```ts
// src/child.ts — the events the fold must recognize (from rpc-mode.js):
//   "agent_start" | "agent_end" | "agent_settled"
//   "message_start" | "message_update" | "message_end"
//   "tool_execution_start" | "tool_execution_update" | "tool_execution_end"
```

## Rollback Plan

v1 is additive: deleting `extensions/pi-swarm/` removes the extension
(ADR 0001 discovery picks up subdirectory `index.ts` files — nothing else
references it). No data migration exists (v1 keeps no on-disk swarm state;
child sessions land in the normal agent-dir sessions store). The one durable
state is the per-project target selection (decided: kept in-memory, session
only — no file, per the briefing's "no agent config" default; see Task 6).
Rollback = `git revert` the change's commits; no cleanup step.

## Success Criteria (measurable)

- `cd extensions/pi-swarm && npx vitest run` → 100% pass, ≥ 40 tests.
- `npx tsc --noEmit -p .` → 0 errors.
- Root `node --test "test/**/*.test.js"` → unchanged pass count, 0 new fails.
- Door check (Task 1) → a live child round-trips: spawn → settle → result
  delivered; evidence pasted into `report.md`.
- L2 verification green at QA gate (per `_shared/rules/verification-ladder.md`).

---

### Task 1: Door check — one live child round-trips (hypothesis test)

> **Door check:** this is the hypothesis test. If the child does not settle
> with a usable final text, STOP — the plan rests on the RPC stream contract.

**Files:**
- Create: `extensions/pi-swarm/src/domain.ts`
- Create: `extensions/pi-swarm/src/jsonl.ts`
- Create: `extensions/pi-swarm/src/jsonl.spec.ts`
- Create: `extensions/pi-swarm/src/child.ts`
- Create: `extensions/pi-swarm/src/child.spec.ts`
- Create: scratch dir under `/private/var/folders/g1/c0fkk4s12mv4rqxrypxlndqc0000gq/T/opencode/pi-swarm-door/`

**Interfaces:**
- Consumes: `bin/skill-pi.js` (wrapper CLI, already committed)
- Produces: `buildChildInvocation(cwd, agentDir): { argv: string[], env: NodeJS.ProcessEnv }`, `decodeJsonlLine(line: string): unknown | undefined`, `decodeJsonlBuffer(buffer: string): { events: unknown[], remainder: string }`, the `domain.ts` types above
- Seam: `child.ts` spawns via `node:child_process.spawn` — the seam is `buildChildInvocation` (pure, testable without a live pi) + the event fold
- Deletion test: without `domain.ts`/`jsonl.ts`, Tasks 2-10 each re-derive constants and re-parse stdio — the whole plan reappears in every task
- Adapters: 2 (real `spawn` in `child.ts`; fake child process in `child.spec.ts`) — justifies the seam

**SATISFIES:** R-core-spawn-wait

- [ ] **Step 1: Write `domain.ts`** (types + constants exactly as in the "Types & Constants" section above — no additions, no renames)

- [ ] **Step 2: Write the failing `jsonl.spec.ts`**

```ts
import { describe, it, expect } from "vitest";
import { decodeJsonlLine, decodeJsonlBuffer } from "./jsonl.ts";

describe("jsonl", () => {
  it("decodes a complete line", () => {
    expect(decodeJsonlLine('{"type":"agent_start"}\n')).toEqual({ type: "agent_start" });
  });
  it("returns undefined for invalid json and empty lines", () => {
    expect(decodeJsonlLine("not json\n")).toBeUndefined();
    expect(decodeJsonlLine("\n")).toBeUndefined();
  });
  it("buffers partial lines across chunks", () => {
    const a = decodeJsonlBuffer('{"type":"agent_s');
    expect(a.events).toEqual([]);
    expect(a.remainder).toBe('{"type":"agent_s');
    const b = decodeJsonlBuffer(a.remainder + 'tart"}\n{"type":"agent_end"}');
    expect(b.events).toEqual([{ type: "agent_start" }]);
    expect(b.remainder).toBe('{"type":"agent_end"}');
  });
});
```

- [ ] **Step 3: Write the failing `child.spec.ts`** (fake child via a `spawn` factory param)

`child.ts` shape (write after seeing RED):

```ts
export interface SpawnFn { (options: SpawnOptions): ChildProcess }
export function buildChildInvocation(cwd: string, agentDir: string): { argv: string[]; env: NodeJS.ProcessEnv }
export class SwarmChild {
  static async spawn(invocation: { argv: string[]; env: NodeJS.ProcessEnv }, cwd: string, spawnFn?: SpawnFn): Promise<SwarmChild>
  // implements SwarmChildHandle; fold: agent_start -> running;
  // message_end -> append assistant TranscriptLine, turns++;
  // tool_execution_* -> append tool TranscriptLine;
  // agent_end/agent_settled or process close -> settle (done | error | interrupted);
  // send(text) -> writes {"type":"steer"|"follow_up","message":text}\n to stdin (steer while running, follow_up after settle);
  // abort() -> writes {"type":"abort"}\n, resolves on settle; caller bounds with ABORT_TIMEOUT_MS then SIGKILL.
}
```

Cover at minimum:
- the `cwd` argument to `buildChildInvocation` and the `cwd` option to `spawn()` must be the same value (assert in a test — a mismatch would make the child see two different project roots)
- `buildChildInvocation` argv is `[skill-pi-exe, "--mode", "rpc", cwd]` shape (exact argv verified in the door check and pinned here) and env has `PI_CODING_AGENT_DIR` set to the given agentDir, no `PI_PACKAGE_DIR` key.
- Fake child that emits `agent_start` then `agent_end` with final text → `onSnapshot` observes `running` then `done`, `finalText` is the text, `turns` ≥ 1.
- Fake child that emits garbage lines then exits 1 → settles `error`, `errorText` bounded to `ERROR_TEXT_BUDGET`.
- Fake child that ignores `abort` → `abort()` resolves only via the SIGKILL path (test with a short injected timeout).
- `send()` while running writes a line containing `"steer"`; `send()` after settle writes `"follow_up"`.

- [ ] **Step 4: Run RED**

```bash
cd /Users/paladm/git/ai-test/skill-pi/extensions/pi-swarm && npx vitest run
```
Expected: both spec files fail (modules not implemented).

- [ ] **Step 5: Implement `jsonl.ts` and `child.ts`** minimally to GREEN.

- [ ] **Step 6: Live door check**

RPC mode has no `--print`: the prompt arrives as a JSONL `{"type":"prompt","message":…}` command on stdin (verified: `dist/modes/rpc/rpc-types.d.ts`). Drive it with a 10s-timeout node one-liner:

```bash
DOOR=$(mktemp -d /private/var/folders/g1/c0fkk4s12mv4rqxrypxlndqc0000gq/T/opencode/pi-swarm-door.XXXXXX)
node --input-type=module -e '
import { spawn } from "node:child_process";
const c = spawn("node", ["/Users/paladm/git/ai-test/skill-pi/bin/skill-pi.js", "--mode", "rpc", process.cwd()], { cwd: process.argv[1], stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
c.stdout.on("data", (d) => { buf += d; for (const line of buf.split("\n")) if (line.trim()) console.log(line); buf = buf.slice(0, buf.lastIndexOf("\n") + 1); });
const t = setTimeout(() => { c.kill("SIGKILL"); console.error("DOOR_TIMEOUT"); process.exit(2); }, 120000);
c.stdin.write(JSON.stringify({ type: "prompt", message: "Reply with exactly: SWARM_DOOR_OK" }) + "\n");
c.on("close", (code) => { clearTimeout(t); console.error("exit", code); process.exit(code ?? 0); });
' "$DOOR"
```
Expected: JSONL on stdout includes an assistant message containing `SWARM_DOOR_OK` and a terminal agent event; exit 0. **Record the exact event `type` values seen** (paste a representative sample into `report.md` under `## Door Check`) — the Task 1 fold must match them; if terminal detection is different from `agent_end`/`agent_settled`, fix the fold here and re-run `npx vitest run`.
Also verify isolation: `~/.pi/agent` mtime unchanged during the run (check before/after with `stat`).

- [ ] **Step 7: Commit**

```bash
git add extensions/pi-swarm/src/domain.ts extensions/pi-swarm/src/jsonl.ts extensions/pi-swarm/src/jsonl.spec.ts extensions/pi-swarm/src/child.ts extensions/pi-swarm/src/child.spec.ts
git commit -m "feat(pi-swarm): rpc child lifecycle + jsonl codec (door check)

[skillgrid-context]
Change: 2026-10-16-pi-swarm-extension
Task: 1
Decisions: children are --mode rpc subprocesses inheriting PI_CODING_AGENT_DIR; tolerant event fold (unknown events ignored)
Remaining: manager + tools (Task 2) through RPC protocol (Task 9)"
```

### Task 2: SwarmManager + core tools (spawn/wait/list) + deferred result delivery

**Files:**
- Create: `extensions/pi-swarm/src/manager.ts`
- Create: `extensions/pi-swarm/src/manager.spec.ts`
- Create: `extensions/pi-swarm/index.ts`
- Modify: (none outside `extensions/pi-swarm/`)

**Interfaces:**
- Consumes: Task 1 — `SwarmChild`, `buildChildInvocation`, `AgentSnapshot`, `SpawnRequest`, `MAX_RUNNING`, `MAX_TRACKED`, budgets
- Produces: `class SwarmManager { constructor(opts: { cwd: string; agentDir: string; deliver: (agentId: string) => void; maxRunning?: number; maxTracked?: number }) }` with `spawn(req: SpawnRequest): AgentSnapshot` (queued agents come back as a snapshot with `status: "queued"` — the same shape, so callers never branch on a union), `waitFor(ids: string[]): Promise<AgentSnapshot[]>`, `list(): readonly AgentSnapshot[]`, `get(id: string): AgentSnapshot | undefined`, `send(id: string, text: string): void`, `cancel(id: string): Promise<void>`, `check(id: string): AgentSnapshot`, `disposeAll(): Promise<void>`, `subscribe(listener: () => void): () => void`, `subscribeTo(id: string, listener: (s: AgentSnapshot) => void): () => void`
- Seam: `manager.spec.ts` injects a fake `SwarmChildHandle` factory (no live child) — the manager is fully testable in-process
- Deletion test: without the manager, each tool handler re-implements caps/queue/consumed/LRU and the deferred-delivery buffer
- Adapters: 2 (real child factory in `index.ts`; fake in spec)

**SATISFIES:** R-core-spawn-wait, R-child-cap

- [ ] **Step 1: Write the failing `manager.spec.ts`**

Cover at minimum (fake child factory yields scripted settles via a `settle(agentId, outcome)` test helper):
- `spawn` returns a snapshot with `status: "running"` immediately; ids are unique `sa-1`, `sa-2`, …
- 5th concurrent spawn (with 4 running fakes) → snapshot `status: "queued"`; when one fake settles, the queued one flips to `running` (subscribe fires)
- `waitFor([id])` resolves when the fake settles; after waitFor, `consumed === true` and the `deliver` callback is NOT called for that agent
- unconsumed settle → `deliver(agentId)` called once (deferred: `deliver` is the extension's flush-on-idle hook; the manager only invokes it at settle time when `consumed === false`)
- `cancel(id)` on a fake that ignores abort → resolves within the injected bound; snapshot `status: "interrupted"`
- LRU: with `MAX_TRACKED` faked small (constructor opts accept overrides for tests: `maxRunning?`, `maxTracked?`), the oldest settled agent is pruned (no longer in `list()`)
- `check(id)` does not set `consumed`

- [ ] **Step 2: Run RED** (`npx vitest run` in the extension dir — manager.spec fails)

- [ ] **Step 3: Implement `manager.ts`**

Key rules:
- Sync reserve-before-yield for `MAX_RUNNING` (same race rationale as the davis design): increment the running counter in `spawn()` before any `await`; release on settle.
- Snapshot store: plain mutable map + listener set (the synchronous read model — TUI reads without awaiting).
- `waitFor` keeps a wait-interest refcount per id; settle during an active wait marks `consumed`.
- Truncation helpers live here: `truncate(text, budget)` appends `\n[truncated: N more bytes]` — used by result delivery (24KB), wait output, check preview. Wait budget rule: per-agent budget starts at `WAIT_BUDGET_PER_AGENT` (16KB); if `ids.length × 16KB > WAIT_BUDGET_TOTAL` (48KB), the per-agent budget is reduced proportionally (`floor(48KB / ids.length)`) so the total never exceeds 48KB. Check preview: truncate `latestText` to ≤2KB **and** ≤20 lines (whichever hits first).

- [ ] **Step 4: Wire `index.ts`** — extension factory:
  - `pi.registerTool` for `swarm_spawn` (params: `prompt` string required, `title` optional, `agent_type` optional, `model` optional; background is always on in v1 — the tool returns the id; description explains fire-and-forget + that children are isolated), `swarm_wait` (params: `ids` string array, max 64; blocks, streams `Waiting for …` via `onUpdate`), `swarm_list` (no params; one describe line per agent: `sa-N [status] "title" (agentType, model, tokens, elapsed)`)
  - `deliver` callback: `pi.sendMessage({ customType: "swarm-result", content: <truncated body + transcript pointer>, details: { id, title, status } }, { deliverAs: "followUp", triggerTurn: true })` — body = `finalText` when non-empty, else the last assistant transcript line, else a status line (`sa-N finished with no text output`), so a child whose last message was a tool call still delivers something meaningful
  - `pi.registerMessageRenderer("swarm-result", ...)` — status glyph + bold header `swarm sa-N · title · finished/failed`, collapsed = first 8 lines + `(ctrl+o to expand)`, expanded = full text
  - `pi.on("session_shutdown", (ev) => …)` → `manager.disposeAll()` **only when `ev.reason === "quit"`** (verified `SessionShutdownEvent.reason: "quit" | "reload" | "new" | "resume" | "fork"` — session replacement must not kill running children); the manager is also keyed by session id so a replacement session starts clean
  - Read `SKILL_PI_SWARM_MAX` (int, default `MAX_RUNNING`) at extension load and pass it as the manager's `maxRunning` constructor option; `SKILL_PI_SWARM` on/off gate (`0`/`false`/`off` disables the whole extension, mirroring `SKILL_PI_TODO`)
  - Resolve `agentDir` via `getAgentDir()` from `@earendil-works/pi-coding-agent`; resolve the skill-pi executable path with the verified wrapper mechanism (`bin/skill-pi.js:11`): `path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "skill-pi.js")` — `index.ts` sits in `extensions/pi-swarm/`, one level above `bin/` is the package root. If that file does not exist (standalone install via stock `pi install`), fall back to `process.argv[1]` when it ends in `skill-pi.js`, else fail the spawn with a clear tool error naming the missing binary

- [ ] **Step 5: GREEN**

```bash
cd /Users/paladm/git/ai-test/skill-pi/extensions/pi-swarm && npx vitest run && npx tsc --noEmit -p .
```
(paste the vitest config if the scaffold step below hasn't run — it has: scaffold `package.json`/`tsconfig.json`/`vitest.config.ts` copying `extensions/todo/` shapes in the same commit)

- [ ] **Step 6: Commit**

```bash
git add extensions/pi-swarm/
git commit -m "feat(pi-swarm): swarm manager + spawn/wait/list tools + deferred result delivery

[skillgrid-context]
Change: 2026-10-16-pi-swarm-extension
Task: 2
Decisions: queued-not-rejected over MAX_RUNNING; consumed semantics shared by swarm_wait and auto-delivery
Remaining: check/send/cancel tools (Task 3), FleetView (Task 4-5), agent types + target selector (Task 6-7), RPC protocol (Task 8-9)"
```

### Task 3: Control tools — `swarm_check`, `swarm_send`, `swarm_cancel` + statusline

**Files:**
- Modify: `extensions/pi-swarm/index.ts` (register 3 more tools, statusline)
- Modify: `extensions/pi-swarm/src/manager.spec.ts` (cancel/check/send cases not yet covered)

**Interfaces:**
- Consumes: Task 2 — `SwarmManager.check/send/cancel/list`
- Produces: tool registrations + `ctx.ui.setStatus("swarm", …)` segment (`swarm: 2 running · 1 done · 1 queued · /swarm`)
- Seam: same as Task 2 (manager API)
- Deletion test: tool handlers without the manager re-derive status line + id lookup
- Adapters: 2 (unchanged)

**SATISFIES:** R-check-and-list, R-send-steers, R-cancel-aborts

- [ ] **Step 1: Extend `manager.spec.ts`** with: `send` while running → fake child's `send` called (steer path); `send` after settle → follow_up path; `check` returns preview bounded to `CHECK_BUDGET` and `CHECK_MAX_LINES` (≤2KB AND ≤20 lines, whichever hits first) and leaves `consumed` false; `cancel(id)` on a `queued` agent → removed from the queue, the next queued agent is promoted to `running` (subscribe fires).
- [ ] **Step 2: RED** (`npx vitest run`)
- [ ] **Step 3: Register tools in `index.ts`:** `swarm_check` (param `id`; returns status line + turns + ≤2KB/20-line preview; errors with the known-id list on unknown id), `swarm_send` (params `id`, `text`; steer/follow_up via manager), `swarm_cancel` (param `id`; bounded abort, reports per-id outcome incl. `was already <status>`)
- [ ] **Step 4: Statusline** — `ctx.ui.setStatus("swarm", …)` driven by `manager.subscribe`; cleared when no agents.
- [ ] **Step 5: GREEN** (`npx vitest run && npx tsc --noEmit -p .`)
- [ ] **Step 6: Commit** (`feat(pi-swarm): check/send/cancel tools + swarm statusline`, same `[skillgrid-context]` block, Task 3)

### Task 4: FleetView — below-prompt list

**Files:**
- Create: `extensions/pi-swarm/src/format.ts`
- Create: `extensions/pi-swarm/src/format.spec.ts`
- Create: `extensions/pi-swarm/src/ui/fleetview.ts`
- Modify: `extensions/pi-swarm/index.ts` (mount FleetView, keybinding)

**Interfaces:**
- Consumes: Task 2 — `manager.list/subscribe/get/cancel`
- Produces: `formatElapsed(ms: number): string`, `formatTokens(n: number): string`, `formatAgentRow(s: AgentSnapshot): string`, `createFleetView(readModel: { list(): readonly AgentSnapshot[]; get(id: string): AgentSnapshot | undefined; cancel(id: string): void; subscribe(l: () => void): () => void }): Component` (a pi-tui `Component` per the todo extension's card pattern — `render(width)`/input handling, synced from the read model, throttled re-render on stream updates)
- Seam: the read-model object (same sync store the manager exposes) — the FleetView is a pure function of it
- Deletion test: without FleetView the running swarm is only visible via `/swarm` (built in Task 5) — the always-on glance is lost
- Adapters: 2 (manager read model in prod; stub in `fleetview.spec.ts`)

**SATISFIES:** R-fleetview-visible

- [ ] **Step 1: Write failing `format.spec.ts`** — `formatElapsed(61_000)` → `"1m01s"`; `formatElapsed(59_000)` → `"59s"`; `formatTokens(12_400)` → `"12.4k"`; `formatAgentRow` includes status glyph (`⠹` running / `✓` done / `✗` error / `■` interrupted / `…` queued), title truncated to fit, model label, tokens, elapsed.
- [ ] **Step 2: RED**
- [ ] **Step 3: Implement `format.ts`, then `fleetview.ts`:** rows `main` + one per agent (earliest-launched first); selection marker `❯` on selected, dim otherwise; hint row `esc to return · enter to open · x to stop`.
- [ ] **Step 4: Mount + keybinding in `index.ts`:** FleetView renders below the prompt via `ctx.ui.setWidget` with placement `belowEditor` (verified: `WidgetPlacement = "aboveEditor" | "belowEditor"` in pi 1.2.0); `shift+tab` is NOT claimed here (that is Task 7's target key) — FleetView navigation keys are active only at an **empty prompt**: `↓`/`←` enter, `↑`/`↓` move, `Esc`/`↑`-above-main return, `Enter` open (Task 5), `x` stop.
- [ ] **Step 5: GREEN**
- [ ] **Step 6: Commit** (`feat(pi-swarm): fleetview list + formatting`, Task 4)

### Task 5: FleetView — live transcript overlay + stop

**Files:**
- Modify: `extensions/pi-swarm/src/ui/fleetview.ts` (overlay state)
- Modify: `extensions/pi-swarm/src/ui/fleetview.spec.ts` (create this spec in Task 4's commit if not created there — it exists from Task 4 Step 4's stub; extend it)

**Interfaces:**
- Consumes: Task 2 — `manager.subscribe` per-agent snapshot listener (add `subscribeTo(id, l)` to the read model if not already present — it is: `SwarmChildHandle.onSnapshot`, aggregated by the manager)
- Produces: overlay mode inside the same `Component` — renders the selected agent's `transcript` (sanitized: strip ANSI, truncate tool lines to one) + auto-follow with scroll-up-to-pause; `x` → `cancel(id)` (two-press confirm)
- Seam: same read model
- Deletion test: child output is only reachable via `/swarm` after this
- Adapters: 2 (unchanged)

**SATISFIES:** R-fleetview-open-transcript, R-fleetview-stop

- [ ] **Step 1: Extend `fleetview.spec.ts`** — selecting a running agent with N transcript lines renders them; a new snapshot with N+1 lines re-renders with the extra line (auto-follow); `x` twice → `cancel` called with the id; `x` once → not called.
- [ ] **Step 2: RED**
- [ ] **Step 3: Implement overlay** — reuse todo-card chrome (`cardTop`/`cardBottom` from `../skill-pi-tui/src/card.ts` — verified location — if that module is importable, else a plain bordered component); 50ms render throttle on streaming snapshots (the davis design's proven cadence).
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Commit** (`feat(pi-swarm): fleetview transcript overlay + stop`, Task 5)

### Task 6: Agent types — discovery + frontmatter

**Files:**
- Create: `extensions/pi-swarm/src/agents.ts`
- Create: `extensions/pi-swarm/src/agents.spec.ts`

**Interfaces:**
- Consumes: `node:fs` (real, tmp dirs in tests)
- Produces: `interface AgentType { name: string; description: string; model?: string; maxTurns?: number; systemPrompt: string; source: "project" | "global" }`, `discoverAgentTypes(projectDir: string, agentDir: string): AgentType[]` (reads `<projectDir>/.skill-pi/agents/*.md` then `<agentDir>/agents/*.md`; project wins on name clash; unparseable files skipped with a console warn), `resolveAgentType(types: AgentType[], name: string): AgentType | undefined`
- Seam: the two directory roots are parameters — prod passes the shim-resolved project dir + `getAgentDir()`
- Deletion test: target selector (Task 7) and `swarm_spawn` `agent_type` validation re-scan the filesystem on every call
- Adapters: 2 (real fs in `index.ts`; tmp-dir fs in spec)

**Frontmatter format** (YAML, parsed with pi's `parseFrontmatter` (exported by `@earendil-works/pi-coding-agent`); fields are flat strings/numbers only):
```
---
description: Security Code Reviewer
model: anthropic/claude-opus-4-6
max_turns: 30
---
You are a security auditor. Review code for vulnerabilities…
```
`name` = frontmatter `name:` if present, else the filename without `.md`.

**SATISFIES:** R-agent-types-discovered

- [ ] **Step 1: Write failing `agents.spec.ts`** — tmp project dir + tmp agent dir: project-only file → discovered `source: "project"`; global-only → `source: "global"`; same name in both → project wins; `max_turns: 30` → `maxTurns: 30`; frontmatter `name:` overrides filename; a file with broken frontmatter (unterminated `---`) is skipped and a warn is emitted (spy on `console.warn`); systemPrompt = the markdown body trimmed.
- [ ] **Step 2: RED**
- [ ] **Step 3: Implement `agents.ts`**
- [ ] **Step 4: GREEN**
- [ ] **Step 5: Wire into `index.ts`** — `swarm_spawn` with `agent_type`: resolve via `resolveAgentType`; unknown → tool error listing known names; resolved → the agent's `systemPrompt` is prepended to the prompt text with a `## Agent instructions` marker, followed by a blank line and the user's prompt (decided: pi 1.2.0's CLI has no `--append-system-prompt` flag — verified in `dist/cli/args.js`; the only CLI option is `--system-prompt`, which would replace the child's default system prompt and break its tool guidance, so prompt-prefixing is the ADR 0006-safe mechanism).
- [ ] **Step 6: Commit** (`feat(pi-swarm): agent type discovery (.skill-pi/agents frontmatter)`, Task 6)

### Task 7: Prompt-target selector — `shift+tab` + build/plan/agent cycle

> **Decision note (owed-decision resolved in planning):** target selection is
> **session-scoped, in-memory only** — no config file. The default `build`
> with "no agent config" (briefing) means a fresh session always starts at
> `build`; persisting the last target across sessions would silently change
> prompt behavior and contradict the default. Revisit if the user asks.

**Files:**
- Create: `extensions/pi-swarm/src/target.ts`
- Create: `extensions/pi-swarm/src/target.spec.ts`
- Modify: `extensions/pi-swarm/index.ts` (keybinding, input interception, selector display)

**Interfaces:**
- Consumes: Task 6 — `AgentType[]` (the discovered set, re-discovered on session start and after `session_info_changed`); plan-build presence probe (see Step 3)
- Produces: `type TargetId = "build" | "plan" | (string & {})`, `interface TargetSelector { current(): TargetId; cycle(): TargetId; cycleList(): readonly TargetId[]; matchesAgent(id: TargetId): AgentType | undefined }`, `createTargetSelector(opts: { agents: readonly AgentType[]; planAvailable: boolean }): TargetSelector`
- Seam: `planAvailable` is a boolean param — prod determines it (Step 3), tests inject it
- Deletion test: the cycle logic, the plan-build probe, and the input-interception decision reappear in `index.ts`
- Adapters: 2 (real probe in prod; injected bool in spec)

**SATISFIES:** R-target-default-build, R-target-cycle, R-target-spawns

- [ ] **Step 1: Write failing `target.spec.ts`** — `createTargetSelector({ agents: [], planAvailable: false })` → `cycleList()` = `["build"]`, `current()` = `"build"`; with `{ agents: [auditor, explorer], planAvailable: true }` → `["build", "plan", "auditor", "explorer"]`; `cycle()` four times returns to `build`; `matchesAgent("auditor")` → the auditor `AgentType`, `matchesAgent("build")` → undefined.
- [ ] **Step 2: RED**
- [ ] **Step 3: Implement `target.ts` + the plan-build presence probe in `index.ts` (decided mechanism — no runtime fallback chain):** v1 detection = the `swarm:plan-present` bus event, **evaluated lazily**: the cycle list is recomputed on every `shift+tab` press (not cached at session start), so whichever extension's `session_start` handler runs first, the event is observed by the first user keypress; OR env `SKILL_PI_PLAN_BUILD=1` (primary override for testing). The plan-build extension emits `swarm:plan-present` once on session start via `pi.events.emit` (one additive line in plan-build's `index.ts` — that is the ONLY plan-build edit in this whole change; commit it as its own work unit `feat(plan-build): emit swarm:plan-present on session start` so the two extensions stay independently revertable). Until plan-build is patched (or the env var is set), `plan` is simply absent from the cycle — which exactly matches the briefing ("when plan mode is installed add that too" = the event is observed). Record the actual observed behavior in `report.md`.
- [ ] **Step 4: Keybinding + display in `index.ts`:** claim `shift+tab` (pi keybinding registration per the todo extension's `SKILL_PI_TODO_KEY` pattern — it reads a keybinding config string and registers it; mirror that: `SKILL_PI_SWARM_TARGET_KEY`, default `shift+tab`, `off` disables). Display: `ctx.ui.setStatus("swarm-target", "⌁ " + current)` — a statusline segment, color: dim for `build`, accent for `plan`, agent color from the frontmatter `color:` field if present (else theme primary). **Keybinding note (verified):** pi 1.2.0's default `shift+tab` binding is `app.thinking.cycle` (`dist/core/keybindings.d.ts`) — claiming `shift+tab` via `registerShortcut` overrides it for this session, so cycling targets no longer cycles the thinking level; document that in the README and keep `SKILL_PI_SWARM_TARGET_KEY` as the user's escape hatch (set it to `off` to restore the thinking cycle).
- [ ] **Step 5: Input interception in `index.ts`:** `pi.on("input", (ev) => …)` — if `ev.source === "interactive"` and `current()` is an agent target and `ev.text` is non-empty and the FleetView is NOT in overlay mode (a child's steer/follow_up must not re-enter the interception — verified: steer/follow_up calls also emit `input` events) → `manager.spawn({ prompt: ev.text, agentType: current() })`, show `ctx.ui.notify("spawned sa-N: <title>")` (use the `notify` from the verified `ExtensionUIContext` surface — `select | confirm | input | notify`), return `{ action: "handled" }` (verified `InputEventResult` shape); otherwise return `{ action: "continue" }`. `build`/`plan` targets never intercept: `build` is today's behavior unchanged; `plan` is informational in v1 (plan-build owns its own flow via `/plan` and `alt+m` — the selector showing `plan` tells the user where the next prompt *would* go, it does not switch modes).
- [ ] **Step 6: GREEN** (`npx vitest run && npx tsc --noEmit -p .`)
- [ ] **Step 7: Commit** (`feat(pi-swarm): prompt-target selector, shift+tab cycle, agent-target spawning`, Task 7)

### Task 8: Cross-extension RPC protocol — envelope + handlers

> **⚠ one-way: the RPC contract.** Channel names `swarm:rpc:ping|spawn|steer|consume|stop`, the envelope `{ v, reqId, type, payload }`, reply channel `swarm:rpc:reply`, version `1`, and the lifecycle events `swarm:created|started|completed|failed|steered|usage` are a public contract the moment another extension consumes them. Changing any of them is a breaking change for consumers — stop and confirm before renaming.

**Files:**
- Create: `extensions/pi-swarm/src/protocol.ts`
- Create: `extensions/pi-swarm/src/protocol.spec.ts`

**Interfaces:**
- Consumes: Task 2 — `SwarmManager` (same API the tools call); Task 1 — `PROTOCOL_VERSION`, `AgentSnapshot`
- Produces: `interface RpcEnvelope { v: number; reqId: string; type: string; payload: unknown }`, `installSwarmProtocol(bus: { emit(c: string, d: unknown): void; on(c: string, h: (d: unknown) => void): () => void }, manager: SwarmManager): { dispose(): void }`
- Seam: the `bus` object is the `pi.events` `EventBus` shape (verified: `emit(channel: string, data: unknown)`, `on(channel, handler)`) — injected for tests
- Deletion test: other extensions cannot spawn/steer/stop without it; the `swarm:*` events (usage ledger) are lost
- Adapters: 2 (real `pi.events` in `index.ts`; in-memory fake bus in spec)

**Protocol** (exact — this is the contract):
- Request envelope (inbound on `swarm:rpc:spawn|steer|consume|stop|ping`): `{ v: 1, reqId: string, payload: … }`
  - `ping`: payload `{}` → reply payload `{ ok: true, version: 1, counts: { running: n, queued: n, tracked: n } }`
  - `spawn`: payload `{ prompt: string, title?: string, agentType?: string, model?: string }` → reply payload `{ id: string }` (or `{ error: string }`)
  - `steer`: payload `{ id: string, text: string }` → reply payload `{ ok: true }`
  - `consume`: payload `{ id: string }` → reply payload `{ snapshot: AgentSnapshot }` — **non-blocking**: returns the current snapshot immediately (like `swarm_check`) and marks the agent consumed so the deferred delivery is suppressed; for a running agent the snapshot is partial by design (the caller polls again if it needs the final state)
  - `stop`: payload `{ id: string }` → reply payload `{ ok: true, status: SwarmStatus }`
- Reply envelope (outbound on `swarm:rpc:reply`): `{ v: 1, reqId: <same>, type: "reply", payload: … }`; unknown `v` → `{ v: 1, reqId, type: "reply", payload: { error: "unsupported_version", supported: [1] } }` with NO side effect; unknown `reqId` correlation failures → reply `{ error: "unknown_request" }`
- Lifecycle events (outbound, no reply): `swarm:created`/`swarm:started`/`swarm:completed`/`swarm:failed`/`swarm:steered` with payload = `AgentSnapshot`; `swarm:usage` with payload `{ id, tokens, turns }` where both are **deltas for the run that just settled** (not cumulative) — emitted once per settle (the spend ledger)
- `swarm:ready` emitted on session start with payload `{ v: 1 }` (version handshake)

**SATISFIES:** R-rpc-protocol, R-rpc-version

- [ ] **Step 1: Write failing `protocol.spec.ts`** (fake bus capturing emits): ping → reply with counts matching a seeded manager; spawn → manager.spawn called, reply carries the id; steer → manager.send called; consume → snapshot returned AND `consumed === true` afterward; stop → manager.cancel awaited; `v: 99` → version-error reply and NO manager call (assert manager spy not called); each lifecycle transition on the manager emits the matching `swarm:*` event once.
- [ ] **Step 2: RED**
- [ ] **Step 3: Implement `protocol.ts`**
- [ ] **Step 4: Wire in `index.ts`** — `installSwarmProtocol(ctx.events or pi.events, manager)` at session start (after the manager exists), `dispose()` on `session_shutdown`; emit `swarm:ready`.
- [ ] **Step 5: GREEN**
- [ ] **Step 6: Commit** (`feat(pi-swarm): cross-extension rpc protocol (swarm:rpc:*, v1)`, Task 8)

### Task 9: `/swarm` dashboard + docs + packaging

**Files:**
- Create: `extensions/pi-swarm/src/ui/dashboard.ts`
- Modify: `extensions/pi-swarm/index.ts` (register `/swarm` command)
- Create: `extensions/pi-swarm/README.md`
- Modify: `/Users/paladm/git/ai-test/skill-pi/README.md` (add `pi-swarm` to the bundled-extensions list, house style)

**Interfaces:**
- Consumes: Tasks 2-8 (manager read model, format, agent types)
- Produces: `/swarm` command → fullscreen dashboard (list all tracked agents: glyph, title, agentType, model, tokens, elapsed, status; keys `j/k` or arrows to move, `Enter` → takeover view (same transcript overlay as FleetView), `x` → cancel selected, `Esc` close) + `README.md`
- Seam: same read model
- Deletion test: management surface (cancel from list, full transcript of settled agents) disappears; FleetView covers only the running glance
- Adapters: 2 (unchanged)

**SATISFIES:** (all scenarios remain covered; the dashboard is the management surface the FleetView hint `/swarm` points at)

- [ ] **Step 1: Implement `dashboard.ts`** — reuse `formatAgentRow` + the Task 5 overlay component; the takeover view IS the FleetView overlay (shared component, not a copy).
- [ ] **Step 2: Register `/swarm`** in `index.ts`; non-TUI mode (e.g. `--print`) → the command prints the `swarm_list` output as text (typically an empty list — children are TUI-session subprocesses; document that in the README).
- [ ] **Step 3: Write `README.md`** — house style (per `extensions/todo/README.md`): what you get, install (bundled + standalone `pi install npm:@devopstales/pi-swarm`), how it works (ASCII diagram: tool → manager → rpc child → result delivery), configuration (env vars table: `SKILL_PI_SWARM` on/off, `SKILL_PI_SWARM_MAX` default 4, `SKILL_PI_SWARM_TARGET_KEY` default `shift+tab`), development (vitest + tsc), the RPC protocol reference (envelope + events — the contract from Task 8), license/sources (the four reference repos + MIT attribution).
- [ ] **Step 4: Root README entry** — one bullet in the bundled-extensions list matching the existing entries' shape.
- [ ] **Step 5: Full GREEN**

```bash
cd /Users/paladm/git/ai-test/skill-pi/extensions/pi-swarm && npx vitest run && npx tsc --noEmit -p .
cd /Users/paladm/git/ai-test/skill-pi && node --test "test/**/*.test.js"
```
Expected: extension suite green (≥ 40 tests), tsc clean, root suite unchanged (verify against the current actual count).

- [ ] **Step 6: Commit** (`feat(pi-swarm): /swarm dashboard, README, root README entry`, Task 9)

### Task 10: L2 verification + door-check E2E + QA artifacts

**Files:**
- Create: `.skillgrid/specs/2026-10-16-pi-swarm-extension/report.md`
- Create: `.skillgrid/specs/2026-10-16-pi-swarm-extension/review.md`
- Modify: `.skillgrid/state.yaml` (phase transitions)

**Interfaces:**
- Consumes: everything above
- Produces: the QA gate artifacts (per the `qa` skill's four-state render) + the live E2E evidence
- Seam: none (verification task)
- Deletion test: n/a
- Adapters: n/a

**SATISFIES:** (all — final gate)

- [ ] **Step 1: Live E2E (the backstop truth):** in a scratch project, run a real session (or `--print` with an explicit tool-prompting instruction): spawn a child via `swarm_spawn`, let it settle, assert the `swarm-result` message triggered a follow-up turn in the parent (visible in the session transcript); verify `~/.pi/agent` untouched (mtime before/after); paste evidence into `report.md` under `## Door Check` / `## E2E`.
- [ ] **Step 2: Run L2** — full vitest + tsc + root `node --test` (commands from Task 9 Step 5) — record counts in `report.md`.
- [ ] **Step 3: Render the QA gate** (`report.md`) + record any WARNINGs (the plan-build probe seam, the system-prompt mechanism choice from Task 6 Step 5, the FleetView placement from Task 4 Step 4 are the expected advisory items).
- [ ] **Step 4: Commit** (spec-zone commit: `docs(pi-swarm): qa gate + e2e evidence`, zone-guard separated from code)

## Execution Notes

- **Ordering:** Tasks 1-8 are strictly sequential (each consumes the prior task's interface). Task 9's dashboard and README can start once Task 5 lands (the overlay is shared) — but keep the sequential commit order for review simplicity. Task 10 is last.
- **Slicing:** 10 tasks → invoke `skillgrid:slicing` after this blueprint is reviewed; expected waves: [1], [2], [3,4], [5,6], [7], [8,9], [10].
- **Testing discipline:** TDD per task (RED → GREEN shown in steps); every spec file lives next to its source (`src/*.spec.ts`), vitest include `src/**/*.spec.ts`.
- **Known unknowns resolved in-task (recorded, not deferred):** exact RPC event `type` names (Task 1 door check), system-prompt injection mechanism (Task 6 Step 5), plan-build probe mechanism (Task 7 Step 3), FleetView widget placement (Task 4 Step 4). Each is pinned to a task with a record-in-report obligation — none is a silent "implement later".

## Plan Review

- Verdict: READY FOR EXECUTION (after one revision pass)
- Findings: 3 Critical, 9 Important, 8 Minor — all 20 verified against the
  codebase and fixed inline:
  - C1 door-check command rewritten for RPC stdin JSONL (no `--print` in rpc mode)
  - C2 `--append-system-prompt` dropped (not a pi 1.2.0 CLI flag) — systemPrompt
    is prompt-prefixed with a `## Agent instructions` marker
  - C3 `SKILL_PI_SWARM_MAX` / `SKILL_PI_SWARM` now read in Task 2 Step 4
  - I4 `swarm:usage` pinned to per-run deltas
  - I5 `shift+tab` overrides pi's default `app.thinking.cycle` — documented +
    `SKILL_PI_SWARM_TARGET_KEY` escape hatch
  - I6 wait budgets: per-agent reduced proportionally so total ≤ 48KB
  - I7 `disposeAll()` only on `reason === "quit"`; manager keyed by session id
  - I8 card chrome path corrected to `../skill-pi-tui/src/card.ts`
  - I9 plan-build probe evaluated lazily (recomputed per `shift+tab`) + env override
  - I10 input interception suppressed while FleetView overlay is open
  - I11 `cancel` on a queued agent defined (queue promotes next)
  - I12 empty `finalText` fallback (last assistant line, else status line)
  - M13 pi's `parseFrontmatter` used instead of a hand-rolled parser
  - M14 vitest config: default (todo has none to copy)
  - M15 check preview: ≤2KB AND ≤20 lines, whichever hits first
  - M16 `/swarm` in `--print` documented as typically empty
  - M17 LRU pinned to `settledAt` ascending
  - M19 `belowEditor` placement confirmed (no hedge)
  - M20 `buildChildInvocation` cwd === spawn cwd asserted in test
- Reviewed: 2026-10-16 (subagent plan review, all findings verified against
  `node_modules/@earendil-works/pi-coding-agent/dist`)
