# @devopstales/pi-swarm

Spawn, track, steer, and inspect **parallel isolated child skill-pi agents** from a
single pi session. Children run as `skill-pi --mode rpc` subprocesses, so each one
is itself a fully isolated skill-pi instance — same `PI_CODING_AGENT_DIR`, no
`PI_PACKAGE_DIR`, no shared state with the parent or with each other.

## What you get

- **Swarm tools** — `swarm_spawn` (fire-and-forget, returns an agent id),
  `swarm_wait` (block and collect results), `swarm_list`, `swarm_check`
  (peek without consuming), `swarm_send` (steer a running child, follow up a
  settled one), `swarm_cancel` (bounded abort: 5s then SIGKILL).
- **Deferred result delivery** — a settled child's final text reaches the parent
  as a `swarm-result` message with `deliverAs: followUp, triggerTurn: true`,
  exactly once, and only on parent idle. A prior `swarm_wait` on that id
  suppresses the auto-delivery (consumed semantics).
- **FleetView** — a below-prompt list of active children (shown whenever at
  least one is running or queued): status glyph, title, agent type, model,
  tokens, elapsed. (token and model columns are placeholders in v1 — children
  report no usage stream yet.) `Enter` opens a child's live transcript overlay
  (sanitized, auto-follow, scroll-up-to-pause); `x` aborts the selected child
  (two-press confirm); `Esc` returns to the prompt.
- **`/swarm` dashboard** — a fullscreen management surface with every tracked
  agent (running, queued, and settled with final status + tokens). `j`/`k` or
  `↑`/`↓` move the selection, `Enter` opens the transcript takeover (the same
  overlay component as FleetView), `x` cancels (two-press confirm), `Esc`
  closes. In non-TUI contexts (`--print`, RPC) the command prints the
  `swarm_list` text instead.
- **Prompt-target selector** — `Ctrl+Q` then `Tab` cycles which agent the next
  submitted prompt goes to: `build → plan (if plan-build is loaded) → your
  agent types → build…`. While an agent type is selected, submitting a prompt
  spawns that child directly instead of entering the main conversation.
- **Agent types** — `.skill-pi/agents/*.md` definitions (frontmatter + system
  prompt) for project-specific child roles.
- **Cross-extension RPC protocol** — a versioned `pi.events` bus contract
  (`swarm:rpc:*`, v1) that lets other extensions spawn/steer/stop children and
  observe lifecycle + usage events.

## Install

Bundled with `@devopstales/skill-pi` (always loaded, nothing to do). To use it
with stock pi:

```sh
pi install npm:@devopstales/pi-swarm
```

Then restart the session and confirm with a `swarm_spawn` prompt or `/swarm`.

## How it works

```
swarm_spawn ──▶ SwarmManager (per session, in-memory)
    │                │
    │  spawn         │  fold JSONL event stream → immutable AgentSnapshot
    ▼                ▼
skill-pi --mode rpc  synchronous read model (list/get/subscribe)
  subprocess          │
  (inherits PI_       ├──▶ swarm_* tools (LLM-facing)
   CODING_AGENT_DIR)  ├──▶ FleetView widget (below prompt, TUI)
    │                 ├──▶ /swarm dashboard (fullscreen, TUI)
    │  settle         └──▶ RPC protocol (pi.events bus)
    ▼
result delivered deferred (on parent idle) as a swarm-result message
→ triggers one follow-up turn in the parent, unless swarm_wait consumed it
```

- Children are driven exclusively through the `--mode rpc` CLI surface
  (JSONL commands on stdin, JSONL events on stdout). The event fold is
  tolerant: unknown event types are ignored; `agent_settled` (or process
  exit) is terminal. pi emits `agent_end` before the child settles and the
  child process stays alive in RPC mode, so the fold treats `agent_end` as
  non-terminal and only `agent_settled` (or process exit) settles the
  record.
