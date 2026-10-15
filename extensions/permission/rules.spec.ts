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

describe("opencode-style per-tool defaults", () => {
  it("read defaults to allow for in-project paths", () => {
    expect(resolveSingleMode({}, "read", "src/file.txt", state)).toBe("allow");
  });

  it("glob defaults to allow", () => {
    expect(resolveSingleMode({}, "glob", "src/**/*.ts", state)).toBe("allow");
  });

  it("grep defaults to allow", () => {
    expect(resolveSingleMode({}, "grep", "src", state)).toBe("allow");
  });

  it("ls defaults to allow", () => {
    expect(resolveSingleMode({}, "ls", "src", state)).toBe("allow");
  });

  it("find defaults to allow", () => {
    expect(resolveSingleMode({}, "find", "src", state)).toBe("allow");
  });

  it("task defaults to allow", () => {
    expect(resolveSingleMode({}, "task", "subagent", state)).toBe("allow");
  });

  it("skill defaults to allow", () => {
    expect(resolveSingleMode({}, "skill", "some-skill", state)).toBe("allow");
  });

  it("edit defaults to ask", () => {
    expect(resolveSingleMode({}, "edit", "src/file.txt", state)).toBe("ask");
  });

  it("write defaults to ask", () => {
    expect(resolveSingleMode({}, "write", "src/file.txt", state)).toBe("ask");
  });

  it("bash defaults to ask", () => {
    expect(resolveSingleMode({}, "bash", "ls -la", state)).toBe("ask");
  });

  it("webfetch defaults to ask", () => {
    expect(resolveSingleMode({}, "webfetch", "https://example.com", state)).toBe("ask");
  });

  it("unknown tool defaults to ask", () => {
    expect(resolveSingleMode({}, "unknownTool", "x", state)).toBe("ask");
  });

  it("defaultMode allow overrides per-tool ask defaults", () => {
    const s: PermissionSettings = { defaultMode: "allow" };
    expect(resolveSingleMode(s, "edit", "src/file.txt", state)).toBe("allow");
    expect(resolveSingleMode(s, "bash", "ls -la", state)).toBe("allow");
  });

  it("defaultMode deny overrides per-tool allow defaults", () => {
    const s: PermissionSettings = { defaultMode: "deny" };
    expect(resolveSingleMode(s, "read", "src/file.txt", state)).toBe("deny");
  });

  it("explicit deny rule beats per-tool allow default", () => {
    const s: PermissionSettings = { deny: ["read"] };
    expect(resolveSingleMode(s, "read", "src/file.txt", state)).toBe("deny");
  });

  it("explicit allow rule beats per-tool ask default", () => {
    const s: PermissionSettings = { allow: ["bash"] };
    expect(resolveSingleMode(s, "bash", "ls -la", state)).toBe("allow");
  });
});

describe(".env guard on read", () => {
  it("read on .env file defaults to ask", () => {
    expect(resolveSingleMode({}, "read", ".env", state)).toBe("ask");
  });

  it("read on .env.local defaults to ask", () => {
    expect(resolveSingleMode({}, "read", ".env.local", state)).toBe("ask");
  });

  it("read on .env.production defaults to ask", () => {
    expect(resolveSingleMode({}, "read", ".env.production", state)).toBe("ask");
  });

  it("read on .env.example defaults to allow", () => {
    expect(resolveSingleMode({}, "read", ".env.example", state)).toBe("allow");
  });

  it("read on normal file still allows", () => {
    expect(resolveSingleMode({}, "read", "README.md", state)).toBe("allow");
  });

  it("explicit allow rule beats .env guard", () => {
    const s: PermissionSettings = { allow: ["read(*.env)"] };
    expect(resolveSingleMode(s, "read", ".env", state)).toBe("allow");
  });

  it("edit on .env file still asks (guard is read-only)", () => {
    expect(resolveSingleMode({}, "edit", ".env", state)).toBe("ask");
  });
});
