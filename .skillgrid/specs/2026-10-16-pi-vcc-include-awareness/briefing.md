# Briefing: pi-vcc include-awareness

**Date:** 2026-10-16
**Status:** PROPOSED

## Goal

Make `pi-vcc` (the algorithmic conversation compactor) include-aware so that
project standing rules referenced from AGENTS.md via `@path` includes survive
compaction and are followable from recall results — without `pi-vcc` depending
on the include-resolution extension the user is building separately.

## Why (product context)

`pi-vcc` compacts the transcript into sticky sections (`Session Goal`,
`Files And Changes`, `Commits`, `Outstanding Context`, `User Preferences`) plus
a rolling brief. Rules that arrive through an AGENTS.md `@path` include tree
(e.g. `@docs/rules.md`) currently vanish on compaction — the compacted agent
keeps acting but forgets the standing rules. Likewise, a recall hit that
mentions `@docs/rules.md` cannot be followed to the file content.

The user is building a separate pi extension based on
`d3ara1n/pi-context-include` (`@path`-in-AGENTS.md expansion into the system
prompt, path-safety fence, `/context-include:status`). The two extensions must
compose through a stable, minimal contract: `pi-vcc` consumes resolved include
paths from a handshake file and never parses `@` syntax itself.

Source of the "learnings" adopted: the `pi-context-include` README +
`extractReferences.test.ts` design (line-start-only, fenced-block-safe
extraction; table-driven edge-case tests; a `:status` diagnostic command;
size/depth guards).

## Requirements

- **R1 — `[Standing Rules]` sticky section.** On compaction, `pi-vcc` reads a
  handshake file of resolved include paths, reads each `.md`, and emits a
  `[Standing Rules]` sticky section in the compacted summary. Sticky-merge
  semantics (line-dedup, cap) — rules survive repeated compactions. The section
  is emitted only when non-empty and is size-capped (no brief bloat).
- **R2 — `vcc_recall` `@path` resolution.** `vcc_recall` (tool +
  `/pi-vcc-recall` command) accepts an `expandRefs` flag. When set, a recall hit
  containing a known include reference has the resolved file's content
  (truncated) appended below the hit.
- **R3 — `/pi-vcc:status` diagnostic command.** Shows the last compaction
  (kept turns, token estimate, cut reason, section list), the effective
  `pi-vcc-config.json` settings, and include-resolver status (which resolved
  paths loaded, which were missing, and the size-cap outcome). Mirrors the
  `/context-include:status` pattern.
- **R4 — table-driven extraction tests.** New and touched extractor tests use
  table-driven suites (`[{ name, input, expected }]`) mirroring the
  `pi-context-include` test style.

## Out of scope

- `@path` parsing in AGENTS.md — owned by the user's include-extension.
  `pi-vcc` only consumes the resolved-path handshake file.
- Re-vendoring `pi-context-include`; no new npm dependency for `pi-vcc`.
- Path-safety fence policy (allow/deny roots) — owned by the include-extension;
  `pi-vcc` trusts the handshake file and caps size only.
- The include-extension itself (separate change, user-authored).

## Success criteria (measurable)

- `bun test` in `extensions/pi-vcc` green, including new table-driven suites.
- `tsc --noEmit -p extensions/pi-vcc` clean.
- Compact a session with a populated handshake file → summary contains
  `[Standing Rules]` with the included rule lines, capped.
- Repeat compaction → `[Standing Rules]` deduped, not stacked.
- `vcc_recall expandRefs:true` on a query matching an `@path` mention →
  resolved file body appended to the hit.
- `/pi-vcc:status` renders last-compaction + settings + include status;
  graceful empty-state before any compaction.

## Constraint: handshake contract

`<agent-dir>/pi-vcc-includes.json` (resolved at runtime via
`getAgentDir()` → `~/.skill-pi/agent/pi-vcc-includes.json`; overridable via
`PI_VCC_INCLUDES_PATH` for tests, same pattern as the existing
`PI_VCC_CONFIG_PATH` env override in `src/core/settings.ts`):

```json
{
  "includes": [
    { "path": "/abs/path/to/docs/rules.md", "source": "AGENTS.md" }
  ]
}
```

- Written by the user's include-extension after it resolves the `@path` tree.
- `pi-vcc` reads it at compaction/recall time; missing file → no integration
  (empty section, no ref expansion), never an error.
- Both extensions test against a shared fixture of this shape, not each other.
- Entry `path` must be an absolute path to a readable `.md`; unreadable or
  non-`.md` entries are skipped (and reported by `:status`).
- Total loaded content capped: ≤ 150 lines / 6 KB, first-wins with a
  `(+N more in <basename>)` footer per file.
