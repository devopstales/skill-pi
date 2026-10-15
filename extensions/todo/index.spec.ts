import { assert, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piTodo, { todoCollapseKey, todoEnabled } from "./index.ts";
import { TODO_STATE_MESSAGE_TYPE, TODO_TOOL_NAME } from "./src/model.ts";

interface RecordedTool {
  name: string;
  execute: (toolCallId: string, params: unknown, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }>;
}

interface RecordedShortcut {
  shortcut: string;
}

interface MockPi {
  tools: Map<string, RecordedTool>;
  shortcuts: string[];
  events: Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>;
  sent: Array<{ customType: string; content: string; display: boolean }>;
  ctx: ExtensionContext;
}

function makeCtx(overrides: Record<string, unknown> = {}): ExtensionContext {
  const defaults: Record<string, unknown> = {
    ui: {
      setWidget: () => undefined,
      setFooter: () => undefined,
      setHeader: () => undefined,
      notify: () => undefined,
      select: async () => undefined,
      confirm: async () => true,
      input: async () => undefined,
      custom: async () => undefined,
      onTerminalInput: () => () => undefined,
      setStatus: () => undefined,
      setWorkingMessage: () => undefined,
      setWorkingVisible: () => undefined,
      setWorkingIndicator: () => undefined,
      setHiddenThinkingLabel: () => undefined,
      setTitle: () => undefined,
      pasteToEditor: () => undefined,
      setEditorText: () => undefined,
      getEditorText: () => "",
      editor: async () => undefined,
      addAutocompleteProvider: () => undefined,
      setEditorComponent: () => undefined,
      getEditorComponent: () => undefined,
      getToolsExpanded: () => false,
      setToolsExpanded: () => undefined,
    },
    mode: "tui",
    hasUI: true,
    cwd: "/tmp",
    sessionManager: {
      getSessionId: () => "test-session",
      getBranch: () => [],
    },
    isIdle: () => true,
    isProjectTrusted: () => true,
    abort: () => undefined,
    hasPendingMessages: () => false,
    shutdown: () => undefined,
    getContextUsage: () => undefined,
    compact: () => undefined,
    getSystemPrompt: () => "",
  };
  const ctx = { ...defaults, ...overrides };
  return ctx as unknown as ExtensionContext;
}

function makePi(): MockPi {
  const ctx = makeCtx();
  const mock: MockPi = {
    tools: new Map(),
    shortcuts: [],
    events: new Map(),
    sent: [],
    ctx,
  };
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      const list = mock.events.get(event) ?? [];
      list.push(handler);
      mock.events.set(event, list);
      return () => undefined;
    },
    registerTool: (tool: RecordedTool & { name: string }) => {
      mock.tools.set(tool.name, tool);
    },
    registerShortcut: (shortcut: string) => {
      mock.shortcuts.push(shortcut);
    },
    registerCommand: () => undefined,
    registerFlag: () => undefined,
    getFlag: () => undefined,
    registerMessageRenderer: () => undefined,
    registerMarkdownTransformer: () => undefined,
    registerEntryRenderer: () => undefined,
    registerToolRenderer: () => undefined,
    sendMessage: (message: { customType: string; content: string; display: boolean }) => {
      mock.sent.push(message);
    },
    sendUserMessage: () => undefined,
    appendEntry: () => undefined,
    setSessionName: () => undefined,
    getSessionName: () => undefined,
    setLabel: () => undefined,
    exec: async () => ({ code: 0, stdout: "", stderr: "" }),
    getActiveTools: () => [],
    getAllTools: () => [],
    getSettings: () => ({}),
    setActiveTools: () => undefined,
    getCommands: () => [],
    setModel: async () => true,
    getThinkingLevel: () => "off",
    setThinkingLevel: () => undefined,
    registerProvider: () => undefined,
    unregisterProvider: () => undefined,
    registerMcpServer: () => undefined,
    unregisterMcpServer: () => undefined,
    getMcpServers: () => [],
    registerVirtualModel: () => undefined,
    unregisterVirtualModel: () => undefined,
    events: { emit: () => undefined },
  } as unknown as ExtensionAPI;
  piTodo(pi);
  return mock;
}

function emit(mock: MockPi, event: string, payload: unknown = {}, ctx: ExtensionContext = mock.ctx): unknown {
  const handlers = mock.events.get(event) ?? [];
  let last: unknown;
  for (const handler of handlers) {
    const result = handler(payload, ctx);
    if (result !== undefined) last = result;
  }
  return last;
}

