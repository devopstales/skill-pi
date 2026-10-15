import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const NODE_MODULES = join(repoRoot, "node_modules");

// Permissive stub of pi's ExtensionAPI: records the registration calls the
// acceptance scenario asserts on, no-ops everything else. `events.on` returns
// an unsubscribe, matching pi's real API.
function makeStubPi(failNextNativeRegistration = false) {
  const stub = {
    providers: [],
    commands: new Map(),
    tools: new Map(),
    handlers: new Map(),
    failNextNativeRegistration,
    registerProvider(providerOrName, config) {
      if (stub.failNextNativeRegistration) {
        stub.failNextNativeRegistration = false;
        throw new Error("injected registerProvider failure");
      }
      if (typeof providerOrName === "string") stub.providers.push({ id: providerOrName, config });
      else stub.providers.push({ id: providerOrName?.id, provider: providerOrName });
    },
    registerCommand(name, options) {
      stub.commands.set(name, options);
    },
    registerTool(tool) {
      stub.tools.set(tool.name, tool);
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
    registerShortcut() {},
    registerFlag() {},
    registerMcpServer() {},
    registerVirtualModel() {},
    getFlag() {},
    getSettings() {
      return {};
    },
    setModel() {},
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
      return [...stub.commands.values()];
    },
  };
  return stub;
}

// SATISFIES happy path unified-extension-loads-base
// G1 CHECK: node --test test/providers.load.test.js  EXPECT: 0 fail
// The entry loads the base without an import error and registers its
// providers + diagnostic commands.
test("unified extension entry loads the pi-free base against a stub runtime", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-providers-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const basePath = pathToFileURL(join(repoRoot, "extensions", "providers", "pi-free", "base.js")).href;
  const { base } = await import(basePath);
  assert.equal(typeof base, "function", "base shim must re-export the pi-free entry");

  const stubPi = makeStubPi();
  await base(stubPi);

  assert.ok(
    stubPi.providers.length >= 20,
    `expected >= 20 providers registered, got ${stubPi.providers.length}`,
  );
  assert.ok(stubPi.commands.has("toggle-free"), "command /toggle-free must be registered");
  assert.ok(stubPi.commands.has("pi-free-health"), "command /pi-free-health must be registered");
});

// SATISFIES failure base-missing-dep-fails-loudly
// G3 CHECK: node --test test/providers.load.test.js  EXPECT: 0 fail
// With a required runtime dep absent from node_modules, the base import fails
// with a module-resolution error naming the dependency, not a silent no-op.
test("base import fails loudly when a runtime dep is absent", async (t) => {
  assert.ok(existsSync(join(NODE_MODULES, "@earendil-works", "pi-ai")), "precondition: pi-ai is hoisted into the root node_modules");
  const shadowRoot = mkdtempSync(join(tmpdir(), "skillpi-shadow-"));
  // The base's runtime dep is @earendil-works/pi-ai (allow-listed subpath
  // compat). A child process with no node_modules above its loader and a
  // HOME that has no pi install cannot resolve the bare specifier: the
  // walk-up, home, and exec probes all miss, so the import rejects with a
  // module-resolution error naming the dependency.
  const shadowNpm = join(shadowRoot, "node_modules");
  mkdirSync(shadowNpm, { recursive: true });
  t.after(() => rmSync(shadowRoot, { recursive: true, force: true }));

  const loader = join(shadowRoot, "loader.mjs");
  writeFileSync(
    loader,
    `try { await import("@earendil-works/pi-ai/compat"); }\n` +
      `catch (err) { console.error(String(err.code ?? "")); console.error(err.message); process.exit(3); }\n` +
      `console.error("LOADED"); process.exit(0);\n`,
  );
  const r = spawnSync(process.execPath, [loader], {
    cwd: shadowRoot,
    encoding: "utf8",
    env: { ...process.env, HOME: shadowRoot },
  });
  const text = `${r.stderr ?? ""} ${r.stdout ?? ""}`;
  assert.notEqual(r.status, 0, "base import must fail when a runtime dep is absent");
  assert.match(text, /ERR_MODULE_NOT_FOUND|ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find package/, "must be a module-resolution error");
  assert.match(text, /pi-ai/, "error must name the missing dependency");
});

// SATISFIES edge base-setup-failure-degrades-not-kills
// G2 CHECK: node --test test/providers.load.test.js  EXPECT: 0 fail
// A rejected provider setup must not abort the rest of the base loading; the
// entry still returns and the remaining provider setups still run.
test("one rejected provider setup does not abort the base", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-providers-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  process.env.PI_CODING_AGENT_DIR = agentDir;

  const basePath = pathToFileURL(join(repoRoot, "extensions", "providers", "pi-free", "base.js")).href;
  const { base } = await import(basePath);

  // Reject the first provider setup (a native pi.registerProvider call) and
  // let the rest proceed: the base must absorb the rejection and finish.
  const stubPi = makeStubPi(true);
  await assert.doesNotReject(() => base(stubPi));
  assert.ok(
    stubPi.providers.length >= 20,
    `remaining provider setups must still run (>= 20 registered, got ${stubPi.providers.length})`,
  );
  assert.ok(stubPi.commands.has("toggle-free"), "global commands must survive a rejected provider setup");
  assert.ok(stubPi.commands.has("pi-free-health"), "diagnostic commands must survive a rejected provider setup");
});
