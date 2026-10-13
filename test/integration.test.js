import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const pkgRoot = dirname(fileURLToPath(import.meta.url));
const bin = join(pkgRoot, "..", "bin", "skill-pi.js");

// Strip provider credentials/models from the environment so tests don't
// accidentally make real API calls when a model is resolvable.
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (/ANTHROPIC|OPENAI|GEMINI|GOOGLE|GROQ|MISTRAL|OPENROUTER|TOGETHER|DEEPSEEK|XAI|CLOUDFLARE|AWS_|BEDROCK|AZURE|OLLAMA|LM_|LLAMA|API_KEY|LLM_|^OPENAI|_API_KEY|PROVIDER/i.test(key)) {
      delete env[key];
    }
  }
  return env;
}

function run(args, env = {}) {
  return spawnSync("node", [bin, ...args], {
    encoding: "utf8",
    env: cleanEnv(env),
  });
}

test("--version prints versions without side effects", () => {
  const r = run(["--version"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skill-pi 0\.\d+\.\d+ \(wraps pi-coding-agent \d+\.\d+\.\d+\)/);
});

test("--help prints usage and exits 0", () => {
  const r = run(["--help"]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skill-pi — isolated pi-based coding agent/);
  assert.match(r.stdout, /--import-auth/);
});

test("--print launches pi in print mode with isolated agent dir", () => {
  const agentDir = mkdtempSync(join(tmpdir(), "skillpi-it-agent-"));
  const r = run(["/tmp", "--print", "unused", "--model", "openai/gpt-4o-mini"], {
    SKILL_PI_AGENT_DIR: agentDir,
    SKILL_PI_WORK_DIR: mkdtempSync(join(tmpdir(), "skillpi-it-work-")),
    HOME: process.env.HOME,
  });
  // No API key for the forced model: pi must fail with its own message,
  // proving the wrapper wired up the launch correctly.
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No API key found|authentication|login/i);
  assert.ok(existsSync(join(agentDir, "settings.json")), "agent dir must be seeded");
  assert.ok(existsSync(join(agentDir, "auth.json")), "auth.json must be seeded");
});

test("pi help output is branded skill-pi (loader hooks active)", () => {
  const home = mkdtempSync(join(tmpdir(), "skillpi-hint-home-"));
  const r = run(["/tmp", "--", "--help"], { HOME: home });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^skill-pi - AI coding assistant/m);
  assert.doesNotMatch(r.stdout, /^pi - AI coding assistant/m);
});