it("registers the todo tool and default shortcuts", () => {
  const mock = makePi();
  assert.ok(mock.tools.get(TODO_TOOL_NAME), "todo tool registered");
  assert.ok(mock.shortcuts.includes("ctrl+shift+t"), "collapse shortcut registered");
  assert.ok(mock.shortcuts.includes("alt+shift+up"), "scroll-up shortcut registered");
  assert.ok(mock.shortcuts.includes("alt+shift+down"), "scroll-down shortcut registered");
});

it("write + list: mutates state and reports it back", async () => {
  const mock = makePi();
  const tool = mock.tools.get(TODO_TOOL_NAME)!;
  const write = await tool.execute("1", { action: "write", tasks: [{ title: "A" }, { title: "B" }] }, undefined, undefined, mock.ctx);
  assert.match(write.content[0].text ?? "", /2 task/);
  assert.ok((write.details as { piTodoState: { tasks: unknown[] } }).piTodoState.tasks.length === 2);
  const list = await tool.execute("2", { action: "list" }, undefined, undefined, mock.ctx);
  assert.match(list.content[0].text ?? "", /A/);
  assert.match(list.content[0].text ?? "", /0\/2 done/);
});

it("write persists a hidden state message for the transcript", async () => {
  const mock = makePi();
  const tool = mock.tools.get(TODO_TOOL_NAME)!;
  await tool.execute("1", { action: "write", tasks: [{ title: "A" }] }, undefined, undefined, mock.ctx);
  assert.equal(mock.sent.length, 1);
  assert.equal(mock.sent[0].customType, TODO_STATE_MESSAGE_TYPE);
  assert.equal(mock.sent[0].display, false);
  assert.match(mock.sent[0].content, /- \[1\] A \(pending\)/);
  const again = await tool.execute("2", { action: "list" }, undefined, undefined, mock.ctx);
  assert.ok(again.content[0]);
  assert.equal(mock.sent.length, 1, "list does not re-persist");
});

it("clear on an all-done list persists the closed marker", async () => {
  const mock = makePi();
  const tool = mock.tools.get(TODO_TOOL_NAME)!;
  await tool.execute("1", { action: "write", tasks: [{ title: "A", status: "done" }] }, undefined, undefined, mock.ctx);
  const before = mock.sent.length;
  assert.ok(before >= 1);
  await tool.execute("2", { action: "clear" }, undefined, undefined, mock.ctx);
  const last = mock.sent[mock.sent.length - 1];
  assert.equal(last.content, "closed");
});

it("context handler re-attaches the snapshot to a transcript that lost it", async () => {
  const mock = makePi();
  const tool = mock.tools.get(TODO_TOOL_NAME)!;
  await tool.execute("1", { action: "write", tasks: [{ title: "A" }] }, undefined, undefined, mock.ctx);
  const firstSnapshot = mock.sent[0].content;
  // Simulate the transcript having lost the snapshot (e.g. compaction) by
  // updating the list: the in-memory state now differs from the last snapshot.
  await tool.execute("2", { action: "update", id: 1, title: "A2" }, undefined, undefined, mock.ctx);
  const result = (await Promise.resolve(
    emit(mock, "context", { messages: [] }),
  )) as { messages: unknown[] } | undefined;
  assert.ok(result, `context handler returns trailing messages (firstSnapshot=${firstSnapshot}, sent=${mock.sent.length})`);
  assert.equal(result!.messages.length, 1);
  const trailing = result!.messages[0] as { customType: string; content: string };
  assert.equal(trailing.customType, TODO_STATE_MESSAGE_TYPE);
  assert.match(trailing.content, /- \[1\] A2 \(pending\)/);
});

it("context handler is a no-op when the snapshot is already present", async () => {
  const mock = makePi();
  const tool = mock.tools.get(TODO_TOOL_NAME)!;
  await tool.execute("1", { action: "write", tasks: [{ title: "A" }] }, undefined, undefined, mock.ctx);
  const snapshot = mock.sent[0].content;
  const result = (await Promise.resolve(
    emit(mock, "context", { messages: [{ customType: TODO_STATE_MESSAGE_TYPE, content: snapshot }] }),
  )) as { messages: unknown[] } | undefined;
  assert.equal(result, undefined, "no trailing message needed");
});

