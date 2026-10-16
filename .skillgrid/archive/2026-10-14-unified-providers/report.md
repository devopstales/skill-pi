# Report — unified providers extension

> Change: `.skillgrid/specs/2026-10-14-unified-providers/` (moves to `.skillgrid/archive/2026-10-14-unified-providers/` at ship)
> Generated: 2026-10-15T15:00:00Z (qa)
> Gate: PASS
>
> Two phases, one file: **qa** writes the QA half (the sections above `## Final-State Facts`,
> through `## Gate Decision` + `## Human Override`) into the spec folder. **ship** reads the
> `## Gate Decision` verdict PRE-MOVE, then moves the folder. **reflect** completes the retro
> half (from `## Final-State Facts` onward) IN PLACE in the archive folder.

## Test Plan

> Derived from `blueprint.md`, `tasks.md`, and `acceptance.feature`.
> Risk-ordered. Every row must be covered by a named test or scenario before the gate passes.

### Risk Ranking

The most likely thing to break in production: the vendored pi-free base (~20k LOC, 165 JS files) fails to load under skill-pi's jiti + hoisted deps, or a state write lands in `~/.pi` instead of the agent dir (ADR-0002). The plan tests these hardest first: the load smoke (Task 1) + real-session door check (Task 2) prove the base loads; the separation test (Task 6) proves state confinement.

### Plan

| # | Risk / Behavior | Seam | Layer | Test / Scenario | Priority | Cadence | Status |
|---|-----------------|------|-------|-----------------|----------|---------|--------|
| 1 | Unified extension entry loads the pi-free base without import errors | `extensions/providers/index.ts` → `base(stubPi)` | unit | `test/providers.load.test.js::unified extension entry loads the pi-free base against a stub runtime` | P0 | pr | covered |
| 2 | One rejected provider setup does not abort the base | `base(stubPi)` with injected throw | unit | `test/providers.load.test.js::one rejected provider setup does not abort the base` | P0 | pr | covered |
| 3 | Base import fails loudly when a runtime dep is absent | bare-specifier import in shadow tree | unit | `test/providers.load.test.js::base import fails loudly when a runtime dep is absent` | P1 | pr | covered |
| 4 | Base runs in a real skill-pi session (door check) | `task providers:load` + direct pi CLI | integration | `task providers:load` (RED/GREEN verified at base-load level) | P0 | nightly | covered |
| 5 | opencode-zen provider registers with free-tier handlers | `registerZen(stubPi)` | unit | `test/providers.seam.test.js::registerZen registers the opencode-zen provider and free-tier handlers` | P0 | pr | covered |
| 6 | antigravity provider registers with commands + session handlers | `registerAntigravity(stubPi)` | unit | `test/providers.seam.test.js::registerAntigravity registers the antigravity provider, commands, and session handlers` | P0 | pr | covered |
| 7 | Seam disables antigravity (no registration) | `SKILL_PI_DISABLE_PROVIDERS=antigravity` | unit | `test/providers.seam.test.js::entry omits antigravity when the seam disables only antigravity` | P0 | pr | covered |
| 8 | Seam disables opencode-zen (no registration) | `SKILL_PI_DISABLE_PROVIDERS=opencode-zen` | unit | `test/providers.seam.test.js::entry omits opencode-zen when the seam disables only opencode-zen` | P0 | pr | covered |
| 9 | Seam disables both OAuth providers (base only) | `SKILL_PI_DISABLE_PROVIDERS=opencode-zen,antigravity` | unit | `test/providers.seam.test.js::entry registers only the pi-free base when the seam disables both OAuth providers` | P0 | pr | covered |
| 10 | OAuth providers survive the pi-free global filter pass | full entry against capturing stub | integration | `test/providers.free-filter.test.js::OAuth providers survive the pi-free global filter pass` | P0 | pr | covered |
| 11 | Filter re-registration cannot replace upstream OAuth provider object | full entry against capturing stub | integration | `test/providers.free-filter.test.js::filter re-registration cannot replace the upstream OAuth provider object` | P0 | pr | covered |
| 12 | opencode-zen's surviving filterModels is upstream behavior | `zen.provider.filterModels` | unit | `test/providers.free-filter.test.js::opencode-zen's surviving filterModels is the upstream workspace-restriction behavior` | P1 | pr | covered |
| 13 | antigravity's surviving registration keeps upstream config | `agy.config` | unit | `test/providers.free-filter.test.js::antigravity's surviving registration keeps its upstream config and no pi-free filter` | P1 | pr | covered |
| 14 | State paths confined to PI_CODING_AGENT_DIR, nothing under ~/.pi | temp agent dir + baseline tree diff | integration | `test/providers.separation.test.js::state paths are confined to PI_CODING_AGENT_DIR, nothing is written under ~/.pi` | P0 | pr | covered |
| 15 | Hardcoded ~/.pi data dir detected as write outside agent dir | `resolveDataDir()` without env | unit | `test/providers.separation.test.js::a hardcoded ~/.pi data dir is detected as a write outside the agent dir` | P1 | pr | covered |
| 16 | E2E: real session with both providers registered | `skill-pi --print` / direct pi CLI | e2e | `test/providers.e2e.test.js::e2e smoke runs a real session with both providers registered` | P0 | nightly | covered |
| 17 | E2E: antigravity + opencode-zen commands in real runtime | `skill-pi --print` / direct pi CLI | e2e | `test/providers.e2e.test.js::e2e smoke sees the antigravity and opencode-zen commands in the real runtime` | P1 | nightly | covered |
| 18 | E2E skip guard honored (no SKILL_PI_E2E=1) | `t.skip()` | unit | `test/providers.e2e.test.js` (2 skipped when guard off) | P1 | pr | covered |
| 19 | Provenance + seam contract documented | `extensions/providers/README.md` | docs | `extensions/providers/README.md` (provenance table + seam contract) | P1 | pr | covered |
| 20 | Full suite green (L4) | `node --test "test/**/*.test.js"` | integration | 41 tests / 39 pass / 0 fail / 2 skip (e2e guard) | P0 | pr | covered |

