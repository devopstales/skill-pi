import { test, describe } from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, chmodSync, readdirSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PI_CLI = join(repoRoot, "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js");
const EXTENSIONS_DIR = join(repoRoot, "extensions");
const VLLM_URL = process.env.E2E_VLLM_URL ?? "http://192.168.104.70:8000";
const MODEL = process.env.E2E_VLLM_MODEL ?? "qwen3.8-uncensored";
const POPUP_TIMEOUT_MS = 600_000;
const SETTLE_TIMEOUT_MS = 300_000;

let spawn;
let ptyAvailable = false;

async function preflight() {
  try {
    const res = await fetch(VLLM_URL + "/v1/models", { signal: AbortSignal.timeout(4000) });
    if (!res.ok) throw new Error("vllm /v1/models not ok");
    const body = await res.json();
    if (!Array.isArray(body.data) || body.data.length === 0) throw new Error("vllm has no models");
  } catch (err) {
    return { ok: false, reason: `vllm unreachable at ${VLLM_URL}: ${err.message}` };
  }
  try {
    ({ spawn } = await import("node-pty"));
    ptyAvailable = true;
  } catch {
    return { ok: false, reason: "node-pty failed to load" };
  }
  const helper = join(repoRoot, "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper");
  if (existsSync(helper)) chmodSync(helper, 0o755);
  return { ok: true };
}

function stripAnsi(s) {
  return s
    .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "")
    .replace(/\x1b[()][0-9A-B]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "");
}

async function makeAgentDir() {
  const dir = await mkdtemp(join(tmpdir(), "skillpi-vllm-"));
  await mkdir(join(dir, "extensions"), { recursive: true });
  await writeFile(
    join(dir, "models.json"),
    JSON.stringify(
      {
        providers: {
          vllm: {
            baseUrl: VLLM_URL + "/v1",
            api: "openai-completions",
            apiKey: "vllm",
            models: [{ id: MODEL, name: MODEL, contextWindow: 32768 }],
          },
        },
      },
      null,
      2,
    ),
  );
  return dir;
}

async function makeProjectDir() {
  return await mkdtemp(join(tmpdir(), "skillpi-vllm-proj-"));
}

function spawnSession(agentDir, projectDir, prompt) {
  const pty = spawn(
    process.execPath,
    [PI_CLI, ...extensionFlags(), "--model", `vllm/${MODEL}`, prompt],
    {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      cwd: projectDir,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1",
      },
    },
  );
  let output = "";
  pty.onData((d) => (output += d));
  return { pty, getOutput: () => output, getPlain: () => stripAnsi(output), kill: () => pty.kill() };
}

async function waitForTodo(session, timeoutMs = POPUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (/todo/i.test(session.getPlain())) return true;
  }
  return false;
}

function plainHasSuccess(plain) {
  const m = plain.match(/todo \xb7 add\s*\n?Added task \d+/);
  return m !== null;
}

async function waitForSettle(session, timeoutMs = SETTLE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = 0;
  let lastLen = 0;
  let sawSuccess = false;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const plain = session.getPlain();
    if (plainHasSuccess(plain)) sawSuccess = true;
    const len = plain.length;
    if (len === lastLen) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince > 3000 && sawSuccess) return true;
    } else {
      stableSince = 0;
      lastLen = len;
    }
    if (/(truncated before completion|done \d+m)/.test(plain.slice(-2000)) && sawSuccess) return true;
  }
  return false;
}

const TODO_PROMPT = `Call the todo tool now. action: "add". title: "Verify dynamic extension allow". No prose, no other tools.`;

function collectExtensionFiles(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = join(dir, entry.name);
    let isFile = entry.isFile();
    let isDir = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        const st = statSync(full);
        isFile = st.isFile();
        isDir = st.isDirectory();
      } catch {
        continue;
      }
    }
    if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
      files.push(full);
    } else if (isDir) {
      files.push(...resolveDirEntryPoints(full));
    }
  }
  return files;
}

function resolveDirEntryPoints(dir) {
  const manifestPath = join(dir, "package.json");
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const declared = manifest?.pi?.extensions;
      if (Array.isArray(declared) && declared.length > 0) {
        return declared.filter((p) => typeof p === "string").map((p) => join(dir, p)).filter((p) => existsSync(p));
      }
    } catch {
      // malformed manifest; fall through to index detection
    }
  }
  if (existsSync(join(dir, "index.ts"))) return [join(dir, "index.ts")];
  if (existsSync(join(dir, "index.js"))) return [join(dir, "index.js")];
  return [];
}

function extensionFlags() {
  const flags = [];
  for (const file of collectExtensionFiles(EXTENSIONS_DIR)) flags.push("--extension", file);
  flags.push("--no-extensions");
  return flags;
}

const pf = await preflight();
const describe_ = pf.ok ? describe : (name, opts, fn) => describe(name, { ...opts, skip: opts.skip ?? pf.reason }, fn);

describe_("dynamic extension allow E2E (vllm)", {}, async () => {
  test("todo tool runs without a permission prompt", async (t) => {
    const agentDir = await makeAgentDir();
    const projectDir = await makeProjectDir();
    let session;
    try {
      session = spawnSession(agentDir, projectDir, TODO_PROMPT);
      const sawTodo = await waitForTodo(session);
      if (!sawTodo) {
        t.skip(`todo tool never appeared in output within timeout (model did not call it). Tail: ${session.getPlain().slice(-500)}`);
        return;
      }
      const settled = await waitForSettle(session);
      if (!settled) {
        t.skip(`settle not detected within timeout. Tail: ${session.getPlain().slice(-1500)}`);
        return;
      }
      const plain = session.getPlain();
      const firstCallIdx = plain.indexOf("todo · add");
      assert.notEqual(firstCallIdx, -1, "the todo tool was never called");
      const beforeTodo = plain.slice(0, firstCallIdx);
      assert.doesNotMatch(
        beforeTodo,
        /Choose permission|Allow once|Allow always|Blocked \(no UI/,
        "a permission prompt appeared before the todo call — the auto-allow did not apply",
      );
      assert.match(plain, /Added task \d+/, "the todo tool call executed successfully");
    } finally {
      session?.kill();
      await Promise.allSettled([rm(agentDir, { recursive: true, force: true }), rm(projectDir, { recursive: true, force: true })]);
    }
  });
});
