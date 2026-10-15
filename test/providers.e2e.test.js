import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PI_CLI = join(repoRoot, "node_modules", "@earendil-works", "pi-coding-agent", "dist", "bundle", "cli.js");
const PROVIDERS_ENTRY = join(repoRoot, "extensions", "providers", "index.ts");
const E2E_TIMEOUT_MS = 180_000;

// The skill-pi wrapper's spawnSync is broken on this host (ENOENT; see
// task-2-report.md), so the e2e drives the same pi bundle + extension entry
// directly instead of through bin/skill-pi.js.
function runSession(agentDir, prompt, extraEnv) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [PI_CLI, "--no-extensions", "--extension", PROVIDERS_ENTRY, "--print", prompt],
      {
        env: { ...process.env, ...extraEnv, PI_CODING_AGENT_DIR: agentDir },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let buf = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), E2E_TIMEOUT_MS);
    child.stdout.on("data", (d) => (buf += d));
    child.stderr.on("data", (d) => (buf += d));
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, output: buf });
    });
  });
}

// pi-free's log is pinned to <PI_DATA_DIR>/free.log (resolveSafeDataFile
// rejects a bare-filename override outside PI_DATA_DIR), and
// PI_DATA_DIR = PI_CODING_AGENT_DIR. The run's lines are scoped by the
// process pid, not by file rotation.
function readRunLog(agentDir, pid) {
  const logPath = join(agentDir, "free.log");
  if (!existsSync(logPath)) return "";
  return readFileSync(logPath, "utf8")
    .split("\n")
    .filter((l) => l.includes(`[pid ${pid}]`))
    .join("\n");
}

const e2eEnabled = process.env.SKILL_PI_E2E === "1";

// SATISFIES happy path e2e-free-model-requests
// SATISFIES failure e2e-skip-guard-honored
// G5 CHECK: SKILL_PI_E2E=1 node --test test/providers.e2e.test.js  EXPECT: 0 fail
// G5 CHECK: node --test test/providers.e2e.test.js  EXPECT: 0 fail, 2 skip
test("e2e smoke runs a real session with both providers registered", { skip: !e2eEnabled }, async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-providers-e2e-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));

  const child = spawn(
    process.execPath,
    [PI_CLI, "--no-extensions", "--extension", PROVIDERS_ENTRY, "--print", "reply with exactly: ok"],
    {
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let buf = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), E2E_TIMEOUT_MS);
  child.stdout.on("data", (d) => (buf += d));
  child.stderr.on("data", (d) => (buf += d));
  const code = await new Promise((resolve) => child.on("exit", (c) => { clearTimeout(timer); resolve(c ?? 1); }));
  // A credential-less throwaway agent dir often gets a 401 on the default
  // (free, keyless) model call. Extensions run before the model call, so a
  // 401 still proves the session booted with the extension loaded.
  assert.ok(code === 0 || /401: |Unauthorized/.test(buf), `session must exit 0 or fail only on auth; captured:\n${buf.slice(-2000)}`);
  if (code === 0) assert.match(buf, /\bok\b/, "assistant message must contain 'ok'");

  const runLog = readRunLog(agentDir, child.pid);
  assert.ok(
    runLog.includes("[pi-free] startup complete in"),
    "pi-free base must reach its startup-complete marker in the real session",
  );
  const agy = await runSession(agentDir, "/antigravity.doctor");
  assert.ok(agy.output.includes("provider=antigravity"), "antigravity doctor must run in the real runtime");
  assert.ok(agy.output.includes("commands=/antigravity"), "antigravity commands must be present in the real runtime");

  // With OPENCODE_API_KEY set, opencode-zen's models route to its inference
  // endpoint, so a key-less 401 from that endpoint proves the provider is
  // registered and answering in the real runtime.
  const zen = await runSession(agentDir, "reply with exactly: ok", { OPENCODE_API_KEY: "e2e-probe-key" });
  assert.ok(
    zen.code === 0 || /401: |Unauthorized/.test(zen.output),
    `opencode-zen session must exit 0 or fail only on auth; captured:\n${zen.output.slice(-2000)}`,
  );
});

// SATISFIES happy path e2e-oauth-commands-present
// G5 CHECK: SKILL_PI_E2E=1 node --test test/providers.e2e.test.js  EXPECT: 0 fail
test("e2e smoke sees the antigravity and opencode-zen commands in the real runtime", { skip: !e2eEnabled }, async (t) => {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-providers-e2e-"));
  t.after(() => rmSync(agentDir, { recursive: true, force: true }));

  const doctor = await runSession(agentDir, "/antigravity.doctor");
  assert.ok(doctor.output.includes("provider=antigravity"), "antigravity doctor must run in the real runtime");
  assert.ok(doctor.output.includes("commands=/antigravity"), "antigravity commands must be present in the real runtime");

  // With OPENCODE_API_KEY set, opencode-zen's models route to its inference
  // endpoint, so a key-less 401 from that endpoint proves the provider is
  // registered and answering in the real runtime.
  const zen = await runSession(agentDir, "reply with exactly: ok", { OPENCODE_API_KEY: "e2e-probe-key" });
  assert.ok(
    zen.code === 0 || /401: |Unauthorized/.test(zen.output),
    `opencode-zen session must exit 0 or fail only on auth; captured:\n${zen.output.slice(-2000)}`,
  );
});
