import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const extDir = join(pkgRoot, "extensions", "skill-pi-tui");

test("skill-pi-tui is a folder-based extension (ADR-0007 shape)", () => {
  assert.ok(existsSync(join(extDir, "index.ts")), "index.ts must exist");
  assert.ok(!existsSync(join(pkgRoot, "extensions", "skill-pi-banner.ts")), "old flat file must be gone");
  const pkg = JSON.parse(readFileSync(join(extDir, "package.json"), "utf8"));
  assert.equal(pkg.private, true, "extension package.json must be private");
  assert.equal(pkg.name, undefined, "extension package.json must not carry a name");
});

test("wrapper enumeration resolves extensions/skill-pi-tui/index.ts", () => {
  const binSrc = readFileSync(join(pkgRoot, "bin", "skill-pi.js"), "utf8");
  assert.match(binSrc, /collectExtensionFiles/);
  const entry = join(extDir, "index.ts");
  const st = statSync(entry);
  assert.ok(st.isFile());
  assert.equal(join(extDir, "index.ts").endsWith("index.ts"), true);
  const topFiles = readdirSync(join(pkgRoot, "extensions"), { withFileTypes: true });
  assert.ok(!topFiles.some((e) => e.name === "skill-pi-banner.ts"));
});

test("skill-pi-tui native type-stripping load", () => {
  const loader = join(extDir, "native-tui-loader.mjs");
  const r = spawnSync(process.execPath, [loader], { encoding: "utf8" });
  assert.equal(r.status, 0, `loader must exit 0, stderr:\n${r.stderr}`);
  assert.match(r.stdout, /ok/);
});
