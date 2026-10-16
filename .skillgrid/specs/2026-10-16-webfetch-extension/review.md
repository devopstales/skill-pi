# Review — webfetch-extension

> Change: `.skillgrid/specs/2026-10-16-webfetch-extension/` (moves to `.skillgrid/archive/2026-10-16-webfetch-extension/` at ship)
> Generated: 2026-10-16T16:05:00-05:00 (requesting-code-review)
> Diff range: `64d5f23..26fc935`
> Rigor tier: T2 (Beta) — three-axis pass per `_shared/planning/rigor-tiers.md`
> Independence: Grade B per axis (fresh subagent context, same model family as the implementer) — see `## Independence`
>
> The durable audit record of the code review. **requesting-code-review** writes this into
> the spec folder, next to `report.md` (which owns the QA gate). It is committed in the spec
> zone before code-zone work continues. **ship** archives it with the folder; **reflect**
> cites it for lineage. The three review axes are reported **side by side, never merged** —
> that separation is the point.

## What Important means

> The explicit threshold that separates a finding worth fixing now from one to park.
> Do not restate the fix-loop cap or escalation numbers here — they live in
> `_shared/planning/rigor-tiers.md`. Name only the bar for "Important."

- **Critical** — must fix before merge. Security, data loss, broken functionality, a
  `SATISFIES` scenario whose RED evidence is missing or whose code path does not match the
  Given/When/Then. Blocks `ship`.
- **Important** — should fix before merge. Architecture drift from a term or an in-force
  ADR, a hard standard breach, a missing or partial requirement, a behavior the spec never
  asked for (scope creep). Unfixed Important issues do not proceed (per the skill's
  Red Flags).
- **Minor** — nice to have. Baseline smells, style, optimization, doc polish. These are the
  nits; they are capped and summarized, never one-per-line below the fold.

## Cap the nits

- **Max 5 Minor findings listed per axis.** Beyond that, collapse the rest into a count.
- A Minor finding that is actually a Critical dressed as polish gets re-labeled, not capped.

## Do not report

- Anything tooling already enforces (lint, typecheck, format).
- Informational context with no required action — `FYI` at most, one line.

## Passes

> Three axes, reported side by side. Never merged into one verdict. Each axis carries its
> own worst issue and its own verdict.

### Standards

- **Worst issue (within this axis):** `picomatch` declared as the extension's runtime dep is absent from root `node_modules` (ADR-0007 load rule) — but a family-wide drift shared by 5 sibling extensions, not a webfetch load failure.
- **Findings:** 0 Critical / 2 Important / 5 Minor (capped)
- **Verdict:** met-with-fixes

### Spec

- **Worst issue (within this axis):** none — all 9 scenarios PASS.
- **Findings:** 0 Critical / 0 Important / 0 Minor
- **Verdict:** met

### Security

- **Worst issue (within this axis):** built-in glob matched hostname+pathname, so a crafted path could claim a built-in host and suppress the fetch (an SSRF-hider) — fixed.
- **Findings:** 0 Critical / 0 High / 1 Medium (fixed) / 3 Low (parked, defense-in-depth)
- **Verdict:** secure-with-fixes

## Findings

> One per line. Every finding names its file + hunk (or scenario) and its ruling.
> Severity is the reviewer's; the ruling (fix now / defer / push back) is the coordinator's.

### Critical

- none

### Important

- [standards] `extensions/webfetch/package.json` + `registry.ts` — `picomatch` is extension-declared but not root-carried (ADR-0007 says runtime deps must also resolve from root). **Ruling: DEFER (family).** Verified: 5 sibling extensions (`command-plate`, `ask-user`, `lsp`, `plan-build`, `todo`) declare+use `picomatch` identically, none root-carried; the wrapper loads all of them in the running E2E. A webfetch-only fix (add to root, or swap to `minimatch`) leaves webfetch inconsistent with its siblings and reopens ADR-0007 for 10 packages. Log as a family-wide ADR-0007 amendment question.
- [standards] `extensions/webfetch/package.json` — no `private: true` (ADR-0007 says extensions are `private: true`, not root-installed). **Ruling: DEFER (family).** Verified: 10/11 extensions omit `private` and carry `publishConfig` (only `skill-pi-tui` sets it); the ADR and the tree already disagree. Same family-wide decision as the ADR-0007 open question.
- [security] `registry.ts:matchExtension` + `github-redirect.ts` — glob matched `hostname + pathname`; a URL like `https://evil.com/github.com/x` could claim the `github.com/**` pattern and short-circuit (suppress) the fetch — defense-in-depth / SSRF-hider, not RCE. **Ruling: FIX NOW — fixed in `26fc935`** (match on `parsed.hostname` only; patterns → bare hostnames; RED tests added in `handlers.test.ts`).

