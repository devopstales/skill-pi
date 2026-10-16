# command-plate

`Ctrl+Q` leader palette for pi (tmux `Ctrl+B` style), with scoped-model and full
model/thinking pickers. Based on [tomsej's pi-ext leader-key](https://github.com/tomsej/pi-ext) (MIT),
homogenized into skill-pi extension conventions.

## Keys

| Key | Action |
| --- | --- |
| `Ctrl+Q` then `?` | Open the command plate palette |
| `Ctrl+Q` then a key | Run a plate action directly (see below) |
| `/cp` | Open the palette (command form) |
| `/models` | Scoped-models picker directly (bypasses palette) |

`Ctrl+Q` is unbound by pi by default, so the leader is always available and
needs no keybinding configuration.

## Palette

`Ctrl+Q` then a chord key to run the action directly (without opening the
palette first).

| Key | Action |
| --- | --- |
| `Ctrl+Q` + `?` | Open the command plate palette |
| `Ctrl+Q` + `m` | Models — scoped model picker (respects `enabledModels`) |
| `Ctrl+Q` + `s` | `/subagents` |
| `Ctrl+Q` + `q` | Quit pi |

Opening the palette (`Ctrl+Q` `?` or `/cp`) shows all actions as a selectable
list; you can also type a chord while the palette is open to jump to an action.

## Scoped model picker

`/models` (or `Ctrl+Q` + `m`) opens a scoped model picker that respects your
`enabledModels` config. The picker is two-level: pick a model, then a
context window size if the model supports more than one.

## Configuration

`$PI_CODING_AGENT_DIR/skill-pi-command-plate.json` (i.e.
`~/.skill-pi/agent/skill-pi-command-plate.json`):

```json
{
  "thinkingDefault": 4000,
  "thinkingValues": [
    { "label": "low", "value": 1000 },
    { "label": "medium", "value": 4000 },
    { "label": "high", "value": 8000 }
  ],
  "defaultContextWindow": 200000,
  "contextValues": [128000, 200000, 500000]
}
```

All keys are optional; missing file → defaults. Malformed JSON → warning +
defaults.

## Disabling

Uninstall the extension to disable. The scoped-models picker and the plate
leader are all-or-nothing with the extension.
