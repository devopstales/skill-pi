import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { agentDirFor, ensureAgentDir, defaultPackages, seedDefaultPackages } from "../lib/config.js";
import { importAuth } from "../lib/auth.js";

test("agentDirFor honors SKILL_PI_AGENT_DIR", () => {
  process.env.SKILL_PI_AGENT_DIR = "/tmp/skillpi-agent-dir-test";
  assert.equal(agentDirFor(undefined), "/tmp/skillpi-agent-dir-test");
  assert.equal(agentDirFor("/explicit"), "/explicit");
  delete process.env.SKILL_PI_AGENT_DIR;
});

test("ensureAgentDir seeds settings, auth, and subdirs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed-"));
  await ensureAgentDir(dir);
  assert.ok(existsSync(join(dir, "settings.json")));
  assert.ok(existsSync(join(dir, "auth.json")));
  assert.ok(existsSync(join(dir, "sessions")));
  assert.ok(existsSync(join(dir, "prompts")));
  assert.ok(existsSync(join(dir, "themes")));
  assert.ok(existsSync(join(dir, "bin")));
});

test("ensureAgentDir seeds an empty packages array into settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed-pkgs-"));
  await ensureAgentDir(dir);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.ok(Array.isArray(settings.packages), "fresh settings must have a packages array");
  assert.equal(settings.packages.length, 0, "no default provider packages are seeded");
});

test("seedDefaultPackages is additive and idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed-pkgs2-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), '{"quietStartup":true,"packages":["npm:custom-provider"]}');
  seedDefaultPackages(dir);
  seedDefaultPackages(dir);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.ok(settings.packages.includes("npm:custom-provider"), "must keep existing packages");
  assert.equal(settings.quietStartup, true, "must preserve unrelated settings");
  assert.equal(settings.packages.length, 1, "no default packages added; user package untouched");
});

test("seedDefaultPackages leaves existing settings file untouched when complete", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed-pkgs3-"));
  const existing = { quietStartup: true, packages: [...defaultPackages] };
  const settingsPath = join(dir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify(existing, null, 2) + "\n");
  const before = readFileSync(settingsPath, "utf8");
  seedDefaultPackages(dir);
  assert.equal(readFileSync(settingsPath, "utf8"), before, "no rewrite when already complete");
});

test("ensureAgentDir does not overwrite existing settings", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed2-"));
  writeFileSync(join(dir, "settings.json"), '{"quietStartup": false}');
  await ensureAgentDir(dir);
  assert.equal(
    JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).quietStartup,
    false,
  );
});

test("ensureAgentDir quarantines unparseable settings.json and reseeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-corrupt-"));
  const settingsPath = join(dir, "settings.json");
  writeFileSync(settingsPath, '{"quietStartup": true,');
  await ensureAgentDir(dir);
  assert.ok(existsSync(join(dir, "settings.json.bak")), "corrupt file preserved as .bak");
  assert.equal(
    readFileSync(join(dir, "settings.json.bak"), "utf8"),
    '{"quietStartup": true,',
    "bak keeps the original bytes",
  );
  const fresh = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(fresh.quietStartup, true, "fresh seed keeps seeded shape");
});

test("ensureAgentDir quarantines schema-invalid settings.json and reseeds", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-badshape-"));
  const settingsPath = join(dir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ quietStartup: "yes" }));
  await ensureAgentDir(dir);
  assert.ok(existsSync(join(dir, "settings.json.bak")));
  const fresh = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.notEqual(fresh.quietStartup, "yes", "schema-invalid value must be replaced by the seed");
});

test("ensureAgentDir keeps a valid settings.json untouched", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-valid-"));
  const settingsPath = join(dir, "settings.json");
  const valid = {
    quietStartup: true,
    defaultModel: "qwen3.8-uncensored",
    defaultProvider: "vllm",
    packages: ["npm:pi-ollama"],
  };
  writeFileSync(settingsPath, JSON.stringify(valid, null, 2) + "\n");
  const before = readFileSync(settingsPath, "utf8");
  await ensureAgentDir(dir);
  assert.equal(readFileSync(settingsPath, "utf8"), before, "valid file byte-identical after ensure");
  assert.ok(!existsSync(join(dir, "settings.json.bak")));
});

test("ensureAgentDir quarantines a valid-object settings.json with wrong field types", async () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-badtype-"));
  const settingsPath = join(dir, "settings.json");
  writeFileSync(settingsPath, JSON.stringify({ defaultModel: 42 }));
  await ensureAgentDir(dir);
  assert.ok(existsSync(join(dir, "settings.json.bak")));
  const fresh = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.notEqual(fresh.defaultModel, 42);
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
