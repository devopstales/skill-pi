import { describe, it, expect } from "vitest";
import { matchPattern, matchesAnyRule, resolveMode, resolveSingleMode } from "./index.js";
import type { PermissionSettings, RuntimeSessionState } from "./models.js";

const state: RuntimeSessionState = { modeOverrides: new Map(), approvalRules: new Set() };

describe("rule chain (triangulation)", () => {
  it("session approvalRules override defaultMode deny", () => {
    const s: PermissionSettings = { defaultMode: "deny" };
    const s2: RuntimeSessionState = { modeOverrides: new Map(), approvalRules: new Set(["bash(npm run *)"]) };
    expect(resolveSingleMode(s, "bash", "npm run test", s2)).toBe("allow");
  });

  it("modeOverrides win over deny rules", () => {
    const s: PermissionSettings = { deny: ["bash(*)"] };
    const s2: RuntimeSessionState = { modeOverrides: new Map([["bash", "allow"]]), approvalRules: new Set() };
    expect(resolveSingleMode(s, "bash", "rm -rf /", s2)).toBe("allow");
  });

  it("matchPattern escapes regex metacharacters", () => {
    expect(matchPattern("node -v", "node -v")).toBe(true);
    expect(matchPattern("node -v", "node -v2")).toBe(false);
    expect(matchPattern("a.b *", "axb")).toBe(false);
    expect(matchPattern("a.b *", "a.b")).toBe(true);
  });

  it("matchPattern: exact pattern requires exact match, trailing ' *' makes args optional", () => {
    expect(matchPattern("git status", "git status")).toBe(true);
    expect(matchPattern("git status", "git status\n--short")).toBe(false);
    expect(matchPattern("git status *", "git status")).toBe(true);
    expect(matchPattern("git status *", "git status --short")).toBe(true);
    expect(matchPattern("git status *", "git log")).toBe(false);
  });

  it("matchesAnyRule bare tool rule matches only that tool", () => {
    expect(matchesAnyRule(["read"], "read", "/tmp/x")).toBe(true);
    expect(matchesAnyRule(["read"], "write", "/tmp/x")).toBe(false);
  });

  it("multi-command bash with one deny resolves to deny (wasm parser)", async () => {
    const s: PermissionSettings = { allow: ["bash(*)"], deny: ["bash(rm -rf *)"] };
    expect(await resolveMode(s, "bash", "ls -la && rm -rf /tmp/x; pwd", state)).toBe("deny");
  });

  it("cd-only command skips cwd-only extraction and allows (wasm parser)", async () => {
    const s: PermissionSettings = { deny: ["bash(*)"] };
    expect(await resolveMode(s, "bash", "cd /tmp", state)).toBe("allow");
  });
});

describe("external_directory default", () => {
  it("read on absolute path outside project defaults to ask", () => {
    expect(resolveSingleMode({}, "read", "/home/user/other-project/file.txt", state)).toBe("ask");
  });

  it("read on in-project relative path defaults to allow", () => {
    expect(resolveSingleMode({}, "read", "src/file.txt", state)).toBe("allow");
  });

  it("read on temp path defaults to allow", () => {
    expect(resolveSingleMode({}, "read", "/tmp/file.txt", state)).toBe("allow");
  });

  it("edit on external path defaults to ask (not allow)", () => {
    expect(resolveSingleMode({}, "edit", "/home/user/other-project/file.txt", state)).toBe("ask");
  });

  it("explicit allow rule beats external_directory ask", () => {
    const s: PermissionSettings = { allow: ["read(*)"] };
    expect(resolveSingleMode(s, "read", "/home/user/other-project/file.txt", state)).toBe("allow");
  });
});
