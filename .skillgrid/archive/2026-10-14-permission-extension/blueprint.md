# Permission Extension (Opencode-style) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-execution (recommended) or simple-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PROPOSED

**Tier:** T2

**Build shape:** Tracer thread — the thinnest end-to-end path (extension loads → a `tool_call` is resolved → the right allow/deny/ask outcome is produced) works first in Task 1; every later task thickens a layer (review UI, bash AST, persistence, auto-accept). Rationale: the integration risk (pi type-stripping the TS, resolving the 4 new runtime deps + 2 wasm binaries at load, under the shim-cwd) is the unknown — prove it loads before investing in the review UI.

**Goal:** Port the `pi-opencode-permissions-and-preview` `permission` extension into `skill-pi` as a self-contained `extensions/permission/` bundle: a `tool_call` permission gate (allow/deny/ask/always rules), a Pierre-backed `edit`/`write` diff review, AST-aware bash matching, conf.d persistence, and an auto-accept toggle.

**Architecture:** A new self-contained extension subdir (`extensions/permission/`, per ADR 0007) mirroring the reference's 13 modules, normalized to project style (2-space, semicolons, `@earendil-works/*` imports, `.js` ESM suffixes) and re-pointed at the ADR 0008 conf.d config contract. The wrapper already enumerates subdirectory `index.ts` entry points (ADR 0001) — no wrapper change. Runtime deps resolve via the root `node_modules` (pi type-strips and imports root-relative); the extension's own `package.json` carries the same deps for its standalone `tsc`/`vitest` check.

**Tech Stack:** TypeScript (ESM, Node 22 native type-stripping), `@earendil-works/pi-coding-agent@1.2.0` + `@earendil-works/pi-tui` (root), `@pierre/diffs` + `@pierre/theme` (diff metadata + highlighting), `web-tree-sitter` + `tree-sitter-bash` (bash AST), vitest (extension unit tests), node:test (root suites).

**Spec:** `.skillgrid/specs/2026-10-14-permission-extension/briefing.md`

## Terms

- **Permission layer** — the rule engine + prompt + review UI that gates tool calls (introduced by the spec).
- **Approval rule** — an `always`-scoped string that auto-allows a matching tool call (spec).
- **Review dialog** — the TUI surface for inspecting an `edit`/`write` before approval (spec).
- **conf.d** — the ADR 0008 plugin-config location (`$AGENT_HOME/conf.d/<name>.conf` + project `conf.d/`). See `.skillgrid/artifacts/04-adr-0008-plugin-config-confd.md`.

## Must-Haves (goal-backward verification)

**Truths** (observable behaviors that must hold):
- **T1 — Rule chain resolves with strictest-wins for bash.** A `tool_call` resolves mode via `deny > always > session-approvals > ask > allow > defaultMode`; for `bash`, each AST-extracted subcommand is evaluated and the strictest wins. A `deny` on any subcommand denies the whole call. (Spec R1.)
- **T2 — `ask` presents the 5-choice prompt + auto-feedback path.** `ask` (with UI) shows `Allow once / Allow always / Allow always for this session / Reject / Reject with feedback`; `Reject with feedback` returns the free text as the block reason; a preview-build error on `edit`/`write` returns an automatic block with that error as the reason. (Spec R2.)
- **T3 — `edit`/`write` show a Pierre diff review.** `promptForPermission` builds an in-memory preview (read, strip BOM, normalize to LF, apply edits) and renders it in the `PermissionReviewDialog`; preview failure → tool blocked with the exact error (no dialog). (Spec R3.)
- **T4 — "Allow always" persists rules (lock + atomic write) to conf.d.** Persisting appends to `always` in `<project-root>/conf.d/permission.conf` (ADR 0008: `.skill-pi/conf.d/` then `.pi/conf.d/` fallback) via a `wx` lockfile + temp-then-rename; rules re-read on the next tool call. (Spec R4.)
- **T5 — Auto-accept toggle + status + optional keybinding.** Toggling flips `edit`+`write` session mode overrides to `allow`; `ctx.ui.setStatus("permission", ...)` reflects on/off. (Spec R5.)
- **T6 — Skill-derived allow rules merge in.** Trusted local skills (user/project scope) contribute `allowed_tools`/`allowed-tools` frontmatter as extra `allow` rules, cached by mtime+size. (Spec R6.)
- **T7 — Extension loads via the wrapper, no wrapper change; tsc clean; suite green.** `extensions/permission/index.ts` is enumerated by `collectExtensionFiles`; `tsc --noEmit -p extensions/permission` passes; `node --test "test/**/*.test.js"` green. (Spec R7.) `backstop` — only observable at load; held-out test: the Task 1 load-verify step.
- **T8 — Deps declared at root + extension; runtime resolves via root.** The 4 runtime deps are in both `package.json` (root) and `extensions/permission/package.json`; the root `npm install` leaves them in the root `node_modules`; the extension `node_modules` is absent from a fresh root install; `tsc -p extensions/permission` resolves them. (Spec R8.) `backstop` — resolved at install, not in the diff.

