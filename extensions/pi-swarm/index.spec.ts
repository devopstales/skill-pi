import { describe, it, expect, vi } from "vitest";
import type { AgentSnapshot } from "./src/domain.ts";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

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

function makeCtx(): { ctx: ExtensionContext; setStatus: ReturnType<typeof vi.fn> } {
  const setStatus = vi.fn();
  const ctx = {
    ui: { setStatus },
    mode: "tui",
    hasUI: true,
    cwd: "/tmp/project",
    sessionManager: { getSessionId: () => "sess-1" },
  } as unknown as ExtensionContext;
  return { ctx, setStatus };
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

vi.mock("@earendil-works/pi-coding-agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@earendil-works/pi-coding-agent")>();
  return { ...mod, getAgentDir: () => "/tmp/agent" };
});

import piSwarm from "./index.ts";

describe("pi-swarm index", () => {
  let tools: Map<string, RegisteredTool>;
  let ctx: ExtensionContext;
  let setStatus: ReturnType<typeof vi.fn>;

  async function setup(agents: AgentSnapshot[]) {
    fakeManager = makeFakeManager(agents);
    tools = new Map<string, RegisteredTool>();
    const pi = {
      registerTool: (def: RegisteredTool) => {
        tools.set(def.name, def);
      },
      registerMessageRenderer: vi.fn(),
      sendMessage: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI;
    const result = makeCtx();
    ctx = result.ctx;
    setStatus = result.setStatus;
    piSwarm(pi, {});
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
});
