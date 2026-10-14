# skill-pi-tui: rename + sidebar with Status card — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use skillgrid:subagent-execution (recommended) or skillgrid:simple-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PROPOSED

**Tier:** T2

**Build shape:** Tracer thread — the first task moves the working banner into the final folder shape (the end-to-end load path exists from commit 1), then each later task thickens the surface with a testable module.

**Goal:** Rename `skill-pi-banner` to the folder-based `skill-pi-tui` extension (ADR-0007 shape, bundled-only) and port the skill-pi-old2 sidebar rail with a live Status card into it.

**Architecture:** One bundled extension at `extensions/skill-pi-tui/` with an `index.ts` entry and `src/` modules. `index.ts` keeps today's banner (`setHeader`, unchanged) and adds a `setFooter` component that (a) registers a `footer` sidebar part rendering the Status card and (b) calls `installSidebar`, which patches the alt-screen layout root into an hstack (main column + 50-col `ScrollView` rail) when in fullscreen at ≥140 columns, and restores pi's native layout in every other case (the old2 mechanism, ported). Git change counts are captured on a 2s unref'd interval into the card.

**Tech Stack:** TypeScript (raw `.ts`, no build step — pi loads it via jiti / Node native type-stripping), `@earendil-works/pi-tui` (`TUI`, `ScrollView`, `VStack`, `HStack`, `Component`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`), `@earendil-works/pi-coding-agent` (`ExtensionAPI`, `ExtensionContext`, `Theme`, `ReadonlyFooterDataProvider`, `SettingsManager`, `DefaultResourceLoader`, `getAgentDir`, `VERSION`), `node:*` builtins only. No new runtime npm dependencies.

**Spec:** `./briefing.md` (in-force ADR set: `./adr.md`; packaging contract per `.skillgrid/artifacts/04-adr-0007-self-contained-extensions.md`; loading per `.skillgrid/artifacts/04-adr-0001-extension-loading-via-dir-manifest.md`)

## Terms

None — the plan reuses the spec's terms (extension, sidebar rail, Status card, layout root, native fallback).

## Hypothesis

**Claim:** The skill-pi-old2 sidebar mechanism (layout-root patching against `TuiAltScreen.layoutRoot` + `Symbol.for("@earendil-works/pi-tui/layout-node")`) works unchanged against the project's installed `@earendil-works/pi-coding-agent@1.2.0`, so the rail can be ported — not re-derived — with only symbol renames and the documented field deletions.

**Right condition:** In a live fullscreen `skill-pi` session at ≥140 columns the rail renders the Status card and the main chat column shrinks by 53 columns; at <140 columns or in regular mode the layout is byte-identical to pi's default; `session_shutdown` restores the original layout-node function with no leaked timers.

**Wrong condition:** The rail does not appear, the main column renders with layout corruption (overlapping/misaligned rows), the native fallback diverges from stock pi output, or a crash/hang occurs at session start or shutdown.

**Thinnest MVP:** Task 4's end-to-end scenario — banner + rail with live counts in one session, plus the native-fallback check at <140 columns.

**Door check:** Task 3 (sidebar layout). If the patcher does not produce a working rail against pi 1.2.0, the hypothesis is falsified — stop, and fall back to a `setWidget`-above-editor card (simpler, no layout patching) or drop the sidebar and keep only the card in the footer.

## Must-Haves (goal-backward verification)

**Truths** (observable behaviors that must hold):

- The banner renders on `session_start` (rows ≥ 12, columns ≥ 50) with logo, tagline, and the 8-cell stats grid — output identical to the pre-change `skill-pi-banner.ts`.
- In fullscreen at terminal width ≥ 140 the layout root becomes an hstack: `[main (grow/shrink), rail ScrollView (basis 50, fixed)]` with a 3-column gap; the rail renders the Status card. `backstop` — held-out by Task 4's live session check (resize across the 140 boundary).
- In fullscreen at width < 140, in regular (non-fullscreen) mode, or when `tui.terminal` is absent, the layout root remains pi's original (native fallback); the footer component renders `[]` and pi's default footer is untouched. `backstop` — held-out by Task 4's narrow-terminal live check.
- The Status card shows a Project group (home-shortened path, git branch when present, session name when set) and a Changes group (`N files · +added −deleted`), refreshed by a 2s unref'd timer from `git diff --numstat HEAD` + `git status --porcelain=v1 --untracked-files=all -z`.
- Outside a git repo the Changes group shows a notice line; git subprocess failure never throws into the render path.
- On `session_shutdown`: the layout-node function is restored to pi's original, the 100ms attach timer and 2s changes timer are cleared, and the footer factory is cleared (`setFooter(undefined)`).
- `node --test "test/**/*.test.js"` is green and the new extension passes `tsc --noEmit` and `vitest run` locally.

**Artifacts** (files that must exist with real implementation, not stubs):

- `extensions/skill-pi-tui/index.ts` — entry: banner (ported verbatim from the old `skill-pi-banner.ts`) + sidebar wiring.
- `extensions/skill-pi-tui/package.json` — `private: true`, no `name`, toolchain devDeps + `check`/`test` scripts (file-search shape minus runtime deps).
- `extensions/skill-pi-tui/tsconfig.json`, `extensions/skill-pi-tui/.gitignore`, `extensions/skill-pi-tui/.npmrc` — file-search scaffolding.
- `extensions/skill-pi-tui/src/card.ts` — panel/outline card rendering (port of old2 `skillgrid-card.ts`, rebranded, trimmed).
- `extensions/skill-pi-tui/src/text.ts` — ANSI strip/sanitize (port of old2 `skillgrid-terminal-theme.ts`).
- `extensions/skill-pi-tui/src/changes.ts` — git change capture (port of old2 `skillgrid-changes.ts`).
- `extensions/skill-pi-tui/src/sidebar.ts` — parts registry on the TUI terminal object (port of old2 `skillgrid-sidebar.ts`).
- `extensions/skill-pi-tui/src/sidebar-layout.ts` — layout-root patcher (port of old2 `skillgrid-sidebar-layout.ts`, rebranded, todo/jobs fields deleted).
- `extensions/skill-pi-tui/src/status-card.ts` — Status card model + renderer (new, composed from `card.ts` + `text.ts`).
- `extensions/skill-pi-tui/native-tui-loader.mjs` — strict-load regression entry (old2 `native-bar-loader.mjs` shape).
- `extensions/skill-pi-tui/index.spec.ts` — vitest suite for the card, text, and changes modules.
- `test/skill-pi-tui.test.js` — root node:test suite: strict-load + wrapper enumeration scenarios.
- `README.md` — "Currently bundled" entry updated to `skill-pi-tui`.
- `.skillgrid/specs/2026-10-14-permission-extension/briefing.md` — "Current:" line updated (`skill-pi-banner` → `skill-pi-tui`).

**Key links** (critical connections that must work together):

- `index.ts`'s `setFooter` factory must register the `footer` sidebar part **and** call `installSidebar` on the same `tui` instance — the rail reads parts from `sidebarState(tui)`, keyed by the `Symbol.for` shared with `sidebar.ts`.
- `installSidebar`'s section list must include the key `"footer"` — that is the key the Status card registers under.
- The changes timer in `index.ts` must write into the same `currentChanges` closure the footer part's `render` reads, and call `tui.requestRender()` after each capture.
- `captureChanges(cwd)` must be called with the **session** cwd (`ctx.cwd`), never the wrapper's cwd.
- `git mv` must preserve `skill-pi-banner.ts` history into `extensions/skill-pi-tui/index.ts`.

**One-way-door decisions:**

- None. The rename only moves an in-repo file (reversible by `git mv` back); the extension is not published; no public API, migration, or cross-package contract changes. The layout-root patching is runtime-only and restored on shutdown (per ADR-0006 it is a seam use, not a pi modification).

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Documentation-like paths | N/A: no path classification or execution — the extension loads a fixed `index.ts` entry via wrapper enumeration | — | — |
| Git repository selection | Applicable: `captureChanges` and the banner's `gitBranch` spawn `git` in the session cwd; a wrong cwd or a non-git dir would corrupt the card or throw | `execFile`/`execFileSync` with explicit `cwd: ctx.cwd`; every git call is wrapped so a non-zero exit or missing binary resolves to an empty model / `"(not a git repo)"` instead of throwing | `index.spec.ts`: temp git repo with known numstat/porcelain state → exact counts; temp non-git dir → empty model; `test/skill-pi-tui.test.js`: strict loader exits 0 |
| Commit state | N/A: `git diff HEAD` + `status --porcelain` are read-only and need no staged/commit semantics beyond what the capture tests exercise | — | — |
| Push state | N/A: no push, fetch, or network git command is run | — | — |
| PR commands | N/A: no PR automation | — | — |
| Mnemonic tool surface | N/A: no `mem_*`/`code_*`/`web_cache_*` contract changes | — | — |
| Shared-convention drift | N/A: no `_shared/*.md` or `agent-config` file is edited | — | — |

## Global Constraints

- Node >= 22.19.0, ESM (`"type": "module"`) — per `.skillgrid/ASSUMPTIONS.md` § VERIFIED.
- 2-space indent, semicolons, no comments in code unless asked — per `.skillgrid/config.yaml` `agents` + `AGENTS.md`.
- No new runtime npm dependencies — root `package.json` is untouched; all imports resolve from the existing root `node_modules` or `node:*` (per ADR-0007: runtime deps resolve via the root; this extension adds none).
- The extension `package.json` is `private: true` and is **not** installed by the root `npm install` — per ADR-0007.
- No wrapper change: `bin/skill-pi.js` is not edited — per ADR-0001 (discovery is `collectExtensionFiles` enumeration).
- Never read or write the stock `~/.pi/agent` — per `.skillgrid/ASSUMPTIONS.md` § VERIFIED.
- The uncommitted ADR-0002 work in the working tree (`bin/skill-pi.js`, `lib/brand.js`, `lib/config.js`, `lib/shim.js` deletion, `extensions/package.json` deletion, `test/` edits, ADR-0001 doc edit) is **not** staged or committed by this change — each commit stages only this change's files (per `./adr.md` notes). **Exception:** `extensions/skill-pi-banner.ts` — at HEAD it is a 6-line `notify` stub; the full logo/tagline/stats-grid banner is uncommitted working-tree work, and Task 1's `git mv` commits that content inside this change (deliberate, per `./adr.md` notes).
- Brand strings: `skill-pi` (not `skillgrid`); the banner keeps its exact current logo/tagline/colors.
- Port source of record: `~/git/ai-test/skill-pi-old2/lib/skillgrid-*.ts` (read at execution time; the files are stable in that checkout).

## File Structure

- `extensions/skill-pi-tui/index.ts` — extension entry: default export `(pi) => void`; `session_start` → banner via `setHeader` + sidebar wiring via `setFooter`; `session_shutdown` → cleanup. Owns the changes-refresh timer.
- `extensions/skill-pi-tui/src/card.ts` — card/panel rendering: `CARD_TONE`, `CardTheme`, `renderCard`, `cardTop`, `cardLine`, `cardBottom`, `cardInnerWidth`, `floatRows`, `panelInnerWidth`, `cardStyle` (global slot), `CARD_STYLE`. No todo/jobs/usage imports.
- `extensions/skill-pi-tui/src/text.ts` — `stripAnsi(value: string): string`, `sanitizeTerminalText(value: string): string`.
- `extensions/skill-pi-tui/src/changes.ts` — `ChangedFile`, `ChangesModel`, `emptyChanges()`, `captureChanges(cwd: string): Promise<ChangesModel>`.
- `extensions/skill-pi-tui/src/sidebar.ts` — `SidebarState`, `SidebarRail`, `sidebarState(tui)`, `sidebarPart(tui, key, bottom, rail?)`, `sidebarHeader(tui, rail)` (kept for API parity; unused by index.ts).
- `extensions/skill-pi-tui/src/sidebar-layout.ts` — `SIDEBAR_BREAKPOINT = 140`, `invalidateSidebar(tui)`, `installSidebar(tui, theme, placement?, headerPlacement?, density?): () => void` (patcher + re-attach loop + native fallback).
- `extensions/skill-pi-tui/src/status-card.ts` — `StatusCardModel` (cwd, branch, sessionName, changes), `renderStatusCard(model, theme, width): string[]`.
- `extensions/skill-pi-tui/native-tui-loader.mjs` — ESM entry that imports the four ported modules and prints `ok`.
- `extensions/skill-pi-tui/index.spec.ts` — vitest: `captureChanges` (temp git repo + non-git dir), `sanitizeTerminalText`, `renderStatusCard` (fake theme, width assertions), `renderCard` frame shape.
- `test/skill-pi-tui.test.js` — node:test: strict-load scenario (spawn `node extensions/skill-pi-tui/native-tui-loader.mjs`) + wrapper enumeration scenario (read `bin/skill-pi.js`, assert `collectExtensionFiles` resolves `extensions/skill-pi-tui/index.ts` and no `skill-pi-banner.ts` path remains).
- `README.md` — modify "Currently bundled" section: replace the `skill-pi-banner` bullet with a `skill-pi-tui` bullet (banner + sidebar description).
- `.skillgrid/specs/2026-10-14-permission-extension/briefing.md` — modify the "Current:" context line to reference `skill-pi-tui`.

---

### Task 1: Rename skill-pi-banner to folder-based skill-pi-tui

**Files:**
- Create: `extensions/skill-pi-tui/` (dir)
- Move: `extensions/skill-pi-banner.ts` → `extensions/skill-pi-tui/index.ts` (git mv)
- Create: `extensions/skill-pi-tui/package.json`
- Create: `extensions/skill-pi-tui/tsconfig.json`
- Create: `extensions/skill-pi-tui/.gitignore`
- Create: `extensions/skill-pi-tui/.npmrc`
- Test: `test/skill-pi-tui.test.js`
- Modify: `README.md` ("Currently bundled" section)
- Modify: `.skillgrid/specs/2026-10-14-permission-extension/briefing.md` (line ~170 "Current:" context)

**Interfaces:**
- Consumes: nothing from this change (the banner code is self-contained; it imports only `node:*` + `@earendil-works/pi-coding-agent` + `@earendil-works/pi-tui`).
- Produces: `extensions/skill-pi-tui/index.ts` with `export default function (pi: ExtensionAPI): void` — the entry `collectExtensionFiles` discovers; the exact same `session_start` → `setHeader` banner behavior as today.
- Seam: none (in-process).
- Deletion test: deleting the folder removes the banner header — the TUI shows pi's default header. Callers: pi's `session_start` event fan-out only.
- Adapters: 1 (the real pi runtime); tests exercise the file on disk, not a stub.

**SATISFIES:** `Folder structure exists and old file is gone`, `Extension loads via wrapper enumeration`, `Banner behavior unchanged`

- [ ] **Step 1: Write the failing test**

Create `test/skill-pi-tui.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(pkgRoot, "extensions", "skill-pi-tui");

test("skill-pi-tui is a folder-based extension (ADR-0007 shape)", () => {
  assert.ok(existsSync(join(extDir, "index.ts")), "index.ts must exist");
  assert.ok(!existsSync(join(pkgRoot, "extensions", "skill-pi-banner.ts")), "old flat file must be gone");
  const pkg = JSON.parse(readFileSync(join(extDir, "package.json"), "utf8"));
  assert.equal(pkg.private, true, "extension package.json must be private");
  assert.equal(pkg.name, undefined, "extension package.json must not carry a name");
});

test("wrapper enumeration resolves extensions/skill-pi-tui/index.ts", () => {
  const binSrc = readFileSync(join(pkgRoot, "bin", "skill-pi.js"), "utf8");
  assert.match(binSrc, /collectExtensionFiles/);
  const entry = join(extDir, "index.ts");
  const st = statSync(entry);
  assert.ok(st.isFile());
  assert.equal(join(extDir, "index.ts").endsWith("index.ts"), true);
  const topFiles = readdirSync(join(pkgRoot, "extensions"), { withFileTypes: true });
  assert.ok(!topFiles.some((e) => e.name === "skill-pi-banner.ts"));
});

test("skill-pi-tui native type-stripping load", () => {
  const loader = join(extDir, "native-tui-loader.mjs");
  const r = spawnSync(process.execPath, [loader], { encoding: "utf8" });
  assert.equal(r.status, 0, `loader must exit 0, stderr:\n${r.stderr}`);
  assert.match(r.stdout, /ok/);
});
```

Note: the third test fails at this step because `native-tui-loader.mjs` does not exist yet — create a minimal one now so Task 1's commit is green, and Task 2 extends it. The loader checks `typeof mod === "object"` (not `typeof fn === "function"`) because `@earendil-works/pi-coding-agent` has no CJS `exports` main: under Node native type-stripping its default import resolves to the module namespace object. pi itself loads the extension via jiti (which interop-defaults it), so both forms are valid at runtime — the loader only needs to prove the import graph resolves.

```mjs
// extensions/skill-pi-tui/native-tui-loader.mjs
// Strict-load regression: pi loads the extension through the root module
// graph; a missing runtime export would throw here first.
import mod from "./index.ts";
if (typeof mod !== "function" && typeof mod !== "object") {
  throw new Error("expected index.ts default export to be a function or module namespace");
}
console.log("ok");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skill-pi-tui.test.js`
Expected: tests 1 and 2 FAIL (`index.ts must exist` — the folder does not exist yet); test 3 (`native type-stripping load`) also fails at this point because the loader imports `./index.ts` which does not exist yet. After Step 3's `git mv` + loader creation, all three pass — this task's RED/GREEN is file-shape, and the loader is introduced in the same step as the move it validates.

- [ ] **Step 3: Write minimal implementation**

```bash
git mv extensions/skill-pi-banner.ts extensions/skill-pi-tui/index.ts
```

(`git mv` into the new dir — no content edit; the banner stays byte-identical.)

Create `extensions/skill-pi-tui/package.json`:

```json
{
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "description": "skill-pi TUI surface: startup banner and fullscreen sidebar with a live Status card. Bundled with @devopstales/skill-pi; not published separately.",
  "files": [
    "index.ts",
    "src",
    "native-tui-loader.mjs",
    "README.md"
  ],
  "scripts": {
    "check": "tsc --noEmit -p .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@earendil-works/pi-coding-agent": "^1.2.0",
    "@earendil-works/pi-tui": "*"
  },
  "devDependencies": {
    "@types/node": "^24.0.0",
    "typescript": "^5.5.0",
    "vitest": "^5.0.0"
  }
}
```

(The `dependencies` block is documentation of the dep footprint per ADR-0007 — these packages are already in the root `node_modules`; the extension package itself is `private` and never installed by the root.)

Create `extensions/skill-pi-tui/tsconfig.json`:

```json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true,
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "noEmit": true,
    "skipLibCheck": true,
    "strict": true,
    "target": "ES2022",
    "types": ["node"],
    "verbatimModuleSyntax": true
  },
  "include": ["index.ts", "src/**/*.ts", "native-tui-loader.mjs", "*.spec.ts"]
}
```

Create `extensions/skill-pi-tui/.gitignore`:

```
node_modules/
*.tgz
```

Create `extensions/skill-pi-tui/.npmrc`:

```
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Create `extensions/skill-pi-tui/native-tui-loader.mjs` exactly as in Step 1.