- Children are spawned with `PI_PACKAGE_DIR` removed from the inherited
  env (the parent wrapper sets it for its brand overlay); a child
  therefore reads project config from `<project>/.pi/` (pi's default)
  rather than `<project>/.skill-pi/`. This is deliberate for v1 — children
  run with the isolated agent dir and no brand overlay; the parent's
  isolation guarantee (never touch `~/.pi/agent`) is unaffected and
  asserted in `child.spec.ts`.
- `MAX_RUNNING` (default 4) extra spawns are **queued**, not rejected; they
  start as running children settle. `MAX_TRACKED` (64) prunes the
  least-recently-settled settled agent first.
- Result budgets: 24KB delivered result, 48KB total / 16KB per agent for
  `swarm_wait`, 2KB / 20-line `swarm_check` preview, 4KB error text.

## Agent types

Drop markdown files into `<project>/.skill-pi/agents/` (project wins over
global on name clash; global root is `<agent-dir>/agents/`):

```md
---
name: auditor
description: Security Code Reviewer
model: anthropic/claude-opus-4-6
max_turns: 30
---
You are a security auditor. Review code for vulnerabilities…
```

Fields: `name` (defaults to the filename without `.md`), `description`,
`model`, `max_turns`, `color` (theme token for the target selector). The body
becomes the system prompt, prepended to the spawn prompt under an
`## Agent instructions` marker (pi's CLI has no `--append-system-prompt`
flag; prompt-prefixing is the ADR-0006-safe mechanism).

## Keybindings

| Key | Context | Action |
|---|---|---|
| `Ctrl+Q` then `Tab` | prompt | cycle prompt target (`build → plan → agent types → build…`); rebind the action key with `SKILL_PI_SWARM_TARGET_KEY` |
| `↓` / `←` | empty prompt, ≥1 active child | enter FleetView |
| `↑` / `↓` | FleetView list | move selection |
| `Enter` | FleetView list / `/swarm` dashboard | open the selected child's transcript overlay |
| `x` | FleetView / dashboard (two presses) | cancel the selected child |
| `j` / `k`, `↑` / `↓` | `/swarm` dashboard | move selection |
| `Esc` | FleetView overlay | return to the list |
| `Esc` | `/swarm` dashboard | close the dashboard |

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `SKILL_PI_SWARM` | `1` | `0` / `false` / `off` disables the extension entirely |
| `SKILL_PI_SWARM_MAX` | `4` | max concurrent running children (extra spawns queue) |
| `SKILL_PI_SWARM_TARGET_KEY` | `tab` | action key of the `Ctrl+Q` target-cycle leader; `off` disables it |
| `SKILL_PI_PLAN_BUILD` | — | `1` / `true` / `yes` force `plan` into the target cycle (normally detected via the `swarm:plan-present` bus event) |

## Cross-extension RPC protocol (v1)

Bus: `pi.events`. Envelope: `{ v: 1, reqId: string, type: string, payload }`.

Request channels (inbound; reply on `swarm:rpc:reply` with the same `reqId`):

| Channel | Payload in | Payload out |
|---|---|---|
| `swarm:rpc:ping` | `{}` | `{ ok, version, counts: { running, queued, tracked } }` |
| `swarm:rpc:spawn` | `{ prompt, title?, agentType?, model? }` | `{ id }` or `{ error }` |
| `swarm:rpc:steer` | `{ id, text }` | `{ ok }` |
| `swarm:rpc:consume` | `{ id }` | `{ snapshot }` — non-blocking; marks the agent consumed (suppresses auto-delivery) |
| `swarm:rpc:stop` | `{ id }` | `{ ok, status }` |

An unsupported `v` gets `{ error: "unsupported_version", supported: [1] }`
with no side effect. Lifecycle events (outbound, no reply):
`swarm:created`, `swarm:started`, `swarm:completed`, `swarm:failed`,
`swarm:steered` (payload = `AgentSnapshot`), and `swarm:usage`
(payload `{ id, tokens, turns }` — deltas for the run that just settled).
`swarm:ready` is emitted on session start as a version handshake.

These channel names and the envelope are a **public contract** (v1): renaming
them is a breaking change for consumers.

## Limitations

- **Single session scope** — the swarm belongs to one parent session; a
  replaced session (`/new`, `/resume`, fork) starts clean and must not kill
  children of the old session.
- **No git worktrees** — children run in the parent's project dir and share
  its working tree; concurrent writes to the same files are the parent's
  problem to coordinate.
- **No resume after crash** — v1 keeps no on-disk swarm state; a crashed child
  settles as `error` and the snapshot is what it had.
- **Non-TUI `/swarm`** prints the `swarm_list` text (typically empty —
  children are TUI-session subprocesses, so a `--print` run has no swarm to
  list).

## Development

```sh
npm test       # vitest (137 tests: codec, child, manager, agents, target, protocol, format, fleetview, dashboard, index)
npm run check  # tsc --noEmit
```

Layout:

```
index.ts                extension: tools, /swarm command, FleetView, target selector,
                        statusline, bus wiring, lifecycle
src/domain.ts           types, constants, budgets
src/jsonl.ts            JSONL line codec (tolerant: partial/invalid lines → undefined)
src/child.ts            RPC subprocess lifecycle (spawn/steer/abort/settle)
src/manager.ts          SwarmManager (registry, caps, queue, LRU prune, wait, deferred delivery)
src/agents.ts           agent-type discovery + frontmatter
src/protocol.ts         cross-extension RPC envelope + handlers
src/target.ts           prompt-target selector state
src/format.ts           elapsed/tokens/status/row formatting
src/ui/fleetview.ts     below-prompt fleet list + transcript overlay
src/ui/dashboard.ts     /swarm fullscreen list + takeover view
```

## License

MIT — see the skill-pi repository. Reference implementations read while
designing (all MIT): badlogic/pi-mono extensions, davis/swarm-agent,
monotyka/pi-harness, tintinweb/custom-agent-types.
