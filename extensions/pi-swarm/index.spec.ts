import { describe, it, expect, vi } from "vitest";
import type { AgentSnapshot } from "./src/domain.ts";
import type { EventBus, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

function snap(over: Partial<AgentSnapshot>): AgentSnapshot {
  return {
    id: "sa-1",
    title: "t",
    agentType: "",
    status: "running",
    createdAt: 0,
    turns: 0,
    tokens: 0,
    finalText: "",
    latestText: "",
    consumed: false,
    transcript: [],
    ...over,
  };
}

interface FakeManager {
  spawn: (req: { prompt: string; title?: string; agentType?: string; model?: string }) => AgentSnapshot;
  waitFor: (ids: string[]) => Promise<AgentSnapshot[]>;
  list: () => readonly AgentSnapshot[];
  get: (id: string) => AgentSnapshot | undefined;
  send: (id: string, text: string) => void;
  cancel: (id: string) => Promise<AgentSnapshot | void>;
  check: (id: string) => AgentSnapshot;
  subscribe: (l: () => void) => () => void;
  subscribeTo: (id: string, l: (s: AgentSnapshot) => void) => () => void;
  disposeAll: () => Promise<void>;
  children: Map<string, unknown>;
}

function makeFakeManager(agents: AgentSnapshot[]): FakeManager {
  const records = new Map(agents.map((a) => [a.id, { ...a }]));
  const unknownId = (id: string) =>
    `unknown agent id: ${id}; known: ${[...records.keys()].length === 0 ? "(none)" : [...records.keys()].join(", ")}`;
  return {
    spawn: (req) => {
      const id = `sa-${records.size + 1}`;
      const s = snap({ id, ...req });
      records.set(id, s);
      return s;
    },
    waitFor: async (ids) => ids.map((id) => records.get(id)!),
    list: () => [...records.values()],
    get: (id) => records.get(id),
    send: (id, _text) => {
      if (!records.has(id)) throw new Error(unknownId(id));
    },
    cancel: async (id) => {
      if (!records.has(id)) throw new Error(unknownId(id));
      const s = records.get(id)!;
      if (s.status === "running" || s.status === "queued") {
        s.status = "interrupted";
        s.settledAt = 123;
      }
    },
    check: (id) => {
      const s = records.get(id);
      if (!s) throw new Error(unknownId(id));
      return s;
    },
    subscribe: () => () => {},
    subscribeTo: () => () => {},
    disposeAll: async () => {},
    children: new Map(),
  };
}

let terminalInputHandlers: Array<(data: string) => unknown> = [];

function makeCtx(): { ctx: ExtensionContext; setStatus: ReturnType<typeof vi.fn> } {
  const setStatus = vi.fn();
  const ctx: {
    ui: {
      setStatus: ReturnType<typeof vi.fn>;
      onTerminalInput: (h: (data: string) => unknown) => () => void;
      setWidget: (key: string, content: unknown, options?: unknown) => void;
      getEditorText: () => string;
    };
    mode: string;
    hasUI: boolean;
    cwd: string;
    sessionManager: { getSessionId: () => string };
  } = {
    ui: {
      setStatus,
      onTerminalInput: (h: (data: string) => unknown) => {
        terminalInputHandlers.push(h);
        return () => {};
      },
      setWidget: vi.fn(),
      getEditorText: () => "",
    },
    mode: "tui",
    hasUI: true,
    cwd: "/tmp/project",
    sessionManager: { getSessionId: () => "sess-1" },
  };
  return { ctx: ctx as unknown as ExtensionContext, setStatus };
}

interface RegisteredTool {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((p: unknown) => void) | undefined,
    ctx: ExtensionContext,
  ) => Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown>; isError?: boolean }>;
}

let fakeManager: FakeManager;

vi.mock("./src/manager.ts", () => ({
  SwarmManager: (class { constructor() { return fakeManager; } }) as unknown as new (opts: unknown) => FakeManager,
  checkPreview: (t: string) => t,
  formatStatusline: (agents: AgentSnapshot[]) => {
    const counts = new Map<string, number>();
    for (const a of agents) counts.set(a.status, (counts.get(a.status) ?? 0) + 1);
    const parts = [...counts.entries()].map(([s, n]) => `${n} ${s}`);
    if (parts.length === 0) return undefined;
    const hasActionable = (counts.get("running") ?? 0) > 0 || (counts.get("queued") ?? 0) > 0;
    return hasActionable ? `swarm: ${parts.join(" · ")} · /swarm` : `swarm: ${parts.join(" · ")}`;
  },
  resultBody: (s: AgentSnapshot) => s.finalText || s.latestText || `${s.id} finished with no text output`,
  truncate: (t: string, b: number) => (t.length <= b ? t : t.slice(0, b) + `\n[truncated]`),
  waitPerAgentBudget: () => 16 * 1024,
}));