**Artifacts** (files that must exist with real implementation, not stubs):
- `extensions/permission/index.ts` — entry + `tool_call` hook + prompt flow + persistence + auto-accept + commands.
- `extensions/permission/constants.ts`, `models.ts` — prompt labels/statuses; `Mode`, `PermissionSettings`, `ParsedRule`, `RuntimeSessionState`.
- `extensions/permission/project.ts` — conf.d 3-scope settings loader (ported from reference `__lib/project.ts`, path resolution rewritten to ADR 0008).
- `extensions/permission/bash-parser.ts`, `bash-arity.ts` — tree-sitter command extraction; command→prefix table.
- `extensions/permission/rejection.ts` — reject / reject-with-feedback resolution.
- `extensions/permission/review-preview.ts` — edit/write preview builder + in-memory edit-apply + fuzzy match.
- `extensions/permission/review-dialog.ts` — the fullscreen/compact review TUI component.
- `extensions/permission/pierre-highlight.ts`, `pierre-metadata.ts`, `pierre-rows.ts`, `pierre-theme.ts`, `pierre-types.ts` — diff metadata, highlighting, row rendering, palette, types.
- `extensions/permission/package.json`, `tsconfig.json` — self-contained toolchain + deps (ADR 0007).
- `extensions/permission/*.spec.ts` — vitest unit tests for the truths above.
- Root `package.json` — the 4 runtime deps added.
- `.skillgrid/config.yaml`, `AGENTS.md`, `README.md` — dep-policy line updated to "pi + bundled-extension runtime deps"; bundled list gains `permission`.

**Key links** (critical connections that must work together):
- `index.ts`'s `tool_call` handler must call `loadSettings(ctx.cwd)` → `mergeSkillAllowRules` → `resolveMode` in that order; `resolveMode` for `bash` must call `extractBashCommands` before `resolveSingleMode`.
- `promptForPermission` must route `edit`/`write` through `buildEditPermissionPreview`/`buildWritePermissionPreview` → `showPermissionReviewDialog`, and non-edit/write tools through `ctx.ui.select`.
- `persistApprovalRules` must write via `project.ts`'s conf.d project path (ADR 0008), not the reference's `.agents/` path.
- The wrapper's `collectExtensionFiles` must pick up `extensions/permission/index.ts` without any edit to `bin/skill-pi.js` (ADR 0001).
- `project.ts` must derive the user conf.d path from `dirname(getAgentDir())` (ADR 0008 D1), never hardcoding `~/.skill-pi` or `~/.pi`.

**One-way-door decisions** (hard to reverse — flag for explicit user approval):
- None. The port is additive (a new `extensions/permission/` subdir + 4 root deps + policy-text edits). No migration, no public API change, no data loss. The ADR 0002 project-conf.d fallback exception is a documented ADR (not a one-way door) and is dormant until ADR 0002's configDir lands.

## Global Constraints

