import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: vi.fn(),
}));

import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { globalSettingsPath, loadSettings, matcherMatches } from "./config.ts";

function makeTempDir(prefix: string): string {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

function writeProjectSettings(cwd: string, hooks: unknown): string {
  const dir = path.join(cwd, ".skill-pi");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "settings.json");
  writeFileSync(file, JSON.stringify({ hooks }));
  return file;
}

function writeGlobalSettings(agentDir: string, hooks: unknown): string {
  mkdirSync(agentDir, { recursive: true });
  const file = path.join(agentDir, "settings.json");
  writeFileSync(file, JSON.stringify({ hooks }));
  return file;
}

describe("globalSettingsPath", () => {
  let agentTmpDir: string;

  beforeEach(() => {
    agentTmpDir = makeTempDir("pi-hooks-agent-");
    vi.mocked(getAgentDir).mockReturnValue(agentTmpDir);
  });

  afterEach(() => {
    rmSync(agentTmpDir, { recursive: true, force: true });
  });

  it("resolves under the mocked agent dir, never containing .pi", () => {
    const p = globalSettingsPath();
    expect(p).toBe(path.join(agentTmpDir, "settings.json"));
    expect(p).not.toContain(".pi");
  });
});

describe("loadSettings", () => {
  let cwd: string;
  let agentTmpDir: string;

  beforeEach(() => {
    cwd = makeTempDir("pi-hooks-cwd-");
    agentTmpDir = makeTempDir("pi-hooks-agent-");
    vi.mocked(getAgentDir).mockReturnValue(agentTmpDir);
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(agentTmpDir, { recursive: true, force: true });
  });

  it("returns no settings and no source paths when no settings files exist", () => {
    const result = loadSettings(cwd);
    expect(result.settings).toBeUndefined();
    expect(result.sourcePaths).toEqual([]);
  });

  it("loads project-only hooks from .skill-pi/settings.json", () => {
    const projectPath = writeProjectSettings(cwd, {
      Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }],
    });

    const result = loadSettings(cwd);

    expect(result.settings?.hooks?.Stop).toEqual([
      { hooks: [{ type: "command", command: "echo hi" }] },
    ]);
    expect(result.sourcePaths).toEqual([projectPath]);
  });

  it("loads global-only hooks from the agent dir settings.json", () => {
    writeGlobalSettings(agentTmpDir, {
      Stop: [{ hooks: [{ type: "command", command: "echo global" }] }],
    });

    const result = loadSettings(cwd);

    expect(result.settings?.hooks?.Stop).toEqual([
      { hooks: [{ type: "command", command: "echo global" }] },
    ]);
    expect(result.sourcePaths).toEqual([
      path.join(agentTmpDir, "settings.json"),
    ]);
  });

  it("merges global and project hook arrays per event key, global first", () => {
    writeGlobalSettings(agentTmpDir, {
      Stop: [{ matcher: "A", hooks: [{ type: "command", command: "A" }] }],
    });
    writeProjectSettings(cwd, {
      Stop: [{ matcher: "B", hooks: [{ type: "command", command: "B" }] }],
    });

    const result = loadSettings(cwd);

    expect(result.settings?.hooks?.Stop).toEqual([
      { matcher: "A", hooks: [{ type: "command", command: "A" }] },
      { matcher: "B", hooks: [{ type: "command", command: "B" }] },
    ]);
  });

  it("ignores .pi/settings.json in the same cwd", () => {
    const dir = path.join(cwd, ".pi");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "settings.json"),
      JSON.stringify({
        hooks: { Stop: [{ hooks: [{ type: "command", command: "nope" }] }] },
      }),
    );

    const result = loadSettings(cwd);

    expect(result.settings).toBeUndefined();
  });
});

describe("matcherMatches", () => {
  it("treats undefined as match-all", () => {
    expect(matcherMatches(undefined, "bash")).toBe(true);
  });

  it("treats empty string as match-all", () => {
    expect(matcherMatches("", "x")).toBe(true);
  });

  it("treats * as match-all", () => {
    expect(matcherMatches("*", "x")).toBe(true);
  });

  it("compiles other values as regex", () => {
    expect(matcherMatches("bash", "bash")).toBe(true);
    expect(matcherMatches("write|edit", "edit")).toBe(true);
    expect(matcherMatches("bash", "read")).toBe(false);
  });

  it("falls back to exact match on invalid regex", () => {
    expect(matcherMatches("[", "x")).toBe(false);
    expect(matcherMatches("[", "[")).toBe(true);
  });
});
