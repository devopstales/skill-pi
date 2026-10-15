import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function makeCapturingStubPi() {
  const stub = {
    registrations: [],
    commands: new Map(),
    handlers: new Map(),
    registerProvider(providerOrId, config) {
      if (typeof providerOrId === "string") stub.registrations.push({ id: providerOrId, config });
      else stub.registrations.push({ id: providerOrId?.id, provider: providerOrId });
    },
    on(event, handler) {
      const list = stub.handlers.get(event) ?? [];
      list.push(handler);
      stub.handlers.set(event, list);
      return () => {
        const l = stub.handlers.get(event);
        if (l) l.splice(l.indexOf(handler), 1);
      };
    },
    registerCommand(name, options) {
      stub.commands.set(name, options);
    },
    registerTool() {},
    registerShortcut() {},
    registerFlag() {},
    registerMcpServer() {},
    registerVirtualModel() {},
    getFlag() {},
    getSettings() {
      return {};
    },
    getThinkingLevel() {
      return "low";
    },
    setThinkingLevel() {},
    sendMessage() {},
    sendUserMessage() {},
    appendEntry() {},
    setSessionName() {},
    getSessionName() {
      return null;
    },
    setLabel() {},
    exec() {
      return "";
    },
    getActiveTools() {
      return [];
    },
    getAllTools() {
      return [];
    },
    setActiveTools() {},
    getCommands() {
      return [];
    },
    setModel() {},
  };
  return stub;
}

// The stub pi must not hold the entry open: the pi-free base schedules a
// 1500ms telemetry debounce (unref'd) and the entry itself runs a session
// timer that otherwise keeps the test runner waiting.
function withFreshStubPi(t, fn) {
  const stub = makeCapturingStubPi();
  const origTimeout = globalThis.setTimeout;
  t.after(() => {
    globalThis.setTimeout = origTimeout;
  });
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const t = origTimeout(fn, ms, ...rest);
    if (typeof t === "object" && t !== null && typeof t.unref === "function") t.unref();
    return t;
  };
  return fn(stub);
}

// Run the full composition entry (pi-free base + both OAuth providers) against
// a capturing stub; every registerProvider call lands in stub.registrations in
// order, so the last entry per id is the provider the runtime serves.
async function runEntry(t, env = {}) {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-free-filter-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  const prior = {
    agentDir: process.env.PI_CODING_AGENT_DIR,
    noPrewarm: process.env.ANTIGRAVITY_NO_PREWARM,
    disabled: process.env.SKILL_PI_DISABLE_PROVIDERS,
  };
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.ANTIGRAVITY_NO_PREWARM = "1";
  if (env.SKILL_PI_DISABLE_PROVIDERS === undefined) delete process.env.SKILL_PI_DISABLE_PROVIDERS;
  else process.env.SKILL_PI_DISABLE_PROVIDERS = env.SKILL_PI_DISABLE_PROVIDERS;
  const { createJiti } = await import("jiti");
  const jiti = createJiti(pathToFileURL(join(repoRoot, "test")).href, {
    interopDefault: true,
    tryNative: true,
    tsconfigPaths: true,
  });
  try {
    const entryUrl = pathToFileURL(join(repoRoot, "extensions", "providers", "index.ts")).href;
    const mod = await jiti.import(entryUrl);
    return await withFreshStubPi(t, async (stubPi) => {
      await mod.default(stubPi);
      return stubPi;
    });
  } finally {
    process.env.PI_CODING_AGENT_DIR = prior.agentDir;
    if (prior.noPrewarm === undefined) delete process.env.ANTIGRAVITY_NO_PREWARM;
    else process.env.ANTIGRAVITY_NO_PREWARM = prior.noPrewarm;
    if (prior.disabled === undefined) delete process.env.SKILL_PI_DISABLE_PROVIDERS;
    else process.env.SKILL_PI_DISABLE_PROVIDERS = prior.disabled;
  }
}

