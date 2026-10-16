# lsp — Design Briefing

> **STATUS:** `accepted` (2026-10-16) — change agreed with user in-session:
> copy and homogenize jtepe/pi-lsp into the skill-pi extension family.

## Problem / Intent

`jtepe/pi-lsp` (MIT) provides a `code_symbols` tool for semantic symbol search
backed by LSP servers. It was copied and homogenized into
`extensions/lsp/` in a single session (commit `429fe5d`), following the same
pattern as `pi-hooks` (fork + homogenize + conf.d config). This change brings
it through the QA pipeline: a `small` fast-track covering the full QA gate.

## Purpose & Success Criteria

- `extensions/lsp/` is a self-contained pi extension that registers a
  `code_symbols` tool (search, definitions, references) backed by
  project-configured LSP servers.
- Config lives in conf.d per ADR 0008: `<git-root>/.skill-pi/conf.d/lsp.conf`
  (project) merged over `dirname(getAgentDir())/conf.d/lsp.conf` (user).
- `cd extensions/lsp && npm run check` (tsc --noEmit) is clean.
- `cd extensions/lsp && npm test` (vitest) is green (14 tests).
- Root suite `node --test "test/**/*.test.js"` is unchanged and green.
- The wrapper discovers the extension automatically (no manifest change).
- A live E2E door check proves the extension loads and registers `code_symbols`
  when the wrapper launches pi.

## Constraints

- Self-contained extension (ADR 0007): all files stay in `extensions/lsp/`;
  runtime deps: `minimatch` (real), `@earendil-works/pi-coding-agent` +
  `@earendil-works/pi-ai` + `typebox` (peer).
- Never modify pi source (ADR 0006); the extension resolves the agent dir via
  `getAgentDir()` (ADR 0002) — tests mock that module.
- No comments in code unless asked. Minimal scoped changes.

## Out of Scope

- Tree-sitter-based symbol expansion (reserved field, not implemented).
- Automatic LSP server installation or discovery.
- Rich disambiguation UI for multiple matching symbols.
- New LSP actions beyond search/definitions/references.

## Fast-Track Waiver

Class: `small`. Single concern (one extension port), no new capability beyond
the port, no migration. Skips: brainstorming, blueprint. Tasks: light.
Waiver recorded here per `fast_track.waiver.required: true`.