Update `README.md` — replace the `skill-pi-banner` bullet in "Currently bundled" with:

```md
- **`skill-pi-tui`** — the TUI surface: a `session_start` header (logo, tagline,
  session stats grid) confirming the isolated session, plus a fullscreen
  right-side sidebar (terminals ≥ 140 columns) with a live Status card
  (project path, git branch, session name, uncommitted change counts).
```

Update `.skillgrid/specs/2026-10-14-permission-extension/briefing.md` line ~170:
change `` `file-search` + `skill-pi-banner` load `` → `` `file-search` + `skill-pi-tui` load ``.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/skill-pi-tui.test.js`
Expected: PASS (3/3).
Run: `node --test "test/**/*.test.js"`
Expected: PASS — full suite green (the `--print` integration test boots pi with the renamed extension and proves it loads).

- [ ] **Step 5: Commit**

```bash
git add extensions/skill-pi-tui test/skill-pi-tui.test.js README.md .skillgrid/specs/2026-10-14-permission-extension/briefing.md
git commit -m "refactor: rename skill-pi-banner to folder-based skill-pi-tui (ADR-0007 shape)"
```

(Stage only these paths — never the uncommitted ADR-0002 files.)

### Task 2: Port card, text, and changes modules

**Files:**
- Create: `extensions/skill-pi-tui/src/card.ts`
- Create: `extensions/skill-pi-tui/src/text.ts`
- Create: `extensions/skill-pi-tui/src/changes.ts`
- Create: `extensions/skill-pi-tui/index.spec.ts`
- Modify: `extensions/skill-pi-tui/native-tui-loader.mjs`

**Interfaces:**
- Consumes: port sources `~/git/ai-test/skill-pi-old2/lib/skillgrid-card.ts`, `skillgrid-terminal-theme.ts`, `skillgrid-changes.ts` (read at execution time).
- Produces (exact export surface — later tasks import these names):
  - `src/text.ts`: `stripAnsi(value: string): string`; `sanitizeTerminalText(value: string): string`
  - `src/changes.ts`: `interface ChangedFile { path: string; status: string; added: number; deleted: number }`; `interface ChangesModel { files: ChangedFile[]; added: number; deleted: number; notice?: string }`; `emptyChanges(): ChangesModel`; `captureChanges(cwd: string): Promise<ChangesModel>`
  - `src/card.ts`: `CARD_TONE = { INFO, SUCCESS, WARNING, ERROR }`; `type CardTone`; `interface CardTheme { fg(color: string, text: string): string; bg?(color: string, text: string): string }`; `interface Card { title: string; subtitle?: string; body: string[]; tone: CardTone; glyph?: string }`; `interface CardRenderOptions { expanded: boolean; previewRows?: number; hint?: string; panel?: boolean }`; `CARD_STYLE = { NEON: "neon", FLOAT: "float" }`; `cardStyle(): CardStyle`; `setCardStyle(style: CardStyle): void`; `renderCard(card: Card, theme: CardTheme, width: number, options: CardRenderOptions): string[]`; `cardTop(card, theme, width, hint?): string`; `cardLine(text, tone, theme, width): string`; `cardBottom(tone, theme, width, content?): string`; `cardInnerWidth(width: number): number`; `cardBodyRows(rows, tone, theme, width, options): string[]`; `floatRows(tone, theme, width, render): string[]`; `panelInnerWidth(theme, width, tone?): number`; `panelHeaderRow(theme, width, tone?): number`; `panelExtraRows(theme, width, tone?): number`
- Seam: `CardTheme` — the render functions are pure over an injected theme object (prod adapter: pi `Theme` via `fg`/`bg`; test adapter: fake theme functions).
- Deletion test: deleting `src/card.ts` reappears card-drawing logic in `status-card.ts` and any future card (todo, jobs). Deleting `src/changes.ts` reappears git parsing in `index.ts`.
- Adapters: 2 per seam (pi theme + fake test theme).

**Port notes (deviations from old2 — apply while copying):**
- `card.ts`: delete the todo/jobs/usage imports — `skillgrid-hover.ts` (`paintHoverable`) and `skillgrid-background-jobs-tools.ts` (`RunningJobDisplay`, `JOB_GLYPH`) are not ported. Remove `cardAwaitingResult`, `cardRunningLine`, `cardTopRows` (todo-card machinery), `markCardResult`, `CardRowContext`. Keep: chrome system, `cardTop`/`cardLine`/`cardBottom`/`cardInnerWidth`, `floatRows`/`paintFloat`/`floatOpener`/`panelInnerWidth`/`panelHeaderRow`/`panelExtraRows`, `renderCard`/`cardText`/`floatPanel`/`fitRow`/`panelHeader`, `cardStyle` global slot.
- `text.ts`: verbatim port of `skillgrid-terminal-theme.ts` (the three regexes + two functions).
- `changes.ts`: verbatim port of `skillgrid-changes.ts` (all exports, `runGit` with `maxBuffer: 1024 * 1024`).

**SATISFIES:** `Card renderer produces a panel`, `Changes capture reads git state`, `Changes capture degrades outside a git repo`, `ANSI sanitization strips escapes and control chars`, `Modules load under native node type-stripping`

- [ ] **Step 1: Write the failing test**

Create `extensions/skill-pi-tui/index.spec.ts`:

```ts
import { assert, it } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { captureChanges, emptyChanges } from "./src/changes.ts";
import { sanitizeTerminalText } from "./src/text.ts";
import { renderCard, CARD_TONE, type CardTheme } from "./src/card.ts";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function makeGitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "sktpi-changes-"));
  git(dir, "init", "-b", "main");
  git(dir, "config", "user.email", "t@t");
  git(dir, "config", "user.name", "t");
  writeFileSync(join(dir, "a.txt"), "x\ny\nz\n");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-m", "init");
  return dir;
}