it("session_start replays the list from the branch", async () => {
  const mock = makePi();
  const tool = mock.tools.get(TODO_TOOL_NAME)!;
  await tool.execute("1", { action: "write", tasks: [{ title: "A" }] }, undefined, undefined, mock.ctx);
  assert.ok(mock.sent.length > 0);
  const snapshotContent = mock.sent[0].content;
  const replayedCtx = makeCtx({
    sessionManager: {
      getSessionId: () => "other-session",
      getBranch: () => [
        { type: "custom_message", customType: TODO_STATE_MESSAGE_TYPE, content: snapshotContent, display: false },
      ],
    },
  });
  emit(mock, "session_start", { reason: "startup" }, replayedCtx);
  emit(mock, "before_agent_start", { type: "before_agent_start", systemPrompt: "" }, replayedCtx);
  const list = await tool.execute("2", { action: "list" }, undefined, undefined, replayedCtx);
  assert.match(list.content[0].text ?? "", /A/);
  assert.match(list.content[0].text ?? "", /0\/1 done/);
});

it("env: SKILL_PI_TODO=0 disables the extension", () => {
  assert.equal(todoEnabled({ SKILL_PI_TODO: "0" } as NodeJS.ProcessEnv), false);
  assert.equal(todoEnabled({ SKILL_PI_TODO: "off" } as NodeJS.ProcessEnv), false);
  assert.equal(todoEnabled({} as NodeJS.ProcessEnv), true);
  assert.equal(todoEnabled({ SKILL_PI_TODO: "1" } as NodeJS.ProcessEnv), true);
});

it("env: SKILL_PI_TODO_KEY customizes or disables the collapse key", () => {
  assert.equal(todoCollapseKey({ SKILL_PI_TODO_KEY: "alt+t" } as NodeJS.ProcessEnv), "alt+t");
  assert.equal(todoCollapseKey({ SKILL_PI_TODO_KEY: "off" } as NodeJS.ProcessEnv), undefined);
  assert.equal(todoCollapseKey({ SKILL_PI_TODO_KEY: "" } as NodeJS.ProcessEnv), undefined);
  assert.equal(todoCollapseKey({} as NodeJS.ProcessEnv), "ctrl+shift+t");
});

it("main-view widget renders nothing (todo lives only in the sidebar rail)", async () => {
  const captured: Array<{ key: string; factory: unknown }> = [];
  const ctx = makeCtx({
    ui: {
      ...makeCtx().ui,
      setWidget(key: string, factory: unknown): void {
        captured.push({ key, factory });
      },
    },
  });
  const mock: MockPi = { tools: new Map(), shortcuts: [], events: new Map(), sent: [], ctx };
  const pi = {
    on: (event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
      const list = mock.events.get(event) ?? [];
      list.push(handler);
      mock.events.set(event, list);
      return () => undefined;
    },
    registerTool: (tool: RecordedTool & { name: string }) => { mock.tools.set(tool.name, tool); },
    registerShortcut: (shortcut: string) => { mock.shortcuts.push(shortcut); },
    sendMessage: () => undefined,
  } as unknown as ExtensionAPI;
  piTodo(pi);
  for (const handler of mock.events.get("session_start") ?? []) handler({ reason: "startup" }, ctx);
  const tool = mock.tools.get(TODO_TOOL_NAME)!;
  await tool.execute("1", { action: "write", tasks: [{ title: "A" }] }, undefined, undefined, ctx);
  for (const handler of mock.events.get("tool_execution_end") ?? []) handler({ toolName: TODO_TOOL_NAME }, ctx);
  const set = captured.find((w) => w.key === "pi-todo" && typeof w.factory === "function");
  assert.ok(set, `widget factory registered; got: ${JSON.stringify(captured.map((w) => [w.key, typeof w.factory]))}`);
  const widget = (set!.factory as (tui: unknown, theme: unknown) => { render: (width: number) => string[] })({ terminal: {} }, { fg: (_c: string, t: string) => t })!;
  assert.deepEqual(widget.render(120), [], "main-view widget renders nothing");
});

it("disabled env: registers nothing", () => {
  const ctx = makeCtx();
  const mock: MockPi = { tools: new Map(), shortcuts: [], events: new Map(), sent: [], ctx };
  const pi = {
    on: () => () => undefined,
    registerTool: () => undefined,
    registerShortcut: () => undefined,
  } as unknown as ExtensionAPI;
  const original = process.env;
  process.env = { ...original, SKILL_PI_TODO: "0" } as NodeJS.ProcessEnv;
  try {
    piTodo(pi);
  } finally {
    process.env = original;
  }
  assert.equal(mock.tools.size, 0);
  assert.equal(mock.shortcuts.length, 0);
});