function finalByReg(stub) {
  const map = new Map();
  for (const r of stub.registrations) map.set(r.id, r);
  return map;
}

// SATISFIES happy path oauth-providers-survive-free-filter
// G1 CHECK: node --test test/providers.free-filter.test.js  EXPECT: 0 fail
// Backstop: the full entry (base + both OAuth providers) runs the base's
// global filter pass before the OAuth registrations, so the final registry
// must still serve opencode-zen and antigravity.
test("OAuth providers survive the pi-free global filter pass", async (t) => {
  const stub = await runEntry(t);
  const final = finalByReg(stub);
  assert.ok(final.has("opencode-zen"), `opencode-zen must be in the final registry (got: ${[...final.keys()].join(", ")})`);
  assert.ok(final.has("antigravity"), `antigravity must be in the final registry (got: ${[...final.keys()].join(", ")})`);
});

// SATISFIES failure oauth-provider-wiped-by-filter
// G2 CHECK: node --test test/providers.free-filter.test.js  EXPECT: 0 fail
// Even when pi-free re-registers a provider (the filter pass re-registers every
// id it owns), the final entry for an OAuth id must still be the upstream
// object — a pi-free wipe would replace the object, and the entry must restore
// the upstream one after the pass.
test("filter re-registration cannot replace the upstream OAuth provider object", async (t) => {
  const stub = await runEntry(t);
  const final = finalByReg(stub);
  const zen = final.get("opencode-zen");
  const agy = final.get("antigravity");
  assert.ok(zen.provider, "opencode-zen must be registered as a provider object (upstream createProvider result)");
  assert.equal(zen.provider.id, "opencode-zen", "opencode-zen's object identity must be the upstream one");
  assert.ok(agy.config, "antigravity must keep its config registration (name/baseUrl/streamSimple)");
  assert.equal(typeof agy.config.streamSimple, "function", "antigravity's streamSimple must survive the pass");
});

// SATISFIES happy path oauth-providers-survive-free-filter (behavioral half):
// the surviving zen provider must still carry its OWN filter behavior, not a
// pi-free one. opencode-zen's filterModels honors the credential's allowed
// workspace list: a restricted catalog is narrowed, an empty allowed list
// leaves the catalog untouched.
test("opencode-zen's surviving filterModels is the upstream workspace-restriction behavior", async (t) => {
  const stub = await runEntry(t);
  const zen = finalByReg(stub).get("opencode-zen");
  assert.equal(typeof zen.provider.filterModels, "function", "opencode-zen must expose a filterModels (upstream contract)");
  const catalog = [{ id: "m-1", name: "M One" }, { id: "m-2", name: "M Two" }];
  const restricted = zen.provider.filterModels(catalog, { allowedModels: ["m-1"] });
  assert.deepEqual(restricted.map((m) => m.id), ["m-1"], "a non-empty allowed list must narrow the catalog");
  const unrestricted = zen.provider.filterModels(catalog, { allowedModels: [] });
  assert.deepEqual(unrestricted.map((m) => m.id), ["m-1", "m-2"], "an empty allowed list must leave the catalog intact");
  const noCredential = zen.provider.filterModels(catalog, undefined);
  assert.deepEqual(noCredential.map((m) => m.id), ["m-1", "m-2"], "no credential must leave the catalog intact");
});

// antigravity registers without a filterModels — its model view is driven by
// the account pool, not pi-free. The pass must leave the config untouched.
test("antigravity's surviving registration keeps its upstream config and no pi-free filter", async (t) => {
  const stub = await runEntry(t);
  const agy = finalByReg(stub).get("antigravity");
  assert.equal(agy.config.filterModels, undefined, "antigravity must not gain a pi-free filterModels");
  assert.equal(agy.config.name, "Antigravity", "antigravity's display name must be the upstream one");
  assert.equal(typeof agy.config.streamSimple, "function", "antigravity's pooled stream must be the upstream one");
});
