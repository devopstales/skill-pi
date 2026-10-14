import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { getDerivedSkillAllowState, getSkillAllowedRules, persistApprovalRules, resetDerivedSkillAllowStateCacheForTest } from "./index.js";
import { loadExtensionSettings } from "./project.js";

describe("persistence", () => {
  it("appends a rule to the conf.d project file exactly once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    mkdirSync(join(dir, "conf.d"), { recursive: true });
    const r = await persistApprovalRules(dir, ["bash(git status *)"]);
    const r2 = await persistApprovalRules(dir, ["bash(git status *)"]);
    expect(r2.added).toEqual([]);
    const parsed = JSON.parse(readFileSync(join(dir, "conf.d", "permission.conf"), "utf-8"));
    expect(parsed.always.filter((x: string) => x === "bash(git status *)")).toHaveLength(1);
    expect(existsSync(join(dir, "conf.d", "permission.conf.lock"))).toBe(false);
  });

  it("reports which rules it added on the first persist", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    mkdirSync(join(dir, "conf.d"), { recursive: true });
    const r = await persistApprovalRules(dir, ["read", "bash(npm run *)"]);
    expect(r.added).toEqual(["read", "bash(npm run *)"]);
    expect(r.settingsPath).toBe(join(dir, "conf.d", "permission.conf"));
    const parsed = JSON.parse(readFileSync(r.settingsPath, "utf-8"));
    expect(parsed.always).toEqual(["read", "bash(npm run *)"]);
  });

  it("creates the conf.d dir when missing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    await persistApprovalRules(dir, ["ls"]);
    const parsed = JSON.parse(readFileSync(join(dir, "conf.d", "permission.conf"), "utf-8"));
    expect(parsed.always).toEqual(["ls"]);
  });

  it("throws on invalid conf.d JSON with the path and message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-"));
    mkdirSync(join(dir, "conf.d"), { recursive: true });
    writeFileSync(join(dir, "conf.d", "permission.conf"), "{ not json");
    await expect(persistApprovalRules(dir, ["read"])).rejects.toThrow(
      /Invalid JSON in .*permission\.conf/,
    );
    expect(existsSync(join(dir, "conf.d", "permission.conf.lock"))).toBe(false);
  });
});

describe(".pi/conf.d fallback (ADR 0008 D2)", () => {
  it("reads .pi/conf.d only when .skill-pi/conf.d is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-pi-"));
    mkdirSync(join(dir, ".pi", "conf.d"), { recursive: true });
    writeFileSync(join(dir, ".pi", "conf.d", "permission.conf"), JSON.stringify({ defaultMode: "deny" }));
    const merged = loadExtensionSettings<{ defaultMode?: string }>("permission", dir, (a, b) => ({ ...a, ...b }));
    expect(merged.defaultMode).toBe("deny");
  });

  it("prefers .skill-pi/conf.d over .pi/conf.d when both exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "perm-pi-"));
    mkdirSync(join(dir, ".pi", "conf.d"), { recursive: true });
    mkdirSync(join(dir, ".skill-pi", "conf.d"), { recursive: true });
    writeFileSync(join(dir, ".pi", "conf.d", "permission.conf"), JSON.stringify({ defaultMode: "deny" }));
    writeFileSync(join(dir, ".skill-pi", "conf.d", "permission.conf"), JSON.stringify({ defaultMode: "allow" }));
    const merged = loadExtensionSettings<{ defaultMode?: string }>("permission", dir, (a, b) => ({ ...a, ...b }));
    expect(merged.defaultMode).toBe("allow");
  });
});

function skillCommand(name: string, path: string, scope: "user" | "project"): SlashCommandInfo {
  return {
    name,
    description: "test skill",
    source: "skill",
    sourceInfo: { path, source: "skill", scope, origin: "top-level" },
  };
}

describe("skill-derived allow rules", () => {
  let dir: string;
  let calls: number;

  beforeEach(() => {
    resetDerivedSkillAllowStateCacheForTest();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function fakePi(skills: SlashCommandInfo[]): ExtensionAPI {
    calls = 0;
    resetDerivedSkillAllowStateCacheForTest();
    return {
      getCommands: () => {
        calls += 1;
        return skills;
      },
    } as unknown as ExtensionAPI;
  }

  it("unions the allowed-tools rules of two local skills", () => {
    dir = mkdtempSync(join(tmpdir(), "perm-skill-"));
    const a = join(dir, "a", "SKILL.md");
    const b = join(dir, "b", "SKILL.md");
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    writeFileSync(a, "---\nallowed-tools:\n  - read\n  - bash(git status *)\n---\nbody a\n");
    writeFileSync(b, "---\nallowed_tools: [grep, ls]\n---\nbody b\n");

    const state = getDerivedSkillAllowState(fakePi([skillCommand("skill:a", a, "project"), skillCommand("skill:b", b, "user")]));
    expect(state.rules).toEqual(["read", "bash(git status *)", "grep", "ls"]);
    expect(state.sources.map((s) => s.skill)).toEqual(["a", "b"]);
    expect(state.sources[0].location).toBe("project");
    expect(state.sources[0].rules).toEqual(["read", "bash(git status *)"]);
  });

  it("parses both frontmatter spellings of allowed tools", () => {
    const dir2 = mkdtempSync(join(tmpdir(), "perm-skill-"));
    const p1 = join(dir2, "one.md");
    writeFileSync(p1, "---\nallowed-tools: [read]\n---\nbody\n");
    const p2 = join(dir2, "two.md");
    writeFileSync(p2, "---\nallowed_tools:\n  - grep\n---\nbody\n");
    const p3 = join(dir2, "three.md");
    writeFileSync(p3, "no frontmatter at all");
    expect(getSkillAllowedRules(p1)).toEqual(["read"]);
    expect(getSkillAllowedRules(p2)).toEqual(["grep"]);
    expect(getSkillAllowedRules(p3)).toEqual([]);
    rmSync(dir2, { recursive: true, force: true });
  });

  it("short-circuits on an unchanged cache key", () => {
    dir = mkdtempSync(join(tmpdir(), "perm-skill-"));
    const a = join(dir, "a", "SKILL.md");
    const b = join(dir, "b", "SKILL.md");
    mkdirSync(join(dir, "a"), { recursive: true });
    mkdirSync(join(dir, "b"), { recursive: true });
    writeFileSync(a, "---\nallowed-tools: [read]\n---\nbody a\n");
    writeFileSync(b, "---\nallowed-tools: [grep]\n---\nbody b\n");
    const pi = fakePi([skillCommand("skill:a", a, "project"), skillCommand("skill:b", b, "user")]);

    const first = getDerivedSkillAllowState(pi);
    const second = getDerivedSkillAllowState(pi);
    expect(second).toBe(first);
    expect(first.rules).toEqual(["read", "grep"]);
  });
});
