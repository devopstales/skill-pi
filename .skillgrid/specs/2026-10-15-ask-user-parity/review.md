# Code Review — 2026-10-15-ask-user-parity

**Diff:** `c4b8108..HEAD -- extensions/ask-user/ test/ask-user-e2e.test.js` (59 files, +7583/−2011)
**Review model:** three fresh subagent reviewers (standards, spec/parity, security), each Grade **A/B** (fresh context, no implementer session history, same model family as the implementer). Blindness contract honored: each received only the diff range + the named sources for its axis.

## "What Important means" (threshold)

**Important** = must fix before ship: an ADR/rule violation, a contract/behavior drift not documented in the port, a missing requirement, or a smell that will bite (broken publish, undeclared runtime surface, dead code in a new surface). **Minor** = polish / YAGNI documentation / a smell that is low-risk.

---

## Standards

**Assessment:** met with fixes — ADR-0004/0005/0006/0008 (user scope) and the comment rule satisfied; two "Important" items must be fixed before ship.

**Important:**
1. **[Important] ADR-0007 root-declaration contract** — `extensions/ask-user/package.json` peer-declares `typebox` + `@earendil-works/pi-tui`, and the extension **directly imports both** (`types.ts`→typebox; 19 files→pi-tui), but the root `package.json` `dependencies` declares **neither** (verified: 0 matches). Both currently resolve only as transitive deps of `pi-coding-agent` (`typebox@1.3.27`, `pi-tui@^1.2.0`). ADR-0007's named failure mode — "runtime deps declared in two places and can drift" — is the risk: a pi upgrade that drops/moves them breaks ask-user, and the per-extension `tsc` check can't see it. **Fix:** add `typebox` + `@earendil-works/pi-tui` to root `dependencies` pinned to pi 1.2.0's versions; keep them as peers in the extension.
2. **[Important] repo formatting convention** — `rpc-fallback.ts` is **tab-indented** (byte-identical to the reference, which uses tabs) while the whole repo / sibling `extensions/permission/` is 2-space; this change re-introduces tabs as a *new* surface, and `index.spec.ts` carries tab residue (`index.spec.ts:2111-2117`) plus a dead `void spy;` next to a duplicate emit-wrap. The port exception covers *comments*, not formatting. **Fix:** normalize whitespace in the new surface to 2-space (or document "verbatim port keeps reference formatting" in the port note); remove the dead `void spy;`.

