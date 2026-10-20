import { describe, it, expect, vi } from "vitest";
import { PROTOCOL_VERSION, type AgentSnapshot, type SwarmStatus } from "./domain.ts";
import { installSwarmProtocol } from "./protocol.ts";

interface Snapshot {
  id: string;
  status: SwarmStatus;
  tokens: number;
  turns: number;
  consumed: boolean;
}

function snap(over: Partial<AgentSnapshot> & { status: SwarmStatus }): AgentSnapshot {
  return {
    id: "sa-1",
    title: "t",
    agentType: "",
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

function makeBus() {
  const handlers = new Map<string, Array<(data: unknown) => void>>();
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const bus = {
    emit: (channel: string, data: unknown) => {
      emitted.push({ channel, data });
    },
    on: (channel: string, handler: (data: unknown) => void) => {
      const list = handlers.get(channel) ?? [];
      list.push(handler);
      handlers.set(channel, list);
      return () => {
        const current = handlers.get(channel) ?? [];
        const i = current.indexOf(handler);
        if (i >= 0) current.splice(i, 1);
      };
    },
    emitted,
    emitChannel(channel: string, data: unknown) {
      for (const h of [...(handlers.get(channel) ?? [])]) h(data);
    },
  };
  return bus;
}

function makeManager(agents: AgentSnapshot[]) {
  const records = new Map<string, AgentSnapshot>();
  for (const a of agents) records.set(a.id, { ...a });
  let seq = agents.length;
  let settled: AgentSnapshot | undefined;
  let consumeHook: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const notifyHook = () => {
    for (const l of [...listeners]) l();
  };
  const manager = {
    calls: [] as Array<{ method: string; args: unknown[] }>,
    spawn: (req: { prompt: string; title?: string; agentType?: string; model?: string }) => {
      manager.calls.push({ method: "spawn", args: [req] });
      const id = `sa-${++seq}`;
      const s = snap({ id, status: "running" });
      records.set(id, s);
      return s;
    },
    get: (id: string) => {
      manager.calls.push({ method: "get", args: [id] });
      return records.get(id);
    },
    list: () => [...records.values()],
    send: (id: string, text: string) => {
      manager.calls.push({ method: "send", args: [id, text] });
      if (!records.has(id)) throw new Error(`unknown agent id: ${id}`);
    },
    cancel: async (id: string) => {
      manager.calls.push({ method: "cancel", args: [id] });
      const s = records.get(id);
      if (!s) throw new Error(`unknown agent id: ${id}`);
      if (s.status === "running" || s.status === "queued") {
        const next = { ...s, status: "interrupted" as const, settledAt: 1 };
        records.set(id, next);
        settled = next;
        notifyHook();
      }
    },
    setSnapshot(id: string, status: SwarmStatus, over: Partial<AgentSnapshot> = {}) {
      const s = records.get(id);
      if (!s) throw new Error(`no record ${id}`);
      const next = { ...s, status, ...over };
      records.set(id, next);
      if (status === "done" || status === "error") settled = next;
      notifyHook?.();
      return next;
    },
    subscribe: (l: () => void) => {
      manager.calls.push({ method: "subscribe", args: [l] });
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    consume: (id: string) => {
      manager.calls.push({ method: "consume", args: [id] });
      const s = records.get(id);
      if (!s) throw new Error(`unknown agent id: ${id}`);
      records.set(id, { ...s, consumed: true });
      consumeHook?.();
      return records.get(id)!;
    },
    settle: () => {
      manager.calls.push({ method: "settle", args: [] });
      return settled;
    },
    setConsumeHook(h: () => void) {
      consumeHook = h;
    },
    notify: () => {
      notifyHook();
    },
    children: new Map<string, unknown>(),
  };
  return manager;
}

type Manager = ReturnType<typeof makeManager>;

function counts(manager: Manager) {
  const list = manager.list();
  return {
    running: list.filter((s) => s.status === "running").length,
    queued: list.filter((s) => s.status === "queued").length,
    tracked: list.length,
  };
}

function replies(bus: ReturnType<typeof makeBus>): Array<{ reqId: string; payload: unknown }> {
  return bus.emitted
    .filter((e) => e.channel === "swarm:rpc:reply")
    .map((e) => {
      const d = e.data as { reqId: string; payload: unknown };
      return { reqId: d.reqId, payload: d.payload };
    });
}

function replyFor(bus: ReturnType<typeof makeBus>, reqId: string) {
  return replies(bus).find((r) => r.reqId === reqId);
}

describe("installSwarmProtocol", () => {
  it("R-rpc-protocol ping replies ok, version, and live counts matching a seeded manager", () => {
    const manager = makeManager([
      snap({ id: "sa-1", status: "running" }),
      snap({ id: "sa-2", status: "running" }),
      snap({ id: "sa-3", status: "queued" }),
      snap({ id: "sa-4", status: "done", consumed: true }),
    ]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:ping", { v: 1, reqId: "p1", type: "ping", payload: {} });
    const reply = replyFor(bus, "p1");
    expect(reply).toBeDefined();
    expect(reply!.payload).toEqual({
      ok: true,
      version: PROTOCOL_VERSION,
      counts: { running: 2, queued: 1, tracked: 4 },
    });
  });

  it("R-rpc-protocol spawn routes into manager.spawn and replies with the returned id", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", {
      v: 1,
      reqId: "s1",
      type: "spawn",
      payload: { prompt: "do it", title: "t", agentType: "auditor", model: "m" },
    });
    expect(manager.calls.find((c) => c.method === "spawn")).toEqual({
      method: "spawn",
      args: [{ prompt: "do it", title: "t", agentType: "auditor", model: "m" }],
    });
    expect(replyFor(bus, "s1")!.payload).toEqual({ id: "sa-1" });
    const created = bus.emitted.filter((e) => e.channel === "swarm:created");
    expect(created).toHaveLength(1);
    expect(created[0].data).toEqual(manager.get("sa-1"));
  });

  it("R-rpc-protocol steer routes into manager.send and replies ok", () => {
    const manager = makeManager([snap({ id: "sa-1", status: "running" })]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:steer", { v: 1, reqId: "st1", type: "steer", payload: { id: "sa-1", text: "focus on auth" } });
    expect(manager.calls.find((c) => c.method === "send")).toEqual({ method: "send", args: ["sa-1", "focus on auth"] });
    expect(replyFor(bus, "st1")!.payload).toEqual({ ok: true });
    const steered = bus.emitted.filter((e) => e.channel === "swarm:steered");
    expect(steered).toHaveLength(1);
    expect(steered[0].data).toEqual(manager.get("sa-1"));
  });

  it("R-rpc-protocol consume returns the current snapshot non-blocking and marks the agent consumed", () => {
    const manager = makeManager([snap({ id: "sa-1", status: "running", turns: 2 })]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:consume", { v: 1, reqId: "c1", type: "consume", payload: { id: "sa-1" } });
    const reply = replyFor(bus, "c1")!.payload as { snapshot: AgentSnapshot };
    expect(reply.snapshot.id).toBe("sa-1");
    expect(reply.snapshot.status).toBe("running");
    expect(manager.get("sa-1")!.consumed).toBe(true);
  });

  it("R-rpc-protocol stop awaits manager.cancel and replies with the final status", async () => {
    const manager = makeManager([snap({ id: "sa-1", status: "running" })]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:stop", { v: 1, reqId: "z1", type: "stop", payload: { id: "sa-1" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(manager.calls.find((c) => c.method === "cancel")).toEqual({ method: "cancel", args: ["sa-1"] });
    expect(replyFor(bus, "z1")!.payload).toEqual({ ok: true, status: "interrupted" });
  });

  it("R-rpc-version an unsupported v replies version error with no manager side effect", () => {
    const manager = makeManager([snap({ id: "sa-1", status: "running" })]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 99, reqId: "v1", type: "spawn", payload: { prompt: "nope" } });
    const reply = replyFor(bus, "v1");
    expect(reply).toBeDefined();
    expect(reply!.payload).toEqual({ error: "unsupported_version", supported: [1] });
    const d = bus.emitted.find((e) => e.channel === "swarm:rpc:reply")!.data as { v: number };
    expect(d.v).toBe(1);
    expect(manager.calls.filter((c) => c.method !== "subscribe")).toEqual([]);
    expect(bus.emitted.some((e) => e.channel === "swarm:created")).toBe(false);
  });

  it("R-rpc-version a missing v replies version error with no side effect", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:ping", { reqId: "v2", type: "ping", payload: {} });
    expect(replyFor(bus, "v2")!.payload).toEqual({ error: "unsupported_version", supported: [1] });
    expect(manager.calls.filter((c) => c.method !== "subscribe")).toEqual([]);
  });

  it("malformed envelopes (null, missing reqId, non-string reqId) are ignored silently", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:ping", null);
    bus.emitChannel("swarm:rpc:ping", {});
    bus.emitChannel("swarm:rpc:ping", { v: 1, reqId: 42, type: "ping", payload: {} });
    expect(replies(bus)).toEqual([]);
    expect(manager.calls.filter((c) => c.method !== "subscribe")).toEqual([]);
  });

  it("lifecycle: spawn -> running -> done emits created, started, completed exactly once, in order", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "l1", type: "spawn", payload: { prompt: "go" } });
    const s = manager.get("sa-1")!;
    manager.setSnapshot("sa-1", "running");
    manager.setSnapshot("sa-1", "done", { turns: 3, tokens: 120 });
    const channels = bus.emitted.map((e) => e.channel).filter((c) => c.startsWith("swarm:") && c !== "swarm:usage" && !c.startsWith("swarm:rpc:"));
    expect(channels).toEqual(["swarm:created", "swarm:started", "swarm:completed"]);
    for (const channel of ["swarm:created", "swarm:started", "swarm:completed"]) {
      const events = bus.emitted.filter((e) => e.channel === channel);
      expect(events).toHaveLength(1);
      expect(events[0].data).toMatchObject({ id: "sa-1", status: channel === "swarm:created" ? s.status : events[0].channel === "swarm:started" ? "running" : "done" });
    }
  });

  it("lifecycle: spawn -> error emits created and failed exactly once", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "l2", type: "spawn", payload: { prompt: "go" } });
    manager.setSnapshot("sa-1", "running");
    manager.setSnapshot("sa-1", "error", { errorText: "boom", turns: 1, tokens: 10 });
    const channels = bus.emitted.map((e) => e.channel);
    expect(channels.filter((c) => c === "swarm:failed")).toHaveLength(1);
    expect(channels.filter((c) => c === "swarm:completed")).toHaveLength(0);
    expect(channels.filter((c) => c === "swarm:started")).toHaveLength(1);
  });

  it("lifecycle: spawn already running does not re-emit created or started", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "l3", type: "spawn", payload: { prompt: "go" } });
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "l4", type: "spawn", payload: { prompt: "go2" } });
    manager.setSnapshot("sa-1", "running");
    manager.setSnapshot("sa-2", "running");
    const channels = bus.emitted.map((e) => e.channel);
    expect(channels.filter((c) => c === "swarm:created")).toHaveLength(2);
    expect(channels.filter((c) => c === "swarm:started")).toHaveLength(2);
    expect(channels.filter((c) => c === "swarm:started")).not.toHaveLength(4);
  });

  it("swarm:usage emits once per settle with per-run deltas, not cumulative", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "u1", type: "spawn", payload: { prompt: "go" } });
    manager.setSnapshot("sa-1", "running", { turns: 2, tokens: 100 });
    manager.setSnapshot("sa-1", "done", { turns: 5, tokens: 250 });
    const usages = bus.emitted.filter((e) => e.channel === "swarm:usage");
    expect(usages).toHaveLength(1);
    expect(usages[0].data).toEqual({ id: "sa-1", tokens: 250, turns: 5 });
  });

  it("swarm:usage delta is the run that just settled, emitted again on a new run after steer", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "u2", type: "spawn", payload: { prompt: "go" } });
    manager.setSnapshot("sa-1", "running", { turns: 1, tokens: 50 });
    manager.setSnapshot("sa-1", "done", { turns: 3, tokens: 90 });
    manager.setSnapshot("sa-1", "running", { turns: 3, tokens: 90 });
    manager.setSnapshot("sa-1", "done", { turns: 7, tokens: 200 });
    const usages = bus.emitted.filter((e) => e.channel === "swarm:usage").map((e) => e.data as { id: string; tokens: number; turns: number });
    expect(usages).toEqual([
      { id: "sa-1", tokens: 90, turns: 3 },
      { id: "sa-1", tokens: 200, turns: 7 },
    ]);
  });

  it("stop of a running agent settles interrupted: started once, no completed/failed, usage once, reply carries interrupted", async () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "sc1", type: "spawn", payload: { prompt: "go" } });
    manager.setSnapshot("sa-1", "running", { turns: 1, tokens: 10 });
    bus.emitChannel("swarm:rpc:stop", { v: 1, reqId: "sc2", type: "stop", payload: { id: "sa-1" } });
    await Promise.resolve();
    await Promise.resolve();
    const channels = bus.emitted.map((e) => e.channel);
    expect(channels.filter((c) => c === "swarm:started")).toHaveLength(1);
    expect(channels.filter((c) => c === "swarm:completed")).toHaveLength(0);
    expect(channels.filter((c) => c === "swarm:failed")).toHaveLength(0);
    expect(channels.filter((c) => c === "swarm:usage")).toHaveLength(1);
    const usage = bus.emitted.find((e) => e.channel === "swarm:usage")!.data as { id: string; tokens: number; turns: number };
    expect(usage).toEqual({ id: "sa-1", tokens: 10, turns: 1 });
    expect(replyFor(bus, "sc2")!.payload).toEqual({ ok: true, status: "interrupted" });
  });

  it("stop of an already-settled agent replies with the current status without re-emitting lifecycle", async () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "ss1", type: "spawn", payload: { prompt: "go" } });
    manager.setSnapshot("sa-1", "running", { turns: 1, tokens: 10 });
    manager.setSnapshot("sa-1", "done", { turns: 2, tokens: 20 });
    const before = bus.emitted.filter((e) => e.channel === "swarm:completed").length;
    bus.emitChannel("swarm:rpc:stop", { v: 1, reqId: "ss2", type: "stop", payload: { id: "sa-1" } });
    await Promise.resolve();
    await Promise.resolve();
    expect(replyFor(bus, "ss2")!.payload).toEqual({ ok: true, status: "done" });
    expect(bus.emitted.filter((e) => e.channel === "swarm:completed")).toHaveLength(before);
    expect(bus.emitted.filter((e) => e.channel === "swarm:usage")).toHaveLength(1);
  });

  it("stop of an unknown id replies with an error payload", async () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:stop", { v: 1, reqId: "su1", type: "stop", payload: { id: "sa-99" } });
    await Promise.resolve();
    await Promise.resolve();
    const payload = replyFor(bus, "su1")!.payload as { error?: string; ok?: boolean };
    expect(payload.ok).toBeUndefined();
    expect(payload.error).toBeTypeOf("string");
  });

  it("spawn that throws replies with an error payload", () => {
    const manager = makeManager([]);
    manager.spawn = () => {
      throw new Error("spawn exploded");
    };
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:spawn", { v: 1, reqId: "se1", type: "spawn", payload: { prompt: "go" } });
    expect(replyFor(bus, "se1")!.payload).toEqual({ error: "spawn exploded" });
  });

  it("steer of an unknown id replies with an error payload", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:steer", { v: 1, reqId: "se2", type: "steer", payload: { id: "sa-99", text: "hi" } });
    expect(replyFor(bus, "se2")!.payload).toEqual({ error: "unknown agent id: sa-99" });
  });

  it("consume of an unknown id replies with an error payload", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:consume", { v: 1, reqId: "se3", type: "consume", payload: { id: "sa-99" } });
    const payload = replyFor(bus, "se3")!.payload as { error?: string; snapshot?: AgentSnapshot };
    expect(payload.snapshot).toBeUndefined();
    expect(payload.error).toBeTypeOf("string");
  });

  it("an unknown request type replies unknown_request", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:ping", { v: 1, reqId: "uk1", type: "explode", payload: {} });
    expect(replyFor(bus, "uk1")!.payload).toEqual({ error: "unknown_request" });
    expect(manager.calls.filter((c) => c.method !== "subscribe")).toEqual([]);
  });

  it("dispose unsubscribes the rpc channels", () => {
    const manager = makeManager([]);
    const bus = makeBus();
    const handle = installSwarmProtocol(bus, manager);
    bus.emitChannel("swarm:rpc:ping", { v: 1, reqId: "d1", type: "ping", payload: {} });
    expect(replies(bus)).toHaveLength(1);
    handle.dispose();
    bus.emitChannel("swarm:rpc:ping", { v: 1, reqId: "d2", type: "ping", payload: {} });
    expect(replies(bus)).toHaveLength(1);
  });
});
