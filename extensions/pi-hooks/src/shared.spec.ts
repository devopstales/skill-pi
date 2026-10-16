import { describe, it, expect } from "vitest";
import {
  appendAdditionalContext,
  extractCommonOutput,
  extractToolResultPatch,
  getStringField,
  hookIfMatches,
  parseJsonOutput,
} from "./hooks/shared.ts";
import type { HookExecutionContext } from "./types.ts";

function makeContext(overrides: Partial<HookExecutionContext> = {}): HookExecutionContext {
  return {
    sessionId: "s1",
    cwd: "/x",
    hookEventName: "Stop",
    ...overrides,
  };
}

describe("hookIfMatches", () => {
  it("returns false for non-tool events with a condition", () => {
    const context = makeContext({ hookEventName: "Stop" });
    expect(hookIfMatches(context, "Bash(*)")).toBe(false);
  });

  it("matches tool name case-insensitively with a glob pattern", () => {
    const context = makeContext({
      hookEventName: "PreToolUse",
      toolName: "bash",
      toolInput: { command: "git push origin" },
    });
    expect(hookIfMatches(context, "Bash(git push*)")).toBe(true);
  });

  it("returns false when the pattern does not match the tool input", () => {
    const context = makeContext({
      hookEventName: "PreToolUse",
      toolName: "bash",
      toolInput: { command: "git status" },
    });
    expect(hookIfMatches(context, "Bash(git push*)")).toBe(false);
  });

  it("matches edit path patterns", () => {
    const context = makeContext({
      hookEventName: "PreToolUse",
      toolName: "edit",
      toolInput: { path: "a/b.ts" },
    });
    expect(hookIfMatches(context, "Edit(*.ts)")).toBe(true);
  });

  it("returns false for a non-matching edit path pattern", () => {
    const context = makeContext({
      hookEventName: "PreToolUse",
      toolName: "edit",
      toolInput: { path: "a/b.ts" },
    });
    expect(hookIfMatches(context, "Edit(*.md)")).toBe(false);
  });

  it("returns true when no condition is given", () => {
    const context = makeContext({
      hookEventName: "PreToolUse",
      toolName: "bash",
      toolInput: { command: "anything" },
    });
    expect(hookIfMatches(context, undefined)).toBe(true);
  });

  it("matches read path patterns case-insensitively", () => {
    const context = makeContext({
      hookEventName: "PreToolUse",
      toolName: "read",
      toolInput: { path: "x" },
    });
    expect(hookIfMatches(context, "Read(*)")).toBe(true);
  });
});

describe("parseJsonOutput", () => {
  it("parses empty object json", () => {
    expect(parseJsonOutput("{}")).toEqual({});
  });

  it("returns undefined for non-json", () => {
    expect(parseJsonOutput("not json")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseJsonOutput("")).toBeUndefined();
  });

  it("trims surrounding whitespace before parsing", () => {
    expect(parseJsonOutput('  {"a":1}  ')).toEqual({ a: 1 });
  });
});

describe("extractCommonOutput", () => {
  it("maps continue:false to stopProcessing:true", () => {
    const result = extractCommonOutput("PreToolUse", { continue: false });
    expect(result.stopProcessing).toBe(true);
  });

  it("drops hookSpecificOutput when hookEventName does not match", () => {
    const result = extractCommonOutput("PreToolUse", {
      hookSpecificOutput: { hookEventName: "Stop" },
    });
    expect(result.hookSpecificOutput).toBeUndefined();
  });

  it("captures systemMessage", () => {
    const result = extractCommonOutput("Stop", { systemMessage: "hi" });
    expect(result.systemMessage).toBe("hi");
  });

  it("captures stopReason", () => {
    const result = extractCommonOutput("Stop", { stopReason: "x" });
    expect(result.stopReason).toBe("x");
  });
});

describe("extractToolResultPatch", () => {
  it("prefers hookSpecificOutput.updatedToolResult.content over top-level content", () => {
    const result = extractToolResultPatch("PostToolUse", {
      content: "top",
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedToolResult: { content: "patched" },
      },
    });
    expect(result.content).toBe("patched");
  });

  it("falls back to updatedMCPToolOutput when no updatedToolResult", () => {
    const result = extractToolResultPatch("PostToolUse", {
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        updatedMCPToolOutput: "mcp",
      },
    });
    expect(result.content).toBe("mcp");
  });

  it("returns all-undefined fields when no patch fields are present", () => {
    const result = extractToolResultPatch("PostToolUse", {});
    expect(result).toEqual({ content: undefined, details: undefined, isError: undefined });
  });
});

describe("appendAdditionalContext", () => {
  it("joins current and next with a newline", () => {
    expect(appendAdditionalContext("a", "b")).toBe("a\nb");
  });

  it("returns next when current is undefined", () => {
    expect(appendAdditionalContext(undefined, "b")).toBe("b");
  });

  it("returns current when next is undefined", () => {
    expect(appendAdditionalContext("a", undefined)).toBe("a");
  });

  it("returns undefined when both are undefined", () => {
    expect(appendAdditionalContext(undefined, undefined)).toBeUndefined();
  });
});

describe("getStringField", () => {
  it("returns the first non-empty string", () => {
    expect(getStringField("a", "b")).toBe("a");
  });

  it("skips empty strings", () => {
    expect(getStringField("", "b")).toBe("b");
  });

  it("returns undefined when all values are empty", () => {
    expect(getStringField("", "")).toBeUndefined();
  });

  it("skips non-string values", () => {
    expect(getStringField(undefined, "x")).toBe("x");
  });
});
