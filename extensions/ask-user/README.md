# @devopstales/pi-ask-user

`ask_user` tool for pi: pause the agent to collect a focused user decision.

## Features

- **Single question** — 2–5 mutually exclusive options, single choice or multi-select
- **Freeform answer** — user can type a custom answer (opt-out with `allowFreeform: false`)
- **Batch** — 2–4 independent questions with a review page (TUI)
- **TUI popup** — interactive keyboard-driven popup (single-select, multi-select toggle rows, freeform editor, paged batch + review)
- **RPC dialog fallback** — `ctx.ui.select` / `ctx.ui.input` dialogs when not in TUI mode
- **Structured details** — reconstructible result shapes across all modes
- **Events** — `ask:answered` / `ask:cancelled` for host correlation

## Install

```bash
pi install npm:@devopstales/pi-ask-user
```

Or bundled with skill-pi (auto-discovered from `extensions/ask-user/index.ts`).

## Usage

The model calls `ask_user` with either a single question or a batch:

```json
{ "question": "Which branch to deploy?", "options": ["main", "staging"] }
```

```json
{
  "questions": [
    { "question": "Which branch?", "options": ["main", "staging"] },
    { "question": "Deploy environment?", "options": ["staging", "prod"] }
  ]
}
```

### Parameters

| Param | Type | Description |
|-------|------|-------------|
| `question` | `string` | Single question (mutually exclusive with `questions`) |
| `questions` | `AskQuestion[]` | Batch of 2–4 questions (mutually exclusive with `question`) |
| `options` | `string[]` | 2–5 option labels (required with `question`) |
| `multiSelect` | `boolean` | Allow multiple selections (commits on Done) |
| `allowFreeform` | `boolean` | When `false`, no custom answer row (default: allowed) |

### Result `details`

Single question:
```json
{ "question": "...", "options": ["..."], "answer": { "kind": "selection", "selections": ["..."] }, "cancelled": false }
```

Batch:
```json
{ "kind": "batch", "questions": [...], "answers": [...], "cancelled": false }
```

## Development

```bash
npm install
npm test          # vitest
npm run check     # tsc --noEmit
```

## License

MIT
