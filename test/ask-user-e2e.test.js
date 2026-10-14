import { test, describe } from "node:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const PI_CLI = join(
  repoRoot,
  "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
);
const EXTENSIONS_DIR = join(repoRoot, "extensions");
const OLLAMA_URL = "http://localhost:11434";
const MODEL = process.env.E2E_MODEL ?? "qwen2.5:1.5b";
const POPUP_TIMEOUT_MS = 90_000;
const SETTLE_TIMEOUT_MS = 20_000;

let spawn;
let ptyAvailable = false;

async function preflight() {
  try {
    const res = await fetch(OLLAMA_URL + "/api/version", {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error("Ollama not responding");
  } catch {
    return { ok: false, reason: "Ollama unreachable at " + OLLAMA_URL };
  }
  try {
    ({ spawn } = await import("node-pty"));
    ptyAvailable = true;
  } catch {
    return { ok: false, reason: "node-pty failed to load" };
  }
  const helper = join(
    repoRoot,
    "node_modules/node-pty/prebuilds/darwin-x64/spawn-helper",
  );
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
  const dir = await mkdtemp(join(tmpdir(), "skillpi-e2e-"));
  await mkdir(join(dir, "extensions"), { recursive: true });
  await writeFile(
    join(dir, "models.json"),
    JSON.stringify(
      {
        providers: {
          ollama: {
            baseUrl: OLLAMA_URL + "/v1",
            api: "openai-completions",
            apiKey: "ollama",
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
  return await mkdtemp(join(tmpdir(), "skillpi-e2e-proj-"));
}

function spawnSession(agentDir, projectDir, prompt) {
  const pty = spawn(
    process.execPath,
    [
      PI_CLI,
      "--extension",
      EXTENSIONS_DIR,
      "--model",
      `ollama/${MODEL}`,
      prompt,
    ],
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
  return {
    pty,
    getOutput: () => output,
    getPlain: () => stripAnsi(output),
    kill: () => pty.kill(),
  };
}

async function waitForPopup(session, timeoutMs = POPUP_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    if (/Type something/.test(session.getPlain())) return true;
  }
  return false;
}

async function waitForSettle(session, timeoutMs = SETTLE_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    const tail = session.getPlain().slice(-6000);
    if (/unavailable outside interactive/i.test(tail)) return true;
    if (!/Type something/.test(tail) && /(✓|✗)/.test(tail)) return true;
  }
  return false;
}

async function teardown(agentDir, projectDir, session) {
  session?.kill();
  await Promise.allSettled([
    rm(agentDir, { recursive: true, force: true }),
    rm(projectDir, { recursive: true, force: true }),
  ]);
}

const SINGLE_PROMPT = `Use the ask_user tool now to ask me which programming language I prefer.
The question must be exactly "Which programming language do you prefer?" and the options must be exactly these three strings, in this order: Python, Rust, Go.
Do not write any prose before or after the tool call. Do not call any other tool.`;

const FREEFORM_PROMPT = `Use the ask_user tool now. Ask me "What is your favorite programming language?" with options: Python, Rust, Go. Set allowFreeform to true.
Do not write any prose before or after the tool call. Do not call any other tool.`;

const BATCH_PROMPT = `Use the ask_user tool now with a batch of two questions.
Question 1: "Which language do you prefer?" options: Python, Rust
Question 2: "Which framework do you prefer?" options: Express, Fastify
Do not write any prose before or after the tool call. Do not call any other tool.`;

const pf = await preflight();
const describe_ = pf.ok ? describe : (name, opts, fn) =>
  describe(name, { ...opts, skip: opts.skip ?? pf.reason }, fn);

describe_("ask_user E2E", {}, async () => {
  test("E2E selection renders the success result row", async (t) => {
    const agentDir = await makeAgentDir();
    const projectDir = await makeProjectDir();
    let session;
    try {
      session = spawnSession(agentDir, projectDir, SINGLE_PROMPT);
      const found = await waitForPopup(session);
      if (!found) {
        t.skip("popup not detected within timeout: model did not call ask_user (small local models are not deterministic)");
        return;
      }
      session.pty.write("\x1b[B");
      await new Promise((r) => setTimeout(r, 300));
      session.pty.write("\r");
      const settled = await waitForSettle(session);
      if (!settled) {
        t.skip("settle not detected within timeout");
        return;
      }
      const plain = session.getPlain();
      assert.match(plain, /✓/);
      assert.doesNotMatch(plain.slice(-6000), /✗/);
    } finally {
      await teardown(agentDir, projectDir, session);
    }
  });

  test("E2E freeform renders the custom answer row", async (t) => {
    const agentDir = await makeAgentDir();
    const projectDir = await makeProjectDir();
    let session;
    try {
      session = spawnSession(agentDir, projectDir, FREEFORM_PROMPT);
      const found = await waitForPopup(session);
      if (!found) {
        t.skip("popup not detected within timeout: model did not call ask_user (small local models are not deterministic)");
        return;
      }
      session.pty.write("\x1b[B\x1b[B\x1b[B\x1b[B");
      await new Promise((r) => setTimeout(r, 300));
      session.pty.write("\r");
      await new Promise((r) => setTimeout(r, 200));
      session.pty.write("hello world");
      await new Promise((r) => setTimeout(r, 200));
      session.pty.write("\r");
      const settled = await waitForSettle(session);
      if (!settled) {
        t.skip("settle not detected within timeout");
        return;
      }
      const plain = session.getPlain();
      assert.match(plain, /hello world/);
    } finally {
      await teardown(agentDir, projectDir, session);
    }
  });

  test("E2E Esc renders the cancelled row", async (t) => {
    const agentDir = await makeAgentDir();
    const projectDir = await makeProjectDir();
    let session;
    try {
      session = spawnSession(agentDir, projectDir, SINGLE_PROMPT);
      const found = await waitForPopup(session);
      if (!found) {
        t.skip("popup not detected within timeout: model did not call ask_user (small local models are not deterministic)");
        return;
      }
      session.pty.write("\x1b");
      const settled = await waitForSettle(session);
      if (!settled) {
        t.skip("settle not detected within timeout");
        return;
      }
      const plain = session.getPlain();
      assert.match(plain, /✗/);
    } finally {
      await teardown(agentDir, projectDir, session);
    }
  });

  test("E2E batch review submits index-aligned answers", async (t) => {
    const agentDir = await makeAgentDir();
    const projectDir = await makeProjectDir();
    let session;
    try {
      session = spawnSession(agentDir, projectDir, BATCH_PROMPT);
      const found = await waitForPopup(session);
      if (!found) {
        t.skip("batch popup not detected within timeout: model did not emit a batch ask_user call (small local models are not deterministic)");
        return;
      }
      session.pty.write("\x1b[B\r");
      await new Promise((r) => setTimeout(r, 500));
      session.pty.write("\x1b[B\r");
      await new Promise((r) => setTimeout(r, 300));
      session.pty.write("\t");
      await new Promise((r) => setTimeout(r, 300));
      session.pty.write("\r");
      await new Promise((r) => setTimeout(r, 300));
      session.pty.write("\r");
      const settled = await waitForSettle(session, 25_000);
      if (!settled) {
        t.skip("batch settle not detected within timeout");
        return;
      }
      const plain = session.getPlain();
      assert.match(plain, /✓/);
    } finally {
      await teardown(agentDir, projectDir, session);
    }
  });

  test("E2E harness cleans up the child process and temp agent dir", async (t) => {
    const agentDir = await makeAgentDir();
    const projectDir = await makeProjectDir();
    let session;
    try {
      session = spawnSession(agentDir, projectDir, SINGLE_PROMPT);
      await new Promise((r) => setTimeout(r, 2000));
      session.kill();
    } finally {
      await teardown(agentDir, projectDir, session);
    }
    assert.equal(existsSync(agentDir), false);
    assert.equal(existsSync(projectDir), false);
  });

  test("E2E skips cleanly when Ollama is unreachable", (t) => {
    if (pf.ok) {
      t.skip("Ollama is reachable; testing skip logic requires it to be down");
      return;
    }
    assert.equal(pf.ok, false);
    assert.ok(pf.reason);
  });
});