it("captureChanges: reads numstat + porcelain from a git repo", async () => {
  const dir = makeGitRepo();
  writeFileSync(join(dir, "a.txt"), "x\ny\nz\nw\nv\n");
  mkdirSync(join(dir, "new"));
  writeFileSync(join(dir, "new", "u.txt"), "hello\n");
  const changes = await captureChanges(dir);
  assert.equal(changes.files.length, 2);
  assert.equal(changes.added, 2);
  assert.equal(changes.deleted, 1);
  const a = changes.files.find((f) => f.path === "a.txt");
  assert.ok(a);
  assert.equal(a.status, "modified");
  assert.equal(a.added, 2);
  assert.equal(a.deleted, 1);
  const u = changes.files.find((f) => f.path === "new/u.txt");
  assert.ok(u);
  assert.equal(u.status, "untracked");
});

it("captureChanges: non-git dir resolves to empty model", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sktpi-nongit-"));
  const changes = await captureChanges(dir);
  assert.deepEqual(changes, emptyChanges());
});

it("sanitizeTerminalText: strips SGR, OSC, and control chars", () => {
  const raw = "\x1b[1;31mred\x1b[0m \x1b]0;title\x07\ttab";
  const out = sanitizeTerminalText(raw);
  assert.equal(out, "red tab");
});

