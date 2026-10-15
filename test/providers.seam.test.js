import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Permissive stub of pi's ExtensionAPI: records the registration calls the
// acceptance scenario asserts on, no-ops everything else. `on` returns an
// unsubscribe, matching pi's real API.
function makeStubPi() {
  const stub = {
    providers: [],
    commands: new Map(),
    handlers: new Map(),
    registerProvider(provider, config) {
      if (typeof provider === "string") stub.providers.push({ id: provider, ...config });
      else stub.providers.push(provider);
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

// SATISFIES happy path zen-provider-registers
// G4 CHECK: node --test test/providers.seam.test.js  EXPECT: 0 fail
// registerZen wires the opencode-zen provider and its free-tier event
// handlers onto the pi runtime.
test("registerZen registers the opencode-zen provider and free-tier handlers", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-zen-seam-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const providerPath = pathToFileURL(join(repoRoot, "extensions", "providers", "zen", "provider.ts")).href;
  const { registerZen } = await import(providerPath);
  assert.equal(typeof registerZen, "function", "provider.ts must export registerZen");

  const stubPi = makeStubPi();
  registerZen(stubPi);

  assert.equal(stubPi.providers.length, 1, "registerProvider must be called once");
  assert.equal(stubPi.providers[0]?.id, "opencode-zen", "provider id must be opencode-zen");
  assert.ok(stubPi.handlers.has("before_agent_start"), "before_agent_start handler must be subscribed");
  assert.ok(stubPi.handlers.has("message_end"), "message_end handler must be subscribed");
});

// SATISFIES happy path antigravity-provider-registers
// G4 CHECK: node --test test/providers.seam.test.js  EXPECT: 0 fail
// registerAntigravity wires the antigravity provider, its /antigravity*
// commands, and its session handlers onto the pi runtime.
test("registerAntigravity registers the antigravity provider, commands, and session handlers", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-agy-seam-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.ANTIGRAVITY_NO_PREWARM = "1";

  // The .js specifiers inside the verbatim vendored src/ tree resolve to the
  // .ts sources only through jiti (pi's extension loader), not native Node
  // ESM — same reason the load test goes through the compiled pi-free dist.
  const { createJiti } = await import("jiti");
  const jiti = createJiti(pathToFileURL(join(repoRoot, "test")).href, {
    interopDefault: true,
    tryNative: true,
    tsconfigPaths: true,
  });

  const providerUrl = pathToFileURL(join(repoRoot, "extensions", "providers", "antigravity", "provider.ts")).href;
  const { registerAntigravity } = await jiti.import(providerUrl);
  assert.equal(typeof registerAntigravity, "function", "provider.ts must export registerAntigravity");

  const modelsUrl = pathToFileURL(join(repoRoot, "extensions", "providers", "antigravity", "src", "models", "index.ts")).href;
  const { PROVIDER_ID } = await jiti.import(modelsUrl);
  assert.equal(PROVIDER_ID, "antigravity", "vendored PROVIDER_ID must be antigravity");

  const stubPi = makeStubPi();
  registerAntigravity(stubPi);

  const agy = stubPi.providers.find((p) => p.id === PROVIDER_ID);
  assert.ok(agy, `registerProvider must be called with id ${PROVIDER_ID}`);
  assert.ok(stubPi.commands.has("antigravity"), "command /antigravity must be registered");
  assert.ok(stubPi.commands.has("antigravity.usage"), "command /antigravity.usage must be registered");
  assert.ok(stubPi.commands.has("antigravity.models"), "command /antigravity.models must be registered");
  assert.ok(stubPi.commands.has("antigravity.doctor"), "command /antigravity.doctor must be registered");
  assert.ok(stubPi.handlers.has("session_start"), "session_start handler must be subscribed");
  assert.ok(stubPi.handlers.has("session_shutdown"), "session_shutdown handler must be subscribed");
});

// SATISFIES happy path provider-toggle-disables-registration
// G1 CHECK: node --test test/providers.seam.test.js  EXPECT: 0 fail
// SATISFIES failure zen-provider-not-registered-when-disabled
// SATISFIES failure antigravity-provider-not-registered-when-disabled
// SATISFIES edge provider-toggle-disables-both
// The unifiedProviders entry is the seam's single decision point: env
// SKILL_PI_DISABLE_PROVIDERS (comma-separated ids) omits the listed OAuth
// providers from registration while the pi-free base always registers.
async function runUnifiedEntry(t, env) {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-seam-entry-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  const prior = { agentDir: process.env.PI_CODING_AGENT_DIR, noPrewarm: process.env.ANTIGRAVITY_NO_PREWARM, disabled: process.env.SKILL_PI_DISABLE_PROVIDERS };
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.ANTIGRAVITY_NO_PREWARM = "1";
  if (env.SKILL_PI_DISABLE_PROVIDERS === undefined) delete process.env.SKILL_PI_DISABLE_PROVIDERS;
  else process.env.SKILL_PI_DISABLE_PROVIDERS = env.SKILL_PI_DISABLE_PROVIDERS;
  try {
    const { createJiti } = await import("jiti");
    const jiti = createJiti(pathToFileURL(join(repoRoot, "test")).href, {
      interopDefault: true,
      tryNative: true,
      tsconfigPaths: true,
    });
    const entryUrl = pathToFileURL(join(repoRoot, "extensions", "providers", "index.ts")).href;
    const { default: unifiedProviders } = await jiti.import(entryUrl);
    const stubPi = makeStubPi();
    await unifiedProviders(stubPi);
    return stubPi;
  } finally {
    process.env.PI_CODING_AGENT_DIR = prior.agentDir;
    if (prior.noPrewarm === undefined) delete process.env.ANTIGRAVITY_NO_PREWARM;
    else process.env.ANTIGRAVITY_NO_PREWARM = prior.noPrewarm;
    if (prior.disabled === undefined) delete process.env.SKILL_PI_DISABLE_PROVIDERS;
    else process.env.SKILL_PI_DISABLE_PROVIDERS = prior.disabled;
  }
}
test("entry registers both OAuth providers and the pi-free base by default", async (t) => {
  const stubPi = await runUnifiedEntry(t, {});
  assert.ok(stubPi.providers.find((p) => p.id === "opencode-zen"), "opencode-zen must register by default");
  assert.ok(stubPi.providers.find((p) => p.id === "antigravity"), "antigravity must register by default");
  assert.ok(stubPi.handlers.get("before_agent_start")?.length > 2, "zen free-tier handlers must subscribe by default");
  assert.ok(stubPi.handlers.get("message_end")?.length > 3, "zen must add its message_end handler by default");
  assert.ok(stubPi.commands.has("antigravity"), "antigravity commands must register by default");
  assert.ok(
    stubPi.providers.length >= 20,
    `pi-free base must register (>= 20 providers, got ${stubPi.providers.length})`,
  );
  assert.ok(stubPi.commands.has("toggle-free"), "pi-free base command must register by default");
});

test("entry omits antigravity when the seam disables only antigravity", async (t) => {
  const stubPi = await runUnifiedEntry(t, { SKILL_PI_DISABLE_PROVIDERS: "antigravity" });
  assert.ok(stubPi.providers.find((p) => p.id === "opencode-zen"), "opencode-zen must still register when only antigravity is disabled");
  assert.equal(stubPi.providers.find((p) => p.id === "antigravity"), undefined, "antigravity must not register when disabled");
  assert.equal(stubPi.commands.get("antigravity"), undefined, "no antigravity command may register when disabled");
  assert.equal(stubPi.commands.get("antigravity.usage"), undefined, "no antigravity.usage command may register when disabled");
  assert.equal(stubPi.commands.get("antigravity.models"), undefined, "no antigravity.models command may register when disabled");
  assert.equal(stubPi.commands.get("antigravity.doctor"), undefined, "no antigravity.doctor command may register when disabled");
  assert.ok(stubPi.providers.length >= 20, "pi-free base must still register");
});

test("entry omits opencode-zen when the seam disables only opencode-zen", async (t) => {
  const stubPi = await runUnifiedEntry(t, { SKILL_PI_DISABLE_PROVIDERS: "opencode-zen" });
  assert.equal(stubPi.providers.find((p) => p.id === "opencode-zen"), undefined, "opencode-zen must not register when disabled");
  assert.ok(stubPi.providers.find((p) => p.id === "antigravity"), "antigravity must still register when only opencode-zen is disabled");
  assert.ok(stubPi.handlers.get("message_end")?.length >= 2, "base message_end handlers must survive zen being disabled");
  assert.ok(stubPi.providers.length >= 20, "pi-free base must still register");
});

test("entry registers only the pi-free base when the seam disables both OAuth providers", async (t) => {
  const stubPi = await runUnifiedEntry(t, { SKILL_PI_DISABLE_PROVIDERS: "opencode-zen,antigravity" });
  assert.equal(stubPi.providers.find((p) => p.id === "opencode-zen"), undefined, "opencode-zen must not register when disabled");
  assert.equal(stubPi.providers.find((p) => p.id === "antigravity"), undefined, "antigravity must not register when disabled");
  assert.equal(stubPi.commands.get("antigravity"), undefined, "no antigravity command may register when disabled");
  assert.ok(stubPi.handlers.get("before_agent_start")?.length >= 2, "base handlers must survive both OAuth providers being disabled");
  assert.ok(
    stubPi.providers.length >= 20,
    `pi-free base must still register when both OAuth providers are disabled (got ${stubPi.providers.length})`,
  );
  assert.ok(stubPi.commands.has("toggle-free"), "pi-free base commands must survive the seam");
  assert.ok(stubPi.commands.has("pi-free-health"), "pi-free base diagnostics must survive the seam");
});
