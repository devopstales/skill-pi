# command-plate

Ctrl+X command plate (which-key style leader palette) for pi, with scoped-model
and full model/thinking pickers. Based on [tomsej's pi-ext leader-key](https://github.com/tomsej/pi-ext) (MIT),
homogenized into skill-pi extension conventions.

## Keys

| Key | Action |
| --- | --- |
| `Ctrl+X` | Open the command plate palette |
| `/cp` | Open the command plate palette (command form) |
| `Ctrl+M` | Open the Scoped Models picker directly |

## Palette

Press a chord key to drill into a group, or a direct key to run the action.
`up`/`down` + `Enter` work too; `Backspace` goes back, `Esc` closes.

| Key | Action |
| --- | --- |
| `m` | Models — scoped model picker (respects `enabledModels`) |
| `a` → `s` | `/subagents` |
| `a` → `p` | `/ps` |
| `t` | `/tree` |
| `q` | Quit pi |

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