const fakeTheme: CardTheme = {
  fg: (_color, text) => text,
  bg: (_color, text) => `\x1b[48;5;16m${text}\x1b[49m`,
};

it("renderCard: panel frame at fixed width", () => {
  const lines = renderCard(
    { title: "Status", body: ["line one", "line two"], tone: CARD_TONE.INFO },
    fakeTheme,
    50,
    { expanded: true, panel: true },
  );
  assert.ok(lines.length >= 4, "header + body + bottom");
  for (const line of lines) {
    assert.ok(visibleWidthCheck(line), `line exceeds width: ${JSON.stringify(line)}`);
  }
});

function visibleWidthCheck(line: string): boolean {
  const plain = line.replace(/\x1b\[[0-9;]*m/g, "");
  return [...plain].length <= 50;
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/skill-pi-tui && npm install && npx vitest run`
Expected: FAIL — `Cannot find module './src/changes.ts'` (modules do not exist yet).

- [ ] **Step 3: Write minimal implementation**

Port the three modules per the port notes (read the old2 sources, copy with the deletions applied, rebrand symbol names: `skillgrid-pi.card-style` → `skill-pi-tui.card-style` in the `Symbol.for` global slot; `skillgrid-pi.card-result` slot is deleted with `markCardResult`). Keep old2's behavior exactly for the kept functions (chrome fallback when `theme.bg` is absent or yields no opener; `wrapTextWithAnsi` wrapping; float paint margin of 1).

Extend `native-tui-loader.mjs`:

```mjs
import mod from "./index.ts";
import { renderCard, cardStyle } from "./src/card.ts";
import { sanitizeTerminalText } from "./src/text.ts";
import { captureChanges, emptyChanges } from "./src/changes.ts";
for (const fn of [renderCard, cardStyle, sanitizeTerminalText, captureChanges, emptyChanges]) {
  if (typeof fn !== "function") throw new Error("expected a function export");
}
if (typeof mod !== "function" && typeof mod !== "object") throw new Error("expected index.ts default export");
console.log("ok");
```

Task 2's vitest suite must not import `index.ts` — keep `index.spec.ts` scoped to the `src/` modules so the spec stays independent of the entry wiring (which Task 4 changes).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/skill-pi-tui && npx vitest run`
Expected: PASS (4 tests).
Run: `cd extensions/skill-pi-tui && npm run check`
Expected: `tsc --noEmit` clean.
Run: `node --test "test/**/*.test.js"` (repo root)
Expected: PASS — strict-load scenario now imports the new modules and still exits 0.

- [ ] **Step 5: Commit**

```bash
cd extensions/skill-pi-tui && npm install
git add extensions/skill-pi-tui
git commit -m "feat(skill-pi-tui): port card, text, and changes modules from skill-pi-old2"
```

### Task 3: Sidebar layout + parts registry + Status card

**Files:**
- Create: `extensions/skill-pi-tui/src/sidebar.ts`
- Create: `extensions/skill-pi-tui/src/sidebar-layout.ts`
- Create: `extensions/skill-pi-tui/src/status-card.ts`
- Modify: `extensions/skill-pi-tui/index.spec.ts`
- Modify: `extensions/skill-pi-tui/native-tui-loader.mjs`

**Interfaces:**
- Consumes: Task 2's `renderCard`, `CARD_TONE`, `CardTheme`, `panelInnerWidth` (from `src/card.ts`); `sanitizeTerminalText` (from `src/text.ts`); `ChangesModel` (from `src/changes.ts`); `@earendil-works/pi-tui` (`TUI`, `ScrollView`, `VStack`, `Component`, `visibleWidth`, `type TuiMouseEvent`).
- Produces:
  - `src/sidebar.ts`: `interface SidebarRail extends Component { digest?(): string }`; `interface SidebarState { active: boolean; visibility?: { todo?: boolean }; ownsHost?: () => boolean; railColumns?: number; statusHidden?: () => boolean; headerOwnsStatus?: () => boolean; parts: Map<string, SidebarRail> }`; `sidebarState(tui: TUI): SidebarState`; `sidebarPart<T extends Component & { dispose?(): void }>(tui: TUI, key: string, bottom: T, rail?: SidebarRail): T`; `sidebarHeader(tui: TUI, rail: SidebarRail): () => void`; `VISUAL_SETTINGS_CHANGED: string`
  - `src/sidebar-layout.ts`: `SIDEBAR_BREAKPOINT: number` (= 140); `invalidateSidebar(tui: TUI): void`; `installSidebar(tui: TUI, theme: { fg(color: string, text: string): string; bold(text: string): string }, placement?: () => "auto" | "right" | "bottom" | "hidden", headerPlacement?: () => "top" | "below-input", density?: () => "comfortable" | "minimal"): () => void`
  - `src/status-card.ts`: `interface StatusCardModel { cwd: string; branch: string | null; sessionName?: string; changes: { files: number; added: number; deleted: number; notice?: string } | undefined }`; `renderStatusCard(model: StatusCardModel, theme: CardTheme, width: number): string[]`
- Seam: the parts registry (`sidebarState` on `tui.terminal` via `Symbol.for("skill-pi-tui.sidebar.state")`) — any future extension can register rail parts through the same symbol without importing this module.
- Deletion test: deleting `sidebar-layout.ts` removes the rail — the footer component renders `[]` and pi's native layout is used; the Status card logic in `status-card.ts` would need re-hosting.
- Adapters: 1 (the live pi TUI); the patcher is defensive by design (all hooks try/catch → native fallback), so it cannot take the session down.

**Port notes (deviations from old2 — apply while copying):**
- `sidebar.ts`: port `sidebarState`/`sidebarPart`/`sidebarHeader` verbatim; rename the state symbol `skillgrid-pi.experimental-sidebar.state` → `skill-pi-tui.sidebar.state` and `VISUAL_SETTINGS_CHANGED` → `"skill-pi-tui.visual-settings-changed"`. Keep the `todo` visibility check inside `sidebarPart`'s render guard (cheap, and future todo work reuses it).
- `sidebar-layout.ts`: port the patcher verbatim (303 lines) except: rename `skillgrid-pi.experimental-sidebar.cache` → `skill-pi-tui.sidebar.cache`; replace the `cardStyle()` import from the ported `card.ts` (same function name, now local); **delete** the `branding` array (it is `const branding = headerActive ? [] : []` in old2 — always empty) and the two `branding.length` checks that depend on it (keep the `density() === "comfortable" && style === CARD_STYLE.NEON` blank-line branch, which is keyed on `headerActive`); keep the section list `["footer", "agents", "todo"]` filtered by the `todo` visibility guard — `footer` is our Status card, `agents`/`todo` simply have no registered parts yet. Keep `narrowStatusOwner`, `STATUS_OWNER` (small, and the `footer` part's render guard uses `statusHidden`/`headerOwnsStatus` which reference it). Keep the 100ms `setInterval(attach, 100).unref()` re-attach loop and the footer-row `minSize: 0` reclaim (`reclaimFooterRow`) — that is what makes the rail take vertical space from the footer dock.
- `status-card.ts` (new, composed from old2 `renderSkillgridSidebarBar` in `skillgrid-bar.ts`): build groups `Project` (path value, `Branch <value>` when present, `Session <value>` when present) and `Changes` (counts line or `No captured changes` / notice line), then `renderCard({ title: "Status", body: <flattened, wrapped with wrapTextWithAnsi at panelInnerWidth - inset>, tone: CARD_TONE.INFO }, theme, width, { expanded: true, panel: true })`. Labels via `theme.fg("muted", …)`, values via `theme.fg("text", theme.bold(...))`, `+added` via `theme.fg("success", …)`, `−deleted` via `theme.fg("error", …)`.

**SATISFIES:** `Rail renders the Status card in wide fullscreen` (module-level: `renderStatusCard` output shape), `Non-git session shows a notice instead of counts` (module-level: notice line), plus the layout-level scenarios in Task 4.

- [ ] **Step 1: Write the failing test**

Append to `extensions/skill-pi-tui/index.spec.ts`:

```ts
import { renderStatusCard, type StatusCardModel } from "./src/status-card.ts";
import { SIDEBAR_BREAKPOINT, invalidateSidebar } from "./src/sidebar-layout.ts";
import { sidebarState, sidebarPart } from "./src/sidebar.ts";

it("renderStatusCard: project + changes groups at width 48", () => {
  const model: StatusCardModel = {
    cwd: "~/git/ai-test/skill-pi",
    branch: "main",
    sessionName: "tui work",
    changes: { files: 3, added: 10, deleted: 2 },
  };
  const lines = renderStatusCard(model, fakeTheme, 48);
  const flat = lines.join("\n");
  assert.match(flat, /Status/);
  assert.match(flat, /~/);
  assert.match(flat, /main/);
  assert.match(flat, /tui work/);
  assert.match(flat, /3 files/);
  assert.match(flat, /\+10/);
  assert.match(flat, /−2/);
  for (const line of lines) assert.ok([...line.replace(/\x1b\[[0-9;]*m/g, "")].length <= 48);
});

it("renderStatusCard: non-git notice when no changes", () => {
  const model: StatusCardModel = { cwd: "/tmp/x", branch: null, changes: undefined };
  const flat = renderStatusCard(model, fakeTheme, 48).join("\n");
  assert.match(flat, /No captured changes/);
  assert.doesNotMatch(flat, /Branch/);
});

it("SIDEBAR_BREAKPOINT is 140 and registry APIs exist", () => {
  assert.equal(SIDEBAR_BREAKPOINT, 140);
  assert.equal(typeof invalidateSidebar, "function");
  assert.equal(typeof sidebarState, "function");
  assert.equal(typeof sidebarPart, "function");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd extensions/skill-pi-tui && npx vitest run`
Expected: FAIL — `Cannot find module './src/status-card.ts'`.

- [ ] **Step 3: Write minimal implementation**

Create the three files per the port notes. The layout patcher's public behavior that the tests above plus Task 4's live checks rely on:
- `installSidebar` returns a no-op uninstall when `tui.terminal` is falsy.
- It replaces `layoutRoot[LAYOUT_NODE]` only while `host.mode === "fullscreen"` and columns ≥ `SIDEBAR_BREAKPOINT` and `placement() !== "bottom" && placement() !== "hidden"`; every other render path returns the original layout node (native fallback).
- It re-attaches on a 100ms unref'd interval (the layout root identity can change between renders) and the returned cleanup restores the original property descriptor, clears the timer, hides the scrollbar, and calls `tui.requestRender()`.
- Section rendering is cached per (component, width, theme, digest) — unchanged sections are not re-rendered.

Extend `native-tui-loader.mjs` to also import `renderStatusCard`, `installSidebar`, `sidebarState`, `sidebarPart` and assert they are functions.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd extensions/skill-pi-tui && npx vitest run`
Expected: PASS (7 tests).
Run: `cd extensions/skill-pi-tui && npm run check`
Expected: clean.
Run: `node --test "test/**/*.test.js"` (repo root)
Expected: PASS.

**Door check (hypothesis):** after this task, start a live session (`skill-pi -- <repo>` in a ≥140-col terminal, then toggle fullscreen inside pi if the mode is regular) and confirm: (a) the rail appears on the right with the Status card, (b) the main column is not corrupted, (c) shrinking below 140 columns restores the native layout. If (a)–(c) fail, STOP — the old2 patcher does not match pi 1.2.0's layout root; report and choose the fallback (widget-based card) before Task 4.

- [ ] **Step 5: Commit**

```bash
git add extensions/skill-pi-tui
git commit -m "feat(skill-pi-tui): port sidebar layout, parts registry, and Status card"
```

### Task 4: Wire banner + sidebar end to end

**Files:**
- Modify: `extensions/skill-pi-tui/index.ts`
- Modify: `test/skill-pi-tui.test.js`

**Prerequisite (verify before wiring):**
1. `cd extensions/skill-pi-tui && npm install` was run in Task 2 (local toolchain). The vitest suite and `tsc --noEmit` run against it.
2. `Theme.bold` exists on pi 1.2.0's `Theme` — verified: `node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.d.ts:72` declares `bold(text: string): string` on the `Theme` class (the same class `setFooter`'s factory receives). `buildTheme` in the wiring below may call `theme.bold(...)` directly. If a future pi bump drops it, adapt `buildTheme` to wrap in `\x1b[1m…\x1b[22m`.

**Interfaces:**
- Consumes: `installSidebar`, `SIDEBAR_BREAKPOINT` (from `src/sidebar-layout.ts`); `sidebarPart` (from `src/sidebar.ts`); `renderStatusCard` (from `src/status-card.ts`); `captureChanges`, `emptyChanges` (from `src/changes.ts`); the existing banner code already in `index.ts`.
- Produces: the finished extension — `session_start` installs banner + sidebar, `session_shutdown` tears both down; no other module changes.
- Seam: none new.
- Deletion test: deleting the sidebar wiring from `index.ts` leaves the banner working — the rail simply never appears.
- Adapters: 1 (live pi).

**Wiring (exact structure to add to `index.ts`):**

```ts
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { installSidebar } from "./src/sidebar-layout.ts";
import { sidebarPart } from "./src/sidebar.ts";
import { renderStatusCard } from "./src/status-card.ts";
import { captureChanges, emptyChanges, type ChangesModel } from "./src/changes.ts";

let currentCtx: ExtensionContext | undefined;
let tuiRef: TUI | undefined;
let removeSidebar: (() => void) | undefined;
let changesTimer: ReturnType<typeof setInterval> | undefined;
let currentChanges: ChangesModel = emptyChanges();

function refreshChanges() {
  const cwd = currentCtx?.cwd ?? process.cwd();
  void captureChanges(cwd).then((changes) => {
    currentChanges = changes;
    tuiRef?.requestRender();
  });
}

function buildTheme(theme: Theme) {
  return { fg: (color: string, text: string) => theme.fg(color, text), bold: (text: string) => theme.bold(text) };
}

function shortenHome(cwd: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home || !cwd.startsWith(home)) return cwd;
  const rel = cwd.slice(home.length).replace(/^\/+/, "");
  return rel ? `~/${rel}` : "~";
}
```

In the `session_start` handler (after the existing banner block, guarded by `if (ctx.mode !== "tui" || !ctx.hasUI) return;` for the sidebar part):

```ts
currentCtx = ctx;
refreshChanges();
changesTimer = setInterval(refreshChanges, 2000);
changesTimer.unref();

ctx.ui.setFooter((tui, theme, footerData) => {
  tuiRef = tui;
  const barTheme = buildTheme(theme);
  const bottom: Component & { dispose(): void } = {
    render() {
      return [];
    },
    invalidate() {},
    dispose() {
      removeSidebar?.();
      removeSidebar = undefined;
      tuiRef = undefined;
    },
  };
  const statusCard = {
    render(width: number): string[] {
      const changes = currentChanges.files.length
        ? { files: currentChanges.files.length, added: currentChanges.added, deleted: currentChanges.deleted, notice: currentChanges.notice }
        : undefined;
      return renderStatusCard(
        {
          cwd: shortenHome(currentCtx?.cwd ?? ctx.cwd),
          branch: footerData?.getGitBranch() ?? null,
          sessionName: ctx.sessionManager?.getSessionName?.() ?? undefined,
          changes,
        },
        barTheme,
        width,
      );
    },
    invalidate: () => tui.requestRender(),
    digest: () => JSON.stringify([currentChanges.added, currentChanges.deleted, currentChanges.files.length]),
  };
  const part = sidebarPart(tui, "footer", bottom, statusCard);
  removeSidebar = installSidebar(tui, barTheme);
  return part;
});
```

Note: the footer component returned is the `sidebarPart` wrapper — in the rail case its `render` is suppressed by the part registry (state.active) and the card renders in the rail; in the native-fallback case `state.active` is false but `ownsHost`/`statusHidden` are false too, so the wrapper renders `bottom.render(width)` = `[]`, keeping pi's default footer visually intact. (If the live check in the door check shows the default footer disappearing in narrow mode, change the returned component to plain `bottom` and re-verify — the part wrapper is only needed for rail-mode suppression.)

In `session_shutdown` (append to the existing handler):

```ts
if (changesTimer) {
  clearInterval(changesTimer);
  changesTimer = undefined;
}
ctx.ui.setFooter(undefined);
removeSidebar?.();
removeSidebar = undefined;
tuiRef = undefined;
currentCtx = undefined;
currentChanges = emptyChanges();
```

- [ ] **Step 1: Write the failing test**

Append to `test/skill-pi-tui.test.js`:

```js
test("index.ts wires banner + sidebar (structural)", () => {
  const src = readFileSync(join(extDir, "index.ts"), "utf8");
  assert.match(src, /setHeader/);
  assert.match(src, /setFooter/);
  assert.match(src, /installSidebar/);
  assert.match(src, /sidebarPart\(tui, "footer"/);
  assert.match(src, /captureChanges/);
  assert.match(src, /setInterval\(refreshChanges, 2000\)/);
  assert.match(src, /changesTimer\.unref\(\)/);
  assert.match(src, /session_shutdown/);
  assert.match(src, /clearInterval\(changesTimer\)/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/skill-pi-tui.test.js`
Expected: FAIL — `setFooter` not present in `index.ts`.

- [ ] **Step 3: Write minimal implementation**

Apply the wiring above to `extensions/skill-pi-tui/index.ts` (imports, module-level state, `refreshChanges`/`buildTheme`/`shortenHome` helpers, `session_start` additions, `session_shutdown` additions).

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test "test/**/*.test.js"`
Expected: PASS — full suite, including the `--print` integration test (print mode: `ctx.mode !== "tui"`, so the sidebar wiring is skipped and pi exits cleanly).
Run: `cd extensions/skill-pi-tui && npm run check && npx vitest run`
Expected: clean + PASS.
**Live verification (the backstop truths):** start `skill-pi -- <a git repo>` in a terminal ≥ 140 columns; confirm the banner header renders and the right rail shows the Status card with live counts (touch a file, wait 2s, watch the count update). Shrink the terminal below 140 columns: the rail disappears and the layout matches stock pi. Exit (`/quit` or Ctrl+D): process exits, no lingering timers.

- [ ] **Step 5: Commit**

```bash
git add extensions/skill-pi-tui/index.ts test/skill-pi-tui.test.js
git commit -m "feat(skill-pi-tui): wire banner + sidebar end to end"
```

## Rollback Plan

- Task 1: `git revert <commit>` restores `extensions/skill-pi-banner.ts` (the `git mv` keeps history, so the revert is a clean inverse rename).
- Tasks 2–4: revert the respective commits in reverse order; each is self-contained within `extensions/skill-pi-tui/` + `test/` and touches no shared file except `README.md` (Task 1) and the permission briefing (Task 1). No data or config is written by the extension at runtime, so there is nothing to migrate back.

## Success Criteria

- `node --test "test/**/*.test.js"` green (root suite, including the new `test/skill-pi-tui.test.js` and the `--print` integration boot).
- `cd extensions/skill-pi-tui && npm run check && npx vitest run` green.
- Live session in a ≥140-col fullscreen terminal: banner header + right rail Status card with live, updating change counts; <140 cols / regular mode: layout byte-identical to stock pi; clean exit with no leaked timers.
- `git status` on the change branch shows only this change's files committed (no ADR-0002 work staged).

## Plan Review

- Pass 1: NEEDS REVISION — 2 Critical (banner baseline at HEAD is a stub; `Theme.bold` unverified), 2 Important (RED-step description; wrapper test strength), 4 Minor.
- Revision applied: all Critical + Important fixed inline (see Findings).
- Verdict: READY FOR EXECUTION (after revision pass)
- Findings: 2 Critical (fixed: (a) banner baseline pinned — at HEAD `skill-pi-banner.ts` is a 6-line notify stub and the full logo/stats-grid banner is uncommitted working-tree work; Task 1's `git mv` commits that content deliberately, documented in Global Constraints + adr.md notes + the acceptance scenario's baseline note; (b) `Theme.bold` verified present at `theme.d.ts:72` and recorded as a Task 4 prerequisite with the `\x1b[1m` fallback), 1 Important (fixed: Task 1 Step 2 now states per-test expected failures), 1 withdrawn (test count was correct), Minor (deferred: `runGit` has no timeout — a hung git leaves the card stale but the process still exits, consistent with the "never throws" truth; `shortenHome` uses `process.env.HOME` like old2 while the banner uses `os.homedir()` — functionally equivalent on macOS; `.mjs` in tsconfig `include` is ignored by tsc (no `allowJs`) — the loader is covered by the node:test spawn instead; `sidebarHeader` ported-but-unused and `agents`/`todo` reserved keys are deliberate API-parity scope beyond the spec, documented)
- Reviewed: 2026-10-14
