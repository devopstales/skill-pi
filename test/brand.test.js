import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { brandOverlayDir, brandEnv } from "../lib/brand.js";

test("brandOverlayDir writes a package.json with piConfig.name=skill-pi", () => {
  const overlay = brandOverlayDir(mkdtempSync(join(tmpdir(), "skillpi-brand-")));
  const pkg = JSON.parse(readFileSync(join(overlay, "package.json"), "utf8"));
  assert.equal(pkg.piConfig?.name, "skill-pi");
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
