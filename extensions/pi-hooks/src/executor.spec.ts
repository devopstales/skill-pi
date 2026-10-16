import { describe, it, expect } from "vitest";
import { buildHookInput } from "./executor.ts";
import type { HookExecutionContext } from "./types.ts";

function makeContext(overrides: Partial<HookExecutionContext> = {}): HookExecutionContext {
  return {
    sessionId: "s1",
    cwd: "/x",
    hookEventName: "SessionStart",
    ...overrides,
  };
}

describe("buildHookInput", () => {
  it("shapes SessionStart input", () => {
    const input = buildHookInput(
      makeContext({
        hookEventName: "SessionStart",
        source: "startup",
        sessionId: "s1",
        cwd: "/x",
        transcriptPath: "/t.jsonl",
      }),
    ) as Record<string, unknown>;

    expect(input).toMatchObject({
      session_id: "s1",
      cwd: "/x",
      hook_event_name: "SessionStart",
      source: "startup",
      transcript_path: "/t.jsonl",
    });
  });

  it("shapes UserPromptSubmit input", () => {
    const input = buildHookInput(
      makeContext({
        hookEventName: "UserPromptSubmit",
        prompt: "hi",
      }),
    ) as Record<string, unknown>;

    expect(input).toMatchObject({
      prompt: "hi",
      hook_event_name: "UserPromptSubmit",
    });
  });

  it("shapes Stop input", () => {
    const input = buildHookInput(
      makeContext({
        hookEventName: "Stop",
        stopHookActive: true,
        lastAssistantMessage: "done",
      }),
    ) as Record<string, unknown>;

    expect(input).toMatchObject({
      stop_hook_active: true,
      last_assistant_message: "done",
      hook_event_name: "Stop",
    });
  });

  it("shapes PreToolUse input", () => {
    const input = buildHookInput(
      makeContext({
        hookEventName: "PreToolUse",
        toolName: "bash",
        toolInput: { command: "ls" },
        toolUseId: "t1",
      }),
    ) as Record<string, unknown>;

    expect(input).toMatchObject({
      tool_name: "bash",
      tool_input: { command: "ls" },
      tool_use_id: "t1",
      hook_event_name: "PreToolUse",
    });
  });

  it("shapes PostToolUse input with tool response", () => {
    const input = buildHookInput(
      makeContext({
        hookEventName: "PostToolUse",
        toolName: "bash",
        toolInput: { command: "ls" },
        toolUseId: "t1",
        toolResponse: { output: "ok" },
      }),
    ) as Record<string, unknown>;

    expect(input).toMatchObject({
      tool_name: "bash",
      tool_input: { command: "ls" },
      tool_use_id: "t1",
      tool_response: { output: "ok" },
      hook_event_name: "PostToolUse",
    });
  });

  it("shapes PostToolUseFailure input with error", () => {
    const input = buildHookInput(
      makeContext({
        hookEventName: "PostToolUseFailure",
        toolName: "bash",
        toolInput: { command: "ls" },
        toolUseId: "t1",
        error: "boom",
      }),
    ) as Record<string, unknown>;

    expect(input).toMatchObject({
      error: "boom",
      hook_event_name: "PostToolUseFailure",
    });
  });

  it("shapes SessionEnd input with reason", () => {
    const input = buildHookInput(
      makeContext({
        hookEventName: "SessionEnd",
        reason: "other",
      }),
    ) as Record<string, unknown>;

    expect(input).toMatchObject({
      reason: "other",
      hook_event_name: "SessionEnd",
    });
  });
});
