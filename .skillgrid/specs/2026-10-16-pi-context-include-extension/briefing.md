# Briefing: pi-context-include (companion extension)

**Date:** 2026-10-16
**Status:** PROPOSED
**Companion to:** `../2026-10-16-pi-vcc-include-awareness/briefing.md` (the pi-vcc
consumer side; this extension is the producer side of the same contract)

## Goal

A new bundled extension `extensions/pi-context-include/` that expands `@path`
references in AGENTS.md into pi's system prompt (per turn), with recursive
resolution, cycle detection, a path-safety fence, a `:status` diagnostic, and a
handshake file for the pi-vcc compactor — a skill-pi homogenization of
`d3ara1n/pi-context-include` (MIT).

## Why (product context)

Projects carry standing rules in multiple files (`docs/api-conventions.md`,
team rules, etc.). Today an agent only sees what's written directly in
AGENTS.md. `@path` includes let one AGENTS.md pull in rule files by reference —
zero duplication, one canonical source per rule file. Upstream
(`d3ara1n/pi-context-include` v3.0.0) proved the design; this change adopts it
into the skill-pi extension family (ADR-0005/0007 shape) and adds the pi-vcc
handshake so included rules also survive compaction.

## Requirements

- **R1 — `@path` extraction.** Line-start-only `@path` references in AGENTS.md
  (optionally after a Markdown list marker `-`/`*`/`+`/`N.`); fenced code
  blocks ignored; relative paths resolve against the containing AGENTS.md;
  `~/` home expansion; absolute paths accepted; `.md` only.
- **R2 — recursive resolution + guards.** Included files can themselves contain
  `@path` refs; realpath-based dedup + cycle detection; depth cap (default 10);
  total size cap (default 500 KB, UTF-8 bytes); every skip is diagnosed with a
  reason (not found / denied / outside allowed roots / depth / size / empty /
  duplicate).
- **R3 — path-safety fence.** Allow-set + deny-set roots (deny always wins).
  Default allow-set: each context file's own directory tree +
  `<agent-dir>/includes/`. `allowedRoots`/`deniedRoots` configurable; an
  explicit `allowedRoots` fully replaces the defaults; `[]` blocks everything.
- **R4 — injection.** Resolved content injected per turn into
  `systemPromptOptions.sections` under a `context_include` tag, each file
  wrapped in `<project_instructions path="<abs>">` so it reads as structured
  project context and unchanged sections are preserved across turns by pi.
  Empty include set → the section is removed (no empty tag).
- **R5 — config.** `contextInclude` block in the global settings
  (`<agent-dir>/settings.json`) and project settings
  (`<cwd>/.pi/settings.json` — project block replaces global block; valid JSON
  only); `maxDepth`, `maxBytes` (finite non-negative numbers, invalid →
  defaults), `allowedRoots`, `deniedRoots`.
- **R6 — `/context-include:status` command.** Shows effective allow/deny roots,
  context files (ok/not found/error), resolved includes (bytes each, total),
  skipped files (reason + ref + resolved path), and a size-limit warning.
- **R7 — pi-vcc handshake.** After each scan, write
  `<agent-dir>/pi-vcc-includes.json` shaped per the companion briefing's
  contract: `{ "includes": [{ "path": "<abs>", "source": "<AGENTS.md path>" }] }`
  — absolute resolved paths of successfully included files. Write is
  best-effort (failure is silent, never breaks the turn). The companion
  pi-vcc change reads this file.
- **R8 — toggle.** `SKILL_PI_CONTEXT_INCLUDE` env var (default on;
  `0/false/no/off` disables) — same convention as `SKILL_PI_WEBFETCH`.

## Out of scope

- Consuming the handshake (that's the companion pi-vcc change).
- Non-`.md` includes (JSON/YAML/TOML intentionally excluded — config/credentials
  live there, instructions don't; upstream design decision, kept).
- pi's own settings discovery / `.pi` handling changes — we only READ
  `<cwd>/.pi/settings.json`, never write it (ADR-0002: separation holds; this is
  a bounded read, same class as the ADR-0008 conf.d project fallback).
- Publish as a standalone npm package (ADR-0004 trigger not met; the
  `package.json` is the ADR-0007 private self-contained shape).

## Success criteria (measurable)

- `bun test` in `extensions/pi-context-include` green (extract, resolve, fence,
  config, status, handshake suites).
- `tsc --noEmit -p .` clean.
- AGENTS.md with `@docs/rules.md` + nested `@sub/team.md` + a cycle → both files
  injected once each, cycle diagnosed, no infinite loop.
- `@~/.skill-pi/agent/includes/shared.md` resolves and injects.
- `@secrets/creds.md` with `deniedRoots: ["./secrets"]` → skipped, reason
  "denied by deniedRoots".
- `/context-include:status` renders the full diagnostic after a turn.
- After a scan, `<agent-dir>/pi-vcc-includes.json` exists with the resolved
  absolute paths; with `SKILL_PI_CONTEXT_INCLUDE=0` no handshake file is written
  and the section is absent.
- Root wrapper suite `node --test "test/**/*.test.js"` still green (new
  extension dir is auto-discovered by `collectExtensionFiles`; no wrapper edit).
