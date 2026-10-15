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
