# pi-context-include extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-execution (recommended) or simple-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PROPOSED

**Tier:** T2 (classification `standard` → L2 floor; security row in the threat matrix is Applicable but bounded by the fence + unit tests, no migration)

**Build shape:** Tracer thread — Task 1 lands the thin end-to-end path (AGENTS.md `@path` → resolved file → `context_include` system-prompt section) before the fence, recursion guards, status, and handshake thicken it.

**Goal:** Build `extensions/pi-context-include/` — a skill-pi-homogenized port of `d3ara1n/pi-context-include` v3.0.0 (MIT) that expands `@path` AGENTS.md references into the system prompt per turn, guarded by a path-safety fence, with a `/context-include:status` diagnostic and a `pi-vcc-includes.json` handshake for the companion pi-vcc change.

**Architecture:** A pure resolution core (`src/resolve.ts`) does extraction → realpath dedup/cycle detection → fence check → size/depth caps → `ResolvedInclude[]` + `ScanDiagnostic`; a thin extension shell (`src/extension.ts` + `index.ts`) wires pi's `session_start` (config load), `before_agent_start` (scan + inject into `systemPromptOptions.sections.context_include` + write handshake), and `context-include:status` (render diagnostic). Ported from upstream's single-file `src/index.ts`, split by responsibility (ADR-0007, "files that change together live together").

**Tech Stack:** TypeScript (Node 22 ESM, type-stripped by pi at runtime); `bun test` + `tsc --noEmit` dev toolchain; `node:fs/promises` + `node:path` + `node:os` only — zero new runtime deps; peer `@earendil-works/pi-coding-agent` `^1.2.0` (same floor as every bundled extension).

**Spec:** `./briefing.md` — requirements R1–R8, success criteria, and the handshake contract (defined in `../2026-10-16-pi-vcc-include-awareness/briefing.md` § Constraint) live there.

**Upstream reference (porting source):** `d3ara1n/pi-extensions` `packages/pi-context-include` v3.0.0 (MIT, `src/index.ts` + `src/extractReferences.test.ts` + README). Ported behaviors: `extractReferences` regex + fence-aware line scan, `resolveIncludes` recursion, `underRoot`/`underAnyRoot` fence, `computeEffectiveRoots` defaults, `ScanDiagnostic` shape, `context-include:status` renderer, `<project_instructions path=...>` wrapping, per-turn `before_agent_start` scan, settings-file config with project-replaces-global. Removed/changed for skill-pi: config source (skill-pi settings paths), agent-dir default include root (isolated dir, not `~/.pi/agent`), handshake write (new), enable toggle (new), comments (project convention: none unless asked), single-file layout (split per ADR-0007).