vi.mock("./src/child.ts", () => ({
  resolveSkillPiExe: () => "/tmp/skill-pi.js",
  buildChildInvocation: () => ({ argv: ["node", "skill-pi.js"], env: {} }),
}));

let agentDirOverride = "/tmp/agent";
vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...mod, getAgentDir: () => agentDirOverride };
});

import piSwarm from "./index.ts";

describe("pi-swarm index", () => {
  let tools: Map<string, RegisteredTool>;
  let ctx: ExtensionContext;
  let setStatus: ReturnType<typeof vi.fn>;
  let handlers: Map<string, unknown[]>;
  let busHandlers: Map<string, Array<(data: unknown) => void>>;

  const TAB = "\t";

  async function pressLeaderAction() {
    const handler = terminalInputHandlers[terminalInputHandlers.length - 1];
    if (!handler) throw new Error("no terminal input handler registered");
    handler("");
    await handler(TAB);
  }

  async function setup(agents: AgentSnapshot[]) {
    terminalInputHandlers = [];
    fakeManager = makeFakeManager(agents);
    tools = new Map<string, RegisteredTool>();
    handlers = new Map();
    busHandlers = new Map();
    const onBus = (channel: string, handler: (data: unknown) => void) => {
      const list = busHandlers.get(channel) ?? [];
      list.push(handler);
      busHandlers.set(channel, list);
      return () => {};
    };
    const pi = {
      registerTool: (def: RegisteredTool) => {
        tools.set(def.name, def);
      },
      registerMessageRenderer: vi.fn(),
      sendMessage: vi.fn(),
      on: (event: string, handler: unknown) => {
        const list = handlers.get(event) ?? [];
        list.push(handler);
        handlers.set(event, list);
        return () => {};
      },
      events: { emit: vi.fn(), on: onBus } as unknown as EventBus,
    } as unknown as ExtensionAPI;
    const result = makeCtx();
    ctx = result.ctx;
    setStatus = result.setStatus;
    piSwarm(pi, {});
  }

  function inputHandlers() {
    return handlers.get("input") ?? [];
  }

  function startSession() {
    const start = (handlers.get("session_start") ?? []) as Array<(ev: unknown, c: ExtensionContext) => unknown>;
    for (const handler of start) handler({ reason: "startup" }, ctx);
  }

  it("registers the six swarm tools", async () => {
    await setup([]);
    expect([...tools.keys()].sort()).toEqual(["swarm_cancel", "swarm_check", "swarm_list", "swarm_send", "swarm_spawn", "swarm_wait"]);
  });

  it("clears the swarm statusline when there are no agents", async () => {
    await setup([]);
    await tools.get("swarm_list")!.execute("tc", {}, undefined, undefined, ctx);
    expect(setStatus).toHaveBeenCalledWith("swarm", undefined);
  });

  it("sets the swarm statusline when agents are present", async () => {
    await setup([snap({ id: "sa-1", status: "running" })]);
    await tools.get("swarm_list")!.execute("tc", {}, undefined, undefined, ctx);
    expect(setStatus).toHaveBeenCalledWith("swarm", "swarm: 1 running · /swarm");
  });

  it("swarm_check on an unknown id returns a tool error listing known ids", async () => {
    await setup([snap({ id: "sa-1" })]);
    const result = await tools.get("swarm_check")!.execute("tc", { id: "sa-99" }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("sa-1");
  });

  it("swarm_check returns status, turns, and a preview without consuming", async () => {
    const latestText = Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n");
    await setup([snap({ id: "sa-1", status: "running", turns: 3, latestText })]);
    const result = await tools.get("swarm_check")!.execute("tc", { id: "sa-1" }, undefined, undefined, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("[running]");
    expect(result.content[0].text).toContain("turns: 3");
    expect(result.details.consumed).toBe(false);
  });

  it("swarm_send on an unknown id returns a tool error listing known ids", async () => {
    await setup([snap({ id: "sa-1" })]);
    const result = await tools.get("swarm_send")!.execute("tc", { id: "sa-99", text: "x" }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("sa-1");
  });

  it("swarm_send forwards text and reports the outcome", async () => {
    await setup([snap({ id: "sa-1", status: "running" })]);
    const sendSpy = vi.spyOn(fakeManager, "send");
    const result = await tools.get("swarm_send")!.execute("tc", { id: "sa-1", text: "steer me" }, undefined, undefined, ctx);
    expect(result.isError).toBeUndefined();
    expect(sendSpy).toHaveBeenCalledWith("sa-1", "steer me");
    expect(result.content[0].text).toContain("sa-1");
  });

  it("swarm_cancel on an unknown id returns a tool error listing known ids", async () => {
    await setup([snap({ id: "sa-1" })]);
    const result = await tools.get("swarm_cancel")!.execute("tc", { id: "sa-99" }, undefined, undefined, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("sa-1");
  });

  it("swarm_cancel of a running agent reports interrupted", async () => {
    await setup([snap({ id: "sa-1", status: "running" })]);
    const result = await tools.get("swarm_cancel")!.execute("tc", { id: "sa-1" }, undefined, undefined, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("interrupted");
  });

  it("swarm_cancel of a settled agent reports was already <status>", async () => {
    await setup([snap({ id: "sa-1", status: "done", settledAt: 123 })]);
    const result = await tools.get("swarm_cancel")!.execute("tc", { id: "sa-1" }, undefined, undefined, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("was already done");
  });

  it("swarm_spawn with an unknown agent_type returns a tool error listing known names", async () => {
    await setup([]);
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "pi-swarm-index-agents-"));
    fs.mkdirSync(path.join(project, ".skill-pi", "agents"), { recursive: true });
    fs.mkdirSync(path.join("/tmp/agent", "agents"), { recursive: true });
    fs.writeFileSync(path.join(project, ".skill-pi", "agents", "auditor.md"), "---\ndescription: a\n---\nA\n");
    fs.writeFileSync(path.join("/tmp/agent", "agents", "explorer.md"), "---\ndescription: e\n---\nE\n");
    ctx.cwd = project;
    try {
      const result = await tools.get("swarm_spawn")!.execute("tc", { prompt: "hi", agent_type: "ghost" }, undefined, undefined, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("auditor");
      expect(result.content[0].text).toContain("explorer");
      expect(result.content[0].text).toContain("ghost");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("swarm_spawn with a known agent_type resolves it, prefixes the prompt, explicit model wins", async () => {
    await setup([]);
    const spawnSpy = vi.spyOn(fakeManager, "spawn");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "pi-swarm-index-agents-"));
    fs.mkdirSync(path.join(project, ".skill-pi", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".skill-pi", "agents", "auditor.md"),
      "---\ndescription: a\nmodel: anthropic/claude-opus-4-6\n---\nAudit the code.\n",
    );
    ctx.cwd = project;
    try {
      const result = await tools.get("swarm_spawn")!.execute(
        "tc",
        { prompt: "Look at auth", agent_type: "auditor", model: "explicit-model" },
        undefined,
        undefined,
        ctx,
      );
      expect(result.isError).toBeUndefined();
      expect(spawnSpy).toHaveBeenCalledTimes(1);
      const req = spawnSpy.mock.calls[0][0] as { prompt: string; model?: string; agentType?: string };
      expect(req.prompt).toBe("## Agent instructions\nAudit the code.\n\nLook at auth");
      expect(req.model).toBe("explicit-model");
      expect(req.agentType).toBe("auditor");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("swarm_spawn agent_type with no explicit model falls back to the agent type model", async () => {
    await setup([]);
    const spawnSpy = vi.spyOn(fakeManager, "spawn");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "pi-swarm-index-agents-"));
    fs.mkdirSync(path.join(project, ".skill-pi", "agents"), { recursive: true });
    fs.writeFileSync(
      path.join(project, ".skill-pi", "agents", "auditor.md"),
      "---\ndescription: a\nmodel: anthropic/claude-opus-4-6\n---\nAudit the code.\n",
    );
    ctx.cwd = project;
    try {
      const result = await tools.get("swarm_spawn")!.execute("tc", { prompt: "Look", agent_type: "auditor" }, undefined, undefined, ctx);
      expect(result.isError).toBeUndefined();
      const req = spawnSpy.mock.calls[0][0] as { prompt: string; model?: string };
      expect(req.model).toBe("anthropic/claude-opus-4-6");
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  describe("target selection and input interception", () => {
    async function makeAgentProject() {
      const fs = await import("node:fs");
      const os = await import("node:os");
      const path = await import("node:path");
      const project = fs.mkdtempSync(path.join(os.tmpdir(), "pi-swarm-target-"));
      fs.mkdirSync(path.join(project, ".skill-pi", "agents"), { recursive: true });
      fs.writeFileSync(path.join(project, ".skill-pi", "agents", "auditor.md"), "---\ndescription: a\n---\nA\n");
      const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-swarm-target-agent-"));
      const original = agentDirOverride;
      agentDirOverride = agentDir;
      return { fs, project, agentDir, cleanup: () => { agentDirOverride = original; } };
    }

    function inputHandler() {
      return (inputHandlers() as Array<(ev: unknown, c: ExtensionContext) => unknown>)[0]!;
    }

    it("build target (default) never intercepts interactive input", async () => {
      await setup([]);
      startSession();
      expect(setStatus).toHaveBeenCalledWith("swarm-target", "⌁ build (dim)");
      const result = await inputHandler()({ type: "input", text: "hi", source: "interactive" }, ctx);
      expect(result).toEqual({ action: "continue" });
    });

    it("non-interactive and empty input never intercept", async () => {
      await setup([]);
      startSession();
      expect(await inputHandler()({ type: "input", text: "hi", source: "rpc" }, ctx)).toEqual({ action: "continue" });
      expect(await inputHandler()({ type: "input", text: "  ", source: "interactive" }, ctx)).toEqual({ action: "continue" });
    });

    it("agent target spawns a child with the prompt, notifies, and returns handled", async () => {
      const { fs, project, agentDir, cleanup } = await makeAgentProject();
      try {
        await setup([]);
        ctx.cwd = project;
        const notify = vi.fn();
        ctx.ui = { ...ctx.ui, notify } as unknown as ExtensionContext["ui"];
        startSession();
        const handler = inputHandler();
        const spawnSpy = vi.spyOn(fakeManager, "spawn");
        expect(await handler({ type: "input", text: "x", source: "interactive" }, ctx)).toEqual({ action: "continue" });
        expect(spawnSpy).not.toHaveBeenCalled();
        await pressLeaderAction();
        expect(setStatus).toHaveBeenLastCalledWith("swarm-target", "⌁ auditor (text)");
        const result = await handler({ type: "input", text: "look at auth", source: "interactive" }, ctx);
        expect(result).toEqual({ action: "handled" });
        expect(spawnSpy).toHaveBeenCalledTimes(1);
        const req = spawnSpy.mock.calls[0][0] as { prompt: string; agentType?: string; title?: string };
        expect(req.prompt).toBe("look at auth");
        expect(req.agentType).toBe("auditor");
        expect(req.title).toBe("look at auth");
        expect(notify).toHaveBeenCalledWith(expect.stringContaining("look at auth"));
      } finally {
        cleanup();
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(agentDir, { recursive: true, force: true });
      }
    });

    it("leader Tab cycles build -> agent -> build and disarms on other keys", async () => {
      const { fs, project, agentDir, cleanup } = await makeAgentProject();
      try {
        await setup([]);
        ctx.cwd = project;
        startSession();
        const handler = terminalInputHandlers[terminalInputHandlers.length - 1];
        expect(setStatus).toHaveBeenLastCalledWith("swarm-target", "⌁ build (dim)");
        await pressLeaderAction();
        expect(setStatus).toHaveBeenLastCalledWith("swarm-target", "⌁ auditor (text)");
        handler("q");
        expect(handler(TAB)).toBeUndefined();
        expect(setStatus).toHaveBeenLastCalledWith("swarm-target", "⌁ auditor (text)");
        await pressLeaderAction();
        expect(setStatus).toHaveBeenLastCalledWith("swarm-target", "⌁ build (dim)");
      } finally {
        cleanup();
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(agentDir, { recursive: true, force: true });
      }
    });

    it("overlay-open suppresses interception", async () => {
      const { fs, project, agentDir, cleanup } = await makeAgentProject();
      try {
        await setup([snap({ id: "sa-1", status: "running" })]);
        ctx.cwd = project;
        const notify = vi.fn();
        ctx.ui = { ...ctx.ui, notify } as unknown as ExtensionContext["ui"];
        startSession();
        const handler = inputHandler();
        await pressLeaderAction();
        const resultClosed = await handler({ type: "input", text: "look", source: "interactive" }, ctx);
        expect(resultClosed).toEqual({ action: "handled" });
        const terminal = terminalInputHandlers[terminalInputHandlers.length - 1];
        terminal("[B");
        terminal("\r");
        const resultOpen = await handler({ type: "input", text: "look", source: "interactive" }, ctx);
        expect(resultOpen).toEqual({ action: "continue" });
      } finally {
        cleanup();
        fs.rmSync(project, { recursive: true, force: true });
        fs.rmSync(agentDir, { recursive: true, force: true });
      }
    });
  });
});
