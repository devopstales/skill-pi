# command-plate

`Ctrl+Q` leader palette for pi (tmux `Ctrl+B` style), with scoped-model and full
model/thinking pickers. Based on [tomsej's pi-ext leader-key](https://github.com/tomsej/pi-ext) (MIT),
homogenized into skill-pi extension conventions.

## Keys

| Key | Action |
| --- | --- |
| `Ctrl+Q` then a key | Run a plate action (see below) |
| `/cp` | List the plate actions (command form) |

`Ctrl+Q` is unbound by pi by default, so the leader is always available and
needs no keybinding configuration.

## Palette

`Ctrl+Q` then a chord key to run the action.

| Key | Action |
| --- | --- |
| `Ctrl+Q` + `m` | Models — scoped model picker (respects `enabledModels`) |
| `Ctrl+Q` + `a` + `s` | `/subagents` |
| `Ctrl+Q` + `a` + `p` | `/ps` |
| `Ctrl+Q` + `t` | `/tree` |
| `Ctrl+Q` + `q` | Quit pi |

## Scoped Models picker

Resolves the `enabledModels` patterns from settings (exact `provider/model`,
globs, and `:thinking` suffixes like `anthropic/claude-sonnet:high`), falling
back to all available models when the scope is empty.

- `j`/`k`, `1`-`9` jump, `left`/`right` cycle the thinking level
- `o`/`i`/`l`/`m`/`h`/`x` set thinking (off/minimal/low/medium/high/xhigh)
- `Enter` switches model + thinking level

## Exported utilities (`model-pick.ts`)

- `runModelSwitcher(pi, ctx)` — full searchable provider → model → thinking flow
- `runThinkingPicker(pi, ctx)` — searchable thinking-level picker
- `searchableSelect(ctx, title, items, ...)` — reusable fuzzy-search select overlay
- `getProviders(ctx)` / `getModelsForProvider(ctx, provider)` — enabled-model awareness

These are not wired into the palette (matching upstream, where the full
switcher is a utility); call them from your own extension commands if needed.

## Development

```sh
npm run check   # tsc --noEmit
npm test        # vitest run
```
