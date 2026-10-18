import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { compile } from "../src/core/summarize";
import { userMsg, assistantText } from "./fixtures";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-vcc-standing-compile-"));

afterAll(() => {
  delete process.env.PI_VCC_INCLUDES_PATH;
});

describe("standing-rules-section (door check: handshake file -> summary)", () => {
  it("compacting with a populated handshake file emits a capped [Standing Rules] section", () => {
    const dir = tmp();
    const rulesPath = join(dir, "rules.md");
    writeFileSync(rulesPath, Array.from({ length: 200 }, (_, i) => `rule ${i}`).join("\n"));
    const handshakePath = join(dir, "pi-vcc-includes.json");
    writeFileSync(handshakePath, JSON.stringify({ includes: [{ path: rulesPath }] }));
    process.env.PI_VCC_INCLUDES_PATH = handshakePath;

    const r = compile({
      messages: [
        userMsg("Fix login bug"),
        assistantText("Found the issue."),
      ],
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
});