### Minor

- [standards] `google-docs-redirect.ts:30` — message names the unshipped `google_workspace_mcp` package. **FIX NOW — fixed** (softened to "a Google Workspace integration, if available").
- [security+standards] `package.json` — `typebox: "*"` in `dependencies` floats the version and splits the family pattern. **FIX NOW — fixed** (moved to `peerDependencies` as `^1.3.27`, matching `file-search`).
- [standards] `fetcher.ts:37` / `tool.ts:72` — dead `truncated` field (a successful fetch can never equal the 5MB cap; `readResponseBody` throws past it). Speculative Generality. **FIX NOW — fixed** (field removed from `FetchResult` + `WebfetchDetails`).
- [standards] `extract.ts` / ported files — ~150 ported comment lines survive the "no comments unless asked" rule. **DEFER** — ported-code trim; keep the two invariant-bearing comments (`fetcher.ts` `dump()` rationale, `extract.ts` settle/kill race).
- [standards] `renderers.ts:98-123` — two near-identical line-collector loops (`collectLines` / `collectNonEmptyTrimmedLines`). **DEFER** — DRY nit, judgement call.
- (3 further Minor items collapsed — `normalizeUrl` http→https rename, `ImageContent`/optional-`beforeFetch` speculative seams, `detectPythonRunner` module-level cache — see the raw Standards report.)

### Pushed back (misread, with reasoning)

- [security] "Percent-encoded hostname escapes scheme-only URL validation (SSRF to loopback), e.g. `http://host/%5B::1%5D:8080`." **Ruling: PUSH BACK (as stated).** Verified: `new URL("http://host/%5B::1%5D:8080")` puts `%5B::1%5D:8080` in the *pathname* (hostname stays `host` → `ENOTFOUND host`, not loopback); and `new URL("http://%5B::1%5D:8080/")` is *rejected* as an invalid URL, so `validateUrl` throws before any connect. The reviewer's own example does not reach the socket. A generic private-range SSRF denylist remains a reasonable **hardening** (defense-in-depth) but is not a demonstrated exploit path in this diff; parked, not fixed.

### Parked (Low, defense-in-depth, non-blocking)

- [security] `.npmrc` references `GITHUB_TOKEN` for `npm.pkg.github.com` — not used by `npm install` today (deps resolve from npmjs), inert until a publish. Scope the token to `read:packages` at first publish.
- [security] extraction timeout (30s) is independent of the tool's `timeout` arg — a slow runner costs a flat 30s on top of the fetch. Bounded by design (child SIGTERM'd, tested). Could pass `min(30s, timeoutSeconds)`.
- [standards] `extensions/webfetch/.npmrc` — second place the GPR registry is configured (root `publishConfig` already names it). Standardize across extensions or delete (family).

## Independence

> The no-leaks proof. Each axis records its independence grade.

| Axis | Grade | Rationale |
|------|-------|-----------|
| Standards | B | fresh subagent context, no session narrative or prior verdict passed; same model family / toolchain as the implementer |
| Spec | B | fresh subagent context, no leaks; same model family |
| Security | B | fresh subagent context, no leaks; same model family; reviewer re-ran the gates itself |

**Reading the grade:** **A** = fresh subagent, no shared history (independent). **B** = fresh
context but same model family / toolchain as the implementer (independent, weaker). **C** =
inline self-review or the implementer's verdict leaked in — **diagnostic only**.

All three were dispatched as fresh subagents given only the diff range + the named
standards/spec/security sources — no session history, rationale, or prior QA verdict was
passed (blindness contract held). Grade B, not A, only because the reviewers share the
implementer's model family.

## Verdict

> The overall review verdict is the **floor** across the three axes.

- **Standards:** met-with-fixes
- **Spec:** met
- **Security:** secure-with-fixes
- **Floor (decides):** met-with-fixes
- **Worst issue (across all three axes):** the glob/host matching bypass (security Medium) — fixed; the `picomatch` root-carriage (standards Important) is the heaviest *open* item but is a family-wide ADR-0007 drift, deferred to a family decision.
- **Unfixed Important count (must be 0 to proceed):** 2 — both **Deferred (family-wide ADR-0007)**, not webfetch-specific; recorded in `WINDOWS.md` and the report so a future change owns them. No webfetch-specific Important issue is left unfixed.

## Fix commits

- `26fc935` — `fix(webfetch): address code-review findings` (glob-bypass, google-docs message, typebox peer-pin, dead `truncated` field; 44/44 tests, tsc clean).
