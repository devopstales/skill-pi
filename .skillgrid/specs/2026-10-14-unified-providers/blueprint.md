# Unified Providers Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-execution (recommended) or simple-execution to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** PROPOSED

**Tier:** T3 (large, multi-concern port + integration)

**Change classification:** `high-risk` — new OAuth trust boundary (two OAuth flows), a custom `streamSimple`, and a vendored ~20k-LOC base; L4 verification (full suite + coverage + lint + a load smoke).

**Build shape:** Tracer thread — a thin end-to-end path (one upstream provider registering and authenticating inside skill-pi) is proven first; the rest of the pi-free base and the second OAuth provider thicken the same layers. Rationale: integration risk (does vendored code actually load + authenticate under skill-pi's isolated agent dir and jiti) is the unknown, not the count of providers.

**Goal:** Bundle one pi extension that registers the union of `pi-free` (26 free/paid providers + its filter/telemetry/fallback/quota/orchestration, ported as-is), the `opencode-zen` provider (OAuth), and the `antigravity` provider (OAuth, multi-account) so a single `skill-pi` install exposes all of them.

**Architecture:** A new bundled extension `extensions/providers/` with a single composition entry `index.ts`. The entry (1) loads the pi-free base exactly as it ships (its `dist/index.js` default export, which registers its 26 providers + all orchestration), then (2) registers the `opencode-zen` provider and (3) the `antigravity` provider into the same pi runtime, each behind a per-provider enable seam. pi-free is vendored as-is under `extensions/providers/pi-free/`; the two OAuth providers are vendored as their raw TS under `extensions/providers/zen/` and `extensions/providers/antigravity/`. New runtime deps are declared in `extensions/package.json` (the `--extension` dir) so jiti resolves them, per ADR-0001.

**Tech Stack:** TypeScript (raw `.ts`, loaded by pi's jiti — no build step), `@earendil-works/pi-coding-agent@1.2.0` + `@earendil-works/pi-ai@1.2.0` (host runtime, already a wrapper dep), `undici` (pi-agy), vendored `pi-free@2.8.4` dist. ESM, Node >= 22.19.0.

**Spec:** `briefing.md` (this folder) · **ADR manifest:** `adr.md` (this folder) · **Product:** `.skillgrid/artifacts/00-prd.md`

**Decision note:** The per-provider enable/disable seam (Task 5) uses the env key **`SKILL_PI_DISABLE_PROVIDERS`** (comma-separated provider ids: `opencode-zen`, `antigravity`), following skill-pi's existing env-override convention (`SKILL_PI_AGENT_DIR`, `SKILL_PI_WORK_DIR`). This is a local implementation detail — the set of toggleable providers is fixed by the two added OAuth providers, and pi-free's base is always on — so it is not a load-bearing product decision.

## Terms

None beyond the project glossary. Relies on: **manifest dir**, **wrapper**, **agent dir**, **`PI_CODING_AGENT_DIR`** (see `.skillgrid/artifacts/02-technical-terms.md`). This plan introduces:

- **unified providers extension** — the new `extensions/providers/` bundled extension; the single pi extension that owns the union of the three upstreams.
- **pi-free base** — the vendored, unmodified pi-free provider set + orchestration; the "as-is" foundation the other two providers are added to.
- **OAuth provider** — `opencode-zen` and `antigravity`; self-contained pi-ai `createProvider`/provider registrations added on top of the pi-free base.

## Hypothesis

**Claim:** pi-free's shipped base can load unchanged inside skill-pi's isolated, jiti-loaded extension context and register its providers + orchestration, and the two OAuth providers can be added to that same pi runtime, all with state confined to `~/.skill-pi/agent` (ADR-0002).
**Right condition:** `skill-pi` launches; `/toggle-free`, `/pi-free-health`, `/free-providers` run and reflect the 26 providers; `/login opencode-zen` and `/login antigravity` complete their OAuth flows and persist to `~/.skill-pi/agent/auth.json`; a request through a free provider and through Zen succeeds; stock `~/.pi/agent` is byte-identical before/after.
**Wrong condition:** any of: pi-free's base fails to import under skill-pi's jiti (unresolved `@earendil-works/*` or relative `dist` import), a command is missing after load, an OAuth login writes to `~/.pi/agent`, or the Zen/Antigravity provider is not selectable in `/model`.
**Thinnest MVP:** the extension loads pi-free's base and registers **one** of the 26 pi-free providers plus the **antigravity** provider; antigravity OAuth completes end-to-end. If that door check fails, the vendoring/loading approach is wrong and the plan is invalidated.
**Door check:** Task 1 (vendor pi-free base + register it) + Task 5 (add antigravity). If Task 1's load smoke fails, STOP — the whole approach rests on pi-free loading as-is.

## Must-Haves (goal-backward verification)

**Truths** (observable behaviors that must hold):
- `skill-pi` launches and the unified providers extension is loaded without import errors (no `ERR_MODULE_NOT_FOUND` for `@earendil-works/*` or relative `dist` paths).
- The 26 pi-free providers are registered and visible; `/free-providers` lists them with free/paid counts.
- `/toggle-free` flips free-only mode for all pi-free providers (ON shows "N free models across M providers").
- `/login opencode-zen` runs the device-flow OAuth and, on success, the `opencode-zen` provider is selectable in `/model`.
- `/login antigravity` runs the Google OAuth callback-server flow and, on success, the `antigravity` provider is selectable in `/model`.
- `/antigravity.usage`, `/antigravity.models`, and `/antigravity.doctor` run and report (or warn "No Antigravity credentials" when logged out).
- pi-free's diagnostic commands still run: `/pi-free-health`, `/free-startup`, `/free-telemetry`, `/clear-free-telemetry`.
- A model request through a pi-free provider and through `opencode-zen` returns a streamed assistant message.
- **`backstop`:** all extension state (auth tokens, telemetry, caches, Antigravity account store) is written to `~/.skill-pi/agent/**`; `~/.pi/agent` and `<repo>/.pi` are byte-identical before/after a session. Verified by a held-out diff test, not by reading the diff.
- **`backstop`:** the two OAuth providers are NOT silently swallowed by pi-free's free-only re-registration — after `/toggle-free ON`, a Zen/Antigravity model that the user explicitly selected is still usable (they are paid-first, not free-gated).

**Artifacts** (files that must exist with real implementation, not stubs):
- [`extensions/providers/index.ts` — the composition entry: loads the pi-free base, then adds the zen + antigravity providers behind the enable seam.]
- [`extensions/providers/pi-free/` — vendored pi-free base (dist + LICENSE + CHANGELOG) with `package.json` `main`/exports resolvable by jiti.]
- [`extensions/providers/zen/` — vendored `opencode-zen-oauth` source (`src/auth.ts`, `src/models.ts`, `src/free-tier.ts`, `src/v2-gate.ts`, `src/extension.ts`) re-exported as a provider registration.]
- [`extensions/providers/antigravity/` — vendored `pi-agy` source (`src/**`, `index.ts` logic) re-exported as a provider registration + its `/antigravity*` commands.]
- [`extensions/providers/README.md` — provenance table (upstream name@version, license) + how the enable seam works.]
- [`test/providers.load.test.js` — load smoke: the extension entry imports and registers providers against a stub ExtensionAPI.]
- [`test/providers.seam.test.js` — the enable seam: a disabled provider registers nothing; an enabled provider registers.]
- [`test/providers.separation.test.js` — ADR-0002: the extension writes state only under a given agent dir (no `~/.pi` path in the vendored code's output).]

**Key links** (critical connections that must work together):
- [`extensions/providers/index.ts` must import the pi-free base's default export and invoke it with the SAME `pi` ExtensionAPI instance it uses to register zen + antigravity — one runtime, three registrations.]
- [The enable seam must be the single place that decides whether each OAuth provider registers; `index.ts` must not call `registerProvider` for zen/antigravity directly (only through the seam).]
- [pi-free's `dist/index.js` relative imports (`./lib/*`, `./providers/*`) must resolve from the vendored location — i.e. the whole `dist/` tree is vendored together, not split.]
- [New runtime deps declared in `extensions/package.json` must be hoisted into the repo `node_modules` so jiti (which resolves from the extension file's location) finds them.]

**One-way-door decisions** (hard to reverse — flag for explicit user approval):
- **Vendoring pi-free as-is (~20k LOC, 165 JS files) into `extensions/providers/pi-free/`** — once committed it is maintained in-tree; reverting means deleting the tree and the registration. This is the core decision of the change. ⚠ Tagged on Task 1.
- **Adding `undici` (pi-agy) and any pi-free runtime deps to `extensions/package.json`** — new transitive surface in the published package. ⚠ Tagged on Task 1.
- **Command-name collisions are NOT a one-way door** (commands are runtime-replaceable, not a published contract); the plan keeps the upstreams' command names verbatim (see Global Constraints).

## Global Constraints

- **No build step.** The extension is raw `.ts` loaded by pi's jiti, matching `file-search` and `skill-pi-banner`. pi-free is vendored as its **compiled `dist/`** (it ships `dist`; we do not recompile it). The two OAuth providers are vendored as their **raw `.ts`** (they ship TS).
- **Deps land on `extensions/package.json`**, not the wrapper root (ADR-0001: the `--extension` dir is what pi's jiti resolves from).
- **pi-free ported as-is.** Do not refactor, rename, or "improve" pi-free internals. The only allowed pi-free edits are: (a) making `dist/index.js`'s entry importable as the base, and (b) nothing else. If a pi-free file references a literal `~/.pi/agent` path, that is a find-and-verify item for ADR-0002 (Task 8), not a rewrite.
- **The two OAuth providers are added, not folded into pi-free's free filter.** They register as their own providers; pi-free's `applyGlobalFilter`/re-registration does not touch them.
- **Command names kept verbatim** from each upstream (`/toggle-free`, `/free-providers`, `/pi-free-health`, `/antigravity`, `/antigravity.usage`, …). No rebranding to a `skill-pi` prefix. Rationale: faithful port, minimal divergence; collisions are checked in Task 1 and resolve in favor of keeping both (last-registered wins in pi's runtime is acceptable and documented).
- **No pi source changes** (ADR-0006). Registration is only via `pi.registerProvider` / pi-ai `createProvider` and `pi.registerCommand` / `pi.on`.
- **State confined to the agent dir** (ADR-0002). No writes to `~/.pi` or `<repo>/.pi`.
- **Provenance required.** `extensions/providers/README.md` carries a table of every vendored file set → upstream `name@version` + license. All three upstreams are MIT.

## File Structure

```
extensions/
  package.json              # MODIFIED: add deps (undici, + any pi-free runtime deps)
  package.json              # MODIFIED: pi.extensions += "./providers/index.ts"
  skill-pi-banner.ts        # unchanged
  file-search/              # unchanged
  providers/                # NEW — the unified providers extension
    index.ts                # composition entry: load base, add providers via seam
    pi-free/                # VENDOR pi-free@2.8.4 (as-is)
      dist/                 #   full compiled tree (index.js, lib/**, providers/**, vendor/**, constants.js, config.js, provider-helper.js)
      package.json          #   vendored manifest (main: ./dist/index.js) — keep `pi` field OUT of the load path
      LICENSE               #   MIT
      CHANGELOG.md          #   MIT provenance
    zen/                    # VENDOR opencode-zen-oauth@1.2.6 (raw TS)
      auth.ts
      models.ts
      free-tier.ts
      v2-gate.ts
      provider.ts           # NEW thin wrapper: re-exports the createProvider<ZenApi> object + free-tier gate wiring
      LICENSE
    antigravity/            # VENDOR pi-agy@0.6.1 (raw TS)
      src/                  #   full pi-agy src/** (accounts/, auth/, client/, diagnostics/, models/, stream/, usage/, utils/, types/)
      provider.ts           # NEW thin wrapper: re-exports the antigravity provider registration + commands
      LICENSE
    README.md               # provenance table + enable seam doc
test/
  providers.load.test.js    # load smoke
  providers.seam.test.js    # enable seam
  providers.separation.test.js  # ADR-0002 state confinement
Taskfile.yml                # MODIFIED: add `providers:test`, `providers:load` tasks
README.md                   # MODIFIED: document the new bundled extension
```

---

### Task 1: Vendor the pi-free base and prove it loads

> ⚠ **one-way:** Vendoring pi-free as-is (~20k LOC) into `extensions/providers/pi-free/` and adding its runtime deps to `extensions/package.json`. This is the load-bearing decision of the change — STOP and confirm before committing.

**Files:**
- Create: `extensions/providers/pi-free/` (full `dist/` tree + `package.json` + `LICENSE` + `CHANGELOG.md`)
- Create: `extensions/providers/index.ts` (first version: base load only)
- Create: `test/providers.load.test.js`
- Modify: `extensions/package.json` (add `./providers/index.ts` to `pi.extensions`; add runtime deps)
- Modify: `Taskfile.yml` (add `providers:test`)

**Interfaces:**
- Consumes: the pi-free@2.8.4 tarball (`dist/index.js` default export `piFreeEntry(pi)`).
- Produces: a working `import { base } from "./pi-free/base.js"` (a 1-line re-export shim so `index.ts` and tests share one import path) that, when called with an `ExtensionAPI`, runs pi-free's full base.
- Seam: `extensions/providers/pi-free/base.js` — the single import point for the base. Deletion test: without it, `index.ts` and every test import the deep `./pi-free/dist/index.js` path directly and the vendored layout is exposed to callers.
- Adapters: 2 (the real pi-free `dist/index.js`; a stub base in `test/providers.load.test.js` that records registration calls).

**SATISFIES:** `unified-extension-loads-base` (acceptance scenario: the extension entry loads pi-free's base and registers its providers without import errors)

- [ ] **Step 1: Vendor the pi-free tree as-is**

  Copy the **entire** `dist/` from the pi-free@2.8.4 tarball into `extensions/providers/pi-free/dist/` (all 165 JS files + their `.map`), plus `LICENSE`, `CHANGELOG.md`, and the tarball's `package.json` (as `extensions/providers/pi-free/package.json`). Do **not** edit any file in `dist/` yet. Confirm the tree is byte-complete:
  `find extensions/providers/pi-free/dist -name '*.js' | wc -l` must equal the tarball's count (165 `.js` excluding `.map` → verify against `npm pack` listing).

- [ ] **Step 2: Add the entry shim + register in the manifest**

  Create `extensions/providers/pi-free/base.js`:
  ```js
  // Re-export pi-free's entry so index.ts and tests share one import path.
  export { default as base } from "./dist/index.js";
  ```
  In `extensions/package.json`, append `"./providers/index.ts"` to `pi.extensions`.

- [ ] **Step 3: Write the failing load test**

  `test/providers.load.test.js` — a stub `ExtensionAPI` that records `registerProvider`, `registerCommand`, `on`, and `registerTool` calls. Import `base` from `extensions/providers/pi-free/base.js` and call `await base(stubPi)`. Assert: (a) no throw, (b) `stubPi.registerProvider` was called ≥ 20 times (the 26 unique providers + built-in re-registrations), (c) `stubPi.registerCommand` was called for at least `toggle-free` and `pi-free-health`.
  The stub must also satisfy the optional peer APIs pi-free touches (a no-op `registerGlobTool` path, `process.cwd()`). Use a minimal `ExtensionAPI` that returns permissive no-ops for any method not explicitly asserted.

- [ ] **Step 4: Run test to verify it fails (RED)**

  Run: `node --test test/providers.load.test.js`
  Expected: FAIL — most likely `ERR_MODULE_NOT_FOUND` for a pi-free transitive dep (`undici`, or a pi-ai subpath) because it is not yet a declared/hoisted dep of `extensions/`. Read the missing specifier; that is the list of deps to add.

- [ ] **Step 5: Add the missing runtime deps to `extensions/package.json` and install**

  Add the specifiers from the RED failure to `extensions/package.json` `dependencies` (e.g. `undici` from pi-agy, plus whatever pi-free's `dist` imports that is not a subpath of `@earendil-works/*`). Run `npm install` at the repo root so they hoist into the shared `node_modules` that jiti resolves from. **Re-derive** the list from the actual import graph (`grep -rhoE 'from "[^./][^"]*"' extensions/providers/pi-free/dist/**/*.js | sort -u`) — do not guess.

- [ ] **Step 6: Run test to verify it passes (GREEN)**

  Run: `node --test test/providers.load.test.js`
  Expected: PASS — base loads, ≥20 providers, the named commands present.

- [ ] **Step 7: Add a first-version composition entry**

  `extensions/providers/index.ts`:
  ```ts
  import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
  import { base } from "./pi-free/base.js";

  export default async function unifiedProviders(pi: ExtensionAPI) {
    await base(pi);
  }
  ```

- [ ] **Step 8: Commit**

  ```bash
  git add extensions/providers extensions/package.json test/providers.load.test.js Taskfile.yml
  git commit -m "feat(providers): vendor pi-free base and register as bundled extension"
  ```

---

### Task 2: Prove the base loads inside a real skill-pi session (door check)

**Files:**
- Modify: `Taskfile.yml` (add `providers:load` — launches skill-pi in `--print` mode and greps for the load markers)
- Test: `test/providers.load.test.js` (extend with a guard for the manual smoke, or a new `test/providers.smoke.note`)

**Interfaces:**
- Consumes: Task 1's `index.ts` + vendored base.
- Produces: evidence (captured startup log) that pi-free's `logStartupSummary` ran and the provider registry is populated in a **real** pi process under skill-pi's agent dir.
- Seam: none (in-process; this is a runtime proof, not new code).
- Deletion test: n/a — verification task.

**SATISFIES:** `base-runs-in-real-session` (acceptance scenario: a real `skill-pi` launch logs pi-free's startup summary and the 26 providers)

- [ ] **Step 1: Add the `providers:load` Taskfile task**

  A task that runs `skill-pi --print "reply with the word ok"` from the repo, with a throwaway `--agent-dir` (e.g. `$TMPDIR/skill-pi-providers-<ts>`), and captures stdout+stderr. Assert the output contains pi-free's startup summary marker (the `logStartupSummary` line — confirm its exact text from `dist/lib/startup-timing.js`) and that the process exits 0.

- [ ] **Step 2: Run it and read the real output**

  Run: `task providers:load`
  Expected: exit 0, startup summary present, no `ERR_MODULE_NOT_FOUND`. If a provider's `setup` fails, pi-free uses `Promise.allSettled` so it degrades — confirm in the log which providers settled rejected and why; a rejected provider setup is a **finding**, not a pass.

- [ ] **Step 3: Commit**

  ```bash
  git add Taskfile.yml test/providers.load.test.js
  git commit -m "test(providers): add real-session load smoke for the pi-free base"
  ```

**Door check:** if Task 1's load smoke or this real-session smoke fails to load the base, STOP — the "pi-free as-is" approach is invalidated. Report the specific failure and decide with the user whether to (a) fix the vendoring, or (b) reconsider the approach.

---

### Task 3: Add the `opencode-zen` provider (OAuth, device flow)

**Files:**
- Create: `extensions/providers/zen/{auth.ts,models.ts,free-tier.ts,v2-gate.ts,provider.ts}`
- Create: `extensions/providers/zen/LICENSE`
- Modify: `extensions/providers/index.ts` (register zen through the seam)
- Test: `test/providers.seam.test.js`

**Interfaces:**
- Consumes: `opencode-zen-oauth@1.2.6` source (verbatim `src/{auth,models,free-tier,v2-gate}.ts`); pi-ai `createProvider`, `@earendil-works/pi-ai/compat` APIs.
- Produces: `extensions/providers/zen/provider.ts` exporting `zenProvider` (the `createProvider<ZenApi>` object from upstream `src/extension.ts`) AND a `registerZen(pi)` function that applies the upstream's `before_agent_start`/`message_end` free-tier handlers + `pi.registerProvider(zenProvider)`.
- Seam: `extensions/providers/zen/provider.ts`'s `registerZen(pi)` — the single call site that turns the vendored zen module into a pi registration. Deletion test: without it, `index.ts` would inline the four `pi.on`/`registerProvider` calls and the vendored module's wiring leaks into the composition entry.
- Adapters: 2 (the real `registerZen`; a stub in `test/providers.seam.test.js`).

**SATISFIES:** `zen-provider-registers` (acceptance scenario: `opencode-zen` is registered and selectable; `/login opencode-zen` is present)

- [ ] **Step 1: Vendor the zen source verbatim**

  Copy `opencode-zen-oauth@1.2.6` `src/{auth,models,free-tier,v2-gate}.ts` into `extensions/providers/zen/` **unchanged** (they use `.ts` extension imports — keep them; jiti resolves `.ts`). Copy `LICENSE`. Confirm `models.ts` exports `INFERENCE_URL`, `MODELS`, `modelFromZen`, `type ZenApi`; `auth.ts` exports `UA`, `fetchZenModels`, `loginZen`, `refreshZenToken`, `type ZenCredential`; `free-tier.ts` exports `freeTierHeaders`, `isZeroCostModel`; `v2-gate.ts` exports `buildTextToolProtocol`, `convertTextToolMessage`, `shapeFreeTierRequest`.

- [ ] **Step 2: Write the failing seam test (RED)**

  `test/providers.seam.test.js` — with a stub `ExtensionAPI`, call `registerZen(stubPi)`. Assert `stubPi.registerProvider` was called once with a provider whose `id === "opencode-zen"`, and `stubPi.on` was called for `before_agent_start` and `message_end`.

- [ ] **Step 3: Implement `provider.ts`**

  Lift the body of upstream `src/extension.ts` into `provider.ts`: the `provider` object (keep its `id: "opencode-zen"`), the `withFreeTierGate`/`freeModelProtocol` helpers, and a `registerZen(pi)` that wires the two `pi.on` handlers + `pi.registerProvider(provider)`. Keep the `id` and all logic verbatim; only the default-export `function (pi)` becomes the named `registerZen`.

- [ ] **Step 4: Run test to verify it passes (GREEN)**

  Run: `node --test test/providers.seam.test.js`
  Expected: PASS.

- [ ] **Step 5: Wire into the composition entry**

  In `extensions/providers/index.ts`, after `await base(pi)`, add:
  ```ts
  import { registerZen } from "./zen/provider.js";
  // in the entry, after base(pi):
  registerZen(pi);
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add extensions/providers/zen extensions/providers/index.ts test/providers.seam.test.js
  git commit -m "feat(providers): add opencode-zen OAuth provider to the unified extension"
  ```

---

### Task 4: Add the `antigravity` provider (OAuth, multi-account, custom stream)

**Files:**
- Create: `extensions/providers/antigravity/src/**` (full pi-agy `src/` tree) + `provider.ts` + `LICENSE`
- Modify: `extensions/providers/index.ts` (register antigravity through the seam)
- Test: `test/providers.seam.test.js` (extend)

**Interfaces:**
- Consumes: `pi-agy@0.6.1` `src/**` (accounts/, auth/, client/, diagnostics/, models/, stream/, usage/, utils/, types/); `undici` (now a declared dep from Task 1 or added here if not yet).
- Produces: `extensions/providers/antigravity/provider.ts` exporting `registerAntigravity(pi)` that runs the upstream `index.ts` body — provider registration (primary only, `PROVIDER_ID`), the `session_start`/`session_shutdown` handlers, the account pool wiring, and the `/antigravity*` commands.
- Seam: `extensions/providers/antigravity/provider.ts`'s `registerAntigravity(pi)`. Deletion test: without it the upstream `index.ts`'s entire body (pool construction, `session_start` closure state, 4 commands) inlines into `index.ts`.
- Adapters: 2 (real; stub in the seam test).

**SATISFIES:** `antigravity-provider-registers` (acceptance scenario: `antigravity` is registered and selectable; `/antigravity.usage`/`.models`/`.doctor` are present)

- [ ] **Step 1: Vendor the antigravity source verbatim**

  Copy `pi-agy@0.6.1` `src/**` into `extensions/providers/antigravity/src/` unchanged, plus `LICENSE`. Confirm `undici` is in `extensions/package.json` deps (add + `npm install` if not — Task 1 may have caught it). Confirm the upstream `index.ts`'s imports (`./src/auth/index.js`, etc.) resolve — pi-agy ships `.js` import specifiers pointing at `.ts` sources; jiti handles this, but verify with the test in Step 2.

- [ ] **Step 2: Write the failing seam test (RED)**

  Extend `test/providers.seam.test.js`: call `registerAntigravity(stubPi)`. Assert `registerProvider` called with `PROVIDER_ID` (import the const from the vendored `src/models/index.js`), `registerCommand` called for `antigravity`, `antigravity.usage`, `antigravity.models`, `antigravity.doctor`, and `on` called for `session_start` and `session_shutdown`.

- [ ] **Step 3: Implement `provider.ts`**

  Lift upstream `index.ts`'s `default function (pi)` into `provider.ts` as `registerAntigravity(pi)`, importing from `./src/**`. Keep the `PROVIDER_ID`/`PROVIDER_NAME`/model/endpoint constants verbatim. Preserve the `emitCommandOutput`/`withUsage` helpers (copy them in).

- [ ] **Step 4: Run test to verify it passes (GREEN)**

  Run: `node --test test/providers.seam.test.js`
  Expected: PASS for both zen and antigravity seams.

- [ ] **Step 5: Wire into the composition entry**

  In `extensions/providers/index.ts`, after `registerZen(pi)`, add:
  ```ts
  import { registerAntigravity } from "./antigravity/provider.js";
  // in the entry:
  registerAntigravity(pi);
  ```

- [ ] **Step 6: Commit**

  ```bash
  git add extensions/providers/antigravity extensions/providers/index.ts test/providers.seam.test.js
  git commit -m "feat(providers): add antigravity OAuth multi-account provider to the unified extension"
  ```

---

### Task 5: Centralize registration behind the per-provider enable seam

**Files:**
- Modify: `extensions/providers/index.ts`
- Test: `test/providers.seam.test.js` (extend)

**Interfaces:**
- Consumes: `registerZen`, `registerAntigravity` (Tasks 3–4), the pi-free `base` (Task 1).
- Produces: a `ProviderToggles` config read from `ctx`/settings/env, and `index.ts` registering each provider **only if enabled**. The seam is the single decision point.
- Seam: `index.ts`'s toggle resolution — the one place that maps an enable flag to a registration call. Deletion test: without it, each `registerX` call is unconditional and a user cannot disable a provider without editing the entry.
- Adapters: 2 (real env/settings-backed toggle; a forced-on and forced-off stub in the seam test).

**SATISFIES:** `provider-toggle-disables-registration` (acceptance scenario: disabling a provider omits its registration; enabling it registers)

- [ ] **Step 1: Write the failing test (RED)**

  In `test/providers.seam.test.js`: (a) with antigravity enabled (default), `registerAntigravity` effects are present; (b) with `SKILL_PI_DISABLE_PROVIDERS=antigravity` set, the stub `pi` receives NO `registerProvider`/`registerCommand` for antigravity; (c) zen likewise. (Config key is fixed by the Decision note: `SKILL_PI_DISABLE_PROVIDERS`, comma-separated; Task 9 documents it.)

- [ ] **Step 2: Implement the seam**

  In `index.ts`:
  ```ts
  function isEnabled(name: string, disabledSet: Set<string>): boolean {
    return !disabledSet.has(name);
  }
  export default async function unifiedProviders(pi: ExtensionAPI) {
    await base(pi);
    const disabled = new Set((process.env.SKILL_PI_DISABLE_PROVIDERS ?? "").split(",").filter(Boolean));
    if (isEnabled("opencode-zen", disabled)) registerZen(pi);
    if (isEnabled("antigravity", disabled)) registerAntigravity(pi);
  }
  ```

- [ ] **Step 3: Run test to verify it passes (GREEN)**

  Run: `node --test test/providers.seam.test.js`
  Expected: PASS for default-on, disable-zen, disable-antigravity, disable-both.

- [ ] **Step 4: Commit**

  ```bash
  git add extensions/providers/index.ts test/providers.seam.test.js extensions/providers/README.md
  git commit -m "feat(providers): gate OAuth provider registration behind a per-provider enable seam"
  ```

---

> **Depends on Task 5** — this test asserts the registration *order* (base's global filter pass first, OAuth providers registered after), which Task 5's seam establishes. Execute after Task 5.

### Task 6: Verify the two OAuth providers are not swallowed by pi-free's free filter

**Files:**
- Test: `test/providers.free-filter.test.js`
- Modify: `extensions/providers/index.ts` (only if a fix is needed — expected: no change, since the OAuth providers register as their own `id`s)

**Interfaces:**
- Consumes: the full entry (base + zen + antigravity) against a stub that captures the provider registry.
- Produces: proof that after the pi-free base applies its global filter, the `opencode-zen` and `antigravity` providers remain registered and selectable (their `id`s are outside pi-free's `UNIQUE_PROVIDERS` + built-in set, so the re-registration filter does not wipe them).
- Seam: the composition entry's registration order (base first, then OAuth providers). Deletion test: n/a — verification task; if a provider IS wiped, the fix is registration order or an explicit re-register, both localized to `index.ts`.
- Adapters: the stub registry (records registered provider ids + their `filterModels`).

**SATISFIES:** `oauth-providers-survive-free-filter` (acceptance scenario: after `/toggle-free ON`, a Zen/Antigravity model is still usable)

- [ ] **Step 1: Write the failing/verifying test (RED if the assumption is wrong)**

  `test/providers.free-filter.test.js` — run the full entry against a stub `pi` that records every `registerProvider` id and, for the pi-free providers, the `filterModels` behavior. Assert the final registry contains `opencode-zen` and `antigravity` **and** that their `filterModels` (if any) is the upstream's, not pi-free's. This test is expected to PASS; it guards a `backstop` truth.

- [ ] **Step 2: Run it**

  Run: `node --test test/providers.free-filter.test.js`
  Expected: PASS. If it FAILS (a provider was re-registered/filtered by pi-free), apply the minimal fix in `index.ts` (e.g. register the OAuth providers **after** the base's global filter pass, or re-register them after `applyGlobalFilter`) and re-run.

- [ ] **Step 3: Commit**

  ```bash
  git add test/providers.free-filter.test.js extensions/providers/index.ts
  git commit -m "test(providers): verify OAuth providers survive pi-free's free-only filter"
  ```

---

### Task 7: ADR-0002 state-confinement verification

**Files:**
- Test: `test/providers.separation.test.js`
- Modify: vendored files **only** if a literal `~/.pi/agent` path is found and confirmed to write state (record each such edit in `providers/README.md` provenance table)

**Interfaces:**
- Consumes: the full entry against a stub `pi` with `ctx.env`, and a sandboxed temp agent dir.
- Produces: proof that the extension's state writes resolve under the given agent dir (via pi's `PI_CODING_AGENT_DIR`-aware credential store) and never to `~/.pi` or `<repo>/.pi`.
- Seam: the credential-store path resolution (pi-owned). Deletion test: n/a — verification task.
- Adapters: the temp-dir fixture (a fake agent dir that records writes).

**SATISFIES:** `state-confined-to-agent-dir` (acceptance scenario: a session writes auth/telemetry/account state only under `~/.skill-pi/agent`)

- [ ] **Step 1: Grep the vendored code for literal home paths**

  Run: `grep -rn "\.pi/agent\|HOME\|os.homedir\|/home/" extensions/providers/` and record every hit in `providers/README.md`. For each, determine whether it (a) resolves through pi's credential store (safe — pi redirects via `PI_CODING_AGENT_DIR`), or (b) is a hardcoded write (must be fixed).

- [ ] **Step 2: Write the confinement test (RED if a hardcoded write exists)**

  `test/providers.separation.test.js` — set `PI_CODING_AGENT_DIR` to a temp dir, run the entry against a stub `pi`, trigger a state write path (e.g. the Antigravity account store init, or pi-free's telemetry `getTelemetryPath`), and assert **no** file appears under `~/.pi` and the state file is under the temp agent dir.

- [ ] **Step 3: Fix any hardcoded writes (if Step 1 found them)**

  For each confirmed hardcoded write, change it to resolve through the agent dir (use the same env var pi uses). Keep edits minimal and record them in `providers/README.md`.

- [ ] **Step 4: Run test to verify it passes (GREEN)**

  Run: `node --test test/providers.separation.test.js`
  Expected: PASS — no `~/.pi` writes.

- [ ] **Step 5: Commit**

  ```bash
  git add test/providers.separation.test.js extensions/providers/
  git commit -m "test(providers): verify ADR-0002 state confinement to the agent dir"
  ```

---

### Task 8: End-to-end OAuth + free-model request smoke

**Files:**
- Modify: `Taskfile.yml` (add `providers:e2e` — drives a real `skill-pi --print` session)
- Test: `test/providers.e2e.test.js` (a Node `--test` that shells out; gated behind an env var so CI can run it headless or skip it)

**Interfaces:**
- Consumes: the full unified extension in a real pi process.
- Produces: end-to-end evidence that (a) a pi-free provider streams an assistant message, and (b) the antigravity/zen OAuth flows reach their expected "logged out" or "logged in" states (a full interactive OAuth is not automatable headless — assert the command is present and the provider is selectable, and that a request through a logged-in free provider returns text).
- Seam: the `skill-pi --print` CLI (the wrapper's real entry). Deletion test: n/a — verification task.
- Adapters: the real CLI (prod) + a `SKILL_PI_E2E=0` skip adapter (CI).

**SATISFIES:** `e2e-free-model-requests` + `e2e-oauth-commands-present` (acceptance scenarios: a real free-model request succeeds; the OAuth login commands are present in a real session)

- [ ] **Step 1: Write the E2E test (skip-guarded)**

  `test/providers.e2e.test.js` — if `process.env.SKILL_PI_E2E` is not `"1"`, `t.skip()`. Otherwise shell out to `skill-pi --print "reply with exactly: ok" --agent-dir <temp>` and assert exit 0 and the assistant message contains "ok". Then run `skill-pi --print` and grep the startup/transcript for the `/antigravity` and `opencode-zen` provider markers to confirm both are registered in the real runtime.

- [ ] **Step 2: Add the `providers:e2e` Taskfile task and run it locally**

  Run: `SKILL_PI_E2E=1 task providers:e2e`
  Expected: PASS (a real free-model round-trip completes; both OAuth providers present). A real interactive `/login` is manual — record it in the task output as a note, not an assertion.

- [ ] **Step 3: Commit**

  ```bash
  git add Taskfile.yml test/providers.e2e.test.js
  git commit -m "test(providers): add E2E free-model + OAuth-presence smoke"
  ```

---

### Task 9: Docs, provenance, and full-suite verification

**Files:**
- Create: `extensions/providers/README.md`
- Modify: `README.md` (the "Currently bundled" list)
- Modify: `Taskfile.yml` (ensure `providers:test` runs the three new test files + the e2e gate)
- Test: full suite

**Interfaces:**
- Consumes: all of the above.
- Produces: a provenance table (every vendored file set → upstream `name@version` + license + any ADR-0002 edits), the enable-seam doc (the `SKILL_PI_DISABLE_PROVIDERS` contract), and a green full suite.
- Seam: none (documentation + final verification).
- Deletion test: n/a.

**SATISFIES:** `docs-and-provenance-present` + `full-suite-green` (acceptance scenarios: the README documents the new extension + provenance; `node --test "test/**/*.test.js"` is green)

- [ ] **Step 1: Write `extensions/providers/README.md`**

  Provenance table (rows: `pi-free@2.8.4` (MIT, apmantza), `opencode-zen-oauth@1.2.6` (MIT, Naab2k3), `pi-agy@0.6.1` (MIT, shakthi-sagar); columns: upstream, version, license, vendored path, any edits made in Task 7). Enable-seam section: the `SKILL_PI_DISABLE_PROVIDERS` contract + the list of providers it gates (zen, antigravity — the pi-free base is always on).

- [ ] **Step 2: Update the wrapper `README.md`**

  Add the unified providers extension to the "Currently bundled" list with a one-line description and a link to `extensions/providers/README.md`.

- [ ] **Step 3: Wire the new tests into the suite and run the full suite (L4)**

  Ensure `test/*.test.js` picks up `providers.load.test.js`, `providers.seam.test.js`, `providers.free-filter.test.js`, `providers.separation.test.js`, and (skip-guarded) `providers.e2e.test.js`. Run the full suite:
  Run: `node --test "test/**/*.test.js"`
  Expected: all green (e2e skipped unless `SKILL_PI_E2E=1`).

- [ ] **Step 4: Syntax-check the new raw-TS files (no project typecheck surface)**

  The repo has **no tsconfig and no typecheck task** — raw-TS extensions are loaded by pi's jiti at runtime, and cross-extension imports (`typebox`, `effect`) resolve only via hoisting (see `file-search`). There is no `tsc -p` to run. Instead, do a syntax parse of the new TS files to catch typos the load test wouldn't (the load test only imports the *registered* paths):
  Run: `for f in $(git diff --name-only origin/main...HEAD -- 'extensions/providers/**/*.ts'); do npx jiti --check "$f" || echo "PARSE FAIL: $f"; done`
  Expected: every new `.ts` file parses (jiti transpiles cleanly). (pi-free's `dist/` is precompiled JS — not typechecked, matching how the rest of the extension set is handled.)

- [ ] **Step 5: Commit**

  ```bash
  git add extensions/providers/README.md README.md Taskfile.yml test/
  git commit -m "docs(providers): add provenance table, enable-seam doc, and full-suite wiring"
  ```

---

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED test |
|---|---|---|---|
| **Module import resolution** (jiti loading vendored TS/JS + transitive deps from the `--extension` dir) | Applicable: pi-free's `dist/` + the two TS trees import `@earendil-works/*` subpaths and `undici`; a missing/ mis-hoisted dep breaks the whole extension at load. | Declare all runtime deps in `extensions/package.json`; hoist via `npm install`; the entry is a thin re-export so the import surface is one path. | `providers.load.test.js` RED before deps added (ERR_MODULE_NOT_FOUND). |
| **Process integration** (the extension runs inside pi's real process; a throw in one provider's setup must not kill the others) | Applicable: pi-free uses `Promise.allSettled` for its own providers, but our added `registerZen`/`registerAntigravity` are sequential. | Wrap each OAuth provider registration so a failure logs and continues (the base already degrades). | `providers.load.test.js` asserts the entry returns even when a stub provider setup throws. |
| **Shell/subprocess** (OAuth callback-server on a fixed port; E2E shells out to the CLI) | Applicable: pi-agy opens `http://localhost:51121/oauth-callback`; the E2E task spawns `skill-pi`. | pi-agy's port/timeout are vendored as-is (its own `ANTIGRAVITY_*` env overrides); the E2E test is skip-guarded (`SKILL_PI_E2E=1`) and uses a throwaway `--agent-dir`. | `providers.separation.test.js` + `providers.e2e.test.js` (skip-guarded) — port conflict surfaces as a failed OAuth callback, asserted in a manual login note. |
| **Version-control automation** (n/a) | N/A: no PR/branch/git automation is introduced by this change. | — | — |
| **Subprocess** (pi-free's binary downloads / `open-browser` for OAuth) | Applicable: pi-free's `open-browser.ts` and any provider that spawns a browser. | Vendored as-is; no new subprocess paths added by the composition entry. | `providers.load.test.js` (no-throw on a headless stub where `open` is a no-op). |
| **Data / state confinement** (auth tokens, telemetry, account store) | Applicable: three upstreams each persist state; ADR-0002 forbids `~/.pi` writes. | Resolve through pi's `PI_CODING_AGENT_DIR`-aware store; grep for literal home paths; fix only confirmed hardcoded writes. | `providers.separation.test.js` asserts no `~/.pi` writes under a temp agent dir. |

## Build Shape & Ordering

Tracer thread. First wave = Tasks 1–2 (vendor base + prove it loads in a real session — the door check). Second wave = Tasks 3–5 (add the two OAuth providers + the enable seam). Third wave = Tasks 6–8 (verify the free-filter interaction, state confinement, and E2E). Fourth = Task 9 (docs + full suite). Slicing should order Tasks 1→2 as the first wave's risk-first items; Tasks 3 and 4 are independent of each other (parallelizable once the seam in Task 5's config key is named — Task 3 can run before 5 with an unconditional register, then 5 centralizes).
