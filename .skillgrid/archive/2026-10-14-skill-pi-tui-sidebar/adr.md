# ADR Review Manifest — 2026-10-14-skill-pi-tui-sidebar

ADR review for the `skill-pi-banner` → `skill-pi-tui` rename + sidebar port. No
new ADR file is created — the packaging shape is already fixed by ADR-0007 and
the extension's non-publication was a maintainer decision recorded in the
briefing.

## In-force ADRs reviewed

| ADR | Status at review | Relevance to this change |
|-----|------------------|--------------------------|
| [ADR 0001](../../artifacts/04-adr-0001-extension-loading-via-dir-manifest.md) | accepted | Discovery is wrapper enumeration + `--no-extensions`. `extensions/skill-pi-tui/index.ts` is picked up by `collectExtensionFiles` with no wrapper edit. The old flat `skill-pi-banner.ts` disappears from `extensions/` root; nothing else references it by path. |
| [ADR 0002](../../artifacts/04-adr-0002-full-separation-from-pi.md) | proposed (uncommitted work in tree) | The sidebar writes no state to `~/.pi` or `<repo>/.pi`; all state is per-process (in-memory parts map, unref'd timers) plus read-only `git` subprocess calls in the session cwd. Isolation invariants preserved. |
| [ADR 0003](../../artifacts/04-adr-0003-taskfile-as-automation-standard.md) | accepted | No new lifecycle ops: the extension's `check`/`test` are `package.json` scripts invoked directly, mirroring `file-search`. No Taskfile edit needed (file-search's local install is equally opt-in). |
| [ADR 0004](../../artifacts/04-adr-0004-extensions-as-separately-published-packages.md) | superseded (scope) by ADR-0005 | **Not exercised.** Per maintainer decision (2026-10-14) this extension is bundled-only — no published package, so no `name`/`publishConfig` in its `package.json`. If it is ever split, ADR-0004/0005 apply at that time. |
| [ADR 0005](../../artifacts/04-adr-0005-package-naming-devopstales-scope.md) | accepted | Naming constraint applies **only at publish time** (would be `@devopstales/pi-tui`). No publish in this change; in-tree paths are `extensions/skill-pi-tui/`. |
| [ADR 0006](../../artifacts/04-adr-0006-never-modify-pi-source.md) | accepted | The sidebar works by *patching the layout root at runtime* (swapping `layoutRoot[LAYOUT_NODE]` on the live TUI instance), exactly like old2. No pi source file is modified, forked, or post-install edited; the patch is applied per session via the public `setFooter` seam and restored on `session_shutdown`. |
| [ADR 0007](../../artifacts/04-adr-0007-self-contained-extensions.md) | proposed | **Primary contract.** `extensions/skill-pi-tui/` is a self-contained subdir: own `package.json` (private, toolchain only), `index.ts` entry, runtime deps resolve via the root `node_modules`. This change also ratifies its first use for an extension with **zero** third-party runtime deps (only pi + node builtins). |
| [ADR 0008](../../artifacts/04-adr-0008-plugin-config-confd.md) | proposed | Not exercised — the sidebar reads no config; all presentation defaults are hardcoded (old2's visual-customization policy is dropped with the header chrome). |

## ADR files created by this change

None.

## ADR files superseded by this change

None.

## Notes for executors

- The rename is a `git mv` of the banner file into the new folder's
  `index.ts` (commit 1); subsequent tasks grow the folder. History is preserved.
- The old2 source tree (`~/git/ai-test/skill-pi-old2/lib/skillgrid-*.ts`) is
  the port source of record. Port with symbol renames (`skillgrid` → `skill-pi-tui`
  in `Symbol.for` keys and exported names), rebranding, and the documented
  deletions (todo/jobs/usage/profile fields, visual-settings policy, feature
  flags). Do not copy file-by-file without reading the port notes in the
  blueprint's tasks.
- The uncommitted ADR-0002 changes in the working tree (deleted
  `lib/shim.js`, `extensions/package.json`, rewritten `bin/skill-pi.js` and
  `lib/brand.js`) belong to the parallel ADR-0002 work, not to this change.
  This change's commits must not stage those files.
- **Exception — `extensions/skill-pi-banner.ts`:** at HEAD this file is a 6-line
  `ctx.ui.notify(...)` stub. The full logo/tagline/stats-grid implementation is
  uncommitted working-tree work from the ADR-0002 era, and Task 1's `git mv`
  commits that content as part of this change's rename commit. This is deliberate:
  the rename targets the banner *as it is now*, and leaving the implementation
  uncommitted would strand it. The acceptance scenario "Banner renders the full
  header" pins the baseline as "the working-tree banner at plan time", not the
  HEAD stub.