- Node `>=22.19.0`, ESM (`"type": "module"`). (briefing Context.)
- 2-space indent, semicolons, **no comments in code unless asked**, minimal scoped changes. (`AGENTS.md`, `.skillgrid/config.yaml`.)
- Runtime deps resolve via the root `node_modules`; the extension `package.json` is `private: true` and is NOT installed by the root `npm install` (ADR 0007).
- Extension config lives in conf.d per ADR 0008: user `$AGENT_HOME/conf.d/permission.conf` (`$AGENT_HOME = dirname(getAgentDir())`), project `<project-root>/conf.d/permission.conf` (`.skill-pi/conf.d/` then `.pi/conf.d/` fallback). The reference's `.agents/permission.settings.json` becomes `conf.d/permission.conf`.
- Never read or write the stock `~/.pi/agent`; skill-pi sets only `PI_CODING_AGENT_DIR` (user scope). The wrapper may set `PI_PACKAGE_DIR` to the brand overlay (ADR 0002 user scope is the only invariant touched by the project conf.d fallback — see ADR 0008 D2).
- Production deps become "pi + bundled-extension runtime deps" (policy text updated in `config.yaml` + `AGENTS.md`); the 4 new runtime deps are `@pierre/diffs`, `@pierre/theme`, `web-tree-sitter`, `tree-sitter-bash`.
- Do NOT port the reference's `diff`, `@modelcontextprotocol/sdk`, `@mozilla/readability`, `turndown`, `turndown-plugin-gfm`, `jsdom` — unused dead weight from the fork.
- The reference targets `@mariozechner/pi-coding-agent@0.67`; the port renames imports to `@earendil-works/*` and uses `.js` ESM suffixes on relative imports.

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Subprocess (tree-sitter wasm) | Applicable — `bash-parser.ts` loads `web-tree-sitter.wasm` + `tree-sitter-bash.wasm` via `createRequire` at parse time | Pin the reference's wasm versions; the Task 1 load-verify step exercises the wasm path end-to-end before any bash rule is trusted | A `bash` `tool_call` with a multi-command string resolves to the expected mode (proves the wasm parser loaded and extracted commands) |
| Config file I/O (conf.d read/write) | Applicable — `project.ts` reads 3 conf.d scopes; `persistApprovalRules` writes with a `wx` lock + atomic rename | Fail-loud on invalid JSON (throw with path+message); lock retry 50ms/5s timeout/30s stale; temp-then-rename | A concurrent second writer either waits or times out per constants; the `always` array gains the rule exactly once; the lock file is removed |
| Path resolution (conf.d derivation) | Applicable — `project.ts` derives `$AGENT_HOME/conf.d/` from `getAgentDir()` and the project root from `git rev-parse` | ADR 0008: `dirname(getAgentDir())` for user; `git rev-parse --show-toplevel` (cwd fallback) for project; `.skill-pi/conf.d/` then `.pi/conf.d/` fallback | With `PI_CODING_AGENT_DIR` pointed at a temp dir, the user conf.d path is `<temp>/conf.d/permission.conf`; a relocated agent dir carries conf.d with it |
| TUI keybinding (review dialog) | N/A for unit tests — the dialog is interactive; covered by the E2E load-verify + manual gate, not a unit seam | The dialog component is tested only for its render of a fixed preview (no key-event mocking) | Render smoke: `PermissionReviewDialog.render(width)` on a fixed diff preview returns a non-empty, width-bounded string[] (Task 3) |

## File Structure

- `extensions/permission/index.ts` — entry: `tool_call` hook, `promptForPermission`, `resolveMode`/`resolveSingleMode`, `getApprovalRules`, `persistApprovalRules` + lock, auto-accept toggle + status, `/permission-toggle-auto-accept` + `/permission-settings` commands, skill-derived rule cache.
- `extensions/permission/constants.ts` — prompt labels, `STATUS_REJECTED`, `FEEDBACK_PLACEHOLDER`, choice arrays.
- `extensions/permission/models.ts` — `Mode`, `PermissionSettings`, `ParsedRule`, `SkillAllowSource`, `DerivedSkillAllowState`, `RuntimeSessionState`.
- `extensions/permission/project.ts` — conf.d path resolution + 3-scope settings loader/merge (ADR 0008). Ported from reference `__lib/project.ts`; the `loadExtensionSettings`/`getExtensionSettingsPaths`/`resolveRootDir`/`resolveProjectAgentsDir` surface is rewritten to conf.d.
- `extensions/permission/bash-parser.ts` — `extractBashCommands` via web-tree-sitter + tree-sitter-bash.
- `extensions/permission/bash-arity.ts` — `BashArity.prefix(tokens)` command→prefix table.
- `extensions/permission/rejection.ts` — `resolvePermissionRejection`, `buildHardRejectedReason`.
- `extensions/permission/review-preview.ts` — `buildEditPermissionPreview`, `buildWritePermissionPreview`, in-memory edit-apply + fuzzy match + BOM/LF normalization.
- `extensions/permission/review-dialog.ts` — `showPermissionReviewDialog` + `PermissionReviewDialog` TUI component.
- `extensions/permission/pierre-highlight.ts` — `loadHighlightedDiff` (shiki via @pierre/diffs).
- `extensions/permission/pierre-metadata.ts` — `buildDiffMetadata`, `summarizeDiffMetadata`.
- `extensions/permission/pierre-rows.ts` — `renderUnifiedDiffLines`, `renderSplitDiffLines`.
- `extensions/permission/pierre-theme.ts` — `getPierreAppearance`, `getPierrePalette`.
- `extensions/permission/pierre-types.ts` — shared types.
- `extensions/permission/package.json` — `private`, deps (4 runtime) + devDeps (typescript, vitest, @types/node).
- `extensions/permission/tsconfig.json` — NodeNext ESM, strict, noEmit.
- `extensions/permission/*.spec.ts` — vitest suites (one per module under test).
- `package.json` (root) — add the 4 runtime deps.
- `.skillgrid/config.yaml` — `dependency_policies` line updated.
- `AGENTS.md` — dep-policy line updated.
- `README.md` — "Currently bundled" list gains `permission`.

---

### Task 1: Scaffold + conf.d settings loader + rule engine core (tracer thread)

> **Checkpoint:** Door check — if the extension does not load (wasm or dep resolution fails), STOP and report before Tasks 2-5. This is the `backstop` for T7/T8.

