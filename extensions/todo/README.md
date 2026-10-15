# @devopstales/pi-todo

A `todo` tool and live task card for [pi](https://pi.dev), integrated with the
**skill-pi-tui** fullscreen sidebar. Give the model a task list you can see: what
it is doing now, what it finished, and what is queued.

Based on [gentle-shell's `gentle-todo`](https://github.com/Gentleman-Programming/gentle-shell/blob/main/extensions/gentle-todo.ts)
(MIT) and [juicesharp's `rpiv-todo`](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-todo)
(MIT).

## What you get

- **The `todo` tool** — `write` (replace the whole list), `add`, `update`,
  `clear`, `list`. Tasks carry `pending` / `in_progress` / `blocked` / `done` /
  `dropped` statuses; `blocked` requires a note naming what it waits for.
- **A live card** — in the skill-pi-tui right sidebar. Shows a `done/total · open`
  summary, per-task status glyphs, in-progress notes, and a stale warning when
  the list goes untouched for several turns. The main-view widget is empty;
  the card lives exclusively in the sidebar rail.
- **Collapse & scroll** — `ctrl+shift+t` collapses to a one-line summary;
  `alt+shift+up/down` scrolls a long list.
- **The list survives** — every change mirrors the open snapshot into the
  transcript as a hidden custom message, so the list is replayed from the session
  branch across `/reload`, compaction, and branch navigation. A finished list
  stays on screen for the turn it finished in, then clears.

## Install

Bundled with `@devopstales/skill-pi` (always loaded, nothing to do). To use it
with stock pi:

```sh
pi install npm:@devopstales/pi-todo
```

Then restart the session and confirm with `todo` in a multi-step prompt.

## How it works

```
todo tool ──write/add/update/clear──▶ in-memory TodoState (per session)
   │                                        │
   │  on change (except list)               │
   ▼                                        ▼
pi.sendMessage(hidden)          skill-pi-tui sidebar "todo" part
customType: pi-todo-state       (widget above editor < 140 cols)
   │
   ▼
session branch ──▶ replayTodo() on session_start
   │
   ▼
context handler re-attaches the snapshot to transcripts that lost it
(compaction / branch navigation) and sends one reminder after several
untouched tool turns
```

- State is keyed by `sessionManager.getSessionId()`, so parallel or child
  sessions never read or overwrite each other's list.
- The transcript snapshot is the *open* set of tasks; a closed list persists a
  `closed` marker so the last open snapshot never reads as current work.
- Rendering reuses the skill-pi-tui card frame (`cardTop` / `cardBottom`), so
  the card matches the Status card chrome and theme tokens.

## Configuration

Environment variables (read once at extension load):

| Variable | Default | Meaning |
|---|---|---|
| `SKILL_PI_TODO` | `1` | `0` / `false` / `off` disables the extension entirely |
| `SKILL_PI_TODO_KEY` | `ctrl+shift+t` | Collapse/expand shortcut (pi keybinding form); `off` or empty disables it |

## Development

```sh
npm test     # vitest (36 tests: model, card rendering, extension wiring)
npm run check # tsc --noEmit
```

Layout:

```
index.ts            extension: tool, shortcuts, events, widget/sidebar card
src/model.ts        pure domain: statuses, applyTodo state machine, summary,
                    transcript snapshot (de)serialization, branch replay, staleness
src/card.ts         card rows: frame + task rows + footer, via skill-pi-tui card chrome
src/theme.ts        pi Theme → card theme adapter
```

## License

MIT — see the skill-pi repository. Upstream sources:
- [Gentleman-Programming/gentle-shell](https://github.com/Gentleman-Programming/gentle-shell) (MIT)
- [juicesharp/rpiv-mono](https://github.com/juicesharp/rpiv-mono) (MIT)
