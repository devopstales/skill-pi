# Permission Extension (Opencode-style) — Design Briefing

> **STATUS:** `draft` (2026-10-14)

## Problem / Intent

`skill-pi` has no control over which tool calls the agent may run and no
review surface for file edits. Users want an opencode-style permission layer
— `allow`/`deny`/`ask`/`always` rules, session + persisted approvals, AST-aware
bash matching, and a diff review UI for `edit`/`write` — bundled into the
isolated agent so every `skill-pi` session gets it without touching stock
`~/.pi`. The baseline is the public
[JayGhiya/pi-opencode-permissions-and-preview](https://github.com/JayGhiya/pi-opencode-permissions-and-preview)
`permission` extension, ported onto the project's pi 1.2.0 (`@earendil-works/*`).

## Purpose & Success Criteria

- **Purpose:** give the agent a configurable, reviewable gate in front of tool
  calls, so a user can pre-authorize safe patterns, be prompted for risky ones,
  and visually approve every `edit`/`write` before it runs.
- **Success criteria:**
  - A `tool_call` resolves through the full rule chain
    (`deny > always > session-approvals > ask > allow > defaultMode`) and the
    strictest mode wins for multi-command bash.
  - `ask` on `edit`/`write` shows a Pierre-backed diff review (compact +
    fullscreen, reject-with-feedback); a preview-construction failure blocks the
    tool with the exact error.
  - "Allow always" persists rules to `<project-root>/conf.d/permission.conf`
    under `always` (file-locked, atomic) and they take effect on the next tool
    call with no reload.
  - Auto-accept toggle flips `edit`/`write` to `allow` for the session and the
    status line reflects it.
  - `tsc --noEmit` clean on the extension; `node --test "test/**/*.test.js"`
    green; the extension loads via the wrapper with no wrapper change.
- **Out of scope:**
  - No new `skills/`, `prompts/`, or `themes/` (the reference ships none for this
    extension).
  - No MCP / readability / turndown / jsdom — those deps belong to other
    extensions in the reference fork and are unused here.
  - No wrapper changes — `bin/skill-pi.js` discovery already picks up
    `extensions/permission/index.ts`.
  - No new `diff` package — the reference's `diff` dep is not imported by the
    permission code.

## Context

- **Extension discovery** (`bin/skill-pi.js:18-48`, `178-188`): the wrapper
  enumerates `<pkgRoot>/extensions` (top-level `*.ts` + subdir `index.ts`) and
  passes each as an explicit `--extension` flag, then `--no-extensions`. A new
  `extensions/permission/index.ts` is discovered automatically — **no wrapper
  edit**.
- **Existing extension precedent** (`extensions/file-search/`): a subdir with
  its own `package.json` (deps + dev toolchain) and `index.ts`, whose runtime
  imports (`effect`, `@effect/*`, `@earendil-works/*`) resolve from the **root**
  `node_modules`. pi type-strips the `.ts` (Node native) and imports through the
  root module graph — the extension's own `node_modules` is only for its
  standalone `tsc`/`vitest` check.
- **pi version**: project pins `@earendil-works/pi-coding-agent@1.2.0`; the
  reference targets the older `@mariozechner/pi-coding-agent@0.67`. Every symbol
  the reference imports (`getAgentDir`, `parseFrontmatter`, `getLanguageFromPath`,
  `highlightCode`, `keyHint`, `rawKeyHint`, `Component`, `TUI`, `truncateToWidth`,
  `visibleWidth`, `wrapTextWithAnsi`) is verified present in 1.2.0 — the port is
  an import rename `@mariozechner/*` → `@earendil-works/*` plus a `.js` ESM
  suffix convention.
- **Conventions** (`.skillgrid/config.yaml`, `AGENTS.md`): 2-space indent,
  semicolons, no comments unless asked, minimal scoped changes, verify before
  claiming. The reference uses 4-space + no-semicolons (`.oxfmtrc.json`); the
  port normalizes to project style.
- **Constraint being changed**: the project currently states "production deps:
  pi only; dev deps for tests only." This feature adds runtime deps, so that
  line becomes "production deps: pi + bundled-extension runtime deps" (mirrors
  how `effect`/`@effect/*` are already root deps for `file-search`).
- **In-flight**: `2026-10-14-unified-providers` is at the blueprint gate. This
  change is independent; it lands on its own change branch (stacked-to-main).

Fits existing patterns: **yes** — the `extensions/<name>/index.ts` subdir +
self-contained `package.json` + root-resolved runtime deps is exactly the
`file-search` shape. The only divergence is that this extension adds 4 real
runtime npm deps (vs `file-search`'s already-present `effect`), which the
config/AGENTS policy text must be updated to acknowledge.

## Approaches Considered

- **Chosen:** Full port of the reference `permission` extension as a self-contained
  `extensions/permission/` subdir; runtime deps declared in **both** the root
  `package.json` (for pi's runtime resolution) and the extension `package.json`
  (for its standalone `tsc`/`vitest` check). Rationale: highest fidelity to the
  baseline, matches the `file-search` precedent exactly, zero wrapper changes.
- **Rejected — root-only deps:** leaner (single source of truth) but the
  extension's own `tsc` would depend on the root `node_modules`, breaking the
  "self-contained extension" property the user chose.
- **Rejected — engine-only port (no review UI):** lower dep weight (drops
  `@pierre/*`) but the user explicitly chose the full port including the
  diff review and the auto-accept/observability commands.

## Requirements

1. **R1 — Rule engine evaluates the full chain with strictest-wins for bash.**
   - **Current:** no permission layer; tool calls run unfiltered.
   - **Target:** a `tool_call` handler resolves mode via
     `deny > always > session-approvals > ask > allow > defaultMode`; for `bash`,
     AST-extracted subcommands are each evaluated and the strictest
     (`deny` > `ask` > `allow`) wins.
   - **Acceptance:** unit tests assert `resolveSingleMode`/`resolveMode` return
     the expected mode for a matrix of (rule, tool, arg) inputs incl. a
     multi-command bash string where one command is `deny`.
   - **Acceptance scenario:** `happy path rule-chain-resolves-mode` →
     `acceptance.feature`

2. **R2 — `ask` presents the 5-choice prompt and the auto-feedback path.**
   - **Current:** none.
   - **Target:** `ask` (with UI) shows `Allow once / Allow always / Allow always
     for this session / Reject / Reject with feedback`; `Reject with feedback`
     captures free text as the block reason; a preview-build error on
     `edit`/`write` returns an automatic block with that error as the reason.
   - **Acceptance:** unit tests cover `resolvePermissionRejection` (hard reject,
     feedback, back) and the `asPromptResult` automatic-rejection path.
   - **Acceptance scenario:** `happy path ask-reject-with-feedback` →
     `acceptance.feature`

3. **R3 — `edit`/`write` show a Pierre diff review (compact + fullscreen).**
   - **Current:** none.
   - **Target:** `promptForPermission` builds an in-memory preview (read file,
     strip BOM, normalize to LF, apply edits) and renders it in the
     `PermissionReviewDialog` TUI (compact by default, `Ctrl+F` fullscreen,
     `u`/`s` unified/split for diffs, `PgUp`/`PgDn` scroll, full-content for new
     files). Preview failure → tool blocked with the exact error (no dialog).
   - **Acceptance:** unit tests cover `buildEditPermissionPreview` /
     `buildWritePermissionPreview` (new-file vs overwrite vs error) and
     `applyEditsToNormalizedContent` (unique/overlap/no-op/fuzzy); the dialog
     render is smoke-covered by the E2E gate + manual check.
   - **Acceptance scenario:** `happy path edit-review-diff` → `acceptance.feature`

4. **R4 — "Allow always" persists rules with a file lock + atomic write.**
   - **Current:** none.
   - **Target:** persisting appends to `always` in
     `<project-root>/conf.d/permission.conf` (ADR 0008 project scope:
     `.skill-pi/conf.d/` then `.pi/conf.d/` fallback) via a `wx` lockfile
     (`permission.conf.lock`, retry + stale detection) and a temp-then-rename
     write; rules re-read on the next tool call (no reload).
   - **Acceptance:** integration test on a temp dir asserts the `always` array
     gains the rule exactly once, the lock file is removed, and a concurrent
     second writer either waits or times out per the constants.
   - **Acceptance scenario:** `happy path persist-always-rule` →
     `acceptance.feature`

5. **R5 — Auto-accept toggle + status + optional keybinding.**
   - **Current:** none.
   - **Target:** `/permission-toggle-auto-accept` and an optional
     `keybindings.autoAcceptEdits` shortcut flip `edit`+`write` session mode
     overrides to `allow`; `ctx.ui.setStatus("permission", ...)` reflects the
     on/off state.
   - **Acceptance:** unit test on `toggleAutoAcceptEdits`/`syncSessionStatus`
     asserts the mode-override map and the status string transition.
   - **Acceptance scenario:** `happy path toggle-auto-accept` →
     `acceptance.feature`

6. **R6 — Skill-derived allow rules merge into settings.**
   - **Current:** none.
   - **Target:** trusted local skills (user/project scope) contribute
     `allowed_tools`/`allowed-tools` frontmatter as extra `allow` rules, with
     an mtime+size cache key to avoid re-reading unchanged skills.
   - **Acceptance:** unit test asserts `getDerivedSkillAllowState` returns the
     union of rules from two skills and the cache short-circuits on an
     unchanged key.
   - **Acceptance scenario:** `happy path skill-derived-allow-rules` →
     `acceptance.feature`

7. **R7 — Extension loads via the wrapper with no wrapper change; tsc clean.**
   - **Current:** `file-search` + `skill-pi-banner` load; no permission
     extension.
   - **Target:** `extensions/permission/index.ts` is enumerated by the existing
     `collectExtensionFiles`; `tsc --noEmit -p extensions/permission` passes;
     `node --test "test/**/*.test.js"` green.
   - **Acceptance:** run the wrapper in a temp project and confirm pi logs the
     permission extension loaded (or no error on the `tool_call` path); run
     `tsc` and the test suite and read the output.
   - **Acceptance scenario:** `happy path extension-loads-and-typechecks` →
     `acceptance.feature`

8. **R8 — Deps declared at root + extension; runtime resolves via root.**
   - **Current:** root `package.json` has only pi + effect; `file-search`
     carries `effect` in its own `package.json` too.
   - **Target:** `@pierre/diffs`, `@pierre/theme`, `web-tree-sitter`,
     `tree-sitter-bash` are declared in **both** root `package.json` (runtime)
     and `extensions/permission/package.json` (standalone check); the
     extension's `node_modules` is NOT installed by the root `npm install`
     (private toolchain, like `file-search`).
   - **Acceptance:** `npm install` at root leaves the 4 packages in the root
     `node_modules`; `extensions/permission/node_modules` is absent from a
     fresh root install; `tsc -p extensions/permission` resolves the 4 packages.
   - **Acceptance scenario:** `happy path deps-resolve-at-root` →
     `acceptance.feature`

## Implementation Decisions

- **Modules to build/modify:**
  - New `extensions/permission/` with: `index.ts` (entry + tool_call hook +
    prompt flow + persistence + auto-accept + commands), `constants.ts`,
    `models.ts`, `project.ts` (conf.d settings loader, ported from
    `__lib/project.ts`; path resolution rewritten to ADR 0008), `bash-parser.ts`, `bash-arity.ts`, `rejection.ts`,
    `review-preview.ts`, `review-dialog.ts`, `pierre-highlight.ts`,
    `pierre-metadata.ts`, `pierre-rows.ts`, `pierre-theme.ts`, `pierre-types.ts`,
    `package.json`, `tsconfig.json`, `*.spec.ts`.
  - Modified: root `package.json` (add 4 deps), `.skillgrid/config.yaml`
    (`dependency_policies`), `AGENTS.md` (dep policy line), `README.md`
    ("Currently bundled" list).
- **Interfaces:**
  - Extension entry: `export default function (pi: ExtensionAPI): void`.
  - Settings schema (`PermissionSettings`): `defaultMode?`, `always?: string[]`,
    `allow?: string[]`, `deny?: string[]`, `ask?: string[]`,
    `keybindings?: { autoAcceptEdits?: string }`.
  - **Config location (ADR 0008):** one file per extension, `<name>.conf`, JSON body.
    User scope `$AGENT_HOME/conf.d/permission.conf` where `$AGENT_HOME =
    dirname(getAgentDir())` (`~/.pi` for stock pi, `~/.skill-pi` for skill-pi).
    Project scope `<project-root>/conf.d/permission.conf`, resolved
    `.skill-pi/conf.d/` then `.pi/conf.d/` fallback (bounded ADR 0002 exception).
    Replaces the reference's `<repo-root>/.agents/permission.settings.json`.
    `project.ts` derives the paths from `getAgentDir()` + git root; the lockfile is
    `permission.conf.lock`.
  - Rule grammar: `"tool"` (blanket), `"glob*"` (name glob),
    `"tool(argPattern)"` (arg match). Arg source per tool: `bash`→AST command
    text, `edit/write/read`→`path`, `fetch`→`url`, `grep/find/ls`→`path`.
  - 3-tier settings paths (ADR 0008): user `<agent-home>/conf.d/permission.conf`,
    project `<project-root>/.skill-pi/conf.d/permission.conf` (then `.pi/conf.d/`
    fallback). (The reference's "3 tiers" collapse to 2 scopes under the conf.d
    contract — there is no separate `.local` override; `.pi/conf.d` is the
    host-compat fallback, not a third tier.)
- **Data flow:** `tool_call` → load+merge conf.d settings (project over user,
  ADR 0008) → merge skill allow rules → resolve mode (AST for bash) →
  `allow`/`deny` short-circuit, `ask` → prompt (review dialog for edit/write) →
  on "allow always", lock + atomic write to the project `conf.d/permission.conf`
  `always` array → re-read on next call.
- **Error handling:** invalid settings JSON → throw with path+message (fail
  loud); preview-build failure → block with exact error; no-UI `ask` → block
  with "no UI for confirmation"; persistent-save contention → lock retry with
  5s timeout + 30s stale detection.
- **Dependencies:** the extension imports `@earendil-works/pi-coding-agent`,
  `@earendil-works/pi-tui` (root), and `@pierre/diffs`, `@pierre/theme`,
  `web-tree-sitter`, `tree-sitter-bash` (root at runtime, extension package
  for the check). wasm binaries ship inside the tree-sitter packages and resolve
  via `createRequire(import.meta.url).resolve(...)`.
- **Port notes:** rename `@mariozechner/*` → `@earendil-works/*`; add `.js` ESM
  suffixes to relative imports (the reference already uses them); normalize
  indent/semicolons to project style; drop the `diff` dep (unused); the
  reference's `global.d.ts` (turndown) is dropped (no turndown).

## Testing Decisions

- **What makes a good test:** only test exported behavior (rule resolution,
  preview construction, persistence, rule derivation) — not the TUI internals.
- **Modules to test:** `matchPattern`/`parseRule`/`resolveSingleMode`/
  `resolveMode`; `bash-arity.prefix`; `applyEditsToNormalizedContent`;
  `buildEditPermissionPreview`/`buildWritePermissionPreview`;
  `summarizeDiffMetadata`; conf.d `loadExtensionSettings` merge (project-over-user,
  ADR 0008);
  `getApprovalRules`; `persistApprovalRules` (temp dir, lock + atomic).
- **Prior art:** `extensions/file-search/index.spec.ts` (vitest) and
  `test/**/*.test.js` (node:test) at the root.
- **Edge cases:** non-unique `oldText`, overlapping edits, no-op replacement,
  fuzzy-only match, file-not-found on edit, overwrite-vs-new-file on write,
  multi-command bash with one `deny`, stale lock file, concurrent writers.

## Impact on Global Docs

- `.skillgrid/artifacts/00-prd.md`: add the permission extension as a shipped
  bundled capability (scope/feature).
- `.skillgrid/ASSUMPTIONS.md`: update the dependency policy from "pi only" to
  "pi + bundled-extension runtime deps" (a VERIFIED constraint change); note
  the new bundled extension.
- `.skillgrid/ARCHITECTURE.md`: add `extensions/permission/` to the bundled
  extension inventory with its runtime deps and the root+extension dep split.

## Clarity Report

| Dimension           | Score | Min  | Status | Notes                              |
|---------------------|-------|------|--------|------------------------------------|
| Goal Clarity        | 0.85  | 0.75 | ok     | baseline + full port stated        |
| Boundary Clarity    | 0.80  | 0.70 | ok     | out-of-scope + no-wrapper-change   |
| Constraint Clarity  | 0.75  | 0.65 | ok     | dep policy change made explicit    |
| Acceptance Criteria | 0.80  | 0.70 | ok     | per-requirement checks + scenarios |
| **Clarity**         | 0.15  | ≤0.20| pass   |                                    |

**Interview log:**

| Round | Question summary         | Decision locked                    |
|-------|-------------------------|------------------------------------|
| 1     | scope (engine / +UI / full) | full port of all three features |
| 2     | where deps land (root / self-contained) | self-contained extension (file-search precedent) |
| 3     | runtime dep home (root-only / both) | both root + extension package.json |

## Open Questions & Assumptions

- **Assumption:** `@pierre/diffs` + `@pierre/theme` + `web-tree-sitter` +
  `tree-sitter-bash` are all published and installable at the versions the
  reference pins (`^1.1.15`, `^0.0.29`, `^0.26.8`, `^0.25.1`). If a version
  drifts, the port pins the reference's resolved versions.
- **Assumption:** the `file-search`-style "extension package.json is a private
  toolchain not installed by the root" holds for `permission` too — i.e. the
  root `npm install` does not recurse into `extensions/*/node_modules` (ADR 0007).
- **Assumption:** pi's native type-stripping handles the `permission` TS
  without needing `tsx`/`esbuild` at runtime (verified for `file-search` today).
- **Question (ADR 0007 open):** drift guard for runtime deps declared in both the
  root and the extension `package.json` — E2E "loads" check vs. an explicit
  presence assertion. Resolve at the QA gate.
- **Question (ADR 0008 open):** for a relocated skill-pi agent dir
  (`--agent-dir ~/other-agent`), is `$AGENT_HOME` the parent of the actual agent
  dir (recommended, so conf.d travels with the install) or fixed `~/.skill-pi`?
  And does a non-git project fall back to cwd for the project `conf.d/`? Confirm
  before `project.ts` is written.
- **Dependency (ADR 0002):** the project-scope `.skill-pi/conf.d/` write only works
  once ADR 0002's `piConfig.configDir` + shim-retirement lands; until then the
  resolver falls back to the shim-based project dir or `.pi/conf.d/`. Track the
  ordering.

## Decisions (ADR)

- [ADR 0007 — Bundled extensions are independently packaged units](../artifacts/04-adr-0007-self-contained-extensions.md):
  every bundled extension is `extensions/<name>/` with its own private `package.json`
  (runtime deps + dev toolchain); runtime deps **also** resolve via the root
  `node_modules` because pi type-strips and imports root-relative; no wrapper change.
  This is the packaging contract this change's dep strategy rests on, and it
  reconciles with the proposed-but-not-executed ADR 0004 (separate publication).
- [ADR 0008 — Plugin config lives in `$AGENT_HOME/conf.d/`](../artifacts/04-adr-0008-plugin-config-confd.md):
  extension config is one `<name>.conf` JSON file under `$AGENT_HOME/conf.d/`
  (user, derived from `dirname(getAgentDir())` → `~/.pi` for stock pi,
  `~/.skill-pi` for skill-pi) and `<project-root>/conf.d/` (project,
  `.skill-pi/conf.d/` then `.pi/conf.d/` fallback). The reference's
  `.agents/permission.settings.json` becomes `conf.d/permission.conf`. The
  project `.pi/conf.d` fallback is a bounded, documented ADR 0002 exception —
  the cost of "self-contained + works in stock pi."

## Terms

- **Permission layer** — the rule engine + prompt + review UI that gates tool
  calls. (New, introduced by this feature.)
- **Approval rule** — an `always`-scoped string in settings that auto-allows a
  matching tool call. (New.)
- **Review dialog** — the TUI surface for inspecting an `edit`/`write` before
  approval. (New.)