**Files:**
- Create: `extensions/permission/index.ts`
- Create: `extensions/permission/constants.ts`
- Create: `extensions/permission/models.ts`
- Create: `extensions/permission/project.ts`
- Create: `extensions/permission/bash-arity.ts`
- Create: `extensions/permission/bash-parser.ts`
- Create: `extensions/permission/rejection.ts`
- Create: `extensions/permission/package.json`
- Create: `extensions/permission/tsconfig.json`
- Modify: `package.json` (root) — add `@pierre/diffs`, `@pierre/theme`, `web-tree-sitter`, `tree-sitter-bash` to `dependencies`
- Test: `extensions/permission/project.spec.ts`
- Test: `extensions/permission/rules.spec.ts`

**Interfaces:**
- Consumes: `@earendil-works/pi-coding-agent` (`ExtensionAPI`, `ExtensionContext`, `getAgentDir`, `parseFrontmatter`), `@earendil-works/pi-tui`, `web-tree-sitter`, `tree-sitter-bash`, `@pierre/diffs` (type-only at this stage), node builtins.
- Produces:
  - `index.ts`: `export default function (pi: ExtensionAPI): void` — registers a `tool_call` handler that calls `resolveMode`.
  - `project.ts`: `getExtensionSettingsPaths(name: string, cwd: string): { global: string; project: string; local: string }` (conf.d paths), `loadExtensionSettings<T>(name, cwd, merge): Partial<T>`, `resolveProjectConfDir(cwd: string): string`.
  - `index.ts` internals (exported for test): `parseRule(rule: string): ParsedRule`, `matchPattern(pattern: string, value: string): boolean`, `matchesAnyRule(rules: string[], toolName: string, argValue: string): boolean`, `resolveSingleMode(settings: PermissionSettings, toolName: string, argValue: string, sessionState: RuntimeSessionState): Mode`, `resolveMode(settings, toolName, argValue, sessionState): Promise<Mode>`, `getMatchValue(tool: string, input: Record<string, unknown>): string | undefined`.
  - `bash-parser.ts`: `extractBashCommands(command: string): Promise<{ text: string; tokens: string[] }[]>`.
  - `bash-arity.ts`: `BashArity.prefix(tokens: string[]): string[]`.
- Seam: `project.ts`'s path derivation (conf.d) is the seam where ADR 0008 is honored; `resolveMode` is the seam where the rule chain is evaluated.
- Deletion test: deleting `project.ts` reappears the path-resolution + 3-scope merge logic across `index.ts`'s `loadSettings` and `persistApprovalRules`; deleting `resolveMode` reappears the whole rule chain in the `tool_call` handler.
- Adapters: prod (`getAgentDir()` real) + test (`PI_CODING_AGENT_DIR` pointed at a temp dir) = 2.

**SATISFIES:** `happy path rule-chain-resolves-mode`, `happy path extension-loads-and-typechecks`, `happy path deps-resolve-at-root`

- [ ] **Step 1: Write the failing tests** (project + rules)

`extensions/permission/project.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getExtensionSettingsPaths, resolveProjectConfDir } from "./project.js";

describe("conf.d path resolution (ADR 0008)", () => {
  it("derives user conf.d from dirname(getAgentDir())", () => {
    // point PI_CODING_AGENT_DIR at a temp dir, then assert the user path
    const p = getExtensionSettingsPaths("permission", process.cwd());
    expect(p.global).toMatch(/\/conf\.d\/permission\.conf$/);
  });
  it("resolves project conf.d under the git root", () => {
    expect(resolveProjectConfDir(process.cwd())).toMatch(/conf\.d$/);
  });
});
```

`extensions/permission/rules.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { parseRule, matchPattern, resolveSingleMode } from "./index.js";
import type { PermissionSettings, RuntimeSessionState } from "./models.js";

const state: RuntimeSessionState = { modeOverrides: new Map(), approvalRules: new Set() };

describe("rule chain", () => {
  it("deny wins over allow", () => {
    const s: PermissionSettings = { deny: ["bash(rm -rf *)"], allow: ["bash(*)"] };
    expect(resolveSingleMode(s, "bash", "rm -rf /", state)).toBe("deny");
  });
  it("ask wins over allow", () => {
    const s: PermissionSettings = { ask: ["edit"], allow: ["edit"] };
    expect(resolveSingleMode(s, "edit", "/tmp/x", state)).toBe("ask");
  });
  it("defaultMode ask is the floor", () => {
    const s: PermissionSettings = { defaultMode: "ask" };
    expect(resolveSingleMode(s, "read", "/tmp/x", state)).toBe("ask");
  });
  it("matchPattern: trailing ' *' also matches bare", () => {
    expect(matchPattern("git *", "git")).toBe(true);
    expect(matchPattern("git *", "git status")).toBe(true);
    expect(matchPattern("git *", "gh")).toBe(false);
  });
  it("parseRule: tool(arg) splits", () => {
    expect(parseRule("bash(git checkout *)")).toEqual({ toolPattern: "bash", argPattern: "git checkout *" });
    expect(parseRule("read")).toEqual({ toolPattern: "read" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/permission && npm run test -- project.spec.ts rules.spec.ts`