**ADR constraints (in-force, respected):**
- ADR-0001 (explicit enumeration): a new `extensions/<name>/index.ts` is discovered by `collectExtensionFiles` with NO wrapper or manifest edit.
- ADR-0002 (full separation): the extension READS `<cwd>/.pi/settings.json` for its config (bounded read, same class as ADR-0008's project conf.d fallback) and reads/writes agent-dir files only; it never writes to `~/.pi` or `<repo>/.pi`.
- ADR-0005 (naming): package `@devopstales/pi-context-include`.
- ADR-0006 (never modify pi source): builds only on the public `ExtensionAPI` surface — `pi.on("session_start" | "before_agent_start")`, `pi.registerCommand`, `systemPromptOptions.sections` (verified present in the installed `@earendil-works/pi-coding-agent` 1.2.0 types: `BuildSystemPromptOptions.sections?: Record<string, string>` and `contextFiles?: Array<{ path; content }>`, `CONFIG_DIR_NAME` export).
- ADR-0007 (self-contained extension): own `package.json` (private), own toolchain; no root `package.json` change (the extension's runtime imports are only `node:*` builtins + the already-root-carried peer).

## Terms

- **agent dir** — `.skillgrid/artifacts/02-technical-terms.md`: `~/.skill-pi/agent` via `getAgentDir()`. Handshake + config defaults live here.
- **handshake file** — `<agent-dir>/pi-vcc-includes.json`: the producer-side half of the contract defined in the companion briefing; this extension WRITES it, pi-vcc READS it.
- **path-safety fence** — allow-set/deny-set root confinement for include targets (deny wins); terminology from upstream README, kept.
- **context file** — an AGENTS.md (or pi context file) surfaced by pi in `systemPromptOptions.contextFiles`; the scan root for `@path` extraction.
- **`pi-context-include`** — the new bundled extension, subject of this plan. (Sharpened: distinct from the existing `pi-context-view` extension — different concern: prompt injection vs. context measurement.)

**Decision note:** (1) package name `@devopstales/pi-context-include` follows ADR-0005 mechanical naming; (2) config lives in pi's settings files (`settings.json` `contextInclude` block), NOT in ADR-0008's `conf.d` — settled in the planning conversation (2026-10-16) to stay a faithful port (upstream reads settings.json; pi-vcc itself reads its own `<agent-dir>/pi-vcc-config.json` precedent for per-extension state); (3) the extension always-on-by-default with an env kill-switch (`SKILL_PI_CONTEXT_INCLUDE`) follows the `SKILL_PI_WEBFETCH` precedent.

## Hypothesis

```markdown
**Claim:** pi 1.2.0's `before_agent_start` `systemPromptOptions.sections` mutation point works as the per-turn injection seam for `@path` includes, and the ported resolution core produces a correct, cycle-safe, fence-bounded include graph from real AGENTS.md files.
**Right condition:** a test AGENTS.md with nested + cyclic `@path` refs yields exactly the expected `context_include` section content (each file once, cycle diagnosed) AND the handshake file written is parseable by the companion pi-vcc contract reader.
**Wrong condition:** pi ignores `sections.context_include` in the assembled system prompt, or the resolver loops/blows past size caps, or contextFiles is absent in skill-pi's shim-cwd environment.
**Thinnest MVP:** Task 1 — single-level `@path` (no recursion, no fence) from one AGENTS.md into `sections.context_include`, proven by a unit test against the event shape + a manual skill-pi session check.
**Door check:** Task 1 Step 5 (manual session probe) — if the section does not appear in the live system prompt, STOP: the seam assumption is false and the plan is invalidated before the thickening tasks.
```

## Must-Haves (goal-backward verification)

**Truths** (observable behaviors that must hold):
- `extractReferences` returns line-start `@path` tokens only: bare, list-marker-prefixed, and `N.`-prefixed lines match; mid-sentence `@`, fenced-block `@`, and email-style `user@host` do not; `.md`-suffixed paths only.
- `resolveIncludes` on a cyclic include graph terminates, includes each file exactly once (realpath dedup), and records a skip with reason `"already included"` for the cycle edge.
- Depth cap: a chain deeper than `maxDepth` is truncated with skip reason `"max depth (N) exceeded"`; size cap: a file that would push accumulated UTF-8 bytes past `maxBytes` is skipped with reason `"size limit exceeded (would reach N bytes)"`; empty files skipped (`"file is empty"`); unreadable files skipped (`"file not found"` / `"read error: ..."`).
- Fence: an include under a `deniedRoots` entry is skipped with reason `"denied by deniedRoots"` even when also under an allowed root; an include outside all allowed roots is skipped with reason `"outside allowed roots"`; with no explicit `allowedRoots`, the defaults (each context file's directory tree + `<agent-dir>/includes/`) permit in-repo relative includes and the shared agent-dir includes dir, and block everything else.
- Config: project `<cwd>/.pi/settings.json` `contextInclude` block replaces the global block when present; invalid JSON in either file → `{}` (defaults win, no throw); non-finite/negative `maxDepth`/`maxBytes` → defaults (10 / 500000); non-string-array `allowedRoots`/`deniedRoots` → treated as absent.
- The `before_agent_start` handler sets `systemPromptOptions.sections.context_include` to the wrapped `<project_instructions path="...">` block per included file (absolute paths) when results are non-empty, and DELETES the key when there are no context files or no results.
- The handshake file `<agent-dir>/pi-vcc-includes.json` is written after each non-empty scan with `{ "includes": [{ "path": "<abs resolved>", "source": "<abs AGENTS.md path>" }] }` (order-preserving, deduped by path); on an empty scan or disabled toggle, no file is written this turn.
- `/context-include:status` renders: effective allowed/denied roots, per-context-file status (ok/not found/ERROR), included files with per-file bytes + total, skipped files with `reason @ref → resolvedPath`, a ⚠ line when total ≥ maxBytes, and the pre-first-turn empty state ("No scan data yet").
- `SKILL_PI_CONTEXT_INCLUDE=0|false|no|off` (case-insensitive) disables the extension entirely: no scan, no section, no handshake, no status data; unset or any other value → enabled.
- The extension loads in skill-pi with no wrapper or `extensions/package.json` edit (auto-discovery via `collectExtensionFiles`).

**Artifacts** (files that must exist with real implementation, not stubs):
- `extensions/pi-context-include/package.json` — `@devopstales/pi-context-include`, private, `peerDependencies` `@earendil-works/pi-coding-agent ^1.2.0`, dev toolchain (`bun`, `typescript`, `@types/node`, `@types/bun`), `check`/`test` scripts, `files`/`publishConfig` matching the `pi-vcc`/`webfetch` precedent.
- `extensions/pi-context-include/index.ts` — entry: parse toggle, `scaffoldDefaultIncludesDir()`, delegate to `registerExtension`.
- `extensions/pi-context-include/src/extract.ts` — `extractReferences(content: string): string[]` (ported, export for tests).
- `extensions/pi-context-include/src/config.ts` — config types + `loadConfig(cwd)`, `readSettingsFile`, `validLimit`, `parseStringArray` (pure/testable).
- `extensions/pi-context-include/src/fence.ts` — `underRoot`, `underAnyRoot`, `resolveRootList`, `computeEffectiveRoots` (pure/testable).
- `extensions/pi-context-include/src/resolve.ts` — `resolveIncludes`, `canonicalize`, `ScanDiagnostic` + diag sub-types (pure/testable; takes explicit config, no module state).
- `extensions/pi-context-include/src/handshake.ts` — `writeHandshake(includes, agentDir)` (best-effort; path from `getAgentDir()` + `PI_CONTEXT_INCLUDE_HANDSHAKE_PATH` env override for tests).
- `extensions/pi-context-include/src/status.ts` — `renderStatus(scan: ScanDiagnostic | null, config: EffectiveConfig): string` (pure; renders the diagnostic block).
- `extensions/pi-context-include/src/extension.ts` — `registerExtension(pi)`: the three event wirings + module state (`_lastScan`, effective roots).
- `extensions/pi-context-include/README.md` — usage, syntax rules, fence, config, handshake contract, toggle, upstream attribution (MIT, source URL).
- `extensions/pi-context-include/test/extract.test.ts`, `config.test.ts`, `fence.test.ts`, `resolve.test.ts`, `handshake.test.ts`, `status.test.ts`, `extension.test.ts` — passing suites for the truths above.

**Key links** (critical connections that must work together):
- `extension.ts` must feed `resolve.ts` the SAME effective roots that `status.ts` renders (single `computeEffectiveRoots` call per scan; `_lastScan` stores the roots, not a re-computation).
- The handshake writer must consume the SAME `ResolvedInclude[]` results as the section renderer (one scan, three consumers: section, diagnostic, handshake — never two independent resolutions).
- `extractReferences` must be the single reference parser shared by `resolve.ts` (no second regex anywhere in the extension).
- `sections.context_include` deletion on empty/no-context-files must run in BOTH exit paths of the `before_agent_start` handler (no stale section from a previous turn survives).
- The handshake shape must byte-match the companion contract: the companion pi-vcc `readIncludes()` test fixture and this extension's handshake writer test assert against the SAME JSON shape (absolute `path`, `source` optional-but-present on success).

**One-way-door decisions:**
- None. New extension dir, additive `sections` key (pi treats unknown section tags as content; removing the key is clean), a new agent-dir file, a new command name (`context-include:status` — no collision with existing commands), a new env var. No migration, no published-contract break, no pi source change.

## Global Constraints

- No comments in code unless asked (project convention).
- Keep changes minimal and scoped; all edits under `extensions/pi-context-include/` (ADR-0007) — NO root `package.json`, NO `extensions/package.json`, NO `bin/` wrapper edits.
- Never read or write the stock `~/.pi/agent` (ADR-0002 security boundary); agent-dir paths via `getAgentDir()` only.
- No new runtime npm dependency; only `node:*` builtins + the peer `@earendil-works/pi-coding-agent` (already root-carried at `^1.2.0`).
- Package name `@devopstales/pi-context-include` (ADR-0005); `private: true` extension package (ADR-0007).
- Upstream attribution in README: "Vendored from d3ara1n/pi-extensions pi-context-include (MIT), homogenized for the skill-pi agent dir."
- Verify before claiming: `bun test` + `tsc --noEmit -p .` green in the extension dir before any "done" claim; root `node --test "test/**/*.test.js"` green before ship.
- Commit style: conventional commits, per work unit.
- Extension toolchain mirror of `pi-vcc`: scripts `check` (`tsc --noEmit -p .`), `test` (`bun test`); devDeps `@types/bun`, `@types/node`, `bun`, `typescript`.

## File Structure

All paths relative to `extensions/pi-context-include/`.

- `package.json` — **create.** ADR-0007 private self-contained package.
- `index.ts` — **create.** Entry point (toggle + includes-dir scaffold + `registerExtension`).
- `src/extract.ts` — **create.** Reference extraction (pure).
- `src/config.ts` — **create.** Settings read + normalization (pure).
- `src/fence.ts` — **create.** Root fence (pure).
- `src/resolve.ts` — **create.** Recursive resolution + diagnostics (pure).
- `src/handshake.ts` — **create.** Contract writer (fs).
- `src/status.ts` — **create.** Diagnostic renderer (pure).
- `src/extension.ts` — **create.** pi event wiring + module state (shell).
- `test/extract.test.ts`, `test/config.test.ts`, `test/fence.test.ts`, `test/resolve.test.ts`, `test/handshake.test.ts`, `test/status.test.ts`, `test/extension.test.ts` — **create.**
- `README.md` — **create.**
- `tsconfig.json` — **create** (mirror `extensions/pi-vcc/tsconfig.json`).
- `src/types.ts` — **create** if `ScanDiagnostic` + config types grow beyond resolve's needs (shared by status + handshake + extension); otherwise keep types colocated in `src/resolve.ts` / `src/config.ts`. Decide by import-graph: a file imported by ≥3 others earns its own module.

**Out of scope (do NOT create):** changes to `bin/`, `lib/`, root `package.json`, `extensions/package.json`, `extensions/pi-vcc/**` (companion change owns it), `test/**` (root suite only observes auto-discovery).

---

### Task 1: Package scaffold + `@path` extraction + thin injection seam (tracer thread / door check)

> **Door check task.** Step 5 is a live session probe: if `sections.context_include` does not appear in the assembled system prompt in a real skill-pi session, STOP — the seam assumption (Hypothesis) is false; report and revise before Tasks 2–6.

**Files:**
- Create: `package.json`, `tsconfig.json`, `index.ts`, `src/extract.ts`, `src/extension.ts`, `src/types.ts`
- Test: `test/extract.test.ts`

**Interfaces:**
- Consumes: `getAgentDir()`, `type ExtensionAPI` from `@earendil-works/pi-coding-agent`; `node:fs/promises` (`readFile`), `node:path`, `node:os`.
- Produces (exact signatures later tasks rely on):
  - `export const extractReferences = (content: string): string[]` — line-start `@path` tokens (after optional list marker `-`/`*`/`+`/`N.` + whitespace), fenced-block-safe, `.md`-suffixed, deduped in file order.
  - `export interface ResolvedInclude { path: string; content: string }` (in `src/types.ts`)
  - `export interface ExtensionState { enabled: boolean; lastScan: ScanDiagnostic | null }` — module state owned by `extension.ts` (the `ScanDiagnostic` full type lands in Task 3's `src/resolve.ts`; Task 1 defines the minimal `ScanDiagnostic` skeleton — contextFiles/included/skipped arrays + limits — in `src/types.ts` and `resolve.ts` (Task 3) imports it, so the type is defined ONCE here).
- Seam: the `before_agent_start` event + `systemPromptOptions.sections` is the external seam (pi runtime); tests fake the event object.
- Deletion test: delete `extension.ts` → no scan, no section, no extension registration; pi-vcc handshake never written.
- Adapters: 2 (real pi event in the live probe; faked event object in `extension.test.ts` — that test file is created in Task 5, Task 1 asserts via the live probe + extract unit tests).

**SATISFIES:** extract-syntax + injection-seam (acceptance scenarios: "Given an AGENTS.md containing `@docs/rules.md`, the system prompt contains the file's content under the `context_include` section"; "Given `@` mid-sentence, in a code fence, or an email, nothing is extracted")

- [ ] **Step 1: Scaffold the package**

`package.json` (mirror `extensions/pi-vcc/package.json` shape, name `@devopstales/pi-context-include`, description: "`@path` syntax for AGENTS.md — include rule files by reference in the system prompt, with recursive resolution and a path-safety fence. Vendored from d3ara1n/pi-extensions pi-context-include (MIT), homogenized for the skill-pi agent dir."):

```json
{
  "name": "@devopstales/pi-context-include",
  "version": "0.1.0",
  "type": "module",
  "license": "MIT",
  "private": true,
  "description": "@path syntax for AGENTS.md — include rule files by reference in the system prompt, with recursive resolution and a path-safety fence. Vendored from d3ara1n/pi-extensions pi-context-include (MIT), homogenized for the skill-pi agent dir.",
  "repository": { "type": "git", "url": "git+https://github.com/devopstales/skill-pi.git" },
  "homepage": "https://github.com/devopstales/skill-pi",
  "bugs": { "url": "https://github.com/devopstales/skill-pi/issues" },
  "keywords": ["pi", "extension", "coding-agent", "context", "include", "agents-md"],
  "files": ["index.ts", "src", "README.md"],
  "publishConfig": { "access": "public", "registry": "https://npm.pkg.github.com" },
  "scripts": { "check": "tsc --noEmit -p .", "test": "bun test" },
  "peerDependencies": { "@earendil-works/pi-coding-agent": "^1.2.0" },
  "devDependencies": {
    "@types/bun": "^1.2.0",
    "@types/node": "^24.0.0",
    "bun": "^1.2.0",
    "typescript": "^5.5.0"
  }
}
```

`tsconfig.json` — copy `extensions/pi-vcc/tsconfig.json` verbatim (verify its content at execution; it is the established per-extension toolchain config).

- [ ] **Step 2: Write the failing extraction tests (table-driven)**

`test/extract.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { extractReferences } from "../src/extract";

const cases = [
  { name: "bare line-start ref", input: "@docs/rules.md", expected: ["docs/rules.md"] },
  { name: "dot-relative ref", input: "@./docs/rules.md", expected: ["./docs/rules.md"] },
  { name: "home ref", input: "@~/.skill-pi/agent/includes/shared.md", expected: ["~/.skill-pi/agent/includes/shared.md"] },
  { name: "absolute ref", input: "@/abs/path/to/file.md", expected: ["/abs/path/to/file.md"] },
  { name: "after dash marker", input: "- @docs/rules.md", expected: ["docs/rules.md"] },
  { name: "after plus marker", input: "+ @docs/rules.md", expected: ["docs/rules.md"] },
  { name: "after numbered marker", input: "1. @docs/rules.md", expected: ["docs/rules.md"] },
  { name: "mid-sentence ignored", input: "see @docs/rules.md for details", expected: [] },
  { name: "email ignored", input: "contact user@example.com", expected: [] },
  { name: "fenced block ignored", input: "```\n@docs/rules.md\n```", expected: [] },
  { name: "non-md ignored", input: "@config.json", expected: [] },
  { name: "trailing text ignored", input: "@docs/rules.md (team rules)", expected: [] },
  { name: "multiple refs deduped in order", input: "@a.md\n@b.md\n@a.md", expected: ["a.md", "b.md"] },
  { name: "triple-backtick fence with tildes", input: "~~~\n@x.md\n~~~", expected: ["x.md"] },
];

describe("extractReferences", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(extractReferences(c.input)).toEqual(c.expected);
    });
  }
});
```

Note on the tilde-fence case: upstream toggles ONLY on ``` (triple backtick) lines; `~~~` fences are NOT fence delimiters upstream — keep parity (the case name documents the ported behavior, `x.md` IS extracted). If the ported regex diverges, fix the implementation to upstream parity, not the test.

- [ ] **Step 3: Run test to verify it fails**

Run: `cd extensions/pi-context-include && npm install && bun test test/extract.test.ts`
Expected: FAIL — cannot find module `../src/extract`.

- [ ] **Step 4: Write minimal implementation**

`src/extract.ts` — port `extractReferences` from upstream `src/index.ts` (the regex `/^@([~.]?[\w./-]+\.md)$/`, the fence toggle on lines whose trim starts with ` ``` `, the list-marker strip `replace(/^([-*+]|\d+\.)\s+/, "")`, the `seen` dedup set). No comments. Export for tests.

`src/types.ts` — `ResolvedInclude` + the `ScanDiagnostic` skeleton:

```typescript
export interface ResolvedInclude { path: string; content: string }

export interface ContextFileDiag { path: string; exists: boolean; error?: string }
export interface IncludedDiag { path: string; bytes: number }
export interface SkippedDiag { ref: string; resolvedPath: string; reason: string }

export interface ScanDiagnostic {
  contextFiles: ContextFileDiag[];
  included: IncludedDiag[];
  skipped: SkippedDiag[];
  totalBytes: number;
  maxBytes: number;
  maxDepth: number;
  allowedRoots: string[];
  deniedRoots: string[];
}
```

`index.ts` — toggle parse (same `parseEnableEnv` pattern as `extensions/webfetch/index.ts`, env var `SKILL_PI_CONTEXT_INCLUDE`), then `registerExtension(pi)` from `src/extension.ts`.

`src/extension.ts` — `registerExtension(pi: ExtensionAPI)`: `pi.on("before_agent_start", async (event) => { ... })` doing the THIN path: for each `event.systemPromptOptions.contextFiles` entry, `extractReferences(ctxFile.content)`, for each ref: `~`/relative/absolute resolution (relative against `path.dirname(path.resolve(ctxFile.path))`), `readFile` the target, collect `ResolvedInclude[]` (no dedup/fence/caps yet — Task 2 adds them). If results non-empty: `event.systemPromptOptions.sections.context_include =` the joined `<project_instructions path="${abs}">\n${content}\n</project_instructions>` blocks prefixed by the upstream header line `Additional files included via @-syntax references in the project instructions:`; else `delete event.systemPromptOptions.sections.context_include`. Guard: no context files → delete + return.

- [ ] **Step 5: Live seam probe (door check)**

Run: `node --test "test/**/*.test.js"` (root suite — confirms the new extension dir auto-loads via `collectExtensionFiles` with no wrapper edit). Then a manual probe: create a scratch project with `AGENTS.md` containing `@docs/rules.md` + `docs/rules.md` with a sentinel line `CONTEXT_INCLUDE_SENTINEL_42`; run `node bin/skill-pi.js <scratch>` in a session, send one message, then inspect the system prompt (via pi's transcript/`/context` surface or the session JSONL) for `CONTEXT_INCLUDE_SENTINEL_42` inside a `<project_instructions path=...>` block under the `context_include` section. If absent → STOP, report the seam failure, do not proceed to Task 2.

- [ ] **Step 6: Commit**

```bash
git add extensions/pi-context-include
git commit -m "feat(pi-context-include): scaffold package + @path extraction + system-prompt injection"
```

### Task 2: Recursive resolution, cycle detection, depth/size caps

**Files:**
- Create: `src/resolve.ts`
- Modify: `src/extension.ts` (replace the thin inline resolution with the `resolve.ts` call)
- Test: `test/resolve.test.ts`

**Interfaces:**
- Consumes: `extractReferences` (Task 1), `ResolvedInclude`/`ScanDiagnostic` (Task 1 `src/types.ts`), `node:fs/promises.realpath`.
- Produces:
  - `export interface ResolveOptions { maxDepth: number; maxBytes: number; allowedRoots: string[]; deniedRoots: string[]; cwd: string }`
  - `export interface ResolveResult { results: ResolvedInclude[]; skipped: SkippedDiag[]; totalBytes: number }`
  - `export const resolveContextIncludes = (contextFiles: Array<{ path: string; content: string }>, opts: ResolveOptions): Promise<ResolveResult>` — the single entry: for each context file, canonicalize + register, then walk refs recursively.
  - `export const canonicalize = (filePath: string): Promise<string>` — realpath, fallback `path.resolve`.
- Seam: none (in-process, pure w.r.t. injected `contextFiles` content).
- Deletion test: delete `resolve.ts` → `extension.ts` must inline the whole walk again (cycle/size/fence logic duplicated in the shell).
- Adapters: 2 (real fs via temp dirs in tests; the faked `contextFiles` array in `extension.test.ts` Task 5).

**SATISFIES:** recursion-cycle (scenario: "Given a cyclic @path graph, resolution terminates with each file once and the cycle edge diagnosed"; "Given a chain deeper than maxDepth / a file exceeding maxBytes, the overflow is truncated with a diagnosed reason")

- [ ] **Step 1: Write the failing tests**

`test/resolve.test.ts` (temp-dir fixtures via `mkdtempSync`):

```typescript
import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveContextIncludes } from "../src/resolve";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-ci-resolve-"));
const allow = (dir: string) => ({ maxDepth: 10, maxBytes: 500_000, allowedRoots: [dir], deniedRoots: [], cwd: dir });

describe("resolveContextIncludes", () => {
  it("resolves a single ref", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.md"), "rules of a");
    const r = await resolveContextIncludes(
      [{ path: join(dir, "AGENTS.md"), content: "@a.md" }],
      allow(dir),
    );
    expect(r.results.map((x) => x.path)).toEqual([join(dir, "a.md")]);
    expect(r.results[0].content).toBe("rules of a");
  });

  it("resolves recursively (nested refs in included files)", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "sub", "team.md"), "team rules");
    writeFileSync(join(dir, "AGENTS.md"), "@sub/team.md");
    writeFileSync(join(dir, "sub", "team.md"), "team rules\n@deeper.md");
    writeFileSync(join(dir, "sub", "deeper.md"), "deep rules");
    const r = await resolveContextIncludes(
      [{ path: join(dir, "AGENTS.md"), content: "@sub/team.md" }],
      allow(dir),
    );
    expect(r.results.map((x) => join(dir, "")).length).toBeGreaterThan(0);
    expect(r.results.some((x) => x.path.endsWith("deeper.md"))).toBe(true);
  });

  it("terminates on a cycle and diagnoses the back edge", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "a.md"), "@b.md");
    writeFileSync(join(dir, "b.md"), "@a.md");
    const r = await resolveContextIncludes(
      [{ path: join(dir, "AGENTS.md"), content: "@a.md" }],
      allow(dir),
    );
    expect(r.results.length).toBe(2);
    expect(r.skipped.some((s) => s.reason === "already included")).toBe(true);
  });

  it("dedupes symlink aliases to one include", async () => { /* symlink a.md -> b.md; expect one result */ });

  it("truncates at maxDepth with diagnosed reason", async () => {
    const dir = tmp();
    // chain: AGENTS.md -> c1.md -> c2.md -> c3.md
    for (let i = 0; i < 3; i++) writeFileSync(join(dir, `c${i + 1}.md`), `@c${i + 2}.md`);
    const r = await resolveContextIncludes(
      [{ path: join(dir, "AGENTS.md"), content: "@c1.md" }],
      { ...allow(dir), maxDepth: 1 },
    );
    expect(r.skipped.some((s) => s.reason === "max depth (1) exceeded")).toBe(true);
  });

  it("skips a file that would exceed maxBytes with diagnosed reason", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "big.md"), "x".repeat(3000));
    const r = await resolveContextIncludes(
      [{ path: join(dir, "AGENTS.md"), content: "@big.md" }],
      { ...allow(dir), maxBytes: 1000 },
    );
    expect(r.results).toEqual([]);
    expect(r.skipped[0].reason).toMatch(/size limit exceeded/);
  });

  it("skips empty and missing files with diagnosed reasons", async () => {
    const dir = tmp();
    writeFileSync(join(dir, "empty.md"), "");
    const r = await resolveContextIncludes(
      [{ path: join(dir, "AGENTS.md"), content: "@empty.md\n@missing.md" }],
      allow(dir),
    );
    const reasons = r.skipped.map((s) => s.reason);
    expect(reasons).toContain("file is empty");
    expect(reasons).toContain("file not found");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/pi-context-include && bun test test/resolve.test.ts`
Expected: FAIL — cannot find module `../src/resolve`.

- [ ] **Step 3: Write minimal implementation**

`src/resolve.ts` — port upstream `resolveIncludes` + `canonicalize` as the pure `resolveContextIncludes` (move the fence calls in from the ported logic: deny check first, then allow check, then read/empty/size checks — same order and same reason strings as upstream: `"already included"`, `"denied by deniedRoots"`, `"outside allowed roots"`, `"file not found"`, `"read error: ..."`, `"file is empty"`, `"size limit exceeded (would reach N bytes)"`, `"max depth (N) exceeded"`). The walking state (`visited` realpath set, accumulated bytes, results, skipped) is local to the call — NO module state (testability).

`src/extension.ts` — replace the Task-1 inline resolution: build `ResolveOptions` from config (loaded in Task 3; until then use defaults `maxDepth: 10`, `maxBytes: 500_000`, and the Task-3 defaults placeholder `allowedRoots: [contextFileDir, join(getAgentDir(), "includes")]` per context file — Task 3 swaps in `computeEffectiveRoots`), call `resolveContextIncludes`, keep the existing section render/delete logic unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/pi-context-include && bun test`
Expected: PASS (extract + resolve). Then `tsc --noEmit -p .`.

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-context-include
git commit -m "feat(pi-context-include): recursive resolution with cycle detection + depth/size caps"
```

### Task 3: Path-safety fence + settings config

**Files:**
- Create: `src/fence.ts`, `src/config.ts`
- Modify: `src/extension.ts` (config load on `session_start`; effective roots via `fence.ts`)
- Test: `test/fence.test.ts`, `test/config.test.ts`

**Interfaces:**
- Consumes: `getAgentDir()`, `CONFIG_DIR_NAME` from the peer; `node:fs/promises`, `node:os`.
- Produces:
  - `export const underRoot = (target: string, root: string): boolean`
  - `export const underAnyRoot = (target: string, roots: readonly string[]): boolean`
  - `export const resolveRootList = (roots: readonly string[], cwd: string): Promise<string[]>`
  - `export const computeEffectiveRoots = (contextFiles: ReadonlyArray<{ path?: string }>, allowedRoots: string[] | undefined, deniedRoots: string[], cwd: string): Promise<{ allowedRoots: string[]; deniedRoots: string[] }>` — explicit `allowedRoots` (resolved) replaces defaults; defaults = `<agent-dir>/includes/` + each context file's dirname (canonicalized).
  - `export interface ContextIncludeConfig { maxDepth?: number; maxBytes?: number; allowedRoots?: string[]; deniedRoots?: string[] }`
  - `export interface EffectiveConfig { maxDepth: number; maxBytes: number; allowedRoots: string[] | undefined; deniedRoots: string[]; cwd?: string }`
  - `export const loadConfig = (cwd?: string): Promise<EffectiveConfig>` — global `<agent-dir>/settings.json` + project `<cwd>/.pi/settings.json` (via `CONFIG_DIR_NAME`); project `contextInclude` block replaces global; `validLimit` (finite ≥ 0 number, else `DEFAULT_MAX_DEPTH = 10` / `DEFAULT_MAX_BYTES = 500_000`); `parseStringArray` (array of strings, else absent).
- Seam: none (in-process); fs is faked via temp dirs.
- Deletion test: delete `fence.ts` → the allow/deny prefix logic reappears inside `resolve.ts`; delete `config.ts` → the settings read + normalization reappears in the `extension.ts` shell.
- Adapters: 2 (temp settings files in tests; the real agent-dir + project settings in the live session).

**SATISFIES:** fence-policy + config-merge (scenarios: "Given an include under a deniedRoot, it is skipped with reason 'denied by deniedRoots' even when allowed"; "Given an include outside all allowed roots, it is skipped with reason 'outside allowed roots'"; "Given a project settings contextInclude block, it replaces the global block; invalid JSON falls back to defaults without throwing")

- [ ] **Step 1: Write the failing tests**

`test/fence.test.ts` (`PI_CODING_AGENT_DIR` is set in a `beforeEach` to a temp dir, same pattern as `config.test.ts`):

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { underRoot, underAnyRoot, resolveRootList, computeEffectiveRoots } from "../src/fence";

describe("fence", () => {
  it("underRoot: equality + prefix, POSIX-normalized", () => {
    expect(underRoot("/a/b/c.md", "/a/b")).toBe(true);
    expect(underRoot("/a/b", "/a/b")).toBe(true);
    expect(underRoot("/a/bc", "/a/b")).toBe(false);
    expect(underRoot("/a\\b\\c.md", "/a/b")).toBe(true);
  });
  it("underAnyRoot: any match wins", () => {
    expect(underAnyRoot("/x/y.md", ["/p", "/x"])).toBe(true);
    expect(underAnyRoot("/x/y.md", ["/p", "/q"])).toBe(false);
  });
  it("resolveRootList: ~ expansion, relative-to-cwd, absolute, canonicalized", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-ci-fence-"));
    const out = await resolveRootList([join(dir, "sub"), "~", "/abs"], dir);
    expect(out[0]).toBe(join(dir, "sub"));
    expect(out[1]).toMatch(/^(\/Users|\/home)\//);
    expect(out[2]).toBe("/abs");
  });
  it("computeEffectiveRoots: explicit allowedRoots replaces defaults", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-ci-fence-"));
    const r = await computeEffectiveRoots([{ path: join(dir, "AGENTS.md") }], [join(dir, "docs")], [], dir);
    expect(r.allowedRoots).toEqual([join(dir, "docs")]);
  });
  it("computeEffectiveRoots: defaults = agent-dir includes + context file dirs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-ci-fence-"));
    const r = await computeEffectiveRoots([{ path: join(dir, "AGENTS.md") }], undefined, [], dir);
    expect(r.allowedRoots).toContain(dir);
    expect(r.allowedRoots).toContain(join(process.env.PI_CODING_AGENT_DIR!, "includes"));
  });
});
```

`test/config.test.ts` (temp agent-dir + project dir, env override `PI_CODING_AGENT_DIR`):

```typescript
import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { loadConfig, DEFAULT_MAX_DEPTH, DEFAULT_MAX_BYTES } from "../src/config";

