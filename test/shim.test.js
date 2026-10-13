import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveShimCwd } from "../lib/shim.js";

test("shim dir owns an empty .pi and links the project", () => {
  const project = mkdtempSync(join(tmpdir(), "skillpi-test-"));
  const shim = resolveShimCwd(project);
  assert.ok(existsSync(join(shim, ".pi")), "shim must contain a .pi marker dir");
  assert.equal(readlinkSync(join(shim, "project")), project);
});

test("resolveShimCwd is idempotent", () => {
  const project = mkdtempSync(join(tmpdir(), "skillpi-test2-"));
  const first = resolveShimCwd(project);
  const second = resolveShimCwd(project);
  assert.equal(first, second);
});
