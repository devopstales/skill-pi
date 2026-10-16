# Consolidated Ctrl+A leader for extension keybindings

---
status: "accepted"
date: 2026-10-16
supersedes: none
---

## Context and Problem Statement

The bundled extensions each chose their own ad-hoc keybindings: `Ctrl+K` opened
the command plate, `Ctrl+M` opened the scoped-model picker directly, `alt+m`
cycled Plan/Build modes, and `ctrl+shift+t` collapsed the todo card. Four
extensions, four different chords, no system. Worse, none of them could coexist
as a *system*, because pi's `registerShortcut()` only accepts literal key
strings: there is no leader state, and `Ctrl+A` is already bound by default to
`app.models.enableAll` (and as a secondary key to `app.tree.filter.all`), so
naively re-registering `Ctrl+A` either collides or shadows a pi built-in.

The goal: one discoverable action surface for all extension features, in the
shape users already know from tmux — a single prefix key (`Ctrl+A`, like tmux's
`Ctrl+B`) followed by a one-letter action key (`Ctrl+A` `t` = todo, `Ctrl+A` `p`
= plan mode, …).

## Decision

- SDD change: none yet (pre-propose decision)

**`Ctrl+A` is the skill-pi leader prefix. Every extension action key is
`Ctrl+A` + one letter, and no extension registers a standalone `Ctrl+A`
shortcut.** The plate itself is opened only by command (`/cp`); its palette keys
(m / a s / a p / t / q) are also reachable as leader actions.

Mapping (defaults, all rebindable per extension):

| Chord | Action | Extension |
|---|---|---|
| `Ctrl+A` `m` | Scoped-models picker (respects `enabledModels`) | command-plate |
| `Ctrl+A` `a` `s` | `/subagents` | command-plate |
| `Ctrl+A` `a` `p` | `/ps` | command-plate |
| `Ctrl+A` `t` | Collapse/expand the todo card | todo |
| `Ctrl+A` `q` | Quit pi | command-plate |
| `Ctrl+A` | Enter Plan mode | plan-build |
| `Ctrl+B` | Enter Build mode | plan-build |

Mechanics, fixed as part of this decision:

- **The leader is not re-registered as `Ctrl+A`.** Each consuming extension
  claims `Ctrl+A` through `ctx.ui.onTerminalInput` (command-plate and todo) or
  through `pi.registerShortcut` (plan-build) *only when pi still binds
  `app.models.enableAll` to `Ctrl+A`* — checked at runtime against the live
  keybindings config. Rebind or unbind that keybinding in `keybindings.json`
  and the leader follows: it moves with the binding, or stops working if the
  binding is removed. This keeps the leader out of pi's reserved-keybinding
  conflict surface (ADR-0006: never patch pi source).
- **plan-build drops the cycle toggle.** `Alt+M` is replaced by two explicit
  leader-free keys, `Ctrl+A` (Plan) and `Ctrl+B` (Build). `Ctrl+B` is
  reserved as the skill-pi "companion" key and must not be used by any other
  extension. Config `shortcuts.toggleMode` becomes `shortcuts.planMode` +
  `shortcuts.buildMode` (file: `skill-pi-plan-build.json`); existing
  `toggleMode` values fall back to defaults on load.
- **The plate is command-only.** `Ctrl+K` is removed; `/cp` opens the palette,
  `/models` opens the scoped-models picker directly (replacing `Ctrl+M`).
  While the plate is open, the leader is armed for the duration of the
  overlay, so `Ctrl+A` `t` collapses the todo card without leaving the palette.
- **Letter keys are reserved in this space.** A new extension action key must
  be `Ctrl+A` + a single unassigned letter (plus at most one second letter for
  groups, like `a` → `s` / `a` → `p`). Unassigned letters: b, c, d, e, f, g, h,
  i, j, k, l, n, o, r, u, v, w, x, y, z.
- **Existing overrides are preserved.** `SKILL_PI_TODO_KEY` (now the *action*
  letter key, default `ctrl+a`), plan-build `shortcuts.planMode` /
  `shortcuts.buildMode`, and ask-user `collapseKey` keep working; they rebind
  the action half of the chord, never the prefix.

## Considered Options

- **Standalone literal shortcuts per extension (status quo)** — zero machinery,
  but the very inconsistency this ADR removes; and every new extension is
  forced to hunt for a free two-key chord. Rejected.
- **True tmux-style global leader state (every extension registers a handler
  for one shared prefix)** — closest to tmux, but pi has no shared leader
  primitive; it would require one extension to own the prefix and dispatch to
  the others (cross-extension coupling), or a fork/patch of pi (violates
  ADR-0006). Rejected.
- **Bind the leader to a currently-unbound chord (e.g. `Ctrl+Space`)** — no
  conflict with `app.models.enableAll`, but a fresh chord to learn and one more
  thing that breaks when pi adds a default binding later. Rejected in favor of
  riding an existing, rebindable pi binding.

## Consequences

- Good, because one prefix is one thing to remember; the `/cp` palette doubles
  as the keybinding help screen.
- Good, because the leader degrades gracefully: rebind `app.models.enableAll`
  and the whole system follows; unbind it and the plate is still fully usable
  via `/cp` (degraded, not dead).
- Bad, because `Ctrl+A` no longer "enable all models" out of the box; do it
  from the model dialog or rebind.
- Bad, because the todo collapse chord is only as reliable as raw
  `onTerminalInput` delivery — during overlays or dialogs that swallow input,
  `Ctrl+A` `t` does not fire.
- Existing plan-build configs with `shortcuts.toggleMode` migrate to defaults
  silently on first load (malformed-file policy unchanged: warn + defaults,
  never overwrite).
