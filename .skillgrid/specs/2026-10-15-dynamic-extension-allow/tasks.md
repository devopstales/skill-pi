# Tasks — dynamic extension tool allow

Fast-track `small` change. Single ticket.

## TICKET-01 — derive extension-registered tools and auto-allow them

- **Scope:**
  - `extensions/permission/models.ts` — add `DerivedExtensionAllowState`
  - `extensions/permission/index.ts` — `getDerivedExtensionAllowState(pi)` (getAllTools → real-file, non-builtin, non-namespaced tools; mtime+size keyed cache), merge into `tool_call` + `permission-settings` as allow rules, `resolveSingleMode` fall-through returns `allow` when the tool is extension-registered, `resetDerivedExtensionAllowStateCacheForTest()`
  - `extensions/permission/extension-allow.spec.ts` — vitest specs for R1–R6
  - `extensions/permission/README.md` — Defaults section documents the dynamic allow
- **SATISFIES:** R1, R2, R3, R4, R5, R6
- **Verification:**
  - `cd extensions/permission && npx vitest run` (all specs green, RED first)
  - `cd extensions/permission && npx tsc --noEmit -p .`
  - `node --test "test/**/*.test.js"` (root suite)
- **Fails-when:** any spec red, tsc error, or root suite failure
