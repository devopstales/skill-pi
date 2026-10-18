import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildStandingRules } from "../src/extract/standing-rules";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-vcc-standing-"));

afterAll(() => {
  delete process.env.PI_VCC_INCLUDES_PATH;
});

describe("buildStandingRules", () => {
  it("returns [] with no entries", () => {
    expect(buildStandingRules([])).toEqual([]);
  });

  it("formats - bullets in order with truncation footer", () => {
    const dir = tmp();
    const rulesPath = join(dir, "rules.md");
    writeFileSync(rulesPath, ["First rule.", "Second rule."].join("\n"));
    const bigPath = join(dir, "big.md");
    writeFileSync(bigPath, Array.from({ length: 200 }, (_, i) => `rule ${i}`).join("\n"));

    const handshakePath = join(dir, "pi-vcc-includes.json");
    writeFileSync(handshakePath, JSON.stringify({
      includes: [{ path: rulesPath }, { path: bigPath }],
    }));
    process.env.PI_VCC_INCLUDES_PATH = handshakePath;

    const lines = buildStandingRules();
    rmSync(dir, { recursive: true, force: true });

    expect(lines.slice(0, 2)).toEqual(["First rule.", "Second rule."]);
    const dropped = 200 - lines.slice(2).filter((l) => !l.startsWith("(+")).length;
    expect(lines.at(-1)).toBe(`(+${dropped} more in big.md)`);
  });

  it("returns [] when the handshake file is missing (no throw)", () => {
    process.env.PI_VCC_INCLUDES_PATH = join(tmp(), "none.json");
    expect(buildStandingRules()).toEqual([]);
  });
});
