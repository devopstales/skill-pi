import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { formatRecallOutput } from "../src/core/format-recall";
import type { SearchHit } from "../src/core/search-entries";

const dir = mkdtempSync(join(tmpdir(), "pi-vcc-expand-refs-"));

const makeRules = (name: string, body: string): string => {
  const p = join(dir, name);
  writeFileSync(p, body, "utf-8");
  return p;
};

const rulesMdPath = makeRules("rules.md", "ALWAYS_RUN_TESTS\n- do other things");

beforeAll(() => {
  process.env.PI_VCC_INCLUDES_PATH = join(dir, "includes.json");
});

afterAll(() => {
  delete process.env.PI_VCC_INCLUDES_PATH;
  rmSync(dir, { recursive: true, force: true });
});

describe("formatRecallOutput ref expansion", () => {
  it("appends resolved file body for a known @path in the hit", () => {
    const hit: SearchHit = { index: 1, role: "user", summary: `read @${rulesMdPath} for the rule`, files: [] };
    const out = formatRecallOutput([hit], "rules", undefined, { expandRefs: true, knownIncludes: [{ path: rulesMdPath }] });
    expect(out).toContain("@ref:");
    expect(out).toContain("ALWAYS_RUN_TESTS");
  });

  it("does not expand when expandRefs is false", () => {
    const hit: SearchHit = { index: 1, role: "user", summary: `read @${rulesMdPath}`, files: [] };
    const out = formatRecallOutput([hit], "rules", undefined, { expandRefs: false, knownIncludes: [{ path: rulesMdPath }] });
    expect(out).not.toContain("@ref:");
  });

  it("does not resolve relative tokens (absolute match only)", () => {
    const hit: SearchHit = { index: 1, role: "user", summary: "read @docs/rules.md", files: [] };
    const out = formatRecallOutput([hit], "rules", undefined, { expandRefs: true, knownIncludes: [{ path: rulesMdPath }] });
    expect(out).not.toContain("@ref:");
  });

  it("expands a ref found in the snippet (query hit)", () => {
    const hit: SearchHit = { index: 3, role: "assistant", summary: "did the thing", snippet: `see @${rulesMdPath}\nmore context`, files: [] };
    const out = formatRecallOutput([hit], "thing", undefined, { expandRefs: true, knownIncludes: [{ path: rulesMdPath }] });
    expect(out).toContain("@ref:");
    expect(out).toContain("ALWAYS_RUN_TESTS");
  });

  it("truncates a long include body at the ref caps", () => {
    const bigPath = makeRules("big.md", Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"));
    const hit: SearchHit = { index: 4, role: "user", summary: `see @${bigPath}`, files: [] };
    const out = formatRecallOutput([hit], "see", undefined, { expandRefs: true, knownIncludes: [{ path: bigPath }] });
    expect(out).toContain("big.md (truncated)");
    const body = out.split("@ref: big.md (truncated)\n")[1] ?? "";
    expect(body.split("\n").filter((l) => l.startsWith("line ")).length).toBe(40);
  });

  it("caps refs at 10 per page", () => {
    const paths = Array.from({ length: 12 }, (_, i) => makeRules(`r${i}.md`, `BODY_${i}`));
    const hits = paths.map((p, i) => ({ index: i, role: "user" as const, summary: `see @${p}`, files: [] }));
    const out = formatRecallOutput(hits, "see", undefined, { expandRefs: true, knownIncludes: paths.map((p) => ({ path: p })) });
    expect(out).toContain("@ref:");
    expect(out).toContain("BODY_9");
    expect(out).not.toContain("BODY_10");
    expect(out).not.toContain("BODY_11");
  });

  it("keeps the 3-arg form byte-identical (backward compat)", () => {
    const hit: SearchHit = { index: 1, role: "user", summary: `read @${rulesMdPath}`, files: [] };
    expect(formatRecallOutput([hit], "rules")).not.toContain("@ref:");
    expect(formatRecallOutput([hit])).not.toContain("@ref:");
  });
});