describe("loadConfig", () => {
  beforeEach(() => {
    const agentDir = mkdtempSync(join(tmpdir(), "pi-ci-agent-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });
  it("defaults when no settings exist", async () => {
    const c = await loadConfig("/no/cwd");
    expect(c.maxDepth).toBe(DEFAULT_MAX_DEPTH);
    expect(c.maxBytes).toBe(DEFAULT_MAX_BYTES);
    expect(c.allowedRoots).toBeUndefined();
    expect(c.deniedRoots).toEqual([]);
  });
  it("project block replaces global block", async () => { /* write both; assert project values win for overlapping keys */ });
  it("invalid JSON in either file falls back to defaults (no throw)", async () => {
    const agentDir = process.env.PI_CODING_AGENT_DIR!;
    writeFileSync(join(agentDir, "settings.json"), "{oops");
    const c = await loadConfig("/no/cwd");
    expect(c.maxDepth).toBe(DEFAULT_MAX_DEPTH);
  });
  it("non-finite/negative limits use defaults; non-string-array roots are absent", async () => {
    /* maxDepth: -1, maxBytes: "500", allowedRoots: ["ok", 3] → defaults/undefined */
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/pi-context-include && bun test test/fence.test.ts test/config.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

`src/fence.ts` — port upstream `toPosix`, `underRoot` (incl. Windows drive-letter case-insensitivity), `underAnyRoot`, `resolveRootList`, `computeEffectiveRoots` (make `allowedRoots`/`deniedRoots`/`cwd` explicit parameters instead of reading module state — the shell passes the loaded config in). `src/config.ts` — `DEFAULT_MAX_DEPTH = 10`, `DEFAULT_MAX_BYTES = 500_000`, `readSettingsFile` (try/catch → `{}`), `validLimit`, `parseStringArray`, `loadConfig` (global via `path.join(getAgentDir(), "settings.json")`; project via `path.join(cwd, CONFIG_DIR_NAME, "settings.json")`; `project.contextInclude ?? global.contextInclude`).

`src/extension.ts` — add `pi.on("session_start", async (_e, ctx) => { await loadConfig(ctx.cwd); lastScan = null; })`; in `before_agent_start`, call `computeEffectiveRoots(contextFiles, cfg.allowedRoots, cfg.deniedRoots, cwd)` once per scan, pass roots into `ResolveOptions`, store the roots on the scan diagnostic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/pi-context-include && bun test && tsc --noEmit -p .`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-context-include
git commit -m "feat(pi-context-include): path-safety fence + settings config (project-replaces-global)"
```

### Task 4: `/context-include:status` command

**Files:**
- Create: `src/status.ts`
- Modify: `src/extension.ts` (register the command; render from `lastScan` + effective config)
- Test: `test/status.test.ts`

**Interfaces:**
- Consumes: `ScanDiagnostic` (Task 1 types), `EffectiveConfig` (Task 3).
- Produces:
  - `export const renderStatus = (scan: ScanDiagnostic | null, cfg: EffectiveConfig): string` — pure renderer; returns the exact diagnostic block (see Truths for content).
- Seam: none.
- Deletion test: delete `status.ts` → the multi-section formatting reappears inline in the command handler.
- Adapters: 1 (faked `ScanDiagnostic` in tests) — the seam is justified by Task 1's live probe, not by this file.

**SATISFIES:** status-diagnostics (scenario: "After a turn with includes, /context-include:status renders roots, context files, included bytes, skipped reasons, and the size warning; before any turn it renders the empty state")

- [ ] **Step 1: Write the failing tests**

`test/status.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { renderStatus } from "../src/status";
import type { ScanDiagnostic } from "../src/types";

const baseCfg = { maxDepth: 10, maxBytes: 500_000, allowedRoots: undefined, deniedRoots: [], cwd: "/p" };
const scan = (over: Partial<ScanDiagnostic> = {}): ScanDiagnostic => ({
  contextFiles: [{ path: "/p/AGENTS.md", exists: true }],
  included: [{ path: "/p/docs/rules.md", bytes: 120 }],
  skipped: [{ ref: "secrets/creds.md", resolvedPath: "/p/secrets/creds.md", reason: "denied by deniedRoots" }],
  totalBytes: 120, maxBytes: 500_000, maxDepth: 10,
  allowedRoots: ["/p", "/agent/includes"], deniedRoots: ["/p/secrets"],
  ...over,
});

describe("renderStatus", () => {
  it("renders the empty state before any scan", () => {
    expect(renderStatus(null, baseCfg)).toContain("No scan data yet");
  });
  it("renders roots, context files, included bytes, and skipped reasons", () => {
    const out = renderStatus(scan(), baseCfg);
    expect(out).toContain("Allowed roots");
    expect(out).toContain("/p/docs/rules.md");
    expect(out).toContain("120 B");
    expect(out).toContain("denied by deniedRoots");
    expect(out).toContain("@secrets/creds.md");
  });
  it("warns when total is at/above maxBytes", () => {
    const out = renderStatus(scan({ totalBytes: 500_000 }), baseCfg);
    expect(out).toMatch(/limit/);
  });
  it("renders per-file errors for unreachable context files", () => {
    const out = renderStatus(scan({ contextFiles: [{ path: "/p/gone.md", exists: false, error: "ENOENT" }] }), baseCfg);
    expect(out).toContain("ERROR: ENOENT");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/pi-context-include && bun test test/status.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/status.ts` — port upstream's status block structure (header `**pi-context-include**`, limits line, allowed/denied roots, context files with ok/not found/ERROR, included files with per-file bytes + total, skipped `reason @ref → resolvedPath`, ⚠ at/above-limit warning, `formatBytes` helper). Pure function over `(scan, cfg)`; `scan === null` → the "No scan data yet — includes are resolved each agent turn. Send a message first." empty state.

`src/extension.ts` — `pi.registerCommand("context-include:status", { description: "Show include graph: context files, resolved includes, skipped files", handler: async (_args, ctx) => { ctx.ui.notify(renderStatus(lastScan, effectiveCfg), "info"); } })`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/pi-context-include && bun test && tsc --noEmit -p .`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-context-include
git commit -m "feat(pi-context-include): add /context-include:status diagnostic command"
```

### Task 5: pi-vcc handshake writer + extension wiring test

**Files:**
- Create: `src/handshake.ts`
- Create: `test/extension.test.ts`
- Modify: `src/extension.ts` (write handshake after each scan; honor the toggle in every wiring point)
- Test: `test/handshake.test.ts`

**Interfaces:**
- Consumes: `ResolvedInclude` (Task 1), `ScanDiagnostic.contextFiles` (source attribution), `getAgentDir()`.
- Produces:
  - `export const HANDSHAKE_FILENAME = "pi-vcc-includes.json"`
  - `export const handshakePath = (): string` — `process.env.PI_CONTEXT_INCLUDE_HANDSHAKE_PATH ?? join(getAgentDir(), HANDSHAKE_FILENAME)`.
  - `export const writeHandshake = (includes: ResolvedInclude[], sources: Array<{ path: string }>): void` — writes `{ includes: [{ path, source }] }` (order-preserving, deduped by `path`, `source` = the context file whose tree the include resolved from — for nested includes, the ROOT context file); best-effort: any error is swallowed (never throws, never fails the turn); no-op when `includes.length === 0` or the toggle is off.
- Seam: the handshake file on disk (the cross-extension contract); env override for tests.
- Deletion test: delete `handshake.ts` → pi-vcc's `[Standing Rules]`/`expandRefs` consume nothing; the companion change's fixture has no producer.
- Adapters: 2 (real write under a temp `PI_CONTEXT_INCLUDE_HANDSHAKE_PATH`; the companion pi-vcc `readIncludes()` fixture asserting the same shape).

**SATISFIES:** handshake-contract (scenario: "After a scan with N resolved includes, <agent-dir>/pi-vcc-includes.json contains exactly those N absolute paths with source attribution; with the toggle off or an empty scan, no file is written this turn")

- [ ] **Step 1: Write the failing tests**

`test/handshake.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeHandshake } from "../src/handshake";

describe("writeHandshake", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "pi-ci-handshake-"));
    process.env.PI_CONTEXT_INCLUDE_HANDSHAKE_PATH = join(tmp, "pi-vcc-includes.json");
  });
  afterEach(() => { delete process.env.PI_CONTEXT_INCLUDE_HANDSHAKE_PATH; });

  it("writes the companion contract shape", () => {
    writeHandshake(
      [{ path: "/p/docs/rules.md", content: "x" }],
      [{ path: "/p/AGENTS.md" }],
    );
    const parsed = JSON.parse(readFileSync(process.env.PI_CONTEXT_INCLUDE_HANDSHAKE_PATH, "utf-8"));
    expect(parsed).toEqual({ includes: [{ path: "/p/docs/rules.md", source: "/p/AGENTS.md" }] });
  });

  it("dedupes by path, order-preserving", () => {
    writeHandshake(
      [
        { path: "/p/a.md", content: "" },
        { path: "/p/b.md", content: "" },
        { path: "/p/a.md", content: "" },
      ],
      [{ path: "/p/AGENTS.md" }],
    );
    const parsed = JSON.parse(readFileSync(process.env.PI_CONTEXT_INCLUDE_HANDSHAKE_PATH, "utf-8"));
    expect(parsed.includes.map((i: any) => i.path)).toEqual(["/p/a.md", "/p/b.md"]);
  });

  it("is a no-op (no write) for empty includes", () => {
    writeHandshake([], [{ path: "/p/AGENTS.md" }]);
    expect(existsSync(process.env.PI_CONTEXT_INCLUDE_HANDSHAKE_PATH)).toBe(false);
  });

  it("never throws on unwritable path", () => {
    process.env.PI_CONTEXT_INCLUDE_HANDSHAKE_PATH = "/proc/definitely/not/writable/x.json";
    expect(() => writeHandshake([{ path: "/p/a.md", content: "" }], [{ path: "/p/AGENTS.md" }])).not.toThrow();
  });
});
```

`test/extension.test.ts` — fake the `pi` API (`on`, `registerCommand` capturing handlers) and the `before_agent_start` event (`{ systemPromptOptions: { contextFiles, sections: {} } }`); temp dirs for AGENTS.md + includes + agent-dir:

```typescript
describe("extension wiring", () => {
  it("sets sections.context_include from resolved includes and writes the handshake", async () => {
    // register, capture the before_agent_start handler, invoke it with a fixture
    // contextFiles pointing at a temp AGENTS.md with "@rules.md"; assert
    // event.systemPromptOptions.sections.context_include contains the content
    // AND the handshake file (env override) has the resolved path.
  });
  it("deletes sections.context_include when there are no results", async () => {
    // set sections.context_include = "stale" before invoking; assert deleted after.
  });
  it("does nothing when the toggle is off", async () => {
    // SKILL_PI_CONTEXT_INCLUDE=0 → handler leaves sections + handshake untouched.
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/pi-context-include && bun test test/handshake.test.ts test/extension.test.ts`
Expected: FAIL — `writeHandshake` missing; wiring assertions unmet (handshake not written).

- [ ] **Step 3: Write minimal implementation**

`src/handshake.ts` — `HANDSHAKE_FILENAME`, `handshakePath()`, `writeHandshake(includes, sources)` per Interfaces (dedup by `path` with a `Map`, `source` = `sources[0].path` — the root context file — for every include; `writeFileSync` in try/catch; skip write when `includes.length === 0`).

`src/extension.ts` — after the scan in `before_agent_start` (both the non-empty and empty paths): `writeHandshake(state.results, contextFiles)` guarded by the toggle; on an empty scan, do NOT rewrite (the previous turn's file stays — pi-vcc reads a stable snapshot; document in README).

- [ ] **Step 4: Run tests to verify they pass + contract cross-check**

Run: `cd extensions/pi-context-include && bun test && tsc --noEmit -p .`
Expected: PASS + clean. Cross-check: the JSON the handshake test writes must satisfy the companion's `readIncludes()` expectations (absolute `path` strings, `.md` suffix) — eyeball against `extensions/pi-vcc/tests/includes.test.ts` fixture shape (the companion blueprint's Task 1).

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-context-include
git commit -m "feat(pi-context-include): write pi-vcc-includes.json handshake + wiring tests"
```

### Task 6: README + live verification + root-suite gate

**Files:**
- Create: `README.md`
- Test: (no new files — verification only)

**Interfaces:**
- Consumes: all of Tasks 1–5.
- Produces: a documented, verified extension; green root suite.
- Seam: none.
- Deletion test: n/a.
- Adapters: n/a.

**SATISFIES:** docs + integration-gate (scenario: "The README documents syntax, fence, config, handshake, and toggle; a live skill-pi session with nested/cyclic/denied includes behaves per the success criteria; the root wrapper suite is green")

- [ ] **Step 1: Write README.md**

Sections (mirror `extensions/pi-vcc/README.md` structure): what it is + upstream attribution ("Vendored from d3ara1n/pi-extensions pi-context-include (MIT), homogenized for the skill-pi agent dir"); syntax rules (line-start, list markers, fence-safe, `.md` only, relative/`~`/absolute); recursive includes + guards (depth 10, 500 KB, cycle/dedup); path-safety fence (default allow-set = context-file dirs + `<agent-dir>/includes/`; deny wins; `allowedRoots: []` blocks all; "guards against accidents, not adversaries"); config block (both settings paths, project-replaces-global, field semantics); `/context-include:status`; the handshake contract (shape, path, env override `PI_CONTEXT_INCLUDE_HANDSHAKE_PATH`, write-on-non-empty-scan semantics, companion link `../pi-vcc`); toggle (`SKILL_PI_CONTEXT_INCLUDE`); development (`npm install`, `npm run check`, `npm test`).

- [ ] **Step 2: Live end-to-end verification**

In a scratch project: `AGENTS.md` with `@docs/rules.md` (which itself contains `@sub/team.md` and a cycle back to `@docs/rules.md`), a `secrets/creds.md` with `deniedRoots: ["./secrets"]` set in the project settings, and `~/.skill-pi/agent/includes/shared.md`. Run a real `skill-pi` session, send a message, then: (a) confirm the system prompt contains rules + team + shared each exactly once, NOT creds; (b) run `/context-include:status` and confirm the skipped `denied by deniedRoots` row + the cycle skip row; (c) confirm `<agent-dir>/pi-vcc-includes.json` lists the three resolved absolute paths; (d) restart with `SKILL_PI_CONTEXT_INCLUDE=0` and confirm the section is absent and no handshake was rewritten this turn.

- [ ] **Step 3: Root suite + typecheck gate**

Run: `node --test "test/**/*.test.js"` (repo root) and `cd extensions/pi-context-include && bun test && tsc --noEmit -p .`.
Expected: all green. (Root suite asserts the extension auto-loads with no wrapper/manifest edit — ADR-0001.)

- [ ] **Step 4: Commit**

```bash
git add extensions/pi-context-include/README.md
git commit -m "docs(pi-context-include): README + live verification notes"
```

---

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Filesystem read (context files, included `.md`, settings files, handshake write) | Applicable: per-turn reads of user-controlled AGENTS.md trees + a per-turn write under the agent dir | Every read try/catch → diagnosed skip or `{}` config fallback; fence evaluated BEFORE read (denied/out-of-scope files never load); size cap enforced during accumulation; handshake write best-effort, never throws | Task 2 `resolve` skip-reason tests (empty/missing/size/depth); Task 3 `config` invalid-JSON test; Task 5 `writeHandshake` unwritable-path test |
| Path safety (which files may be injected into a high-trust prompt section) | Applicable: included content enters the system prompt inside `<project_instructions>` (pi's high-trust tag); an errant `@../../secret.md` leaks it every turn | Allow-set/deny-set fence (deny wins), defaults bounded to context-file dirs + `<agent-dir>/includes/`; realpath canonicalization so symlink escapes are caught by prefix comparison; `.md`-only extraction; explicit `allowedRoots` fully replaces defaults (documented) | Task 3 `fence` tests (equality vs prefix, `~`/relative/absolute root resolution, explicit-replaces-defaults); Task 2 resolve-with-fence skip test (`denied by deniedRoots` / `outside allowed roots`) |
| Symlink / cycle (infinite recursion, unbounded prompt growth) | Applicable: recursive resolution over user-authored files | realpath `visited` set → cycle + symlink-alias dedup in one mechanism; depth cap (10) with diagnosed truncation; total byte cap (500 KB) enforced before read-append | Task 2 cycle test (`already included` back-edge) + symlink-alias dedup test + `maxDepth` truncation test |
| Shell / subprocess | N/A: pure `node:fs` reads/writes + string processing; no `exec`/spawn anywhere | — | — |
| Settings parsing (global + project JSON) | Applicable: user-authored JSON in two locations controls the fence policy | Strict JSON parse, any error → `{}` (defaults win, no throw); field-level validation (`validLimit`, `parseStringArray`) — invalid fields individually fall back, never reject the whole block | Task 3 config tests (invalid JSON, non-finite limits, non-string-array roots) |
| Public API surface (new command, new section tag, new env var, new agent-dir file) | Applicable: `context-include:status` command name, `sections.context_include` tag, `SKILL_PI_CONTEXT_INCLUDE` env, `pi-vcc-includes.json` file | All additive; section key deleted on empty (no stale state); command name namespaced (`context-include:`) matching the package; env var follows the `SKILL_PI_*` family convention; file is a new contract (companion-defined) | Task 5 wiring test (section deletion on empty results + toggle-off no-op); Task 6 live verification |
| Mnemonic / tool contracts | N/A: no Mnemonic tools, no LLM-callable tools registered | — | — |

## Rollback plan

Purely additive; new extension dir, no migration, no pi change. Rollback = delete `extensions/pi-context-include/` (one commit range; conventional commits) — the extension disappears from `collectExtensionFiles` enumeration, the `context_include` section stops being written, `pi-vcc-includes.json` becomes stale-but-harmless (pi-vcc tolerates missing/stale handshake: missing → no integration). No root/wrapper/manifest edits were made, so nothing else to revert.

## Execution Handoff

6 tasks, 5 with real test cycles → **slicing is warranted** (invoke `skillgrid:slicing` → `tasks.md` with waves). Dependency order: T1 → T2 → T3 → (T4 ∥ T5) → T6. Waves: W1 = Task 1 (door check, STOP if the seam probe fails); W2 = Task 2; W3 = Task 3; W4 = Task 4 + Task 5 (parallel — independent files, both depend only on W1–W3); W5 = Task 6.

**Cross-change note:** the handshake shape is a joint contract with the companion change (`2026-10-16-pi-vcc-include-awareness`). Either change can land first; both degrade gracefully (pi-vcc: missing file → no section; this extension: pi-vcc absent → file simply unconsumed). Task 5 Step 4 cross-checks the shape against the companion's test fixture.

Choose execution:
1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
2. **Inline** — `skillgrid:simple-execution` with checkpoints.

Final review: two-axis `skillgrid:requesting-code-review` (T2 default). The Applicable threat rows each have a RED test in the tasks above; the live seam probe (Task 1 Step 5) and live E2E (Task 6 Step 2) are the held-out checks for the two `backstop`-class truths (section appears in the live prompt; handshake consumed by the companion).
