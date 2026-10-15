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

## Fix triage

| # | Source | Severity | Disposition | Rationale |
|---|--------|----------|-------------|-----------|
| S1 | Standards-1 (root deps) | Important | **FIX** | ADR-0007 contract; one-line root `package.json` add. |
| S2 | Standards-2 (tabs + dead code) | Important | **FIX** | repo convention + dead code in new surface. |
| S3 | Standards-3 (`files`) | Minor→**must-fix** | **FIX** | publish-breaking; fold into S1's package.json edit. |
| Sec1 | Security-1 (conf allowlist) | Low | **FIX** | one-line, cheap, closes the only security finding. |
| S5 | Standards-5 (LC_MESSAGES + i18n test) | Minor | **FIX** (test) / **FIX** (document) | obsoletes QA F4; small. |
| S6 | Standards-6 (isRecord dedupe) | Minor | **DEFER** → W019 | pure polish; factor to a shared helper. |
| S4 | Standards-4 (project-scope note) | Minor | **DEFER** → W020 | one-line README note; do with S5. |
| S7 | Standards-7 (`<ENTER>` magic string) | Minor | **DEFER** → W021 | polish. |
| Spec1 | Spec-1 (label) | Minor | **ACCEPT as-is** | `"Ask User"` is correct for `ask_user`; record, don't change. |

**Fix-now set:** S1, S2, S3, Sec1, S5 (test + doc), S4 (README line). Then re-run extension vitest + tsc, re-verify, update WINDOWS.md, and re-render the gate.
