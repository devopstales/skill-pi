# pi-vcc include-awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-execution (recommended) or simple-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PROPOSED

**Tier:** T2

**Build shape:** Tracer thread — Task 1 lands the contract reader + section end-to-end (handshake file → `[Standing Rules]` in a summary) as the first real, connected slice; Tasks 2–4 thicken it.

**Goal:** Make pi-vcc compaction and recall include-aware: a `[Standing Rules]` sticky section sourced from a resolved-include handshake file, `@path` ref expansion in `vcc_recall`, and a `/pi-vcc:status` diagnostic — all without depending on the user's separate include-extension.

**Architecture:** A single new module `src/core/includes.ts` owns the handshake-file contract (read + normalize + read-content with caps); every other task consumes it. The section flows through the existing compile pipeline (`buildSections` → `SectionData` → `formatSummary` → `mergePrevious` in `summarize.ts`) with sticky-dedup merge. Recall ref expansion post-processes formatted hits in `format-recall.ts`. The status command reads a small `last-compaction.json` the `before-compact` hook persists (additive to the existing `/tmp` debug snapshot) plus `loadSettings()` and the includes module.

**Tech Stack:** TypeScript (Node 22, ESM, type-stripped by pi at runtime), `bun test`, `tsc --noEmit`; existing deps only (`typebox` for the tool param schema) — no new runtime dependency.

**Spec:** `./briefing.md` — requirements R1–R4, the handshake contract, and success criteria live there; this blueprint is the how.

**ADR constraints (in-force, respected):**
- ADR-0007 (self-contained extensions): all changes live under `extensions/pi-vcc/`; the extension `package.json` stays `private`, no new runtime dep (root carries nothing new).
- ADR-0006 (never modify pi source): build only on the public `ExtensionAPI` surface (`registerCommand`, `registerTool`, existing hook events).
- ADR-0002 (full separation): all state files land under the agent dir via `getAgentDir()`; never `~/.pi`.

## Terms

- **agent dir** — `.skillgrid/artifacts/02-technical-terms.md`: `~/.skill-pi/agent` (via `getAgentDir()`, override `PI_CODING_AGENT_DIR`). Handshake + state files live here.
- **handshake file** — `<agent-dir>/pi-vcc-includes.json`: the resolved-include contract written by the user's include-extension; defined in `briefing.md` § Constraint.
- **sticky section** — a summary section that merges across compactions via line-dedup + cap (vs. volatile `Outstanding Context` which is replaced). Vocabulary from `src/core/summarize.ts` merge rules.
- **include-aware** — pi-vcc behavior that consumes the handshake file; the subject of this plan.

**Decision note:** the handshake file location/naming (`pi-vcc-includes.json`, agent-dir, env override `PI_VCC_INCLUDES_PATH`) was settled in the planning conversation (2026-10-16) as the contract both extensions test against; it is recorded in `briefing.md` and is not re-opened by this blueprint.

## Must-Haves (goal-backward verification)

**Truths** (observable behaviors that must hold):
- Compacting with a populated, valid handshake file yields a summary containing `[Standing Rules]` whose lines are the included rule lines (fenced-block content excluded), capped at 150 lines / 6 KB total with a `(+N more in <basename>)` footer when a file is truncated.
- Compacting with a missing/empty handshake file yields NO `[Standing Rules]` section and never throws (integration is additive, never a failure mode).
- A second compaction after the first dedups `[Standing Rules]` lines (no stacking) and preserves lines that were present before.
- `vcc_recall` with `expandRefs: true` and a query whose hit mentions `@docs/rules.md` (a known include) appends the resolved file content (truncated, with a `@ref:` header) below that hit; with `expandRefs: false`/absent, output is byte-identical to today.
- `vcc_recall` output never grows unbounded by ref expansion: at most 10 refs per page, each file truncated to 40 lines / 2 KB.
- `/pi-vcc:status` prints last-compaction stats (kept turns, token est, reason, section list), effective settings, and include status (loaded/missing/skipped with reasons); before any compaction it prints a graceful empty state, not an error.
- `last-compaction.json` is written under the agent dir on every successful pi-vcc compaction and its presence does not alter compaction behavior. `backstop` — verified by held-out runtime test in Task 4 (write a compaction, read the file, then a fresh process renders status from it).

