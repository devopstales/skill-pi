import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const REAL_HOME_PI = join(homedir(), ".pi");

// The pi-free base schedules an unref'd 1500ms telemetry debounce and a
// session-start timer; unref everything so the runner is never held open.
function unrefTimers(t) {
  const origTimeout = globalThis.setTimeout;
  t.after(() => {
    globalThis.setTimeout = origTimeout;
  });
  globalThis.setTimeout = (fn, ms, ...rest) => {
    const timer = origTimeout(fn, ms, ...rest);
    if (typeof timer === "object" && timer !== null && typeof timer.unref === "function") timer.unref();
    return timer;
  };
}

function makeStubPi() {
  return {
    providers: [],
    commands: new Map(),
    handlers: new Map(),
    registerProvider(providerOrId, config) {
      this.providers.push(typeof providerOrId === "string" ? { id: providerOrId, config } : providerOrId);
    },
    on(event, handler) {
      const list = this.handlers.get(event) ?? [];
      list.push(handler);
      this.handlers.set(event, list);
      return () => {
        const l = this.handlers.get(event);
        if (l) l.splice(l.indexOf(handler), 1);
      };
    },
    registerCommand(name, options) {
      this.commands.set(name, options);
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
}

// Seed a pre-existing tree under REAL_HOME_PI and capture every entry so the
// "nothing new may appear" assertion cannot be fooled by unrelated writers.
function baselineTree(dir) {
  if (!existsSync(dir)) return [];
  const entries = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else entries.push(p);
    }
  };
  walk(dir);
  return entries;
}

// SATISFIES happy path state-confined-to-agent-dir
// G3 CHECK: node --test test/providers.separation.test.js  EXPECT: 0 fail
// Under a temp PI_CODING_AGENT_DIR every state path the extension owns must
// resolve under that dir — nothing may land under ~/.pi. pi-free resolves its
// data dir (free.json / free.log / free-telemetry.json) through PI_DATA_DIR;
// antigravity's account store and pi's own auth store live under the agent dir.
test("state paths are confined to PI_CODING_AGENT_DIR, nothing is written under ~/.pi", async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-separation-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));
  unrefTimers(t);

  const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  const priorPiFreeOnly = process.env.PI_FREE_ONLY;
  const priorPiFreeLog = process.env.PI_FREE_FILE_LOG;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  process.env.PI_FREE_ONLY = "true";
  process.env.PI_FREE_FILE_LOG = "false";
  try {
    const baseline = baselineTree(REAL_HOME_PI);
    // jiti caches modules under its internal registry (not the ESM loader),
    // so re-importing after the entry runs reflects the env in effect now —
    // including the PI_CODING_AGENT_DIR set just above.
    const jiti = require("jiti").createJiti(pathToFileURL(join(repoRoot, "test")).href, {
      interopDefault: true,
      tryNative: true,
      tsconfigPaths: true,
    });
    const stub = makeStubPi();
    const mod = await jiti.import(pathToFileURL(join(repoRoot, "extensions", "providers", "index.ts")).href);
    await mod.default(stub);

    const paths = await jiti.import(pathToFileURL(join(repoRoot, "extensions", "providers", "pi-free", "dist", "lib", "paths.js")).href);
    const telemetry = await jiti.import(pathToFileURL(join(repoRoot, "extensions", "providers", "pi-free", "dist", "lib", "telemetry.js")).href);
    const config = await jiti.import(pathToFileURL(join(repoRoot, "extensions", "providers", "pi-free", "dist", "config.js")).href);
    const store = await jiti.import(pathToFileURL(join(repoRoot, "extensions", "providers", "antigravity", "src", "accounts", "store.ts")).href);

    const statePaths = [
      ["PI_DATA_DIR", paths.PI_DATA_DIR],
      ["free.json", paths.resolveSafeDataFile(undefined, "free.json")],
      ["free.log", paths.resolveSafeDataFile(undefined, "free.log")],
      ["telemetry", telemetry.getTelemetryPath()],
      ["antigravity auth store", store.getAuthFilePath()],
    ];
    for (const [label, p] of statePaths) {
      const rel = relative(agentDir, p);
      const inside = rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep));
      assert.ok(inside, `state path (${label}) ${p} must resolve under the temp agent dir ${agentDir} (relative: ${rel})`);
      assert.ok(!p.startsWith(REAL_HOME_PI + sep), `state path (${label}) ${p} must not land under ${REAL_HOME_PI}`);
    }
    assert.equal(config.getFreeOnly(), true, "PI_FREE_ONLY must still be honored through the agent-dir config");
    assert.ok(existsSync(join(agentDir, "free.json")), "pi-free's free.json must be created under the agent dir");
    assert.ok(!existsSync(join(REAL_HOME_PI, "free.json")) || baseline.includes(join(REAL_HOME_PI, "free.json")), "no new free.json may appear under ~/.pi");

    const after = baselineTree(REAL_HOME_PI);
    const newFiles = after.filter((p) => !baseline.includes(p));
    assert.deepEqual(newFiles, [], `no new file may appear under ${REAL_HOME_PI}: ${newFiles.join(", ")}`);
  } finally {
    if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
    if (priorPiFreeOnly === undefined) delete process.env.PI_FREE_ONLY;
    else process.env.PI_FREE_ONLY = priorPiFreeOnly;
    if (priorPiFreeLog === undefined) delete process.env.PI_FREE_FILE_LOG;
    else process.env.PI_FREE_FILE_LOG = priorPiFreeLog;
  }
});

// SATISFIES failure hardcoded-home-write-detected
// G4 CHECK: node --test test/providers.separation.test.js  EXPECT: 0 fail
// A vendored write that targets a literal home path must be detected: with no
// agent-dir env, pi-free's data dir defaults to join(homedir(), ".pi"), and the
// confinement assertion (same predicate as the happy path) must fail for it.
test("a hardcoded ~/.pi data dir is detected as a write outside the agent dir", async (t) => {
  unrefTimers(t);
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-separation-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));

  const priorAgentDir = process.env.PI_CODING_AGENT_DIR;
  try {
    delete process.env.PI_CODING_AGENT_DIR;
    const { createJiti } = await import("jiti");
    const jiti = createJiti(pathToFileURL(join(repoRoot, "test")).href, {
      interopDefault: true,
      tryNative: true,
      tsconfigPaths: true,
    });
    const paths = await jiti.import(pathToFileURL(join(repoRoot, "extensions", "providers", "pi-free", "dist", "lib", "paths.js")).href);
    const dataDir = paths.resolveDataDir();
    assert.equal(dataDir, join(homedir(), ".pi"), "without PI_CODING_AGENT_DIR the default data dir is the literal ~/.pi home path");
    const confined = dataDir === agentDir || dataDir.startsWith(agentDir + sep);
    assert.equal(confined, false, "the confinement check must flag a literal ~/.pi path as a write outside the agent dir");
  } finally {
    if (priorAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = priorAgentDir;
  }
});
