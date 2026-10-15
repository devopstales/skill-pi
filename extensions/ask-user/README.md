# @devopstales/pi-ask-user

`ask_user` tool for pi: pause the agent to collect one or more structured user
decisions in an interactive TUI (or native RPC dialogs).

## Features

- **Structured questions** — 1–4 questions per invocation, each with 2–4 options
- **Multi-select** — `multiSelect: true` enables checkbox rows (commit via the `Next` row)
- **Freeform answer** — a `Type something.` row is appended to every question automatically
- **Previews** — an option's `preview` markdown renders side-by-side in the TUI (single-select only)
- **Notes** — per-answer notes (`n`) and a global note on the Submit tab
- **Batch review** — multi-question dialogs get a Submit tab that reviews every answer
- **TUI popup** — tabbed, keyboard-driven dialog (arrows/Tab to navigate, `Esc` to cancel)
- **RPC dialog fallback** — `ctx.ui.select` / `ctx.ui.input` dialogs for hosts without a custom UI
- **Terminal attention** — a single BEL (`\x07`) on a TTY when the questionnaire starts waiting
- **Events** — outbound `ask_user:prompt` / `ask_user:blocked`; inbound `ask_user:answer` +
  `ask_user:answer-result` (first answer wins); legacy `ask:answered` / `ask:cancelled` for back-compat
- **i18n** — 9 locales (`en`, `de`, `es`, `fr`, `pt`, `pt-BR`, `ru`, `uk`, `zh`) selected by `LC_ALL` / `LC_MESSAGES` / `LANG` (first match wins; a `pt_BR`-style tag falls back to its `pt` prefix), with an English fallback for any missing key

> Ported for full UI/contract parity with [`@juicesharp/rpiv-ask-user-question`](https://github.com/juicesharp/rpiv-mono)
> (MIT), keeping the `ask_user` tool name and skill-pi's self-contained, `conf.d`-based config.

## Install

```bash
pi install npm:@devopstales/pi-ask-user
```

Or bundled with skill-pi (auto-discovered from `extensions/ask-user/index.ts`).

## Usage

The model always calls `ask_user` with `questions[]`:

```json
{
  "questions": [
    {
      "question": "Which branch should we deploy?",
      "header": "Branch",
      "options": [
        { "label": "main", "description": "Production release branch" },
        { "label": "staging", "description": "Staging branch for validation" }
      ]
    }
  ]
}
```

Multi-select with a preview:

```json
{
  "questions": [
    {
      "question": "Which features should we enable?",
      "header": "Features",
      "multiSelect": true,
      "options": [
        { "label": "Dark mode", "description": "Toggle a dark theme" },
        { "label": "Beta features", "description": "Enable experimental flags" }
      ]
    }
  ]
}
```

### Parameters

| Param | Type | Description |
|-------|------|-------------|
| `questions` | `Question[]` | 1–4 questions (required) |
| `questions[].question` | `string` | The full question text |
| `questions[].header` | `string` | ≤16-char chip shown next to the question |
| `questions[].options` | `Option[]` | 2–4 options (required) |
| `questions[].options[].label` | `string` | ≤60-char option label |
| `questions[].options[].description` | `string` | What the option means / its trade-offs |
| `questions[].options[].preview` | `string?` | Optional markdown preview (single-select only) |
| `questions[].multiSelect` | `boolean?` | Allow multiple selections (default `false`) |

Reserved labels (`Other`, `Type something.`, `Next`) are rejected at runtime —
the `Type something.` and `Next` rows are appended automatically.

### Result envelope

Answered:

```
User has answered your questions: "Which branch should we deploy?"="main". You can now continue with the user's answers in mind.
```

Declined / cancelled:

```
User declined to answer questions
```

`details` carries the structured `QuestionnaireResult` (`answers[]` with
`kind: option | custom | multi`, optional `selected[]` / `notes` / `preview`,
`cancelled`, optional `globalNote` / `unanswered[]` / `error`).

## Configuration

Read from `$AGENT_HOME/conf.d/ask-user.conf` (a JSON object). Missing or malformed
file → stderr warning + defaults.

| Field | Description | Default |
|-------|-------------|---------|
| `collapseKey` | Key that collapses/expands the dialog. Pi keybinding ids (`alt+o`, `ctrl+shift+h`); `"off"` disables it. | `"ctrl+]"` |
| `guidance.description` | Full-replace the tool description shown to the model. | built-in |
| `guidance.promptSnippet` | Full-replace the one-line prompt snippet. | built-in |
| `guidance.promptGuidelines` | Full-replace the prompt-guidelines list. | built-in |

```json
{ "collapseKey": "alt+o" }
```

Only the `user` scope is implemented (ADR-0008's `project`/`.skill-pi` merge is not
wired for this extension — YAGNI); the path above is the only config location read.
Unknown top-level keys in the file are ignored (only `collapseKey` and `guidance`
are honored).

### Keyboard

| Key | Action |
|-----|--------|
| `↑` / `↓` | Move between option rows |
| `Tab` / `Shift+Tab` (or `→` / `←`) | Switch question tabs (multi-question dialogs) |
| `Enter` | Confirm the focused option (single-select) / submit a custom answer |
| `Space` | Toggle a checkbox (multi-select) |
| `Next` row + `Enter` | Commit a multi-select answer and advance |
| `Type something.` row | Freeform text entry (multiline via `Shift+Enter`) |
| `n` | Add/edit a note for the current answer (or the global note on the Submit tab) |
| `Ctrl+U` | Clear the custom-answer buffer |
| `Esc` | Cancel the whole questionnaire (or exit the notes editor) |
| `collapseKey` (default `Ctrl+]`) | Collapse/expand the dialog into a one-line row |

**`Ctrl+]` does nothing?** On layouts where `]` is on the shifted layer (Latin
American among them) the default is unreachable. Set `collapseKey` to something
you can type, e.g. `"alt+o"`.

## Development

```bash
npm install
npm test          # vitest (172 tests)
npm run check     # tsc --noEmit
```

## License

MIT