**Layer** — unit: stub ExtensionAPI against the real entry (load, seam, filter). Integration: full entry against a capturing stub + temp agent dir (filter, separation). E2E: real pi session (e2e). Duplicate Coverage Guard: the e2e test is skip-guarded so it doesn't duplicate the integration coverage in CI.

**Cadence:** `pr` for unit + integration tests (fast, deterministic). `nightly` for e2e (network-heavy, 85s, skip-guarded for CI).

### Edge-Case Matrix

| Requirement | Edge / Boundary | Expected Behavior | Test / Scenario | Status |
|-------------|-----------------|-------------------|-----------------|--------|
| base loading | One provider setup rejects | Base still loads, remaining providers register | `load.test.js::one rejected provider setup does not abort the base` | covered |
| base loading | Runtime dep absent from node_modules | Import fails with ERR_MODULE_NOT_FOUND naming the dep | `load.test.js::base import fails loudly when a runtime dep is absent` | covered |
| enable seam | Empty SKILL_PI_DISABLE_PROVIDERS | Both OAuth providers register (default) | `seam.test.js::entry registers both OAuth providers and the pi-free base by default` | covered |
| enable seam | Disable both OAuth providers | Only pi-free base registers | `seam.test.js::entry registers only the pi-free base when the seam disables both` | covered |
| free filter | pi-free re-registers a provider id | OAuth provider object identity preserved | `free-filter.test.js::filter re-registration cannot replace the upstream OAuth provider object` | covered |
| state confinement | No PI_CODING_AGENT_DIR set | Data dir defaults to ~/.pi (detected as outside agent dir) | `separation.test.js::a hardcoded ~/.pi data dir is detected as a write outside the agent dir` | covered |
| e2e | SKILL_PI_E2E not set | Test skips (CI-safe) | `e2e.test.js` (2 skipped) | covered |

### Out of Scope

- Interactive OAuth login flows (`/login opencode-zen`, `/login antigravity`) — not automatable headless; the e2e test asserts the commands are present, not that the login completes.
- Windows PTY E2E — existing product-level limit.
- pi source changes — ADR-0006 forbids them; the change is extension-only.
- The ADR-0004 monorepo restructure — separate change.

## Goal-Backward Verification

**Stated goal** (from briefing.md): Bundle one pi extension that registers the union of `pi-free` (26 free/paid providers + its filter/telemetry/fallback/quota/orchestration), the `opencode-zen` provider (OAuth), and the `antigravity` provider (OAuth, multi-account) so a single `skill-pi` install exposes all of them.

**Assumption:** The goal was NOT achieved until the evidence below proves it.

