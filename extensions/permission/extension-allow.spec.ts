import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import {
  getDerivedExtensionAllowState,
  resolveSingleMode,
  resetDerivedExtensionAllowStateCacheForTest,
} from "./index.js";
import type { PermissionSettings, RuntimeSessionState } from "./models.js";

const state: RuntimeSessionState = { modeOverrides: new Map(), approvalRules: new Set() };

function extensionTool(name: string, path: string, source: "local" | "cli" = "cli"): ToolInfo {
  return {
    name,
    description: `test ${name}`,
    parameters: {},
    exposure: "direct",
    sourceInfo: { path, source, scope: "user", origin: "top-level", baseDir: join(path, "..") },
  };
}

function builtinTool(name: string): ToolInfo {
  return {
    name,
    description: `builtin ${name}`,
    parameters: {},
    exposure: "direct",
    sourceInfo: { path: `builtin:${name}`, source: "builtin", scope: "user", origin: "top-level" },
  };
}

function mcpTool(name: string): ToolInfo {
  return {
    name,
    description: `mcp ${name}`,
    parameters: {},
    exposure: "direct",
    namespace: { name: "mcp__docs" },
    sourceInfo: { path: `mcp__docs/${name}`, source: "mcp", scope: "user", origin: "top-level" },
  };
}

function fakePi(tools: ToolInfo[]): ExtensionAPI {
  return {
    getAllTools: () => tools,
  } as unknown as ExtensionAPI;
}

function resolve(settings: PermissionSettings, toolName: string, pi: ExtensionAPI): "allow" | "ask" | "deny" {
  return resolveSingleMode(settings, toolName, "", state, getDerivedExtensionAllowState(pi));
}

describe("dynamic extension allow", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "perm-ext-"));
    mkdirSync(join(dir, "todo"), { recursive: true });
    mkdirSync(join(dir, "notebook"), { recursive: true });
    writeFileSync(join(dir, "todo", "index.ts"), "export default () => {}");
    writeFileSync(join(dir, "notebook", "index.ts"), "export default () => {}");
    resetDerivedExtensionAllowStateCacheForTest();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe.each([
    { name: "extension-registered tool resolves to allow", scenario: R1 },
    { name: "builtin tool keeps its existing resolution", scenario: R2 },
    { name: "deny rule beats the extension auto-allow", scenario: R3 },
    { name: "ask rule beats the extension auto-allow", scenario: R4 },
    { name: "a newly registered extension tool is picked up", scenario: R5 },
    { name: "namespaced (MCP) tool is not auto-allowed", scenario: R6 },
  ])("R1–R6", ({ name }) => {
    it(name, () => {
      resetDerivedExtensionAllowStateCacheForTest();
      const todoPath = join(dir, "todo", "index.ts");

      switch (name) {
        case "extension-registered tool resolves to allow": {
          expect(resolve({}, "todo", fakePi([extensionTool("todo", todoPath), builtinTool("bash")]))).toBe("allow");
          expect(resolve({}, "todo", fakePi([extensionTool("todo", todoPath, "local"), builtinTool("bash")]))).toBe("allow");
          break;
        }
        case "builtin tool keeps its existing resolution": {
          expect(resolve({}, "bash", fakePi([builtinTool("bash")]))).toBe("ask");
          expect(resolve({}, "edit", fakePi([builtinTool("bash")]))).toBe("ask");
          break;
        }
        case "deny rule beats the extension auto-allow": {
          expect(resolve({ deny: ["todo"] }, "todo", fakePi([extensionTool("todo", todoPath)]))).toBe("deny");
          break;
        }
        case "ask rule beats the extension auto-allow": {
          expect(resolve({ ask: ["todo"] }, "todo", fakePi([extensionTool("todo", todoPath)]))).toBe("ask");
          break;
        }
        case "a newly registered extension tool is picked up": {
          const notebookPath = join(dir, "notebook", "index.ts");
          expect(resolve({}, "notebook", fakePi([extensionTool("todo", todoPath), extensionTool("notebook", notebookPath)]))).toBe("allow");
          break;
        }
        case "namespaced (MCP) tool is not auto-allowed": {
          expect(resolve({}, "docs.search", fakePi([mcpTool("docs.search"), extensionTool("todo", todoPath)]))).toBe("ask");
          break;
        }
      }
    });
  });

  it("caches until the tool list changes", () => {
    const todoPath = join(dir, "todo", "index.ts");
    const notebookPath = join(dir, "notebook", "index.ts");
    const tools: ToolInfo[] = [extensionTool("todo", todoPath)];
    const pi = fakePi(tools);
    resetDerivedExtensionAllowStateCacheForTest();
    const first = getDerivedExtensionAllowState(pi);
    const second = getDerivedExtensionAllowState(pi);
    expect(second).toBe(first);
    expect(getDerivedExtensionAllowState(fakePi(tools))).toBe(first);
    const expanded: ToolInfo[] = [...tools, extensionTool("notebook", notebookPath)];
    const expandedState = getDerivedExtensionAllowState(fakePi(expanded));
    expect(expandedState).not.toBe(first);
    expect(expandedState.tools).toContain("notebook");
    expect(getDerivedExtensionAllowState(fakePi(expanded))).toBe(expandedState);
  });

  it("resets the extension allow cache for tests", () => {
    const todoPath = join(dir, "todo", "index.ts");
    const pi = fakePi([extensionTool("todo", todoPath)]);
    resetDerivedExtensionAllowStateCacheForTest();
    const first = getDerivedExtensionAllowState(pi);
    const second = getDerivedExtensionAllowState(pi);
    expect(second).toBe(first);
  });
});

const R1 = "extension-registered tool resolves to allow";
const R2 = "builtin tool keeps its existing resolution";
const R3 = "deny rule beats the extension auto-allow";
const R4 = "ask rule beats the extension auto-allow";
const R5 = "a newly registered extension tool is picked up";
const R6 = "namespaced (MCP) tool is not auto-allowed";
