# skill-loader

Progressive-disclosure skills for pi: a compact skill catalog in session
context plus a `use_skill` tool that loads full SKILL.md bodies on demand.

At `session_start` (startup or new) the extension scans the skill sources
once, renders a compact catalog (one `- <name>: <description>` line per
skill, grouped by zone), and injects it into the session context as a
hidden custom message (the same mechanism `pi-hooks` uses for SessionStart
additional context). The `context` handler re-attaches the catalog when the
transcript loses it (compaction, branch navigation) and stays idempotent —
an unchanged catalog is never appended twice.

## Sources

First match per skill name wins (project-local overrides the hub mirror):

1. `<project>/.agents/skills/` — project-local override (project = git root of cwd)
2. `~/.skillgrid/.agents/skills/` — the skillgrid hub mirror (primary)
3. `~/.agents/skills/` — fallback
4. `<pkgRoot>/skills/` — skill-pi's own bundled skills (may be empty)

A skill is a directory containing a file named exactly `SKILL.md` with YAML
frontmatter (`name`, `description`, optional `disable-model-invocation:
true`; `metadata:` blocks are skipped). Files missing `name` or
`description` are excluded with a stderr note — never a throw.

## Catalog

- `disable-model-invocation: true` skills are excluded from the catalog but
  stay loadable via `use_skill` by name.
- Size budget: 32768 chars. Over budget, the core zones (lifecycle,
  planning, execution, verification) are kept in full and every other zone
  collapses to `### <zone>` + `(N skills — use use_skill by name)`.
- Opt-out: `SKILL_PI_SKILLS=0` disables catalog injection (the tool stays
  registered). `<agent-dir>/conf.d/skill-loader.conf` as `{"enabled": false}`
  does the same (ADR 0008 conf.d, same pattern as the lsp extension).
- All source dirs missing → tool registered with an empty catalog, nothing
  injected: a skill-pi session without a hub install is a clean state.

## Tool: `use_skill`

Input: `{ id: string }`. Returns the full SKILL.md body with the frontmatter
stripped. Bodies over 40000 chars are truncated and reported as
`{ truncated: true, size: <full size>, path: <file> }` in details. Unknown
ids return an error listing up to 10 closest matches (case-insensitive
prefix/substring). The tool always resolves against the same sources, so it
works when the catalog is disabled or empty.

## Files

- `index.ts` — entry: scan, inject, register tool
- `scan.ts` — discovery + frontmatter parse (pure functions)
- `catalog.ts` — catalog rendering + budget logic (pure functions)
- `tool.ts` — `use_skill` tool definition

## Tests

`node --test "test/*.test.ts" "test/*.test.mjs"` — fixtures live under
`test/` and point nowhere near a live `~/.skillgrid`.
