import { afterEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverAgentTypes, resolveAgentType } from "./agents.ts";

const TMP_ROOT = join(tmpdir(), "pi-swarm-agents-spec");
mkdirSync(TMP_ROOT, { recursive: true });
const created: string[] = [];

function tmpDir(name: string): string {
  const dir = mkdtempSync(join(TMP_ROOT, name + "-"));
  created.push(dir);
  return dir;
}

function writeAgent(dir: string, filename: string, content: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, filename);
  writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("discoverAgentTypes", () => {
  it("discovers a project-only agent with source 'project'", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(join(project, ".skill-pi", "agents"), "auditor.md", "---\ndescription: Security Auditor\n---\nYou are a security auditor.\n");
    const types = discoverAgentTypes(project, agentDir);
    expect(types).toEqual([
      {
        name: "auditor",
        description: "Security Auditor",
        maxTurns: undefined,
        model: undefined,
        color: undefined,
        systemPrompt: "You are a security auditor.",
        source: "project",
      },
    ]);
  });

  it("discovers a global-only agent with source 'global'", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(join(agentDir, "agents"), "explorer.md", "You explore codebases.\n");
    const types = discoverAgentTypes(project, agentDir);
    expect(types).toEqual([
      {
        name: "explorer",
        description: "explorer",
        maxTurns: undefined,
        model: undefined,
        color: undefined,
        systemPrompt: "You explore codebases.",
        source: "global",
      },
    ]);
  });

  it("project wins on name clash (exactly one entry)", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(join(project, ".skill-pi", "agents"), "shared.md", "---\ndescription: Project Version\n---\nProject prompt.\n");
    writeAgent(join(agentDir, "agents"), "shared.md", "---\ndescription: Global Version\n---\nGlobal prompt.\n");
    const types = discoverAgentTypes(project, agentDir);
    expect(types).toHaveLength(1);
    expect(types[0].description).toBe("Project Version");
    expect(types[0].systemPrompt).toBe("Project prompt.");
    expect(types[0].source).toBe("project");
  });

  it("parses max_turns as a number and passes through model and color", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(
      join(agentDir, "agents"),
      "opus.md",
      "---\ndescription: Opus Agent\nmodel: anthropic/claude-opus-4-6\nmax_turns: 30\ncolor: red\n---\nUse opus.\n",
    );
    const types = discoverAgentTypes(project, agentDir);
    expect(types[0]).toMatchObject({
      name: "opus",
      description: "Opus Agent",
      model: "anthropic/claude-opus-4-6",
      maxTurns: 30,
      color: "red",
      systemPrompt: "Use opus.",
      source: "global",
    });
    expect(types[0].maxTurns).toBe(30);
  });

  it("frontmatter name overrides the filename", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(join(project, ".skill-pi", "agents"), "file.md", "---\nname: renamed\ndescription: D\n---\nBody.\n");
    const types = discoverAgentTypes(project, agentDir);
    expect(types[0].name).toBe("renamed");
  });

  it("skips a file with unterminated frontmatter and warns naming the file", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    const bad = writeAgent(join(project, ".skill-pi", "agents"), "broken.md", "---\nname: broken\nnever closed\n");
    writeAgent(join(project, ".skill-pi", "agents"), "good.md", "---\ndescription: Good\n---\nFine.\n");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const types = discoverAgentTypes(project, agentDir);
    expect(types.map((t) => t.name)).toEqual(["good"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("broken.md");
    warn.mockRestore();
  });

  it("skips an unreadable file and warns naming it", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(join(project, ".skill-pi", "agents"), "fine.md", "---\ndescription: Fine\n---\nFine.\n");
    const dir = join(project, ".skill-pi", "agents");
    const unreadable = join(dir, "unreadable.md");
    writeFileSync(unreadable, "---\ndescription: x\n---\nBody.\n");
    chmodSync(unreadable, 0o000);
    try {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const types = discoverAgentTypes(project, agentDir);
      expect(types.map((t) => t.name)).toEqual(["fine"]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("unreadable.md");
      warn.mockRestore();
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  it("strips and trims the frontmatter to produce the systemPrompt", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(
      join(agentDir, "agents"),
      "spaced.md",
      "---\ndescription: D\n---\n\n  \nfirst line\n  \nsecond\n\n  \n",
    );
    const types = discoverAgentTypes(project, agentDir);
    expect(types[0].systemPrompt).toBe("first line\n  \nsecond");
  });

  it("falls back to the filename for description", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(join(agentDir, "agents"), "naming.md", "---\nname: naming\n---\nBody.\n");
    const types = discoverAgentTypes(project, agentDir);
    expect(types[0].description).toBe("naming");
  });

  it("resolves the project dir through a project -> real symlink (shim shape)", () => {
    const real = tmpDir("real");
    const shim = tmpDir("shim");
    const agentDir = tmpDir("agent");
    writeAgent(join(real, ".skill-pi", "agents"), "via-shim.md", "---\ndescription: Via Shim\n---\nThrough the shim.\n");
    symlinkSync(real, join(shim, "project"));
    const types = discoverAgentTypes(join(shim, "project"), agentDir);
    expect(types).toEqual([
      {
        name: "via-shim",
        description: "Via Shim",
        maxTurns: undefined,
        model: undefined,
        color: undefined,
        systemPrompt: "Through the shim.",
        source: "project",
      },
    ]);
  });

  it("uses cwd as-is when there is no project symlink", () => {
    const project = tmpDir("project");
    const agentDir = tmpDir("agent");
    writeAgent(join(project, ".skill-pi", "agents"), "direct.md", "---\ndescription: Direct\n---\nDirectly.\n");
    const types = discoverAgentTypes(project, agentDir);
    expect(types.map((t) => t.name)).toEqual(["direct"]);
  });
});

describe("resolveAgentType", () => {
  const types = [
    { name: "auditor", description: "a", systemPrompt: "A", source: "project" as const },
    { name: "explorer", description: "e", systemPrompt: "E", source: "global" as const },
  ];

  it("matches by exact name", () => {
    expect(resolveAgentType(types, "auditor")).toBe(types[0]);
    expect(resolveAgentType(types, "explorer")).toBe(types[1]);
  });

  it("returns undefined for an unknown name (including prefix/case mismatches)", () => {
    expect(resolveAgentType(types, "auditors")).toBeUndefined();
    expect(resolveAgentType(types, "Auditor")).toBeUndefined();
    expect(resolveAgentType([], "x")).toBeUndefined();
  });
});
