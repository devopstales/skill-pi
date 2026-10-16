# Ctrl+Q leader for extension keybindings

---
status: "accepted"
date: 2026-10-16
supersedes: ADR-0009
---

- SDD change: none yet (pre-propose decision)

## Context and Problem Statement

ADR-0009 introduced a leader prefix for extension keybindings and picked
`Ctrl+A`. In practice that choice produced two problems:

1. **Conflict warnings.** `Ctrl+A` is pi's default for both
   `tui.editor.cursorLineStart` and `app.tree.filter.all`, and `Ctrl+B` is
   `tui.editor.cursorLeft`. Registering them as standalone `registerShortcut`
   keys emitted "Extension shortcut conflict … Using <extension>" diagnostics on
   every session start.
2. **Layout fragility.** The follow-up candidate `Ctrl+;` (the "free" symbol
   slot) is the *Shift form of `?`* on the Hungarian (QWERTZ) layout, so
   `Ctrl+;` becomes `Ctrl+Shift+?` — a three-finger chord — for a real user
   audience. A leader prefix must be a key that is unambiguously itself on every
   layout.

The goal is unchanged from ADR-0009: one discoverable action surface for all
extension features, in the shape users know from tmux (a single prefix followed
by an action key), but on a prefix that is both **layout-proof** and **free of
pi built-in bindings**.

## Decision

**`Ctrl+Q` is the skill-pi leader prefix. Every extension action key is
`Ctrl+Q` + one letter (or `Tab`), and no extension registers a standalone
`Ctrl+Q` shortcut.** `Ctrl+Q` is chosen because:

- `Q` is a letter in the same physical position on every QWERTY/QWERTZ layout —
  layout-proof by construction (unlike `;`, which swaps with `?` on Hungarian).
- `Ctrl+Q` is **unbound by pi by default** on macOS/Linux (it is only a Windows
  `app.message.dequeue` fallback), so it needs no keybinding configuration and
  generates no conflict warnings.

Because `Ctrl+Q` is unbound, the leader is implemented as a raw
`ctx.ui.onTerminalInput` listener (or a `tui` input listener for overlays) that
arms a one-key window on `Ctrl+Q` and resolves the next key — **not** as a
`registerShortcut`, which is what caused the ADR-0009 conflict warnings.

Mapping (defaults, all rebindable per extension):

| Chord | Action | Extension |
|---|---|---|
| `Ctrl+Q` `t` | Collapse/expand the todo card | todo |
| `Ctrl+Q` `p` | Enter Plan mode | plan-build |
| `Ctrl+Q` `b` | Enter Build mode | plan-build |
| `Ctrl+Q` `m` | Scoped-models picker (respects `enabledModels`) | command-plate |
| `Ctrl+Q` `a` `s` | `/subagents` | command-plate |
| `Ctrl+Q` `a` `p` | `/ps` | command-plate |
| `Ctrl+Q` `q` | Quit pi | command-plate |
| `Ctrl+Q` `Tab` | Cycle agent target | pi-swarm |

Mechanics, carried forward and refined from ADR-0009:

- **Plan/Build are leader chords, not standalone keys.** ADR-0009 registered
  `Ctrl+A` / `Ctrl+B` as standalone `registerShortcut` keys — the source of the
  conflict warnings. Now `Ctrl+Q` `p` and `Ctrl+Q` `b` are intercepted by the
  leader listener, so no standalone `Ctrl+Q` is ever registered.
- **The command plate is command-only** (`/cp`), unchanged from ADR-0009; its
  palette keys are also reachable as leader actions.
- **Letter/Tab keys are reserved in this space.** A new extension action key is
  `Ctrl+Q` + one unassigned key. Unassigned: c, d, e, f, g, h, i, j, k, l, n,
  o, r, u, v, w, x, y, z.
- **Per-extension overrides rebind the action key only.** `SKILL_PI_TODO_KEY`
  (default `t`), plan-build `shortcuts.planMode` / `shortcuts.buildMode`
  (default `["p"]` / `["b"]`), and pi-swarm `SKILL_PI_SWARM_TARGET_KEY`
  (default `tab`) set the *second* key of the chord; the `Ctrl+Q` prefix itself
  is fixed.
- **ask-user is untouched** — its `Ctrl+]` collapse key is dialog-scoped, not
  part of the global action space.

## Considered Options

- **`Ctrl+A` prefix (ADR-0009, status quo)** — familiar, but collides with two
  pi built-ins and the follow-up `Ctrl+;` alternative is layout-fragile.
  Replaced.
- **`Ctrl+;` prefix** — free in pi on US layouts, but `;` is the Shift form of
  `?` on Hungarian QWERTZ, making it a three-key chord for that audience.
  Rejected for layout-proofness.
- **`Alt+A` prefix** — layout-proof and pi-free, but requires "Option as Meta"
  (macOS) and AltGr (Windows) terminal setup, and a single `Alt+A` press would
  have to double as both prefix and Plan-mode action. Rejected for setup
  fragility.

## Consequences

- Good, because `Ctrl+Q` is identical on every layout and needs no terminal or
  pi keybinding configuration — the leader works out of the box on macOS.
- Good, because no standalone `Ctrl+Q` is registered, the ADR-0009 conflict
  warnings are gone by construction.
- Good, because `Ctrl+Q` `Tab` gives pi-swarm a target-cycle key that does not
  steal pi's `shift+tab` thinking-level cycle.
- Bad, because `Ctrl+Q` is the classic terminal XON/XOFF "resume output" key —
  if a user pauses output with `Ctrl+S`, the `Ctrl+Q` that resumes it also arms
  the leader. Rare, but a real-world quirk the ADR-0009 prefixes did not have.
- Bad, because on Windows `Ctrl+Q` is the `app.message.dequeue` fallback, so a
  conflict warning would appear there (acceptable: skill-pi's primary target is
  macOS; the leader still functions).