Expected: FAIL (module not found / functions not defined).
Also confirm the three scenarios in `acceptance.feature` are RED.

- [ ] **Step 3: Write minimal implementation**

Port `constants.ts`, `models.ts`, `rejection.ts` verbatim from the reference (rename `@mariozechner/pi-coding-agent` → `@earendil-works/pi-coding-agent`; add `.js` to relative imports; normalize to 2-space + semicolons). Port `bash-arity.ts` (pure data + `prefix`). Port `bash-parser.ts` (rename `@mariozechner` → `@earendil-works`; the `createRequire(import.meta.url).resolve("web-tree-sitter/web-tree-sitter.wasm")` + `tree-sitter-bash/tree-sitter-bash.wasm` calls are unchanged — they resolve via the root `node_modules`).

Rewrite `project.ts` for conf.d (ADR 0008):
```ts
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface ConfSettingsPaths { global: string; project: string; local: string; }

export function agentHome(): string {
  return path.dirname(getAgentDir());
}
export function resolveProjectRoot(cwd: string): string {
  try {
    const out = cp.execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return out ? path.resolve(out) : path.resolve(cwd);
  } catch {
    return path.resolve(cwd);
  }
}
export function resolveProjectConfDir(cwd: string): string {
  return path.join(resolveProjectRoot(cwd), "conf.d");
}
export function getExtensionSettingsPaths(name: string, cwd: string): ConfSettingsPaths {
  return {
    global: path.join(agentHome(), "conf.d", `${name}.conf`),
    project: path.join(resolveProjectRoot(cwd), "conf.d", `${name}.conf`),
    local: path.join(resolveProjectRoot(cwd), "conf.d", `${name}.local.conf`),
  };
}
export function loadExtensionSettings<T>(name: string, cwd: string, merge: (a: Partial<T>, b: Partial<T>) => Partial<T>): Partial<T> {
  const paths = getExtensionSettingsPaths(name, cwd);
  const g = loadJsonSafe<T>(paths.global);
  const p = loadJsonSafe<T>(paths.project);
  const l = loadJsonSafe<T>(paths.local);
  return merge(merge(g, p), l);
}
function loadJsonSafe<T>(filePath: string): Partial<T> {
  if (!fs.existsSync(filePath)) return {};
  const raw = fs.readFileSync(filePath, "utf-8");
  try { return JSON.parse(raw); } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in ${filePath}: ${message}`);
  }
}
```
(Note: the reference's "3 tiers" are global/project/local; under ADR 0008 they map to user-conf.d / project-conf.d / project-conf.d-local. The `.pi/conf.d/` fallback in ADR 0008 D2 is added in Task 4's persistence, not here — keep the tracer thread thin.)

Write `index.ts` with the rule engine (port `parseRule`, `matchPattern`, `matchesAnyRule`, `getMatchValue`, `resolveSingleMode`, `resolveMode`, and a minimal `tool_call` handler that resolves mode and blocks/aborts on `deny`/`ask`-no-UI, allowing on `allow`). The full prompt loop + persistence + auto-accept + commands land in Tasks 2-5 — this task wires the resolver so the tracer thread is real end-to-end.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/permission && npm run test -- project.spec.ts rules.spec.ts`
Expected: PASS.

- [ ] **Step 5: Load-verify (door check, backstop for T7/T8)**

Add the 4 runtime deps to root `package.json`, run `npm install` at the root, then confirm the extension loads with no wrapper change:
```bash
# root
npm install
# verify deps landed at root, not in the extension
ls node_modules/@pierre/diffs node_modules/web-tree-sitter node_modules/tree-sitter-bash >/dev/null && echo "root deps OK"
[ ! -d extensions/permission/node_modules ] && echo "extension node_modules absent (correct)"
# tsc
cd extensions/permission && npx tsc --noEmit && echo "tsc OK"
# root suite still green
cd ../.. && node --test "test/**/*.test.js"
```
Expected: all PASS. If the wasm or a dep fails to resolve at load, STOP and report (door check failed).

- [ ] **Step 6: Commit**

```bash
git add extensions/permission/ package.json
git commit -m "feat(permission): scaffold extension + conf.d settings loader + rule engine (tracer thread)"
```

### Task 2: Edit/write diff preview + review dialog