**Artifacts** (files that must exist with real implementation, not stubs):
- `extensions/pi-vcc/src/core/includes.ts` — contract: `readIncludes()`, `normalizeIncludes()`, `readIncludedRules()` (caps: 150 lines / 6 KB, fenced-block strip, non-`.md`/unreadable skip), `extractRefTokens()`.
- `extensions/pi-vcc/src/extract/standing-rules.ts` — `[Standing Rules]` line builder on top of `readIncludedRules()`.
- `extensions/pi-vcc/src/commands/vcc-status.ts` — `/pi-vcc:status` command.
- `extensions/pi-vcc/tests/extract-standing-rules.test.ts`, `tests/includes.test.ts`, `tests/standing-rules-merge.test.ts`, `tests/vcc-recall-expand-refs.test.ts`, `tests/vcc-status.test.ts` — passing tests for the truths above.
- Modified: `src/sections.ts`, `src/core/build-sections.ts`, `src/core/summarize.ts`, `src/core/format-recall.ts`, `src/tools/recall.ts`, `src/commands/vcc-recall.ts`, `src/commands/recall-scope` (`parseRecallScope`), `src/hooks/before-compact.ts`, `index.ts`, `README.md`, `package.json` (version bump).

**Key links** (critical connections that must work together):
- `buildSections()` must call the standing-rules extractor with the includes-module output, and `formatSummary()` must emit `[Standing Rules]` between `Outstanding Context` and `User Preferences` (order in `SectionData` = emission order).
- `mergePrevious()` must treat `Standing Rules` as sticky (line-dedup + cap 15), NOT volatile.
- `vcc_recall`'s ref expansion must use the same `readIncludes()`/`readIncludedRules()` as the section (single resolver; no second parser).
- `before-compact.ts` must persist `last-compaction.json` in the SAME code path that returns the compaction result (both `/pi-vcc` and auto paths), and `vcc-status.ts` must read exactly that shape.
- `parseRecallScope` must surface `expandRefs` to BOTH the tool and the command handler.

**One-way-door decisions:**
- None. The handshake file is a new file a writer extension may or may not produce; pi-vcc tolerates its absence (R: missing → no-op). `expandRefs` is a new optional param with a stable default. `last-compaction.json` is new state. No migration, no published-contract break.

## Global Constraints

