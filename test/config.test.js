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

test("ensureAgentDir seeds default packages into settings", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed-pkgs-"));
  ensureAgentDir(dir);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.ok(Array.isArray(settings.packages), "fresh settings must register default packages");
  for (const pkg of defaultPackages) {
    assert.ok(settings.packages.includes(pkg), `missing default package ${pkg}`);
  }
});

test("seedDefaultPackages is additive and idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "skillpi-seed-pkgs2-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), '{"quietStartup":true,"packages":["npm:custom-provider"]}');
  seedDefaultPackages(dir);
  seedDefaultPackages(dir);
  const settings = JSON.parse(readFileSync(join(dir, "settings.json"), "utf8"));
  assert.ok(settings.packages.includes("npm:custom-provider"), "must keep existing packages");
  for (const pkg of defaultPackages) {
    assert.ok(settings.packages.includes(pkg), `missing default package ${pkg}`);
  }
  assert.equal(settings.quietStartup, true, "must preserve unrelated settings");
  assert.equal(
    settings.packages.filter((p) => p === defaultPackages[0]).length,
    1,
    "idempotent: a default package appears exactly once",
  );
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
