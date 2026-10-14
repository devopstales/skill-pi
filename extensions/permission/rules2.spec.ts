import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it, expect } from "vitest";
import { matchPattern, matchesAnyRule, resolveMode, resolveSingleMode } from "./index.js";
import type { PermissionSettings, RuntimeSessionState } from "./models.js";
import { getExtensionSettingsPaths, loadExtensionSettings } from "./project.js";

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

describe("conf.d loading (triangulation)", () => {
  it("merges project under local with last-wins defaultMode", () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-conf-"));
    mkdirSync(join(dir, "conf.d"), { recursive: true });
    writeFileSync(join(dir, "conf.d", "permission.conf"), JSON.stringify({ defaultMode: "deny", allow: ["read"] }));
    writeFileSync(join(dir, "conf.d", "permission.local.conf"), JSON.stringify({ defaultMode: "allow" }));

    const merged = loadExtensionSettings<{ defaultMode?: string; allow?: string[] }>("permission", dir, (a, b) => ({
      ...a,
      ...b,
      allow: [...(a.allow ?? []), ...(b.allow ?? [])],
    }));
    expect(merged.defaultMode).toBe("allow");
    expect(merged.allow).toEqual(["read"]);
  });

  it("throws on invalid JSON with the path in the message", () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-conf-"));
    mkdirSync(join(dir, "conf.d"), { recursive: true });
    writeFileSync(join(dir, "conf.d", "permission.conf"), "{ not json");
    expect(() =>
      loadExtensionSettings<Record<string, unknown>>("permission", dir, (a, b) => ({ ...a, ...b })),
    ).toThrow(/Invalid JSON in .*permission\.conf/);
  });
});