- No comments in code unless asked (project convention).
- Keep changes minimal and scoped; all edits under `extensions/pi-vcc/` (ADR-0007).
- Never read or write the stock `~/.pi/agent` — agent-dir state only (ADR-0002, project security boundary).
- No new runtime dependency; `typebox` already present for tool schemas (ADR-0007 dep policy).
- No new npm peer/dev deps in `extensions/pi-vcc/package.json`; the extension's own toolchain is `bun`/`tsc` (already declared).
- Verify before claiming: `bun test` and `tsc --noEmit -p .` green before any "done" claim.
- Tests live in `extensions/pi-vcc/tests/` and run via `bun test` (the extension's self-test, per ADR-0007); root `node --test` is the wrapper suite and is NOT touched.
- Commit style: conventional commits, per work unit (`.agents/skills/_shared/rules/commits.md`).

## File Structure

All paths relative to `extensions/pi-vcc/`.

- `src/core/includes.ts` — **create.** The include contract, single source of truth for every other task.
- `src/extract/standing-rules.ts` — **create.** Section line builder (thin; formats `readIncludedRules()` output).
- `src/commands/vcc-status.ts` — **create.** `/pi-vcc:status` command.
- `src/sections.ts` — **modify.** Add `standingRules: string[]` to `SectionData` (position: after `outstandingContext`, before `userPreferences`).
- `src/core/build-sections.ts` — **modify.** Populate `standingRules` via the new extractor.
- `src/core/format.ts` — **modify.** Add `section("Standing Rules", data.standingRules)` to `formatSummary`'s `headerParts` (the section list is hardcoded here — this is the actual emission point; order: after `Outstanding Context`, before `User Preferences`). The existing `section()` helper already omits empty sections, so no extra guard needed.
- `src/core/summarize.ts` — **modify.** Add `"Standing Rules"` to `HEADER_NAMES` in the SAME position as `formatSummary` (merge's `sectionOf` parser keys off this array); `mergeHeaderSection`'s default branch already does line-dedup + cap 15, which is exactly the sticky semantics needed — no special case required.
- `src/core/format-recall.ts` — **modify.** Optional ref-expansion post-processor on formatted output.
- `src/tools/recall.ts` — **modify.** Add optional `expandRefs` boolean param; pass resolver + flag into `formatRecallOutput`.
- `src/commands/vcc-recall.ts` — **modify.** Parse `expandRefs` token; thread through.
- `src/core/recall-scope.ts` — **modify.** `parseRecallScope` returns `expandRefs: boolean`.
- `src/hooks/before-compact.ts` — **modify.** Persist `last-compaction.json` (agent dir) on successful compaction; additive, never alters the returned compaction.
- `index.ts` — **modify.** Register `vcc-status` command.
- `README.md` — **modify.** Document the handshake contract, `[Standing Rules]`, `expandRefs`, `/pi-vcc:status`, caps.
- `package.json` — **modify.** Version `0.1.0 → 0.2.0` (new capabilities).
- `tests/*.test.ts` — **create** the five suites listed under Artifacts; refactor `tests/build-sections.test.ts` + `tests/extract-preferences.test.ts` into table-driven form (R4, low-risk, additive assertions).

---

### Task 1: Include contract reader + `[Standing Rules]` sticky section (tracer thread)

> Carries the door check: if the handshake-file → section slice doesn't produce a capped `[Standing Rules]` section in a real summary, STOP — the contract shape or pipeline insertion point is wrong and the plan is invalidated.

**Files:**
- Create: `src/core/includes.ts`
- Create: `src/extract/standing-rules.ts`
- Create: `tests/includes.test.ts`
- Create: `tests/extract-standing-rules.test.ts`
- Modify: `src/sections.ts`
- Modify: `src/core/build-sections.ts`
- Modify: `src/core/format.ts` (emit the new section)
- Modify: `src/core/summarize.ts` (HEADER_NAMES only — merge default branch already sticky)
- Test: `tests/build-sections.test.ts` (add standing-rules assertions, table-driven)

**Interfaces:**
- Consumes: `getAgentDir()` from `@earendil-works/pi-coding-agent`; `process.env.PI_VCC_INCLUDES_PATH` (new, test override); `SectionData` (existing).
- Produces (exact signatures later tasks rely on):
  - `export interface IncludeEntry { path: string; source?: string }`
  - `export const INCLUDES_PATH_DEFAULT: string` (join(getAgentDir(), "pi-vcc-includes.json"))
  - `export const readIncludes = (): IncludeEntry[]` — reads + normalizes the handshake file; returns `[]` on missing/invalid (never throws).
  - `export interface IncludedRule { file: string; lines: string[]; truncated: boolean }`
  - `export const readIncludedRules = (entries?: IncludeEntry[]): IncludedRule[]` — default `entries = readIncludes()`; reads each `.md`, strips fenced blocks, caps at 150 lines / 6 KB total (first-wins), returns per-file `truncated` flag.
  - `export const extractRefTokens = (text: string): string[]` — line-start-only `@path` tokens (optionally after a list marker `-`/`*`/`+`/`1.`), fenced-block-safe; reused by Task 3.
  - `export const buildStandingRules = (entries?: IncludeEntry[]): string[]` (in `src/extract/standing-rules.ts`) — returns `- <line>` bullets from `readIncludedRules()` output, in order, with `(+N more in <basename>)` footer lines for truncated files.
- Seam: none (in-process). The handshake file path is the only external seam; `PI_VCC_INCLUDES_PATH` makes it testable without a real agent dir.
- Deletion test: delete `includes.ts` → the section extractor, recall ref expansion (Task 3), and status (Task 4) all lose their single resolver; they'd each need their own file-read + cap logic.
- Adapters: 2 (prod `readIncludes` from agent-dir file; test adapter pointing `PI_VCC_INCLUDES_PATH` at a temp fixture).

**SATISFIES:** standing-rules-section (acceptance scenario: "Given a populated handshake file, compacting emits a capped `[Standing Rules]` section"; and "Given a missing handshake file, compacting emits no such section and does not fail")

- [ ] **Step 1: Write the failing tests**

`tests/includes.test.ts` (table-driven):

```typescript
import { describe, it, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readIncludes, readIncludedRules, extractRefTokens } from "../src/core/includes";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-vcc-includes-"));

describe("readIncludes", () => {
  it("returns [] when the handshake file is missing", () => {
    process.env.PI_VCC_INCLUDES_PATH = join(tmp(), "nope.json");
    expect(readIncludes()).toEqual([]);
  });
  it("returns [] (not throw) on invalid JSON", () => {
    const p = join(tmp(), "bad.json");
    writeFileSync(p, "{not json");
    process.env.PI_VCC_INCLUDES_PATH = p;
    expect(readIncludes()).toEqual([]);
  });
  it("returns absolute entries and drops non-.md / non-absolute", () => {
    const p = join(tmp(), "ok.json");
    writeFileSync(p, JSON.stringify({ includes: [
      { path: "/a/b.md", source: "AGENTS.md" },
      { path: "/a/c.txt" },
      { path: "relative/d.md" },
    ] }));
    process.env.PI_VCC_INCLUDES_PATH = p;
    expect(readIncludes()).toEqual([{ path: "/a/b.md", source: "AGENTS.md" }]);
  });
});

describe("readIncludedRules", () => {
  const writeMd = (dir: string, name: string, body: string): string => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };
  it("reads lines, strips fenced blocks, dedups", () => {
    const dir = tmp();
    const p = writeMd(dir, "rules.md", [
      "Always run tests.",
      "```bash",
      "const x = 1;",
      "```",
      "Never commit secrets.",
      "Always run tests.",
    ].join("\n"));
    const out = readIncludedRules([{ path: p }]);
    expect(out[0].lines).toEqual(["Always run tests.", "Never commit secrets."]);
    expect(out[0].truncated).toBe(false);
  });
  it("caps at 6KB total with truncated flag", () => {
    const dir = tmp();
    const p = writeMd(dir, "big.md", Array.from({ length: 2000 }, (_, i) => `rule ${i}`).join("\n"));
    const out = readIncludedRules([{ path: p }]);
    expect(out[0].truncated).toBe(true);
    const totalLines = out.reduce((n, r) => n + r.lines.length, 0);
    expect(totalLines).toBeLessThanOrEqual(150);
  });
  it("skips unreadable paths", () => {
    const out = readIncludedRules([{ path: "/no/such/file.md" }]);
    expect(out).toEqual([]);
  });
});