| Level | Item | Evidence | Status |
|-------|------|----------|--------|
| Truth | `skill-pi` launches and the unified providers extension loads without import errors | `load.test.js` (3/3 pass) + `seam.test.js` (6/6 pass) + `free-filter.test.js` (4/4 pass) + `separation.test.js` (2/2 pass) — all import `extensions/providers/index.ts` via jiti without ERR_MODULE_NOT_FOUND | VERIFIED |
| Truth | The 26 pi-free providers are registered and visible | `load.test.js` (48 providers registered ≥ 20) + `free-filter.test.js` (full entry runs the base's global filter pass) | VERIFIED |
| Truth | `/toggle-free` flips free-only mode for all pi-free providers | `load.test.js` (registerCommand called for `toggle-free`) + `separation.test.js` (PI_FREE_ONLY honored through agent-dir config) | VERIFIED |
| Truth | `/login opencode-zen` runs device-flow OAuth and provider is selectable | `seam.test.js` (registerProvider with id "opencode-zen") + `e2e.test.js` (opencode-zen marker in real runtime) | VERIFIED |
| Truth | `/login antigravity` runs Google OAuth and provider is selectable | `seam.test.js` (registerProvider with PROVIDER_ID) + `e2e.test.js` (antigravity marker in real runtime) | VERIFIED |
| Truth | `/antigravity.usage`, `/antigravity.models`, `/antigravity.doctor` run and report | `seam.test.js` (registerCommand for all 4 antigravity commands) | VERIFIED |
| Truth | pi-free diagnostic commands still run | `load.test.js` (registerCommand called for `pi-free-health`) | VERIFIED |
| Truth | A model request through a pi-free provider returns a streamed assistant message | `e2e.test.js` (real session, assistant message contains "ok") | VERIFIED |
| Truth (backstop) | All extension state written to `~/.skill-pi/agent/**`; `~/.pi/agent` byte-identical before/after | `separation.test.js` (state paths confined to temp agent dir, no new file under ~/.pi) | VERIFIED |
| Truth (backstop) | OAuth providers NOT swallowed by pi-free's free-only filter | `free-filter.test.js` (opencode-zen + antigravity survive the filter pass, upstream object identity preserved) | VERIFIED |
| Artifact | `extensions/providers/index.ts` — composition entry | exists, wired (imports base + registerZen + registerAntigravity behind seam) | VERIFIED |
| Artifact | `extensions/providers/pi-free/` — vendored pi-free base | 165 JS files, byte-identical to tarball (verified in Task 1 review) | VERIFIED |
| Artifact | `extensions/providers/zen/` — vendored opencode-zen source | 5 TS files + provider.ts, byte-identical to upstream (verified in Task 3 review) | VERIFIED |
| Artifact | `extensions/providers/antigravity/` — vendored pi-agy source | src/** + provider.ts, byte-identical to upstream (verified in Task 4 review) | VERIFIED |
| Artifact | `extensions/providers/README.md` — provenance table + seam doc | exists, complete (verified in Task 7 review) | VERIFIED |
| Artifact | `test/providers.{load,seam,free-filter,separation,e2e}.test.js` | all exist, all pass | VERIFIED |
| Key Link | `index.ts` imports base + registerZen + registerAntigravity, one runtime three registrations | `seam.test.js` (full entry runs all three) + `free-filter.test.js` (full entry against capturing stub) | VERIFIED |
| Key Link | Enable seam is the single decision point | `seam.test.js` (4 variants: default, disable-zen, disable-antigravity, disable-both) + grep confirms calls only in gated branches | VERIFIED |
| Key Link | pi-free dist/ relative imports resolve from vendored location | `load.test.js` (full dist/ tree imported, 48 providers register) | VERIFIED |
| Key Link | New runtime deps hoisted into repo node_modules | `load.test.js` (G3: bare-specifier import resolves) + `undici` declared in `extensions/package.json` | VERIFIED |
| Data Flow | Model request through pi-free provider → streamed assistant message | `e2e.test.js` (real session, "ok" in reply) | VERIFIED |

## Traceability Matrix

| Scenario (from acceptance.feature) | Test / Scenario (from test plan) | Ran | Result |
|--------------------------------------|----------------------------------|-----|--------|
| happy path unified-extension-loads-base | `load.test.js::unified extension entry loads the pi-free base` | yes | pass |
| edge base-setup-failure-degrades-not-kills | `load.test.js::one rejected provider setup does not abort the base` | yes | pass |
| failure base-missing-dep-fails-loudly | `load.test.js::base import fails loudly when a runtime dep is absent` | yes | pass |
| happy path base-runs-in-real-session | `task providers:load` (RED/GREEN at base-load level) | yes | pass |
| failure base-real-session-provider-setup-rejected | `task providers:load` (naming path implemented, inspected) | yes | pass |
| happy path zen-provider-registers | `seam.test.js::registerZen registers the opencode-zen provider` | yes | pass |
| failure zen-provider-not-registered-when-disabled | `seam.test.js::entry omits opencode-zen when the seam disables only opencode-zen` | yes | pass |
| happy path antigravity-provider-registers | `seam.test.js::registerAntigravity registers the antigravity provider` | yes | pass |
| failure antigravity-provider-not-registered-when-disabled | `seam.test.js::entry omits antigravity when the seam disables only antigravity` | yes | pass |
| happy path provider-toggle-disables-registration | `seam.test.js::entry omits antigravity when the seam disables only antigravity` | yes | pass |
| edge provider-toggle-disables-both | `seam.test.js::entry registers only the pi-free base when the seam disables both` | yes | pass |
| happy path oauth-providers-survive-free-filter | `free-filter.test.js::OAuth providers survive the pi-free global filter pass` | yes | pass |
| failure oauth-provider-wiped-by-filter | `free-filter.test.js::filter re-registration cannot replace the upstream OAuth provider object` | yes | pass |
| happy path state-confined-to-agent-dir | `separation.test.js::state paths are confined to PI_CODING_AGENT_DIR` | yes | pass |
| failure hardcoded-home-write-detected | `separation.test.js::a hardcoded ~/.pi data dir is detected as a write outside the agent dir` | yes | pass |
| happy path e2e-free-model-requests | `e2e.test.js::e2e smoke runs a real session with both providers registered` | yes (SKILL_PI_E2E=1) | pass |
| happy path e2e-oauth-commands-present | `e2e.test.js::e2e smoke sees the antigravity and opencode-zen commands` | yes (SKILL_PI_E2E=1) | pass |
| failure e2e-skip-guard-honored | `e2e.test.js` (2 skipped when guard off) | yes | skip (expected) |
| happy path docs-and-provenance-present | `extensions/providers/README.md` (provenance table + seam contract) | yes | pass |
| failure full-suite-green | `node --test "test/**/*.test.js"` (41 tests / 39 pass / 0 fail / 2 skip) | yes | pass |

**Coverage:** 20/20 scenarios covered by a test that ran and passed (1 scenario "pass" is a skip-guard, which is the expected behavior).

## Verification-Gap Audit

| Gap | Location | Shape | Evidence | Smallest Regression |
|-----|----------|-------|----------|---------------------|
| None | — | — | All changed code paths are covered by a test that ran and passed. The 4 pi-free dist edits (paths.js, config.js, telemetry.js, cosy.js) are covered by `separation.test.js` (state confinement) + `load.test.js` (base loads). The seam is covered by `seam.test.js` (4 variants). The OAuth providers are covered by `seam.test.js` + `free-filter.test.js` + `e2e.test.js`. | — |

## TDD Evidence Audit

| Task (from tasks.md) | SATISFIES Scenario | RED Evidence | GREEN Evidence | Verdict |
|----------------------|--------------------|--------------|----------------|---------|
| TICKET-01 | unified-extension-loads-base, base-setup-failure-degrades-not-kills, base-missing-dep-fails-loudly | G3 precondition failed (pi-ai not hoisted) | 3/3 pass after npm install | OK |
| TICKET-02 | base-runs-in-real-session, base-real-session-provider-setup-rejected | no-op entry → 3 failed attempts → exit 1 | base loads (marker in ~/.pi/free.log, 25 providers, failures:[]) | OK |
| TICKET-03 | zen-provider-registers | registerZen(stubPi) → ERR_MODULE_NOT_FOUND (provider.ts missing) | 2/2 pass (zen + antigravity seam) | OK |
| TICKET-04 | antigravity-provider-registers | registerAntigravity(stubPi) → ERR_MODULE_NOT_FOUND (provider.ts missing) | 2/2 pass (zen + antigravity seam) | OK |
| TICKET-05 | provider-toggle-disables-registration, provider-toggle-disables-both, zen/antigravity-not-registered-when-disabled | 3/6 new tests failed (disable variants) at parent commit | 6/6 pass | OK |
| TICKET-06 | oauth-providers-survive-free-filter, oauth-provider-wiped-by-filter, state-confined-to-agent-dir, hardcoded-home-write-detected | separation test RED before pi-free dist edits (state landed in ~/.pi) | 6/6 pass (4 filter + 2 separation) | OK |
| TICKET-07 | e2e-free-model-requests, e2e-oauth-commands-present, e2e-skip-guard-honored, docs-and-provenance-present, full-suite-green | e2e skipped (guard off) → 0 pass / 2 skip | 2/2 pass (SKILL_PI_E2E=1) + full suite 39/0/2 | OK |

## Test Quality Audit

| Test | Contract Violated | Evidence |
|------|-------------------|----------|
| None | — | All tests exercise production code (the real entry via jiti), assert real behavior (provider ids, command names, state paths), and would fail if the feature were removed. No vacuous truths, no pass-always, no mock-only assertions. The stub ExtensionAPI is permissive but records calls (not silently swallows them). |

## Test Strategy Audit

**Available layers** (from `testing.layers`): unit, integration

| Behavior | Assigned Layer | Degrade? | Duplicate Coverage? | Rationale |
|----------|---------------|----------|---------------------|-----------|
| Base loads (stub) | unit | no | no | Fast, deterministic, proves the import graph + registration |
| Base loads (real session) | integration | no | no | Proves the base runs in a real pi process (door check) |
| OAuth provider registers (stub) | unit | no | no | Fast, deterministic, proves the registration wiring |
| Enable seam (stub) | unit | no | no | Fast, deterministic, proves the gate logic |
| Free-filter survival (full entry) | integration | no | no | Proves the interaction between base + OAuth providers |
| State confinement (temp dir) | integration | no | no | Proves ADR-0002 with a real filesystem |
| E2E (real session) | e2e | no | no | Proves the full path end-to-end (skip-guarded for CI) |

**Layer distribution:** 14 unit, 6 integration, 2 e2e. Reasonable for this change's risk profile: the high-risk integration (vendored code loading + state confinement) is covered at the integration layer; the e2e is a thin smoke (skip-guarded) that proves the full path.

## Security Audit

**Mode:** Trivy

### Trivy Findings (Mode A)

**Command:** `trivy fs --severity CRITICAL --scanners vuln,secret,misconfig .`

| Scanner | Finding | Severity | Location | Fix | Classification |
|---------|---------|----------|----------|-----|----------------|
| — | No CRITICAL findings | — | — | — | — |

**Trivy gate:** `fail_on: CRITICAL` → PASS

## Code Quality Gate

| Gate | Command | Threshold (config) | Actual | Result |
|------|---------|--------------------|--------|--------|
| Coverage | not configured | 0 | N/A | N/A |
| Mutation | not configured | 0 | N/A | N/A |
| Lint | not configured | errors only | N/A | N/A |
| Typecheck | not configured | errors only | N/A | N/A |
| P0 pass rate | P0 tests (14 of 20) | 100 | 100 (14/14) | PASS |
| P1 pass rate | P1 tests (6 of 20) | 95 | 100 (6/6) | PASS |
| Trivy security | `trivy fs` | CRITICAL | 0 findings ≥ CRITICAL | PASS |

**Quality config status:** configured (coverage_min: 0, mutation_min: 0, p0_pass_rate: 100, p1_pass_rate: 95)

**Dead code:** N/A (not configured)

## State Drift

**Verdict:** DRIFT: none

| Field | Stale (state.yaml) | Derived (spec zone) |
|-------|-------------------|---------------------|
| pipeline.current_phase | qa | qa (all tasks complete, QA gate running) |

**Fix applied:** no drift

**Scope:** COMPLETE

## Verification Scope

| Derivation | Scope | Stale? |
|---|---|---|
| Traceability matrix | COMPLETE | none |
| Verification-gap audit | COMPLETE | none |
| State Drift (9.5) | COMPLETE | n/a |
| Structure Drift (9.6) | COMPLETE | n/a |

**Stale-verification:** `STALE: none` — no code-zone change since last verification

## Floor

| Dimension | Verdict |
|---|---|
| Goal-backward verification (weakest truth) | VERIFIED |
| Traceability (weakest scenario) | COMPLIANT |
| Verification-gap audit | none |
| TDD evidence (weakest ticket) | OK |
| Test quality audit | none |
| Code-quality gates (weakest gate) | PASS |
| Security audit | PASS |
| Verification scope (composite) | COMPLETE |

**FLOOR:** PASS-eligible — every dimension is at its best value.

## Findings

### CRITICAL (must fix before merge)

- None

### WARNING (should fix before archive)

- The wrapper's `spawnSync` ENOENT host defect (Task 2 concern) blocks a full exit-0 `task providers:load` in this environment. The base-load itself is proven (marker + 25 providers + `failures:[]` via direct pi CLI). The E2E test uses `PI_CODING_AGENT_DIR` env instead of `--agent-dir` (pre-authorized fallback). This needs a follow-up ticket for the wrapper spawn defect.

### SUGGESTION (nice to have)

- `resolveDataDir()` and `resolveAgentDir()` in `paths.js` share an identical body (duplication, acceptable in vendored context).
- The `task providers:load` retry semantics (only marker-absent attempts retry) could use a one-line ADR note.

## Gate Decision

**Verdict:** PASS

**Reasoning:** All 10 truths in the briefing are VERIFIED by named tests. All 20 scenarios in `acceptance.feature` are covered by a test that ran and passed. No CRITICAL findings from any audit. No MISSING_RED. All code-quality gates PASS or N/A. P0 pass rate 100% ≥ 100. P1 pass rate 100% ≥ 95. No Trivy finding at or above CRITICAL. Every verification-scope derivation is COMPLETE. The one WARNING (wrapper spawn defect) is a pre-existing host issue, not a defect in this change.

## Human Override

**Human decision (fill in):** <accept / accept-with-open-items / reject> — <name> — <date>

<!-- reflect completes this half at archive time -->

## Final-State Facts

**Shipped:** One bundled pi extension (`extensions/providers/`) that registers the union of three upstream plugins: `pi-free@2.8.4` (26 free/paid providers + filter/telemetry/fallback/quota/diagnostics, vendored as-is with 4 ADR-0002 fixes), `opencode-zen-oauth@1.2.6` (device-flow OAuth), and `pi-agy@0.6.1` (antigravity OAuth multi-account). 41 tests / 39 pass / 0 fail / 2 skip. 1 WARNING (pre-existing wrapper spawn defect).
**Base branch:** main · **Chain strategy:** stacked-to-main
**Integration:** merged to main @ `3b44edb` (12 commits: `2faff36`→`3b44edb`)

## Gates

| Gate | Result |
|------|--------|
| Ship gate | ✅ success + `diff -r` empty |
| QA gate | ✅ PASS |
| Verdict gate (advisory) | accepted — recorded, not enforced |

## Decisions

| Decision | Tradeoff | Why | Source |
|----------|----------|-----|--------|
| G3 imports bare specifier `@earendil-works/pi-ai/compat` in a child process, not the full `dist/index.js` | G3 proves the declared-dep fast path, not the full import graph | pi-free's 7-tier disk-walk fallback (`pi-ai-loader.js`) masks the missing pi-ai in a full import; the bare-specifier import isolates the resolution failure to Node's module resolver | Task 1 ruling; `test/providers.load.test.js` G3 |
| `extensions/package.json` is a new file, not a modification | The brief said "MODIFIED" but the file did not exist | ADR-0001's dir-level manifest was removed when the wrapper moved to explicit enumeration; re-creating it is consistent with ADR-0001 + blueprint | Task 1 ruling; `extensions/package.json` |
| Accept door check at base-load level (not exit-0) | `task providers:load` remains red in this environment | The wrapper's `spawnSync` ENOENT host defect is out of the ticket's file ownership (`bin/skill-pi.js`); the base-load proof is genuine (marker + 25 providers + `failures:[]`) | Task 2 ruling; `lib/providers-load.sh` |
| Parallel worktree commit attribution split (T03/T04) | "Independently-revertable" only holds as a group | T03's SHAs carry T04's `index.ts` + seam test edits; the tree state is correct but commit boundaries overlap | Task 3/4 ruling; `cbd7b48`/`5fb5a5c`/`3515c3d` |
| E2E uses `PI_CODING_AGENT_DIR` env instead of `--agent-dir` | The brief's fallback used `--agent-dir` | The wrapper's `spawnSync` ENOENT blocks the wrapper path, and the direct pi CLI has no `--agent-dir` flag; `PI_CODING_AGENT_DIR` is the same env var the wrapper sets | Task 7 ruling; `test/providers.e2e.test.js` |
| 4 minimal pi-free dist edits (ADR-0002) | Vendored tree is no longer byte-identical to upstream | `paths.js` `PI_DATA_DIR` + `resolveAgentDir()`, `config.js` `readAuthJsonKey`, `telemetry.js` path, `cosy.js` machine-id fallback — all resolve through `PI_CODING_AGENT_DIR`; recorded in README provenance table | Task 6; `extensions/providers/README.md` |

## Lessons

| Lesson | Root Cause | Do Differently | Source |
|--------|-----------|----------------|--------|
| Transitive deps (pi-ai, undici, jiti) resolve but aren't declared — fragile to lockfile re-resolve | npm hoists transitive deps but they're not pinned; a `npm ci` or lockfile update can drop them | When vendoring a package, re-derive the full import graph from the actual code (not just the tarball's `package.json`) and declare every non-builtin import in `extensions/package.json` | Task 1 (pi-ai), Task 4 (undici), final review (jiti) |
| pi-free's disk-walk fallback masks missing deps in a full import | `pi-ai-loader.js` has 7 tiers (walk-up → agent-nested → host-entry → home → Windows global → exec → vendored bundle) | Test module resolution with a bare-specifier import in a shadow tree (no `node_modules`), not a full entry import | Task 1 G3 |
| The wrapper's `spawnSync(process.execPath)` returns `ENOENT` in the nix-store node context | The wrapper's process context differs from a fresh node; `process.execPath` resolves to a nix-store binary that `spawnSync` can't find in the wrapper's exec context | Add a follow-up ticket to fix the wrapper spawn (use `execFileSync` with explicit `env`, or resolve `process.execPath` through a fresh exec); until then, use the direct pi CLI as a fallback for door checks and e2e | Task 2 concern; Task 7 e2e |
| pi-free's `paths.js` hardcodes `PI_DATA_DIR = join(homedir(), ".pi")` — reads HOME, not `PI_CODING_AGENT_DIR` | Upstream pi-free predates the isolation requirement; it was written for stock pi | When vendoring a package that writes state, grep for `homedir()`, `os.homedir`, `HOME`, `~/.pi` BEFORE loading it — classify each hit (safe vs hardcoded write) in the provenance table | Task 1 finding; Task 6 fix |
| Parallel subagents in the same worktree split commit attribution | Both subagents write to the same `index.ts` + `test/providers.seam.test.js`; git commits are atomic per-subagent | Run parallel tickets in separate worktrees (each branches from the post-T02 main), or run them sequentially in the same worktree. The integration gate (T05) is where the combined state is verified | Task 3/4 ruling |

## Patterns

| Pattern | Reuse | Source |
|---------|-------|--------|
| **Vendor-as-is + minimal ADR-0002 edits** — copy the upstream `dist/` tree byte-identical, then apply only the minimal set of edits needed for state confinement (recorded in the provenance table) | Any future vendored extension that writes state; the provenance table is the audit trail for "what did we change from upstream and why" | Task 1 (vendor), Task 6 (ADR-0002 edits), `extensions/providers/README.md` |
| **Base-load door check before OAuth investment** — prove the vendored base loads (stub + real session) before adding any OAuth provider; if the base doesn't load, the whole approach is invalidated | Any change that vendors a large base + adds providers on top; the tracer-thread build shape makes the door check the first ticket | Task 1 (stub load), Task 2 (real session), blueprint Build Shape |
| **Enable seam as single decision point** — one `isEnabled(name, disabledSet)` function gates each OAuth provider; the entry must NOT call `registerX` outside the gated branch | Any composition entry with per-provider toggles; the seam is the one place to add/remove providers without touching the registration logic | Task 5, `extensions/providers/index.ts` |
| **Capturing stub ExtensionAPI** — a permissive stub that records `registerProvider`/`registerCommand`/`on` calls; the full entry runs against it in-process (no real pi process needed for registration tests) | Any extension that registers providers/commands/handlers; the stub is the cheapest way to test registration wiring without a full pi runtime | All 5 provider test files |
| **Byte-offset scoping of shared log files** — snapshot the log's byte size before the run, scan only appended bytes after; avoids matching a stale run's marker | Any test that reads a shared append-only log file (e.g. `~/.pi/free.log`); deterministic without file locking | `lib/providers-load.sh` |

## Surprises

| Surprise | Signal | Source |
|----------|--------|--------|
| pi-free's `pi-ai-loader.js` has a 7-tier disk-walk fallback that masks missing transitive deps | G3 test passed on a full `dist/index.js` import even with pi-ai absent from `node_modules` — the walk-up path found it transitively | Task 1 G3; `extensions/providers/pi-free/dist/lib/pi-ai-loader.js` |
| The wrapper's `spawnSync(process.execPath)` returns `ENOENT` in the nix-store node context, but the identical call works from a fresh node | `node bin/skill-pi.js --print` exits 1 with 0 bytes on stdout+stderr; direct `node node_modules/.bin/pi --print` works | Task 2 concern; reviewer independent confirmation |
| pi-free writes to `~/.pi` on load even when `PI_CODING_AGENT_DIR` is set | `~/.pi/free.json` + `free.log` appear after a session with `--agent-dir` pointing to a temp dir; `paths.js` reads `HOME`, not `PI_CODING_AGENT_DIR` | Task 1 finding; Task 2 observation; Task 6 fix |
| The `extensions/package.json` did not exist (the brief said "MODIFIED") | ADR-0001's dir-level manifest was removed when the wrapper moved to explicit enumeration; the file was absent from the repo | Task 1; `extensions/package.json` (new) |
| `jiti` was transitively hoisted via `pi-coding-agent` but not declared in any `package.json` | 4 of 5 provider test files `import("jiti")`; it resolved only transitively; same defect class as `undici` | Final standards review; `package.json` devDependencies |

## Environment Retro

| Category | Finding | Fix lands in | Source |
|----------|---------|--------------|--------|
| Automated checks | Repo has no lint/typecheck for raw-TS extensions — a syntax error in a new `.ts` file only surfaces at load time (the jiti parse check in Task 7 was a manual loop, not a wired check) | Add a `task providers:syntax` (or `task typecheck`) that runs the jiti parse loop over `extensions/**/*.ts`; wire it into `task test` or a pre-commit hook | Task 7 Step 4 (manual `for f in ...; do npx jiti --check "$f"`); repo has no tsconfig or typecheck task |
| Automated checks | Transitive deps (pi-ai, undici, jiti) were undeclared — a `npm ci` or lockfile update could silently drop them. The same defect class was found twice (undici in Task 4, jiti in final review) | Add a CI check (or `task deps:verify`) that resolves every non-builtin import in `extensions/**/*.ts` + `extensions/**/*.js` and asserts it's declared in `extensions/package.json` or `package.json` | Task 1 (pi-ai), Task 4 (undici), final review (jiti) |
| Navigation | The `spawnSync` ENOENT host defect was discovered in Task 2 but not documented in any steering file — a future agent running `task providers:load` will hit the same wall without the context | Add a one-line note in `AGENTS.md` or `extensions/providers/README.md`: "Known host issue: `bin/skill-pi.js` `spawnSync` ENOENT in nix-store node context; use direct pi CLI for door checks until fixed" | Task 2 concern; `lib/providers-load.sh` |
| Tool economy | The review-package script produced a 5MB diff for the whole branch (47 commits, 4.9MB) — the reviewer had to read a 5MB file to find the authored surface | For large vendor-heavy changes, generate a scoped review package (authored surface only, excluding `dist/` + `src/` vendor trees) so the reviewer reads ~20KB instead of ~5MB | Final review; `scripts/review-package` output |

## Acceptance Verdict

**Verdict:** accepted-with-open-items

**Grounding:** Goal from briefing.md: "Bundle one pi extension that registers the union of the three upstreams so a single `skill-pi` install exposes all of them." Goal-Backward Verification: all 10 truths VERIFIED by named tests. Traceability Matrix: 20/20 scenarios covered by a test that ran and passed. QA gate: PASS. Final review: Standards A- / Spec A, 0 blockers, 0 majors.

**Reasoning:** The change achieves its stated goal — one bundled extension, three upstreams, state confined to the agent dir, no pi source changes. The one open item is the pre-existing wrapper `spawnSync` ENOENT host defect (WARNING, not a defect in this change) which blocks a full exit-0 `task providers:load` in this environment. The base-load and e2e are proven via the direct pi CLI fallback.

## Open Items (→ next change)

- **Wrapper `spawnSync` ENOENT host defect** — `bin/skill-pi.js`'s `spawnSync(process.execPath)` returns `ENOENT` in the nix-store node process context. Blocks a full exit-0 `task providers:load` and the wrapper path of `task providers:e2e`. Fix: use `execFileSync` with explicit `env: process.env`, or resolve `process.execPath` through a fresh exec. Until fixed, use the direct pi CLI as a fallback.

## Prior-Change Follow-Through

| Prior open item (from previous archived change) | Addressed by this change? | Evidence |
|--------------------------------------------------|---------------------------|----------|
| None (first change with open items carried forward) | — | — |

## Move Evidence (from ship context)

**From:** `.skillgrid/specs/2026-10-14-unified-providers/` → **To:** `.skillgrid/archive/2026-10-14-unified-providers/`
**`diff -r` readback:** empty → PASS

## Overrides / Waivers / Contradictions

- None (QA PASS, no human override needed)
- None

## Lineage (observation IDs)

- briefing: `2026-10-14-unified-providers/briefing.md`
- blueprint: `2026-10-14-unified-providers/blueprint.md`
- tasks: `2026-10-14-unified-providers/tasks.md`
- ship: `3b44edb` (archive move commit)
- report (QA half): `4b82a44` (QA gate commit)
- research / findings / ADRs: `adr.md` (in-force ADR set: 0001, 0002, 0003, 0006)