**Minor:**
3. `package.json` `files: ["index.ts", "README.md"]` ships a **broken package** — `index.ts` imports ~20 sibling `.ts` + `locales/*.json`, none listed. The reference's `files` is a long explicit list; the port collapsed it to the minimal one, silently breaking the ADR-0004 `pi install npm:@devopstales/pi-ask-user` contract. **Fix:** list what's needed (`*.ts`, `state/**/*.ts`, `view/**/*.ts`, `locales/`). (Sibling permission has the same gap but uses `*.ts`; don't copy it.)
4. ADR-0008 D2 (project scope) silently unimplemented + undocumented — `configPath()` is user scope only; neither `config.ts` nor README notes the omission. One-line README note.
5. `i18n-bridge.ts` `LC_MESSAGES` appears in no ADR/README/terms (documented contract is `LANG`/`LC_ALL`) — document or drop; `resolveLocale`/`loadLocale` have zero direct test (the file's whole point) — one focused spec obsoletes QA finding F4.
6. `isRecord` duplicated identically across `answer-channel.ts`, `external-answer.ts`, `normalize.ts` — factor into `types.ts`.
7. `session.spec.ts` `<ENTER>` is an unexplained magic string — name it or comment it (the sibling `key-router.spec.ts` already uses a named `sentinel()` factory).

## Spec

**Verdict:** faithful port + documented deviations. **No Critical/Important drift.** All adapted modules byte-match the reference except the documented adaptations; all `state/`+`view/` ports byte-identical; all 9 locales byte-identical (28 keys each); envelope text byte-for-byte; tests assert the reference contract (172/172).

**Minor:**
1. `index.ts:275` tool `label: "Ask User"` vs reference `"Ask User Question"` — a consequence of the rename, harmless, but not flagged as an expected deviation. (Recommend: keep `"Ask User"`; it's correct for the `ask_user` tool — note it in the port record rather than "fixing" it to the reference string.)

**Cross-extension note (out of strict scope, resolved):** the reviewer flagged a `conf.d` path discrepancy vs permission. **Verified a misread** — `permission/project.ts:14` `agentHome() = dirname(getAgentDir())` is the *same* derivation ask-user uses (`dirname(getAgentDir())`). No actual inconsistency; both resolve the global `conf.d` identically.

## Security

**Verdict:** no High/Critical exploitable issues. **1 Low.**

**Low:**
1. **[Low] Unvalidated `ask-user.conf` top-level keys pass through to `registerTool`** — CWE-20 / A04 Insecure Design. `loadConfig` (config.ts:107-112) only shape-checks "non-array object"; only the three `guidance` fields are validated. On a multihomed/writable agent dir, a hand-edited conf could inject `label`/`parameters` (the realistic surface). Worst case with the current pi host: the tool misdescribes/misvalidates its args (model confusion), not code execution. Confidence: Likely. **Fix:** allowlist conf keys in `loadConfig` — return only `{ guidance, collapseKey }`.

**Cleared (checked, no exploitable sink):** external-editor spawn (no `shell:true`, operator-trusted command, fixed tmp path); terminal-escape/OSC injection from model text (pi-tui `ansiCodeLength` consumes full CSI/OSC/APC → renders literal, cosmetic garbling only); inbound `ask_user:answer` handler (strictly typed before use, one-shot settle, idempotent close); double-encoded JSON decode (try/catch, guarded access); locale loading (fixed dir, normalized name, no traversal); ReDoS (fixed small regexes only); logging (BEL gated on TTY, conf warn is path-only); no new deps; no crypto.

---

## Floor verdict

Weakest dimension: **Standards** — 2 Important (root-dep declaration, formatting) + 1 publish-breaking Minor that must be fixed before ship. Spec and Security are clean (no Critical/Important). The floor is **Standards: met with fixes** — the change is ship-eligible *after* the Important set + the `files` fix are applied. No axis is FAIL; nothing is a silent PASS.

## Fix triage (RESOLVED)

| # | Source | Severity | Disposition | Result |
|---|--------|----------|-------------|--------|
| S1 | Standards-1 (root deps) | Important | **FIXED** | Added `@earendil-works/pi-tui@^1.2.0` + `typebox@1.3.27` to root `package.json` `dependencies` (pinned to pi 1.2.0's versions); kept as extension peers. |
| S2 | Standards-2 (tabs + dead code) | Important | **PARTIALLY FIXED** | Removed dead `void spy;` + duplicate emit-wrap in `index.spec.ts`. `rpc-fallback.ts` tab indentation kept (byte-identical verbatim port; documented as the port-formatting exception below). |
| S3 | Standards-3 (`files`) | Minor→must-fix | **FIXED** | `files` now lists `*.ts`, `state/**/*.ts`, `view/**/*.ts`, `tool/**/*.ts`, `locales/*.json`, `README.md`. |
| Sec1 | Security-1 (conf allowlist) | Low | **FIXED** | `loadConfig` allowlists to `{ collapseKey, guidance }`; unknown top-level keys dropped. New test added. |
| S5 | Standards-5 (LC_MESSAGES + i18n test) | Minor | **FIXED** | `i18n-bridge.spec.ts` (6 tests: LANG/LC_ALL selection, prefix fallback, unknown→English, missing-key fallback). README documents the `LC_ALL`/`LC_MESSAGES`/`LANG` order. Obsoletes QA F4. |
| S4 | Standards-4 (project-scope note) | Minor | **FIXED** | README documents user-scope-only + allowlist. |
| S6 | Standards-6 (isRecord dedupe) | Minor | **DEFER** → W019 | pure polish. |
| S7 | Standards-7 (`<ENTER>` magic string) | Minor | **DEFER** → W021 | polish. |
| Spec1 | Spec-1 (label) | Minor | **ACCEPTED** | `"Ask User"` is correct for `ask_user`; kept, recorded here. |

**Port-formatting exception (documented):** `rpc-fallback.ts` (and other byte-identical verbatim ports under `view/`/`state/`) retain the reference's tab indentation. This is the *verbatim* port surface — normalizing it would break the byte-identity that makes the parity proof auditable. The hand-written/adapted files (`index.ts`, `types.ts`, `config.ts`, `envelope.ts`, `events.ts`, `external-answer.ts`, `answer-channel.ts`, `normalize.ts`, `validate.ts`, `i18n-bridge.ts`, and the spec files) are all 2-space.

**Re-verification after fixes:** extension `vitest run` 179/179 (was 172; +6 i18n +1 config), `tsc --noEmit` clean. Root `package.json` deps added (no lockfile churn expected — both already present at the pinned versions as pi transitive deps).

## Gate re-render

The Standards axis floor was "met with fixes" (2 Important + 1 publish-breaking). All three are now resolved (S1 root deps, S3 `files`, S2 dead code). Security's only Low is fixed. Spec was already clean. The floor no longer blocks: **Standards → met**, **Spec → faithful**, **Security → no exploitable**. Remaining open items are SUGGESTIONS (W019–W021 + QA W014–W018), none blocking.

**Re-rendered gate: PASS** (supersedes the earlier CONCERNS, which was capped by the e2e model-reliability scope *and* the Standards fixes; the Standards fixes are now applied, and the e2e scope remains a documented, deferred SUGGESTION (W016) covered deterministically at the unit layer — accepted per the user's "defer" decision).