**Files:**
- Create: `extensions/permission/review-preview.ts`
- Create: `extensions/permission/review-dialog.ts`
- Create: `extensions/permission/pierre-highlight.ts`
- Create: `extensions/permission/pierre-metadata.ts`
- Create: `extensions/permission/pierre-rows.ts`
- Create: `extensions/permission/pierre-theme.ts`
- Create: `extensions/permission/pierre-types.ts`
- Modify: `extensions/permission/index.ts` — `promptForPermission` routes `edit`/`write` through the preview + dialog
- Test: `extensions/permission/preview.spec.ts`

**Interfaces:**
- Consumes: `@pierre/diffs` (`FileDiffMetadata`, `parseDiffFromFile`, `getFiletypeFromFileName`, `setLanguageOverride`, `cleanLastNewline`, `getHighlighterOptions`, `getSharedHighlighter`, `renderDiffWithHighlighter`), `@pierre/theme` (`pierre-dark`, `pierre-light`), `@earendil-works/pi-tui` (`Component`, `truncateToWidth`, `visibleWidth`, `wrapTextWithAnsi`), `@earendil-works/pi-coding-agent` (`Theme`, `getLanguageFromPath`, `highlightCode`, `keyHint`, `rawKeyHint`).
- Produces:
  - `review-preview.ts`: `buildEditPermissionPreview(input: PermissionEditPreviewInput, cwd: string): Promise<PermissionReviewPreview>`, `buildWritePermissionPreview(input: PermissionWritePreviewInput, cwd: string): Promise<PermissionReviewPreview>`.
  - `review-dialog.ts`: `showPermissionReviewDialog(ctx: ExtensionContext, preview: PermissionReviewPreview): Promise<PermissionPromptChoice | undefined>`.
- Seam: `review-preview.ts` is the seam where the in-memory edit-apply + fuzzy-match logic lives (the pi-native edit safety rules). `review-dialog.ts` is the TUI seam.
- Deletion test: deleting `review-preview.ts` reappears the BOM-strip / LF-normalize / fuzzy-match / overlap-detect logic in `index.ts`'s `promptForPermission`.
- Adapters: prod (pi TUI) + test (render a fixed preview) = 2.

**SATISFIES:** `happy path edit-review-diff`, `happy path ask-reject-with-feedback`

- [ ] **Step 1: Write the failing tests**

