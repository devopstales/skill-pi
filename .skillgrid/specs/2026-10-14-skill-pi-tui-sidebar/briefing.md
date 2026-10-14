# skill-pi-tui: rename + sidebar with Status card — Design Briefing

> **STATUS:** `draft` (2026-10-14)
> **Tier:** T2

## Problem / Intent

The bundled `skill-pi-banner` extension is a flat single file
(`extensions/skill-pi-banner.ts`) and only renders a startup header. The
`skill-pi-old2` distribution (skillgrid-on-pi) already ships a richer TUI
surface — a right-side **sidebar rail** with a live **Status card**
(project path, git branch, session name, and live git change counts) that
appears in fullscreen at wide terminals. This change renames the extension to
`skill-pi-tui` (its true scope is the whole TUI surface, not just the banner)
as a **self-contained folder-based extension** per ADR-0007, and ports the
old2 sidebar + card rendering into it. The extension is **not** published
separately — it is part of `@devopstales/skill-pi` (per maintainer decision,
2026-10-14).

## Purpose & Success Criteria

- **Purpose:** every `skill-pi` TUI session gets the sidebar with a live
  Status card at no configuration, and the extension lives in the ADR-0007
  folder shape so future TUI features (todo card, working indicator, usage
  windows) have a home.
- **Success criteria:**
  - `extensions/skill-pi-tui/` exists with `index.ts` + `package.json`
    (`private: true`, no `name`) + `src/` modules; the old
    `extensions/skill-pi-banner.ts` is gone.
  - The banner still renders on `session_start` exactly as today (logo,
    tagline, stats grid) via `setHeader`.
  - In fullscreen mode at terminal width ≥ 140, a right-side rail renders a
    **Status card** showing: project path (home-shortened), git branch,
    session name (when set), and live change counts (`N files · +added −deleted`)
    from `git diff --numstat HEAD` + `git status --porcelain`, refreshed every
    2s.
  - Below 140 columns, in regular (non-fullscreen) mode, or in
    print/RPC mode, the layout is byte-identical to pi's default (native
    fallback; no rail, no footer replacement).
  - `tsc --noEmit` clean in the extension; `node --test "test/**/*.test.js"`
    green; the extension loads via the wrapper with no wrapper change.
- **Out of scope:**
  - No bottom status bar replacement, no header chrome, no working-indicator
    editor (old2 `SkillgridPromptEditor`) — all deferred.
  - No todo card, background jobs, or usage windows (old2 features without
    counterparts in this project).
  - No new runtime npm dependencies — everything resolves from the existing
    root `node_modules` (`@earendil-works/pi-tui`, `node:*` builtins).
  - No wrapper change — `collectExtensionFiles` already discovers
    `extensions/skill-pi-tui/index.ts`.
  - No separate publication of the extension (no `name`, no `publishConfig`).

## Context

- **Extension discovery** (`bin/skill-pi.js`, `collectExtensionFiles`): the
  wrapper enumerates `<pkgRoot>/extensions` (top-level `*.ts` + subdir
  `index.ts`) and passes each as an explicit `--extension` flag, then
  `--no-extensions` (ADR-0001). Renaming the file to
  `extensions/skill-pi-tui/index.ts` keeps it discovered — **no wrapper
  edit**. The uncommitted ADR-0002 work in the working tree (shim retired,
  `extensions/package.json` deleted) does not affect discovery, which is
  wrapper-enumeration-based, not manifest-based.
- **Folder shape precedent** (`extensions/file-search/`): subdir with own
  `package.json` (private dev toolchain) + `index.ts`; runtime imports resolve
  from the **root** `node_modules` (pi loads the extension's `.ts` through the
  root module graph); the extension's own `node_modules` serves its standalone
  `tsc`/`vitest` check. ADR-0007 is the in-force contract for exactly this.
- **Port source** (`~/git/ai-test/skill-pi-old2/`): `lib/skillgrid-sidebar.ts`
  (44 lines — parts registry on the TUI terminal object via `Symbol.for`),
  `lib/skillgrid-sidebar-layout.ts` (303 lines — patches the alt-screen
  layout root into an hstack: main column + 50-col `ScrollView` rail, 140-col
  breakpoint, 100ms re-attach loop, native fallback), `lib/skillgrid-card.ts`
  (327 lines — panel/outline card rendering with float style),
  `lib/skillgrid-changes.ts` (100 lines — git numstat/porcelain capture),
  `lib/skillgrid-terminal-theme.ts` (ANSI sanitize for user-facing strings).
  These are plain `.ts` with no build step; the port normalizes
  `skillgrid`-named symbols to `skill-pi-tui`-named symbols.
- **pi 1.2.0 compatibility (verified against installed dist):**
  - `@earendil-works/pi-tui` exports `TUI`, `ScrollView`, `VStack`, `HStack`,
    `Component`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi` — every
    symbol the old2 layout code needs.
  - The layout-node symbol `Symbol.for("@earendil-works/pi-tui/layout-node")`
    and the `TuiAltScreen.layoutRoot` member exist in the installed pi 1.2.0
    bundle — the old2 patcher's assumptions hold against this exact version.
  - `ctx.ui.setHeader` / `ctx.ui.setFooter` factories receive
    `(tui: TUI, theme: Theme, …)`; `Theme` has `fg`/`bg`/`bold`.
  - `footerData.getGitBranch()` and `footerData.getExtensionStatuses()`
    (from `ctx.ui.setStatus`) exist on `ReadonlyFooterDataProvider`.
- **Conventions** (`.skillgrid/config.yaml`, `AGENTS.md`): 2-space indent,
  semicolons, no comments unless asked, minimal scoped changes, verify before
  claiming.

Fits existing patterns: **yes** — `extensions/<name>/index.ts` + private
`package.json` + root-resolved runtime deps is the `file-search` shape (the
only difference: no new runtime deps at all).
