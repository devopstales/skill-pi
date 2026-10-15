# Review — 2026-10-15-dynamic-extension-allow

- **Diff:** `fd2f14e` (feat(permission): auto-allow tools registered by local extensions) on `main`
- **Date:** 2026-10-15
- **Tier:** T2 (fast-track small) — three-axis review per `requesting-code-review`
- **Independence grades:** Standards B · Spec B · Security B (fresh subagent contexts, same toolchain family as implementer; no session narrative or prior verdicts leaked)

## What Important means

A finding blocks ship if it breaks a `SATISFIES` scenario, violates an in-force ADR, or opens a new exploitable trust boundary. Documentation drift, pattern-consistency notes, and test-shape observations are Minor (capped, logged, non-blocking).

## Standards (verdict: ✅ Ship-ready — 0 Important, 4 Minor)

- **Strengths:** spec-compliant; ADR 0006/0007 respected (only public `ExtensionAPI`, confined to `extensions/permission/`); rule-chain order preserved so explicit rules beat the auto-allow; no comments, 2-space, semicolons, conventional commit.
- **Minor (deferred):**
  1. README omitted the `defaultMode`-skips-auto-allow caveat → **FIXED in fix commit** (README now states it).
  2. `DerivedExtensionAllowState.cacheKey` is an internal comparison token exposed on the public interface — follows the existing `DerivedSkillAllowState` pattern; kept for consistency.
  3. Tests use `fakePi` stubs (`as unknown as ExtensionAPI`) — standard for opaque pi objects; root suite is the named backstop.
  4. Extension cache key (`name:path:namespace`) intentionally omits mtime that the skill cache key uses — the *set* of registered tools is the invalidation trigger, not file content; asymmetry noted for future readers.

## Spec (verdict: ✅ Spec compliant — 0 Critical, 1 Important, 4 Minor)

- **Per-scenario:** R1 PASS · R2 PASS · R3 PASS · R4 PASS · R5 PASS · R6 PASS (each asserted at exactly the strength the scenario requires; deny/ask precedence structurally guaranteed by evaluation order in `resolveSingleMode`, forwarded through the bash fan-out in `resolveMode`).
- **Zone rule:** PASS — spec folder `444a7fb` committed ~17 min before code commit `fd2f14e` (reflog-verified).
- **Scope creep:** none — every hunk maps to TICKET-01.
- **Important (fixed in fix commit):** `source: "local"` named in the design was not literally checked → explicit `tool.sourceInfo.source === "local"` guard added.
- **Minor (deferred):** `isSyntheticToolPath` name overstates the check (it tests "not an absolute path"); global cache is per-process by design; `defaultMode` precedence now documented (see Standards #1); R-const table values in the spec are unused (harmless).

## Security (verdict: ✅ ACCEPTABLE — 0 Critical/High)

- **Verified:** `sourceInfo` is loader-stamped (not tool-craftable); all local extensions resolve to absolute paths; the filter is a superset of a safe condition; no new file I/O (no new DoS surface); cache key is pure string ops (no traversal class).
- **F1 (Confirmed, by-design):** auto-allow is argument-blind — bounded by "you trusted the extension file at load"; no new attack vector.
- **F2 (Likely):** an extension could shadow a builtin name (e.g. `bash`) and enter the auto-allow — mitigant: explicit `deny`/`ask` rules win (R3/R4); documented in README.
- **F3 (Needs verification, policy only):** `scope`/`origin` are not consulted — package-scope extensions auto-allow identically; acceptable for a local CLI.
- **F4:** Windows drive paths fail closed (all extension tools → `ask`); no platform is mis-allowed.
- **Recommendation (applied):** document argument-blindness + name-shadowing caveat in README → **FIXED in fix commit**.

## Fixes applied this round

1. `index.ts` — `sourceInfo.source === "local"` guard added to `getDerivedExtensionAllowState` (spec Important).
2. `README.md` — `defaultMode` caveat + argument-blind + name-shadowing documentation (standards Minor #1 + security recommendation).

Verification after fixes: extension vitest 62/62 green, `tsc --noEmit` clean.

## Deferred (Minor, logged)

- `cacheKey` public-but-internal field (pattern consistency with skill cache)
- Cache-key asymmetry skill vs extension derivation (documented in this file)
- `fakePi` stub shape (root suite is the backstop)
- `isSyntheticToolPath` naming

## Floor verdict

**PASS** — no open Critical/Important findings; review clean after fix commit.
