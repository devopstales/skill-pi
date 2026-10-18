import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compile } from "../src/core/summarize";
import { userMsg } from "./fixtures";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-vcc-standing-compile-"));

afterAll(() => {
  delete process.env.PI_VCC_INCLUDES_PATH;
});

const standingBullets = (r: string): string[] =>
  r
    .split("[Standing Rules]\n")[1]
    .split(/\n\n|\n\n---\n\n/)[0]
    .split("\n")
    .filter((l) => l.startsWith("- "));

describe("standing-rules-section (door check: handshake file -> summary)", () => {
  it("compacting with a populated handshake file emits a capped [Standing Rules] section", () => {
    const dir = tmp();
    const rulesPath = join(dir, "rules.md");
    writeFileSync(rulesPath, Array.from({ length: 200 }, (_, i) => `rule ${i}`).join("\n"));
    const handshakePath = join(dir, "pi-vcc-includes.json");
    writeFileSync(handshakePath, JSON.stringify({ includes: [{ path: rulesPath }] }));
    process.env.PI_VCC_INCLUDES_PATH = handshakePath;

    const r = compile({
      messages: [userMsg("Fix login bug")],
    });

    expect(r).toContain("[Standing Rules]");
    const section = r
      .split("[Standing Rules]\n")[1]
      .split(/\n\n|\n\n---\n\n/)[0];
    const bullets = section
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .filter((l) => !l.startsWith("- (+"));
    expect(bullets.length).toBeLessThanOrEqual(150);
    expect(bullets[0]).toBe("- rule 0");
    expect(section).toContain("more in rules.md");
  });

  it("compacting with a missing handshake file emits no [Standing Rules] section and does not fail", () => {
    process.env.PI_VCC_INCLUDES_PATH = join(tmp(), "none.json");
    const r = compile({
      messages: [userMsg("Fix login bug")],
    });
    expect(r).not.toContain("[Standing Rules]");
    expect(r).toContain("[Session Goal]");
  });

  it("sticky-merge: previous [Standing Rules] + fresh shared rule dedup, no double-prefix", () => {
    const dir = tmp();
    const rulesPath = join(dir, "rules.md");
    writeFileSync(rulesPath, "shared rule one\nadded rule two");
    const handshakePath = join(dir, "pi-vcc-includes.json");
    writeFileSync(handshakePath, JSON.stringify({ includes: [{ path: rulesPath }] }));
    process.env.PI_VCC_INCLUDES_PATH = handshakePath;

    const r = compile({
      previousSummary: "[Standing Rules]\n- shared rule one\n- older rule three",
      messages: [userMsg("Fix login bug")],
    });

    expect(r).toContain("[Standing Rules]");
    const bullets = standingBullets(r);
    // dedup: the shared rule appears exactly once, not prefixed twice
    expect(bullets.filter((l) => l === "- shared rule one").length).toBe(1);
    expect(r).not.toContain("-- shared rule one");
    expect(bullets).toEqual([
      "- shared rule one",
      "- older rule three",
      "- added rule two",
    ]);
  });

  it("sticky-merge: caps merged [Standing Rules] at the 15 newest rules", () => {
    const dir = tmp();
    const rulesPath = join(dir, "rules.md");
    writeFileSync(rulesPath, "added rule two");
    const handshakePath = join(dir, "pi-vcc-includes.json");
    writeFileSync(handshakePath, JSON.stringify({ includes: [{ path: rulesPath }] }));
    process.env.PI_VCC_INCLUDES_PATH = handshakePath;

    const r = compile({
      previousSummary:
        "[Standing Rules]\n" + Array.from({ length: 16 }, (_, i) => `- old rule ${i}`).join("\n"),
      messages: [userMsg("Fix login bug")],
    });

    const bullets = standingBullets(r);
    expect(bullets.length).toBe(15);
    expect(bullets[0]).toBe("- old rule 2");
    expect(bullets[bullets.length - 1]).toBe("- added rule two");
  });
});