describe("extractRefTokens (line-start, fenced-safe)", () => {
  const cases = [
    { name: "plain line-start", input: "@docs/rules.md", expected: ["@docs/rules.md"] },
    { name: "after list marker", input: "- @docs/rules.md", expected: ["@docs/rules.md"] },
    { name: "numbered marker", input: "1. @docs/rules.md", expected: ["@docs/rules.md"] },
    { name: "mid-sentence ignored", input: "see @docs/rules.md here", expected: [] },
    { name: "in code fence ignored", input: "```\n@docs/rules.md\n```", expected: [] },
    { name: "email ignored", input: "mail user@host.com", expected: [] },
  ];
  for (const c of cases) {
    it(c.name, () => { expect(extractRefTokens(c.input)).toEqual(c.expected); });
  }
});
```

`tests/extract-standing-rules.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { buildStandingRules } from "../src/extract/standing-rules";

describe("buildStandingRules", () => {
  it("returns [] with no entries", () => {
    expect(buildStandingRules([])).toEqual([]);
  });
  it("formats - bullets in order with truncation footer", () => {
    // seed via a temp handshake; assert shape
    // (concrete assertion written against readIncludedRules output in Step 3)
    const lines = buildStandingRules([]);
    expect(lines).toEqual([]);
  });
});
```

In `tests/build-sections.test.ts`, add a table-driven block:

```typescript
describe("buildSections standing rules", () => {
  it("populates standingRules from the handshake file", () => {
    // point PI_VCC_INCLUDES_PATH at a temp fixture with one .md
    // assert r.standingRules deep-equals expected bullets
  });
  it("omits standingRules (empty) when handshake file missing", () => {
    process.env.PI_VCC_INCLUDES_PATH = "/nope/none.json";
    const r = buildSections({ blocks: [{ kind: "user", text: "hi" }] });
    expect(r.standingRules).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/pi-vcc && bun test tests/includes.test.ts tests/extract-standing-rules.test.ts tests/build-sections.test.ts`
Expected: FAIL — `readIncludes`/`readIncludedRules`/`extractRefTokens`/`buildStandingRules` not exported; `r.standingRules` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

`src/core/includes.ts` — implement the four exported functions per the Interfaces block. Caps are module constants: `const MAX_RULES_LINES = 150; const MAX_RULES_BYTES = 6 * 1024;`. Fenced-block strip: track ```` ``` ````/`~~~` fences line-by-line and skip interior lines. `extractRefTokens`: match `^\s*(?:[-*+]|\d+\.)?\s*@(\S+)` per line, skip lines inside fences, reject tokens containing `@` (emails) or `.`-less host patterns is NOT required — keep it simple: any line-start `@token` after an optional list marker.

`src/extract/standing-rules.ts`:

```typescript
import { readIncludedRules } from "../core/includes";

export const buildStandingRules = (entries?: Parameters<typeof readIncludedRules>[0]): string[] => {
  const rules = readIncludedRules(entries);
  const lines: string[] = [];
  for (const r of rules) {
    for (const l of r.lines) lines.push(`- ${l}`);
    if (r.truncated) lines.push(`- (+${...} more in ${basename(r.file)})`);
  }
  return lines;
};
```

`src/sections.ts` — add to `SectionData`:

```typescript
export interface SectionData {
  sessionGoal: string[];
  outstandingContext: string[];
  filesAndChanges: string[];
  commits: string[];
  standingRules: string[];
  userPreferences: string[];
  briefTranscript: string;
}
```

`src/core/build-sections.ts` — in `buildSections()`, add `standingRules: buildStandingRules(),` to the returned object (import from `../extract/standing-rules`).

`src/core/format.ts` — in `formatSummary`, insert `section("Standing Rules", data.standingRules),` into `headerParts` between the `Outstanding Context` and `User Preferences` entries. `section()` already returns `""` for empty item lists, so the section is emitted only when non-empty.

`src/core/summarize.ts` — add `"Standing Rules"` to `HEADER_NAMES` in the same relative position (after `Outstanding Context`, before `User Preferences`) so the merge `sectionOf` parser finds it. No `mergeHeaderSection` change: the default branch (line-dedup, cap = 15 via the existing `header === "Session Goal" ? 8 : header === "Commits" ? 8 : 15` expression) is exactly the sticky semantics required.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/pi-vcc && bun test tests/includes.test.ts tests/extract-standing-rules.test.ts tests/build-sections.test.ts`
Expected: PASS. Then `bun test` (whole suite) to confirm no regression in existing section/merge tests.

- [ ] **Step 5: Verify format emission**

Add a `tests/format.test.ts` assertion: `formatSummary` with populated `standingRules` emits `[Standing Rules]` between `[Outstanding Context]` and `[User Preferences]`; with `standingRules: []` the section is absent. (The emit itself is implemented in Step 3's `format.ts` edit — this step is the RED→GREEN proof for ordering/omission.)

- [ ] **Step 6: Commit**

```bash
git add extensions/pi-vcc
git commit -m "feat(pi-vcc): add [Standing Rules] sticky section from include handshake file"
```

### Task 2: `vcc_recall` `@path` ref expansion

**Files:**
- Modify: `src/core/recall-scope.ts` (`parseRecallScope` → add `expandRefs: boolean`)
- Modify: `src/core/format-recall.ts` (ref-expansion post-processor)
- Modify: `src/tools/recall.ts` (new `expandRefs` param + thread)
- Modify: `src/commands/vcc-recall.ts` (parse + thread)
- Test: `tests/vcc-recall-expand-refs.test.ts`
- Test: `tests/recall-scope.test.ts` (add expandRefs cases)

**Interfaces:**
- Consumes: `readIncludes()`, `readIncludedRules()`, `extractRefTokens()` from Task 1's `src/core/includes.ts`.
- Produces:
  - `parseRecallScope` now returns `{ scope: "lineage" | "all"; text: string; expandRefs: boolean }` (today it returns `{ scope, text }` per `src/core/recall-scope.ts`; add the field).
  - `formatRecallOutput` signature becomes `(entries: SearchHit[], query?: string, headerOverride?: string, opts?: { expandRefs?: boolean; knownIncludes?: IncludeEntry[] }) => string` — a 4th OPTIONAL positional arg; the existing 3-arg call sites (`entries, query, headerOverride`) keep working unchanged, and only the call sites that need expansion pass the 4th arg. (Update the two expansion call sites in `recall.ts` + `vcc-recall.ts` in the same commit; do NOT touch call sites that don't expand.)
  - Ref-expansion constants: `const MAX_REFS_PER_PAGE = 10; const MAX_REF_LINES = 40; const MAX_REF_BYTES = 2 * 1024;`
- Seam: none (in-process); resolver is Task 1's.
- Deletion test: delete the post-processor → recall hits mentioning `@path` can't be followed; the tool + command lose the `expandRefs` param.
- Adapters: 2 (prod resolver; test fixture handshake).

**SATISFIES:** recall-expand-refs (scenario: "Given expandRefs:true and a hit mentioning a known @path, the resolved file body is appended; given expandRefs absent, output is unchanged")

- [ ] **Step 1: Write the failing tests**

`tests/vcc-recall-expand-refs.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { formatRecallOutput } from "../src/core/format-recall";
import type { SearchHit } from "../src/core/search-entries";

// seed PI_VCC_INCLUDES_PATH + a real temp .md with known content
describe("formatRecallOutput ref expansion", () => {
  it("appends resolved file body for a known @path in the hit", () => {
    const hit: SearchHit = { index: 1, role: "user", summary: "read @docs/rules.md for the rule", files: [] };
    const out = formatRecallOutput([hit], "rules", undefined, { expandRefs: true, knownIncludes: [{ path: rulesMdPath }] });
    expect(out).toContain("@ref:");
    expect(out).toContain("ALWAYS_RUN_TESTS");
  });
  it("does not expand when expandRefs is false", () => {
    const hit: SearchHit = { index: 1, role: "user", summary: "read @docs/rules.md", files: [] };
    const out = formatRecallOutput([hit], "rules", undefined, { expandRefs: false, knownIncludes: [{ path: rulesMdPath }] });
    expect(out).not.toContain("@ref:");
  });
  it("caps refs at 10 per page", () => {
    // 12 hits each mentioning a distinct known include -> only first 10 expanded
  });
  it("keeps the 3-arg form byte-identical (backward compat)", () => {
    const hit: SearchHit = { index: 1, role: "user", summary: "read @docs/rules.md", files: [] };
    expect(formatRecallOutput([hit], "rules")).not.toContain("@ref:");
  });
});
```

Add to `tests/recall-scope.test.ts`: `parseRecallScope("foo expandRefs")` → `{ text: "foo", scope: "lineage", expandRefs: true }`; `parseRecallScope("foo")` → `expandRefs: false`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/pi-vcc && bun test tests/vcc-recall-expand-refs.test.ts tests/recall-scope.test.ts`
Expected: FAIL — `expandRefs` not in `parseRecallScope` return; `formatRecallOutput` ignores the opts object (no `@ref:` in output).

- [ ] **Step 3: Write minimal implementation**

`src/core/recall-scope.ts` — in `parseRecallScope`, detect the `expandRefs` token (word-boundary, case-insensitive) and strip it from `text`; return it as `expandRefs`.

`src/core/format-recall.ts` — accept the 4th optional `opts` arg. After building the base `lines` array (before the final join), if `opts?.expandRefs && opts.knownIncludes?.length`: for each rendered hit line, run `extractRefTokens(line)`; a token matches a known include when its path (token minus the leading `@`) equals a `knownIncludes[].path` (absolute match only — relative tokens are NOT resolved here; the include-extension writes absolute paths, so this is by design; document in README). On match, read the file via `readIncludedRules([entry])` (reuses its caps), truncate to `MAX_REF_LINES`/`MAX_REF_BYTES`, and append `\n@ref: <basename>\n<content>` under that hit. Enforce `MAX_REFS_PER_PAGE` across the whole page (first 10 matching hits only).

`src/tools/recall.ts` — add to the `parameters` Type.Object:

```typescript
expandRefs: Type.Optional(
  Type.Boolean({ description: "When true, expand @path references in hits to the resolved include file content." }),
),
```

At the two `formatRecallOutput` call sites that return search/recent output, append the 4th arg `{ expandRefs: params.expandRefs, knownIncludes: readIncludes() }`. The expand-only path (params.expand set, no query) does NOT get the 4th arg — expansion of explicit indices is unchanged.

`src/commands/vcc-recall.ts` — use `parsed.expandRefs`; at its `formatRecallOutput` call sites for query + recent output, append `{ expandRefs: parsed.expandRefs, knownIncludes: readIncludes() }`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/pi-vcc && bun test tests/vcc-recall-expand-refs.test.ts tests/recall-scope.test.ts tests/format-recall.test.ts tests/recall-tool-scope.test.ts`
Expected: PASS (existing recall tests still green — backward-compat holds). Then full `bun test`.

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-vcc
git commit -m "feat(pi-vcc): expand @path refs in vcc_recall via expandRefs"
```

### Task 3: `/pi-vcc:status` diagnostic command

**Files:**
- Modify: `src/hooks/before-compact.ts` (persist `last-compaction.json`)
- Create: `src/commands/vcc-status.ts`
- Create: `tests/vcc-status.test.ts`
- Create: `tests/last-compaction.test.ts`
- Modify: `index.ts` (register the command)
- Modify: `src/core/settings.ts` (export the `LAST_COMPACT_PATH` default + env override `PI_VCC_LAST_COMPACT_PATH`, same pattern as `SETTINGS_PATH`)

**Interfaces:**
- Consumes: `loadSettings()` (existing), `readIncludes()`/`readIncludedRules()` (Task 1), `getAgentDir()`.
- Produces:
  - `export interface LastCompaction { at: string; reason: string; keptUserTurns: number; totalUserTurns: number; keptTokensEst: number; smartKeepAdjusted: boolean; sections: string[]; firstKeptEntryId: string; summaryLength: number }`
  - `export const LAST_COMPACT_PATH_DEFAULT: string` (join(getAgentDir(), "last-compaction.json"))
  - `export const readLastCompaction = (): LastCompaction | null` (in `src/core/last-compaction.ts` — new small file, or colocate in `settings.ts`; prefer a new `src/core/last-compaction.ts` to keep `settings.ts` focused)
  - `export const registerVccStatusCommand = (pi: ExtensionAPI) => void`
- Seam: the `last-compaction.json` file is the seam between the hook (writer) and the command (reader); `PI_VCC_LAST_COMPACT_PATH` makes it testable.
- Deletion test: delete the command → no way to inspect last compaction/settings/include status without the `/tmp` debug file; the hook's persist call becomes write-only.
- Adapters: 2 (hook writes a real file; test seeds a fixture via `PI_VCC_LAST_COMPACT_PATH`).

**SATISFIES:** vcc-status (scenario: "Given a completed compaction, /pi-vcc:status prints last-compaction + settings + include status; given no compaction yet, it prints a graceful empty state")

- [ ] **Step 1: Write the failing tests**

`tests/last-compaction.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { readLastCompaction, LAST_COMPACT_PATH_DEFAULT } from "../src/core/last-compaction";

describe("readLastCompaction", () => {
  it("returns null when the file is missing", () => {
    process.env.PI_VCC_LAST_COMPACT_PATH = "/nope/none.json";
    expect(readLastCompaction()).toBeNull();
  });
  it("parses a valid last-compaction.json", () => {
    // write fixture with all LastCompaction fields, assert round-trip
  });
  it("returns null on invalid JSON (no throw)", () => {
    // write "{bad", assert null
  });
});
```

`tests/vcc-status.test.ts` — stub a minimal `pi` + `ctx` capturing `ctx.ui.notify`/`sendMessage`; seed `PI_VCC_LAST_COMPACT_PATH`, a handshake fixture, and a `pi-vcc-config.json` fixture; invoke the command handler; assert the output contains the section list, kept-turns, effective settings values, and include status (loaded/missing). Also assert the no-compaction empty-state text.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd extensions/pi-vcc && bun test tests/last-compaction.test.ts tests/vcc-status.test.ts`
Expected: FAIL — `readLastCompaction`/`LAST_COMPACT_PATH_DEFAULT`/`registerVccStatusCommand` not exported; command not registered.

- [ ] **Step 3: Write minimal implementation**

`src/core/last-compaction.ts` — `LastCompaction` interface, `LAST_COMPACT_PATH_DEFAULT`, `readLastCompaction()` (mirror `readJson`/`loadSettings` style from `settings.ts`; never throws).

`src/hooks/before-compact.ts` — in the success path (where `details: PiVccCompactionDetails` is built, ~line 551), also `writeFileSync` the `LastCompaction` JSON to `LAST_COMPACT_PATH_DEFAULT` (env override). Guard in try/catch; a write failure must not alter or block the returned compaction. Build the object from the already-available locals (`reason`, `stats`/`keptUserTurns`, `totalUserTurns`, `keptTokensEst`, `smartKeepAdjusted`, `sections` from the `summary.matchAll` already computed, `firstKeptEntryId`, `summary.length`, `at: new Date().toISOString()`).

`src/commands/vcc-status.ts` — `registerVccStatusCommand(pi)` calls `pi.registerCommand("pi-vcc:status", { description: "Show last compaction, settings, and include status", handler: async (_args, ctx) => { ... } })`. Render a plain-text block:
- `Last compaction:` — from `readLastCompaction()`; if null, `none yet`.
- `Settings:` — from `loadSettings()`, one line per key.
- `Includes:` — from `readIncludes()`; list each entry as `loaded <basename>` / `missing <path>` (check `readIncludedRules` non-empty per entry), plus total line/byte usage vs caps.
Send via `ctx.ui.notify` (info) or `pi.sendMessage({ customType: "pi-vcc-status", content, display: true })` — match how `vcc-recall` surfaces output (`pi.sendMessage` with `display: true`).

`index.ts` — `import { registerVccStatusCommand } from "./src/commands/vcc-status";` and call it in the default export.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd extensions/pi-vcc && bun test tests/last-compaction.test.ts tests/vcc-status.test.ts`
Expected: PASS. Full `bun test` for regressions (especially `before-compact-hook.test.ts` — the new write must not change its assertions; the `backstop` truth here is the held-out: write a compaction in one process, read the file in a fresh test process, render status from it).

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-vcc
git commit -m "feat(pi-vcc): add /pi-vcc:status diagnostic command + last-compaction.json"
```

### Task 4: Table-driven test refactor (R4) + docs + version

**Files:**
- Modify: `tests/extract-preferences.test.ts` (refactor to table-driven `[{ name, input, expected }]`)
- Modify: `tests/build-sections.test.ts` (consolidate the standing-rules additions into the table style)
- Modify: `README.md` (handshake contract, `[Standing Rules]`, `expandRefs`, `/pi-vcc:status`, caps, env overrides)
- Modify: `package.json` (version `0.1.0 → 0.2.0`)

**Interfaces:**
- Consumes: all of Tasks 1–3 (tests only + docs; no production signature change).
- Produces: green `bun test` + `tsc --noEmit`; updated README; bumped version.
- Seam: none.
- Deletion test: n/a (test hygiene + docs).
- Adapters: n/a.

**SATISFIES:** test-hygiene (scenario: "The preference/goal/standing-rules extractor suites are table-driven and green")

- [ ] **Step 1: Refactor `extract-preferences.test.ts` to table-driven**

Convert the individual `it(...)` preference-extraction cases into a `const cases = [{ name, input, expected }]` loop (mirror the `extractRefTokens` table from Task 1). Assertions must be behavior-preserving (same inputs/expected as today — no semantic change).

- [ ] **Step 2: Run the suite to confirm no regression**

Run: `cd extensions/pi-vcc && bun test`
Expected: PASS, same test count (or higher if split), zero new failures.

- [ ] **Step 3: Update README.md**

Document: the handshake file contract (path, env override, shape, caps, missing-file = no-op), the `[Standing Rules]` section (sticky, capped, fenced-block-safe), `vcc_recall expandRefs` (tool + command, caps 10/40/2KB, absolute-only matching), `/pi-vcc:status` (what it shows), and the new env overrides `PI_VCC_INCLUDES_PATH` / `PI_VCC_LAST_COMPACT_PATH`.

- [ ] **Step 4: Bump version + typecheck**

`package.json` `version: "0.1.0"` → `"0.2.0"`. Run `cd extensions/pi-vcc && tsc --noEmit -p .` and `bun test`.
Expected: tsc clean, full suite green.

- [ ] **Step 5: Commit**

```bash
git add extensions/pi-vcc
git commit -m "docs(pi-vcc): table-driven extractor tests, include-awareness README, v0.2.0"
```

---

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| Filesystem read (handshake file, included `.md`, last-compaction.json) | Applicable: pi-vcc now reads external files under the agent dir on every compaction/recall | All reads wrapped so missing/invalid JSON → `[]`/`null` (never throw); only `.md` + absolute paths accepted; size-capped (150 lines / 6 KB rules; 10/40/2 KB refs); `getAgentDir()` only, never `~/.pi` (ADR-0002) | Task 1 `readIncludes` invalid-JSON + missing tests; Task 3 `readLastCompaction` invalid test; `readIncludedRules` unreadable-path test |
| Path safety (which files may be read) | N/A: policy owned by the user's include-extension; pi-vcc trusts the handshake file's absolute paths and only enforces `.md` + readability + size caps (documented in briefing out-of-scope) | No fence re-implementation; the contract is "resolved absolute `.md` paths" | Task 1 non-`.md`/non-absolute dropped test |
| Untrusted input (file content into summary / recall output) | Applicable: included `.md` and recall hit text are injected into the compacted summary and tool output | Fenced-block strip; line/byte caps; per-file truncation footer; ref expansion capped per page — bounds the blast radius of a large/malicious include | Task 1 6KB cap test; Task 2 10-refs-per-page cap test |
| Shell / subprocess | N/A: no subprocess, no shell interpolation — pure file read + string processing | — | — |
| Concurrency (compaction writing `last-compaction.json` while `:status` reads) | N/A (accepted): single pi process per agent dir; the write is a small atomic-ish `writeFileSync` and a torn read degrades to `null` (invalid JSON → null) which renders "none yet" — acceptable for a diagnostic | try/catch on write; `readLastCompaction` returns null on any parse failure | Task 3 invalid-JSON → null test |
| Public API surface (tool schema, command names) | Applicable: `vcc_recall` gains an optional param; new `/pi-vcc:status` command | `expandRefs` optional with stable default (absent = today's behavior); `:status` is additive (new name, no collision) | Task 2 backward-compat test (3-arg `formatRecallOutput` + recall tests unchanged); Task 3 command-registration test |

## Rollback plan

Purely additive, no migration; low-risk (T2, classification `standard`), included per the project blueprint rule "include rollback plan for risky changes". Rollback = revert the commit range for this change (Tasks 1–4, conventional commits under `extensions/pi-vcc`). No persisted state is load-bearing: `last-compaction.json` and `pi-vcc-includes.json` are safe to delete; `[Standing Rules]` disappears with the code; `expandRefs` is ignored by a pre-change build. The only forward-compat note: a newer include-extension may keep writing `pi-vcc-includes.json` after rollback — harmless (unconsumed file).

## Execution Handoff

4 tasks, 3 of which carry real test cycles → **slicing is warranted** (invoke `skillgrid:slicing` to produce `tasks.md` with dependency edges + waves). Dependency order: Task 1 → Task 2 (shares `includes.ts` resolver) and Task 1 → Task 3 (shares `readIncludes`); Task 4 depends on all. Waves: W1 = Task 1 (door check); W2 = Task 2 + Task 3 (parallel, both depend only on W1); W3 = Task 4.

After slicing, choose execution:
1. **Subagent-Driven (recommended)** — fresh subagent per task, two-stage review between tasks.
2. **Inline Execution** — `skillgrid:simple-execution`, batched with checkpoints.

Final review: two-axis `skillgrid:requesting-code-review` (T2 default). No backstop truth is exogenous to the diff except Task 3's `last-compaction.json` write-then-read, which carries its own held-out test in the plan.