`extensions/permission/preview.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEditPermissionPreview, buildWritePermissionPreview } from "./review-preview.js";

describe("edit preview", () => {
  it("produces a diff preview for a valid edit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    const f = join(dir, "a.txt");
    writeFileSync(f, "hello\nworld\n");
    const p = await buildEditPermissionPreview({ path: f, edits: [{ oldText: "hello", newText: "hi" }] }, dir);
    expect(p.kind).toBe("diff");
    if (p.kind === "diff") { expect(p.addedLines).toBeGreaterThan(0); }
  });
  it("returns an error preview for a non-existent file", async () => {
    const p = await buildEditPermissionPreview({ path: "/no/such/file", edits: [{ oldText: "a", newText: "b" }] }, process.cwd());
    expect(p.kind).toBe("error");
  });
  it("returns an error preview for non-unique oldText", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    const f = join(dir, "b.txt");
    writeFileSync(f, "dup\ndup\n");
    const p = await buildEditPermissionPreview({ path: f, edits: [{ oldText: "dup", newText: "x" }] }, dir);
    expect(p.kind).toBe("error");
  });
  it("write to a new file produces a new-file preview", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    const p = await buildWritePermissionPreview({ path: join(dir, "new.txt"), content: "a\nb" }, dir);
    expect(p.kind).toBe("new-file");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/permission && npm run test -- preview.spec.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write minimal implementation**

Port `pierre-types.ts`, `pierre-highlight.ts`, `pierre-metadata.ts`, `pierre-rows.ts`, `pierre-theme.ts`, `review-preview.ts`, `review-dialog.ts` from the reference (rename `@mariozechner/*` → `@earendil-works/*`; add `.js` to relative imports; 2-space + semicolons). In `index.ts`, extend `promptForPermission` to route `edit`/`write` through `buildEditPermissionPreview`/`buildWritePermissionPreview` → `asPromptResult(preview) ?? showPermissionReviewDialog(ctx, preview)` (port the `asPromptResult`/`isAutomaticFeedbackRejection` helpers).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/permission && npm run test -- preview.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/permission/
git commit -m "feat(permission): edit/write diff preview + pierre review dialog"
```

### Task 3: Full ask prompt loop + reject-with-feedback + auto-feedback rejection

**Files:**
- Modify: `extensions/permission/index.ts` — the full `ask` loop (5-choice prompt, `Allow always` confirm + persist, `Allow always for session`, reject/reject-with-feedback)
- Test: `extensions/permission/prompt.spec.ts`

**Interfaces:**
- Consumes: `rejection.ts` (`resolvePermissionRejection`, `buildHardRejectedReason`), `constants.ts` (`PERMISSION_CHOICES`, `APPROVAL_CONFIRM_CHOICES`), `project.ts` (persistence path).
- Produces: the completed `tool_call` handler's `ask` branch; `getApprovalRules(toolName, argValue): Promise<string[]>`; `confirmApprovalRules(...)`.
- Seam: the `ask` loop in `index.ts` is the seam where prompt outcomes map to block/allow/abort.
- Deletion test: deleting the loop reappears the outcome→action mapping in the handler.
- Adapters: prod (pi UI) + test (mock `ctx.ui.select`/`input`) = 2.

**SATISFIES:** `happy path ask-reject-with-feedback`, `happy path rule-chain-resolves-mode`

- [ ] **Step 1: Write the failing tests**

`extensions/permission/prompt.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolvePermissionRejection, buildHardRejectedReason } from "./rejection.js";

describe("rejection", () => {
  it("reject -> hard with reason", async () => {
    const ctx = { ui: { input: async () => "" } } as any;
    const r = await resolvePermissionRejection(ctx, "Reject", "bash", "git status");
    expect(r).toEqual({ kind: "hard", reason: buildHardRejectedReason("bash", "git status") });
  });
  it("reject-with-feedback -> feedback kind with trimmed text", async () => {
    const ctx = { ui: { input: async () => "  use rg  " } } as any;
    const r = await resolvePermissionRejection(ctx, "Reject with feedback", "bash", "git status");
    expect(r).toEqual({ kind: "feedback", reason: "use rg" });
  });
  it("empty feedback -> back", async () => {
    const ctx = { ui: { input: async () => "" } } as any;
    const r = await resolvePermissionRejection(ctx, "Reject with feedback", "bash", "git status");
    expect(r).toEqual({ kind: "back" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/permission && npm run test -- prompt.spec.ts`
Expected: PASS (rejection.ts is pure) — this task's RED is the `tool_call` handler's `ask` branch, covered by the integration load-verify in Task 5 + the manual gate. Confirm the `ask-reject-with-feedback` scenario is wired.

- [ ] **Step 3: Write minimal implementation**

Port the full `ask` loop from the reference `index.ts` (the `while (true)` over `promptForPermission`, the `Allow always` → `getApprovalRules` → `confirmApprovalRules` → `persistApprovalRules` path, the `Allow always for session` path, and the `resolvePermissionRejection` → block/abort/continue outcomes). Wire `getApprovalRules` (bash → per-command `getBashAlwaysPattern`, edit/write/read/fetch/grep/find/ls → bare tool name).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/permission && npm run test -- prompt.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/permission/
git commit -m "feat(permission): full ask prompt loop + reject-with-feedback + auto-feedback rejection"
```

### Task 4: conf.d persistence (lock + atomic write) + skill-derived allow rules

**Files:**
- Modify: `extensions/permission/index.ts` — `persistApprovalRules`, `withPersistentApprovalLock`, `writeOwnSettingsFileAtomic`, `loadOwnSettingsFile`, `getDerivedSkillAllowState`, `mergeSkillAllowRules`
- Modify: `extensions/permission/project.ts` — add the ADR 0008 D2 project `.pi/conf.d/` fallback read to `loadExtensionSettings`
- Test: `extensions/permission/persist.spec.ts`

**Interfaces:**
- Consumes: `project.ts` conf.d paths, `bash-parser.ts` (`extractBashCommands`), `bash-arity.ts` (`BashArity.prefix`).
- Produces: `persistApprovalRules(cwd, rules): Promise<{ settingsPath: string; added: string[] }>`, `getDerivedSkillAllowState(pi): DerivedSkillAllowState`, `getSkillAllowedRules(skillPath): string[]`.
- Seam: `persistApprovalRules` + the lock is the seam where the conf.d project path (ADR 0008) is written.
- Deletion test: deleting the lock reappears the read-modify-write race in the `Allow always` path.
- Adapters: prod (fs) + test (temp dir) = 2.

**SATISFIES:** `happy path persist-always-rule`, `happy path skill-derived-allow-rules`

- [ ] **Step 1: Write the failing tests**

`extensions/permission/persist.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { persistApprovalRules } from "./index.js";

describe("persistence", () => {
  it("appends a rule to the conf.d project file exactly once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    // seed an empty conf.d
    const { mkdirSync } = await import("node:fs");
    mkdirSync(join(dir, "conf.d"), { recursive: true });
    const r = await persistApprovalRules(dir, ["bash(git status *)"]);
    const r2 = await persistApprovalRules(dir, ["bash(git status *)"]);
    expect(r2.added).toEqual([]);
    const parsed = JSON.parse(readFileSync(join(dir, "conf.d", "permission.conf"), "utf-8"));
    expect(parsed.always.filter((x: string) => x === "bash(git status *)")).toHaveLength(1);
    expect(existsSync(join(dir, "conf.d", "permission.conf.lock"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/permission && npm run test -- persist.spec.ts`
Expected: FAIL (persistApprovalRules not exported / not writing to conf.d).

- [ ] **Step 3: Write minimal implementation**

Port `persistApprovalRules`, `withPersistentApprovalLock`, `writeOwnSettingsFileAtomic`, `loadOwnSettingsFile`, `isStalePersistentApprovalLock`, `isErrnoCode`, `delay` from the reference (the lock constants `PERSISTENT_APPROVAL_LOCK_*` carry over). Change the settings path to `project.ts`'s conf.d project path (ADR 0008). Port `getDerivedSkillAllowState`, `getSkillAllowedRules`, `buildSkillAllowCacheKey`, `isLocalSkillCommand`, `mergeSkillAllowRules` (use `pi.getCommands()` + `parseFrontmatter`). Add the ADR 0008 D2 `.pi/conf.d/` fallback read to `project.ts` (`loadExtensionSettings` reads `.skill-pi/conf.d/` then `.pi/conf.d/` when the former is absent).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/permission && npm run test -- persist.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/permission/
git commit -m "feat(permission): conf.d persistence (lock+atomic) + skill-derived allow rules + .pi fallback"
```

### Task 5: Auto-accept toggle + status + commands + load-verify (backstop)

**Files:**
- Modify: `extensions/permission/index.ts` — `toggleAutoAcceptEdits`, `syncSessionStatus`, `/permission-toggle-auto-accept`, `/permission-settings`, optional `keybindings.autoAcceptEdits` shortcut
- Modify: `.skillgrid/config.yaml` — `dependency_policies` line → "pi + bundled-extension runtime deps"
- Modify: `AGENTS.md` — dep-policy line → "pi + bundled-extension runtime deps"
- Modify: `README.md` — "Currently bundled" list gains `permission`
- Test: `extensions/permission/autostatus.spec.ts`

**Interfaces:**
- Consumes: `index.ts` session state (`RuntimeSessionState.modeOverrides`), `project.ts` (`loadSettings`), `getDerivedSkillAllowState`.
- Produces: the completed extension — `session_start` syncs status; the two commands are registered; the optional keybinding is wired.
- Seam: `toggleAutoAcceptEdits`/`syncSessionStatus` is the seam where mode overrides drive the status line.
- Deletion test: deleting the toggle reappears the edit/write override bookkeeping in the handler.
- Adapters: prod (pi UI status) + test (assert modeOverrides + status string) = 2.

**SATISFIES:** `happy path toggle-auto-accept`, `happy path extension-loads-and-typechecks`

- [ ] **Step 1: Write the failing tests**

`extensions/permission/autostatus.spec.ts`:
```ts
import { describe, it, expect } from "vitest";
import { toggleAutoAcceptEdits } from "./index.js";

describe("auto-accept", () => {
  it("toggling sets edit+write overrides to allow", () => {
    const ctx = { sessionManager: { getSessionId: () => "s1" }, ui: { setStatus: () => {} } } as any;
    toggleAutoAcceptEdits(ctx);
    toggleAutoAcceptEdits(ctx); // back off
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/permission && npm run test -- autostatus.spec.ts`
Expected: FAIL (toggleAutoAcceptEdits not exported).

- [ ] **Step 3: Write minimal implementation**

Port `toggleAutoAcceptEdits`, `syncSessionStatus`, the `session_start` handler, the two `registerCommand` calls, and the optional `registerShortcut` (from `initSettings.keybindings.autoAcceptEdits`) from the reference `index.ts`. Update `.skillgrid/config.yaml` `dependency_policies` to: `"Production deps: @earendil-works/pi-coding-agent + bundled-extension runtime deps (@pierre/*, web-tree-sitter, tree-sitter-bash); dev deps for tests only"`. Update `AGENTS.md`'s matching line. Add `permission` to the README "Currently bundled" list.

- [ ] **Step 4: Run the full gate (backstop for T7)**

Run:
```bash
cd extensions/permission && npx tsc --noEmit && npx vitest run
cd ../.. && node --test "test/**/*.test.js"
```
Expected: all PASS. Then run the wrapper in a temp project and confirm pi logs the permission extension loaded (no wrapper change):
```bash
node bin/skill-pi.js --agent-dir /tmp/perm-agent --no-shim /tmp/perm-proj --print "say ok" 2>&1 | grep -i "permission\|extension" || echo "check load log"
```
Expected: the permission extension loads (or no error on the `tool_call` path).

- [ ] **Step 5: Commit**

```bash
git add extensions/permission/ .skillgrid/config.yaml AGENTS.md README.md
git commit -m "feat(permission): auto-accept toggle + commands + dep-policy docs; load-verify green"
```
