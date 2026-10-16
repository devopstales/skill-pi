# pi-swarm — Design Briefing

> **STATUS:** `accepted` (2026-10-16) — change agreed with user in-session:
> swarm of isolated child agents, FleetView, cross-extension RPC protocol,
> agent-target selector with `Ctrl+Q` `Tab` (skill-pi leader).

## Problem / Intent

skill-pi is a single-session agent: every task runs in one conversation, and the
user waits for the model turn-by-turn. The ecosystem has converged on a pattern
skill-pi lacks — spawn parallel child agents, each with its own context, and
steer them from the parent. Five reference implementations exist for pi
(see Sources); none fits skill-pi's isolation contract directly, so we build
`pi-swarm` as a bundled extension.

**Intent:** let the main agent (or the user, by typing `@agent` in the prompt)
fire self-contained tasks to isolated child skill-pi instances that run
concurrently, can be inspected and steered live, and report back when they
settle — while the user keeps working in the parent.

## Purpose & Success Criteria

- The parent model can delegate: `swarm_spawn` returns immediately, the child
  runs as its own isolated `skill-pi --mode rpc` subprocess, and its result
  arrives in the parent conversation at the next idle boundary (deferred
  delivery, one follow-up turn).
- The user can see and attend to the swarm: a below-prompt **FleetView**
  (navigate with arrow keys, open a child's live transcript, stop it) and a
  `/swarm` dashboard command; a statusline segment summarizes the swarm.
- Mid-run steering works: `swarm_send` injects a message into a running child
  (RPC `steer`) or queues one for its next turn (RPC `follow_up`).
- The TUI shows **which agent will handle the next prompt** — an agent-target
  selector — and `Ctrl+Q` `Tab` cycles targets. Default target is `build` (no
  agent config, exactly today's behavior). When `plan-build` is installed,
  `plan` is in the cycle; every agent type in `.skill-pi/agents/` /
  `~/.skill-pi/agent/agents/` is in the cycle too. Selecting an agent target
  and submitting a prompt spawns a child of that agent type instead of
  entering the prompt into the main conversation.
- Other extensions can drive the swarm: a versioned `pi.events`-bus RPC
  protocol (`swarm:rpc:*`) + lifecycle events (`swarm:*`) + a per-agent spend
  ledger (`swarm:usage`).
- `cd extensions/pi-swarm && npx vitest run` is green; `npx tsc --noEmit -p .`
  is clean; root suite `node --test "test/**/*.test.js"` is unchanged and
  green.

## Constraints

- Self-contained extension (ADR 0007): all new files stay in
  `extensions/pi-swarm/`; runtime deps limited to what is already in the root
  `node_modules` (`@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`,
  `typebox`).
- Never modify pi source (ADR 0006): children are spawned as **subprocesses**
  of the `skill-pi` executable in `--mode rpc` (JSONL commands on stdin,
  JSONL events on stdout — verified against pi 1.2.0
  `dist/modes/rpc/rpc-types.d.ts`: `prompt`, `steer`, `follow_up`, `abort`,
  `get_state`, …). In-process SDK sessions are out of scope for v1.
- Children inherit `PI_CODING_AGENT_DIR` from the parent (the isolated
  `~/.skill-pi/agent`), so every child is itself a fully isolated skill-pi
  instance — isolation is the product (per ASSUMPTIONS.md § VERIFIED).
- Agent types live in `.skill-pi/agents/<name>.md` (project, read through the
  shim's `project -> <repo>` symlink) then `~/.skill-pi/agent/agents/<name>.md`
  (global), as YAML-frontmatter markdown. The stock-pi `.pi/agents`
  convention is NOT used (ADR 0002 separation).
- No comments in code unless asked. Minimal scoped changes.
- Keybinding `Ctrl+Q` `Tab` for target cycling is a skill-pi leader action
  (ADR-0010); it does not collide with plan-build's `Ctrl+Q` `p` / `Ctrl+Q` `b`
  mode chords or with pi's `shift+tab` thinking-level cycle (that key stays
  untouched).
- Exactly one edit outside `extensions/pi-swarm/`: plan-build's `index.ts`
  gains one additive `pi.events.emit("swarm:plan-present", …)` line on
  session start (the v1 probe for the target cycle — blueprint Task 7 Step 3),
  committed as its own work unit so the two extensions stay independently
  revertable.

## Out of Scope (v1)

- tmux windows and git-worktree isolation for children (pasky's lifecycle) —
  v1 children run in the parent cwd; worktree isolation is a backlog item.
- Cross-session channels + task board (monotyka's messenger model) — the
  RPC protocol is the seam; channels build on it later.
- Scheduled spawns, one-level nesting, per-agent memory scopes.
- Publishing `@devopstales/pi-swarm` standalone — packaged in wave 5, not a
  must-have for the change to pass QA.

## Tier & Class

`standard` (T2): multi-file feature, new subprocess trust boundary (children
are unattended pi instances running with the user's credentials), new
public-ish contract (the RPC protocol). Verification floor L2; the E2E door
check (a live child round-trip) is a `backstop` truth.

## Sources

- davis7dotsh/my-pi-setup — `extensions/subagents` (tool surface, deferred
  result delivery, budgets, caps), `extensions/background-terminals` (settle
  + collect pattern)
- pasky/pi-side-agents (orchestration tools for parent agents, statusline)
- tintinweb/pi-subagents (agent types, FleetView, steering, session resume,
  RPC protocol shape)
- monotykamary/pi-messenger-swarm (file-based coordination model — informs
  the post-v1 backlog)
