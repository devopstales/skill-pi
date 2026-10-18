import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { readIncludes, readIncludedRules, extractRefTokens } from "../src/core/includes";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-vcc-includes-"));

afterAll(() => {
  delete process.env.PI_VCC_INCLUDES_PATH;
});

describe("readIncludes", () => {
  it("returns [] when the handshake file is missing", () => {
    process.env.PI_VCC_INCLUDES_PATH = join(tmp(), "nope.json");
    expect(readIncludes()).toEqual([]);
  });

  it("returns [] (not throw) on invalid JSON", () => {
    const p = join(tmp(), "bad.json");
    writeFileSync(p, "{not json");
    process.env.PI_VCC_INCLUDES_PATH = p;
    expect(readIncludes()).toEqual([]);
  });

  it("returns absolute entries and drops non-.md / non-absolute", () => {
    const p = join(tmp(), "ok.json");
    writeFileSync(p, JSON.stringify({ includes: [
      { path: "/a/b.md", source: "AGENTS.md" },
      { path: "/a/c.txt" },
      { path: "relative/d.md" },
    ] }));
    process.env.PI_VCC_INCLUDES_PATH = p;
    expect(readIncludes()).toEqual([{ path: "/a/b.md", source: "AGENTS.md" }]);
  });
});

describe("readIncludedRules", () => {
  const writeMd = (dir: string, name: string, body: string): string => {
    const p = join(dir, name);
    writeFileSync(p, body);
    return p;
  };

  it("reads lines, strips fenced blocks, dedups", () => {
    const dir = tmp();
    const p = writeMd(dir, "rules.md", [
      "Always run tests.",
      "```bash",
      "const x = 1;",
      "```",
      "Never commit secrets.",
      "Always run tests.",
    ].join("\n"));
    const out = readIncludedRules([{ path: p }]);
    expect(out[0].lines).toEqual(["Always run tests.", "Never commit secrets."]);
    expect(out[0].truncated).toBe(false);
  });

  it("caps at 6KB total with truncated flag", () => {
    const dir = tmp();
    const p = writeMd(dir, "big.md", Array.from({ length: 2000 }, (_, i) => `rule ${i}`).join("\n"));
    const out = readIncludedRules([{ path: p }]);
    expect(out[0].truncated).toBe(true);
    const totalLines = out.reduce((n, r) => n + r.lines.length, 0);
    expect(totalLines).toBeLessThanOrEqual(150);
  });

  it("skips unreadable paths", () => {
    const out = readIncludedRules([{ path: "/no/such/file.md" }]);
    expect(out).toEqual([]);
  });
});

describe("extractRefTokens (line-start, fenced-safe)", () => {
  const cases = [
    { name: "plain line-start", input: "@docs/rules.md", expected: ["@docs/rules.md"] },
    { name: "after list marker", input: "- @docs/rules.md", expected: ["@docs/rules.md"] },
    { name: "numbered marker", input: "1. @docs/rules.md", expected: ["@docs/rules.md"] },
    { name: "mid-sentence ignored", input: "see @docs/rules.md here", expected: [] },
    { name: "in code fence ignored", input: "```\n@docs/rules.md\n```", expected: [] },
    { name: "email ignored", input: "mail user@host.com", expected: [] },
  ];
  for (const c of cases) {
    it(c.name, () => { expect(extractRefTokens(c.input)).toEqual(c.expected); });
  }
});
