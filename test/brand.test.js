import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { brandOverlayDir, brandEnv } from "../lib/brand.js";

test("brandOverlayDir re-exports the real pi package with piConfig.name=skill-pi + configDir=.skill-pi", () => {
  const overlay = brandOverlayDir(mkdtempSync(join(tmpdir(), "skillpi-brand-")));
  const pkg = JSON.parse(readFileSync(join(overlay, "package.json"), "utf8"));
  assert.equal(pkg.piConfig?.name, "skill-pi");
  assert.equal(pkg.piConfig?.configDir, ".skill-pi");
  // Re-exported fields (not a bare {piConfig} file)
  assert.equal(pkg.name, "@earendil-works/pi-coding-agent");
  assert.match(String(pkg.version), /^\d+\.\d+\.\d+/);
});

test("brandOverlayDir makes pi's theme path resolve (no dark.json ENOENT)", () => {
  const overlay = brandOverlayDir(mkdtempSync(join(tmpdir(), "skillpi-brand-")));
  const theme = join(overlay, "dist", "modes", "interactive", "theme", "dark.json");
  assert.ok(existsSync(theme), `dark.json resolvable through overlay: ${theme}`);
});

test("brandEnv pins PI_CODING_AGENT_DIR to the PI base despite the rename", () => {
  const env = brandEnv("/tmp/agent");
  assert.equal(env.PI_CODING_AGENT_DIR, "/tmp/agent");
  assert.equal(env.PI_CODING_AGENT_SESSION_DIR, undefined);
});

test("brandEnv does not derive the env base from the branded name", () => {
  const env = brandEnv("/tmp/agent");
  assert.equal(env.SKILL_PI_CODING_AGENT_DIR, undefined);
  assert.ok(!Object.keys(env).some((k) => k.startsWith("SKILL_PI_")), "no SKILL_PI_* env base");
});
