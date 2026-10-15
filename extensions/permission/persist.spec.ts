import { mkdtempSync, mkdirSync, readFileSync, existsSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import { getDerivedSkillAllowState, getSkillAllowedRules, persistApprovalRules, resetDerivedSkillAllowStateCacheForTest } from "./index.js";
import { loadExtensionSettings } from "./project.js";

describe("persistence (global conf.d)", () => {
  let tmpHome: string;

  it("writes to the global conf.d path, not project", async () => {
    tmpHome = mkdtempSync(join(tmpdir(), "perm-global-"));
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(tmpHome, "agent");
    try {
      const r = await persistApprovalRules(process.cwd(), ["bash(git status *)"]);
      expect(r.settingsPath).toBe(join(tmpHome, "conf.d", "permission.conf"));
      expect(r.added).toContain("bash(git status *)");
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = original;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("deduplicates on second persist to the same global file", async () => {
    tmpHome = mkdtempSync(join(tmpdir(), "perm-global-"));
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(tmpHome, "agent");
    try {
      await persistApprovalRules(process.cwd(), ["bash(git status *)"]);
      const r2 = await persistApprovalRules(process.cwd(), ["bash(git status *)"]);
      expect(r2.added).toEqual([]);
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = original;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("reports which rules it added", async () => {
    tmpHome = mkdtempSync(join(tmpdir(), "perm-global-"));
    const original = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = join(tmpHome, "agent");
    try {
      const r = await persistApprovalRules(process.cwd(), ["read"]);
      expect(r.added).toContain("read");
      expect(r.settingsPath).toBe(join(tmpHome, "conf.d", "permission.conf"));
    } finally {
      if (original === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = original;
      rmSync(tmpHome, { recursive: true, force: true });
    }
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
