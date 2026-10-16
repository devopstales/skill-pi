import { assert, it } from "vitest";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import piPlanBuild from "./index.ts";
import { STATE_TYPE } from "./src/plan-state.ts";

interface MockPi {
	api: ExtensionAPI;
	tools: Map<string, unknown>;
	commands: Map<string, { description: string; handler: unknown }>;
	shortcuts: string[];
	flags: Map<string, unknown>;
	entryRenderers: Map<string, unknown>;
	messageRenderers: Map<string, unknown>;
	events: Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>;
	entries: Array<{ customType: string; data: unknown }>;
	activeTools: string[];
}

function makeCtx(overrides: Record<string, unknown> = {}): ExtensionContext {
	return {
		cwd: "/tmp",
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		hasPendingMessages: () => false,
		model: undefined,
		modelRegistry: { find: () => undefined },
		sessionManager: {
			getSessionId: () => "session-1",
			getBranch: () => [],
			getEntries: () => [],
			getSessionFile: () => undefined,
		},
		ui: {
			theme: { fg: (_: string, text: string) => text, bold: (text: string) => text },
			notify: () => undefined,
			select: async () => undefined,
			confirm: async () => true,
			setStatus: () => undefined,
			setWidget: () => undefined,
			setHeader: () => undefined,
			setFooter: () => undefined,
		},
		...overrides,
	} as unknown as ExtensionContext;
}

function mockPi(): MockPi {
	const mock: MockPi = {
		api: undefined as unknown as ExtensionAPI,
		tools: new Map<string, unknown>(),
		commands: new Map<string, { description: string; handler: unknown }>(),
		shortcuts: [],
		flags: new Map<string, unknown>(),
		entryRenderers: new Map<string, unknown>(),
		messageRenderers: new Map<string, unknown>(),
		events: new Map<string, Array<(event: unknown, ctx: ExtensionContext) => unknown>>(),
		entries: [],
		activeTools: [],
	};
	const api: ExtensionAPI = {
		on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) => {
			const list = mock.events.get(name) ?? [];
			list.push(handler);
			mock.events.set(name, list);
			return () => undefined;
		},
		registerTool: (tool: { name: string }) => {
			mock.tools.set(tool.name, tool);
		},
		registerCommand: (name: string, options: { description: string; handler: unknown }) => {
			mock.commands.set(name, options);
		},
		registerShortcut: (shortcut: string) => {
			mock.shortcuts.push(shortcut);
		},
		registerFlag: (name: string, flag: unknown) => {
			mock.flags.set(name, flag);
		},
		registerEntryRenderer: (type: string, renderer: unknown) => {
			mock.entryRenderers.set(type, renderer);
		},
		registerMessageRenderer: (type: string, renderer: unknown) => {
			mock.messageRenderers.set(type, renderer);
		},
		appendEntry: (customType: string, data: unknown) => {
			mock.entries.push({ customType, data });
		},
		sendMessage: () => undefined,
		sendUserMessage: () => undefined,
		getActiveTools: () => mock.activeTools,
		setActiveTools: (names: string[]) => {
			mock.activeTools = names;
		},
		getFlag: () => undefined,
		getThinkingLevel: () => "medium",
		setThinkingLevel: () => undefined,
		setModel: async () => true,
	} as unknown as ExtensionAPI;
		mock.api = api;
	return mock;
}

it("registers all plan tools, commands, flags, and shortcuts", () => {
	const pi = mockPi();
	piPlanBuild(pi.api);
	for (const name of ["plan_task", "plan_exit", "plan_complete", "plan_finish", "plan_step_control", "plan_step_complete"]) {
		assert.ok(pi.tools.has(name), `tool ${name} registered`);
	}
	for (const name of ["plan", "build", "build-fresh", "plan-settings"]) {
		assert.ok(pi.commands.has(name), `command ${name} registered`);
	}
	assert.ok(pi.flags.has("plan"), "plan flag");
	assert.ok(pi.flags.has("build"), "build flag");
	assert.equal(pi.shortcuts.length, 0, "mode keys are leader chords, not standalone shortcuts");
	assert.ok(pi.events.has("session_start"), "mode leader wired on session_start");
});

it("registers entry renderers for state, review, notices, and validation", () => {
	const pi = mockPi();
	piPlanBuild(pi.api);
	assert.ok(pi.entryRenderers.has(STATE_TYPE), "state entry renderer");
	assert.ok(pi.entryRenderers.has("skill-pi-plan-review"), "plan review renderer");
	assert.ok(pi.entryRenderers.has("skill-pi-plan-notice"), "mode notice renderer");
	assert.ok(pi.entryRenderers.has("skill-pi-plan-validation-notice"), "validation notice renderer");
	assert.ok(pi.entryRenderers.has("skill-pi-plan-inspection"), "inspection renderer");
	assert.ok(pi.messageRenderers.has("skill-pi-plan-fresh-announcement"), "fresh announcement message renderer");
});

it("wires session and tool events", () => {
	const pi = mockPi();
	piPlanBuild(pi.api);
	for (const name of ["session_start", "session_tree", "session_shutdown", "session_compact", "before_agent_start", "agent_settled", "agent_end", "input", "tool_call", "tool_result", "context"]) {
		assert.ok(pi.events.has(name), `event ${name} handled`);
	}
});

it("session_start restores state and applies mode routing", async () => {
	const pi = mockPi();
	piPlanBuild(pi.api);
	const ctx = makeCtx();
	const startHandlers = pi.events.get("session_start") ?? [];
	assert.ok(startHandlers.length > 0, "session_start handler present");
	await startHandlers[0]!({ reason: "startup" }, ctx);
	assert.deepEqual(pi.activeTools, [], "no plan tools active without a plan in Build mode");
});

it("plan_task new creates a plan and persists state", async () => {
	const pi = mockPi();
	piPlanBuild(pi.api);
	const ctx = makeCtx();
	const startHandlers = pi.events.get("session_start") ?? [];
	await startHandlers[0]!({ reason: "startup" }, ctx);
	const tool = pi.tools.get("plan_task") as { execute: (id: string, params: unknown, signal: undefined, onUpdate: undefined, ctx: ExtensionContext) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }> };
	const planCommand = pi.commands.get("plan") as { handler: (args: string, ctx: ExtensionContext) => Promise<void> };
	await planCommand.handler("", ctx);
	const result = await tool.execute("id", { action: "new", expectedAttached: null, title: "Fix login", scope: "Handle 302 loops" }, undefined, undefined, ctx);
	assert.match(result.content[0]!.text ?? "", /New plan started/);
	assert.ok(pi.entries.some((entry) => entry.customType === STATE_TYPE), "state persisted to the transcript");
});
