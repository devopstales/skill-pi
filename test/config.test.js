import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentDirFor, ensureAgentDir } from "../lib/config.js";
import { importAuth } from "../lib/auth.js";

test("agentDirFor honors SKILL_PI_AGENT_DIR", () => {
  process.env.SKILL_PI_AGENT_DIR = "/tmp/skillpi-agent-dir-test";
  assert.equal(agentDirFor(undefined), "/tmp/skillpi-agent-dir-test");
  assert.equal(agentDirFor("/explicit"), "/explicit");
  delete process.env.SKILL_PI_AGENT_DIR;
});

test("ensureAgentDir seeds settings, auth, and subdirs", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed-"));
  ensureAgentDir(dir);
  assert.ok(existsSync(join(dir, "settings.json")));
  assert.ok(existsSync(join(dir, "auth.json")));
  assert.ok(existsSync(join(dir, "sessions")));
  assert.ok(existsSync(join(dir, "prompts")));
  assert.ok(existsSync(join(dir, "themes")));
  assert.ok(existsSync(join(dir, "bin")));
});

test("ensureAgentDir does not overwrite existing settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed2-"));
  writeFileSync(join(dir, "settings.json"), '{"quietStartup": false}');
  ensureAgentDir(dir);
  assert.equal(
    JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).quietStartup,
    false,
  );
});

test("importAuth copies auth.json and models.json", () => {
  const src = mkdtempSync(join(tmpdir(), "skillpi-auth-src-"));
  const dst = mkdtempSync(join(tmpdir(), "skillpi-auth-dst-"));
  writeFileSync(join(src, "auth.json"), '{"anthropic":"sk-ant-x"}');
  writeFileSync(join(src, "models.json"), '{"providers":{}}');
  importAuth(src, dst);
  assert.ok(existsSync(join(dst, "auth.json")));
  assert.ok(existsSync(join(dst, "models.json")));
});

test("importAuth throws without auth.json", () => {
  const src = mkdtempSync(join(tmpdir(), "skillpi-auth-empty-"));
  assert.throws(() => importAuth(src, "/tmp/should-not-matter"), /auth\.json/);
});
