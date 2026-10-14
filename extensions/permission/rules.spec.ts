import { describe, it, expect } from "vitest";
import { parseRule, matchPattern, resolveSingleMode } from "./index.js";
import type { PermissionSettings, RuntimeSessionState } from "./models.js";

const state: RuntimeSessionState = { modeOverrides: new Map(), approvalRules: new Set() };

describe("rule chain", () => {
  it("deny wins over allow", () => {
    const s: PermissionSettings = { deny: ["bash(rm -rf *)"], allow: ["bash(*)"] };
    expect(resolveSingleMode(s, "bash", "rm -rf /", state)).toBe("deny");
  });

  it("ask wins over allow", () => {
    const s: PermissionSettings = { ask: ["edit"], allow: ["edit"] };
    expect(resolveSingleMode(s, "edit", "/tmp/x", state)).toBe("ask");
  });

  it("defaultMode ask is the floor", () => {
    const s: PermissionSettings = { defaultMode: "ask" };
    expect(resolveSingleMode(s, "read", "/tmp/x", state)).toBe("ask");
  });

  it("matchPattern: trailing ' *' also matches bare", () => {
    expect(matchPattern("git *", "git")).toBe(true);
    expect(matchPattern("git *", "git status")).toBe(true);
    expect(matchPattern("git *", "gh")).toBe(false);
  });

  it("parseRule: tool(arg) splits", () => {
    expect(parseRule("bash(git checkout *)")).toEqual({ toolPattern: "bash", argPattern: "git checkout *" });
    expect(parseRule("read")).toEqual({ toolPattern: "read" });
  });
});
