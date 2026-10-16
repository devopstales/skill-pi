import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  triggerPostToolUseFailureHooks,
  triggerPostToolUseHooks,
} from "./tool-hooks.ts";
import { executeParsedHook } from "./shared.ts";
import type { HookExecutionContext, SettingsFile } from "../types.ts";

vi.mock("./shared.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./shared.ts")>();
  return {
    ...actual,
    executeParsedHook: vi.fn(),
  };
});

function makeContext(event: "PostToolUse" | "PostToolUseFailure"): HookExecutionContext {
  return {
    sessionId: "s1",
    cwd: "/x",
    hookEventName: event,
    toolName: "bash",
    toolInput: { command: "ls" },
    toolUseId: "t1",
  };
}

function makeSettings(event: "PostToolUse" | "PostToolUseFailure"): SettingsFile {
  return {
    hooks: {
      [event]: [
        {
          hooks: [
            { type: "command", command: "a" },
            { type: "command", command: "b" },
            { type: "command", command: "c" },
          ],
        },
      ],
    },
  };
}

const exit2 = {
  hookResult: { stdout: "", stderr: "feedback", exitCode: 2 },
  plainStdout: "",
  jsonOutput: undefined,
  commonOutput: undefined,
};

const exit1 = {
  hookResult: { stdout: "", stderr: "", exitCode: 1 },
  plainStdout: "",
  jsonOutput: undefined,
  commonOutput: undefined,
};

const jsonContext = {
  hookResult: { stdout: "", stderr: "", exitCode: 0 },
  plainStdout: "",
  jsonOutput: { additionalContext: "ctx" },
  commonOutput: {
    hookSpecificOutput: undefined,
    systemMessage: undefined,
    suppressOutput: false,
    stopProcessing: false,
  },
};

describe("triggerPostToolUseHooks", () => {
  beforeEach(() => {
    vi.mocked(executeParsedHook)
      .mockReset()
      .mockResolvedValueOnce(exit2)
      .mockResolvedValueOnce(exit1)
      .mockResolvedValueOnce(jsonContext);
  });

  it("notifies feedback for exit 2, error for other failures, and collects context", async () => {
    const notifications: Array<[string, "info" | "error" | "warning"]> = [];

    const result = await triggerPostToolUseHooks(
      "bash",
      makeContext("PostToolUse"),
      makeSettings("PostToolUse"),
      (message, type) => notifications.push([message, type]),
    );

    expect(result.additionalContext).toBe("ctx");
    expect(notifications).toEqual([
      ["PostToolUse feedback: feedback", "warning"],
      ["PostToolUse hook failed (exit 1): ", "error"],
    ]);
    expect(vi.mocked(executeParsedHook)).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(executeParsedHook).mock.calls.every((call) => call[2] === "PostToolUse"),
    ).toBe(true);
  });
});

describe("triggerPostToolUseFailureHooks", () => {
  beforeEach(() => {
    vi.mocked(executeParsedHook)
      .mockReset()
      .mockResolvedValueOnce(exit2)
      .mockResolvedValueOnce(exit1)
      .mockResolvedValueOnce(jsonContext);
  });

  it("notifies feedback for exit 2, error for other failures, and collects context", async () => {
    const notifications: Array<[string, "info" | "error" | "warning"]> = [];

    const result = await triggerPostToolUseFailureHooks(
      "bash",
      makeContext("PostToolUseFailure"),
      makeSettings("PostToolUseFailure"),
      (message, type) => notifications.push([message, type]),
    );

    expect(result.additionalContext).toBe("ctx");
    expect(notifications).toEqual([
      ["PostToolUseFailure feedback: feedback", "warning"],
      ["PostToolUseFailure hook failed (exit 1): ", "error"],
    ]);
    expect(vi.mocked(executeParsedHook)).toHaveBeenCalledTimes(3);
    expect(
      vi.mocked(executeParsedHook).mock.calls.every((call) => call[2] === "PostToolUseFailure"),
    ).toBe(true);
  });
});
