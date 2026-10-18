import { describe, it, expect, vi } from "vitest";
import { ABORT_TIMEOUT_MS, CHECK_BUDGET, CHECK_MAX_LINES, WAIT_BUDGET_TOTAL, type AgentSnapshot } from "./domain.ts";
import { SwarmManager, checkPreview, formatStatusline, truncate, waitPerAgentBudget } from "./manager.ts";

interface FakeChildOpts {
  settle?: () => void;
  settleDelayMs?: number;
  ignoreAbort?: boolean;
  settleStatus?: "done" | "error" | "interrupted";
  finalText?: string;
  onAbort?: () => void;
}

class FakeChild {
  readonly id: string;
  readonly sentTexts: string[] = [];
  private listeners = new Set<(s: AgentSnapshot) => void>();
  private state: AgentSnapshot;
  private readonly opts: Required<Omit<FakeChildOpts, "onAbort">> & { onAbort?: () => void };

  constructor(id: string, createdAt: number, opts: FakeChildOpts) {
    this.id = id;
    this.opts = {
      settle: opts.settle ?? (() => {}),
      settleDelayMs: opts.settleDelayMs ?? 0,
      ignoreAbort: opts.ignoreAbort ?? false,
      settleStatus: opts.settleStatus ?? "done",
      finalText: opts.finalText ?? "",
      onAbort: opts.onAbort,
    };
    this.state = {
      id,
      title: "",
      agentType: "",
      status: "running",
      createdAt,
      turns: 0,
      tokens: 0,
      finalText: this.opts.finalText,
      latestText: this.opts.finalText,
      consumed: false,
      transcript: [],
    };
  }

  get snapshot(): AgentSnapshot {
    return this.state;
  }

  send(text: string): void {
    this.sentTexts.push(text);
    this.state = { ...this.state, latestText: text };
  }

  abort(): Promise<void> {
    this.opts.onAbort?.();
    if (this.opts.ignoreAbort) return new Promise(() => {});
    return Promise.resolve();
  }

  onSnapshot(listener: (s: AgentSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  settle(status?: "done" | "error" | "interrupted"): void {
    if (this.state.status === "done" || this.state.status === "error" || this.state.status === "interrupted") return;
    const next = this.state;
    const settledStatus = status ?? this.opts.settleStatus;
    next.settledAt = Date.now();
    next.status = settledStatus;
    if (settledStatus === "done" || settledStatus === "interrupted") next.finalText = this.opts.finalText;
    this.state = { ...next };
    this.opts.settle();
    for (const listener of [...this.listeners]) listener(this.state);
  }
}

interface FakeFactory {
  children: Map<string, FakeChild>;
  opts: FakeChildOpts;
}

function makeFactory(opts: FakeChildOpts = {}): { spawn: (id: string) => FakeChild; fake: FakeFactory } {
  const fake: FakeFactory = { children: new Map(), opts };
  const spawn = (id: string): FakeChild => {
    const child = new FakeChild(id, Date.now(), opts);
    fake.children.set(id, child);
    return child;
  };
  return { spawn, fake };
}

function makeManager(opts: {
  maxRunning?: number;
  maxTracked?: number;
  deliver?: (agentId: string) => void;
  factory?: (id: string) => FakeChild;
  abortTimeoutMs?: number;
}) {
  const deliver = opts.deliver ?? vi.fn();
  const factory = opts.factory ?? ((id: string) => makeFactory().spawn(id));
  return {
    manager: new SwarmManager({
      cwd: "/tmp/project",
      agentDir: "/tmp/agent",
      deliver,
      maxRunning: opts.maxRunning,
      maxTracked: opts.maxTracked,
      abortTimeoutMs: opts.abortTimeoutMs,
      spawnChild: (id, createdAt) => factory(id),
    }),
    deliver,
  };
}

describe("truncate", () => {
  it("appends the truncation marker with the exact remaining byte count", () => {
    const text = "a".repeat(100);
    const out = truncate(text, 10);
    expect(out).toBe("a".repeat(10) + "\n[truncated: 90 more bytes]");
  });
  it("returns short text unchanged", () => {
    expect(truncate("hello", 100)).toBe("hello");
  });
});

describe("waitPerAgentBudget", () => {
  it("starts at the 16KB per-agent budget", () => {
    expect(waitPerAgentBudget(1)).toBe(16 * 1024);
    expect(waitPerAgentBudget(3)).toBe(16 * 1024);
  });
  it("shrinks proportionally so ids.length x budget never exceeds the 48KB total", () => {
    expect(waitPerAgentBudget(4)).toBe(12 * 1024);
    expect(waitPerAgentBudget(64)).toBe(768);
    expect(4 * waitPerAgentBudget(4)).toBeLessThanOrEqual(WAIT_BUDGET_TOTAL);
    expect(64 * waitPerAgentBudget(64)).toBeLessThanOrEqual(WAIT_BUDGET_TOTAL);
  });
});

describe("formatStatusline", () => {
  const snap = (status: AgentSnapshot["status"]): AgentSnapshot => ({
    id: "sa-1",
    title: "",
    agentType: "",
    status,
    createdAt: 0,
    turns: 0,
    tokens: 0,
    finalText: "",
    latestText: "",
    consumed: false,
    transcript: [],
  });

  it("returns undefined when there are no agents", () => {
    expect(formatStatusline([])).toBeUndefined();
  });

  it("lists only the present buckets", () => {
    expect(formatStatusline([snap("running"), snap("running"), snap("done")])).toBe(
      "swarm: 2 running · 1 done · /swarm",
    );
    expect(formatStatusline([snap("queued")])).toBe("swarm: 1 queued · /swarm");
    expect(formatStatusline([snap("interrupted")])).toBe("swarm: 1 interrupted");
    expect(formatStatusline([snap("error")])).toBe("swarm: 1 error");
  });

  it("orders buckets running, done, error, interrupted, queued", () => {
    expect(formatStatusline([snap("queued"), snap("error"), snap("running"), snap("done"), snap("interrupted")])).toBe(
      "swarm: 1 running · 1 done · 1 error · 1 interrupted · 1 queued · /swarm",
    );
  });

  it("omits the command hint when nothing is actionable", () => {
    expect(formatStatusline([snap("done"), snap("error")])).toBe("swarm: 1 done · 1 error");
  });

  it("keeps the command hint while a child is running", () => {
    expect(formatStatusline([snap("done"), snap("running")])).toBe("swarm: 1 running · 1 done · /swarm");
  });
});

describe("checkPreview", () => {
  it("caps at CHECK_BUDGET bytes", () => {
    const text = "x".repeat(CHECK_BUDGET + 50);
    const out = checkPreview(text);
    expect(out.length).toBeLessThanOrEqual(CHECK_BUDGET + 100);
    expect(out).toContain("[truncated:");
  });
  it("caps at CHECK_MAX_LINES, whichever hits first", () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i} padding`.padEnd(40)).join("\n");
    const lines = checkPreview(text).split("\n");
    expect(lines.length).toBeLessThanOrEqual(CHECK_MAX_LINES + 1);
  });
});

describe("SwarmManager", () => {
  it("spawn returns a running snapshot immediately with unique sa-N ids", () => {
    const { manager }  = makeManager({});
    const a = manager.spawn({ prompt: "p1" });
    const b = manager.spawn({ prompt: "p2" });
    expect(a.status).toBe("running");
    expect(b.status).toBe("running");
    expect(a.id).toBe("sa-1");
    expect(b.id).toBe("sa-2");
    expect(a.title).toBe("p1");
  });

  it("queues the 5th concurrent spawn and promotes it when a running child settles", () => {
    const { manager } = makeManager({ maxRunning: 4 });
    const ids = [1, 2, 3, 4, 5].map((n) => manager.spawn({ prompt: `p${n}` }).id);
    expect(manager.get(ids[0])?.status).toBe("running");
    expect(manager.get(ids[4])?.status).toBe("queued");

    const events: string[] = [];
    const unsub = manager.subscribe(() => events.push(manager.get(ids[4])?.status ?? ""));
    try {
      const children = (manager as unknown as { children: Map<string, FakeChild> }).children;
      children.get(ids[0])?.settle("done");
      expect(manager.get(ids[0])?.status).toBe("done");
      expect(manager.get(ids[4])?.status).toBe("running");
      expect(events).toContain("running");
    } finally {
      unsub();
    }
  });

  it("waitFor resolves on settle with consumed=true and does NOT call deliver", async () => {
    const deliver = vi.fn();
    const { manager } = makeManager({ deliver });
    const id = manager.spawn({ prompt: "p" }).id;
    const promise = manager.waitFor([id]);
    (manager as unknown as { children: Map<string, FakeChild> }).children.get(id)?.settle("done");
    const [snapshot] = await promise;
    expect(snapshot.status).toBe("done");
    expect(snapshot.consumed).toBe(true);
    expect(deliver).not.toHaveBeenCalled();
    expect(manager.get(id)?.consumed).toBe(true);
  });

  it("unconsumed settle calls deliver exactly once", async () => {
    const deliver = vi.fn();
    const { manager } = makeManager({ deliver });
    const id = manager.spawn({ prompt: "p" }).id;
    (manager as unknown as { children: Map<string, FakeChild> }).children.get(id)?.settle("done");
    await vi.waitFor(() => expect(deliver).toHaveBeenCalledTimes(1));
    expect(deliver).toHaveBeenCalledWith(id);
  });

  it("cancel resolves within the injected bound on an abort-ignoring child and settles interrupted", async () => {
    vi.useFakeTimers();
    try {
      const { manager } = makeManager({ abortTimeoutMs: 100, factory: (id) => makeFactory({ ignoreAbort: true }).spawn(id) });
      const id = manager.spawn({ prompt: "p" }).id;
      const promise = manager.cancel(id);
      expect(manager.get(id)?.status).not.toBe("interrupted");
      await vi.advanceTimersByTimeAsync(200);
      await promise;
      expect(manager.get(id)?.status).toBe("interrupted");
      expect(manager.get(id)?.settledAt).toBeDefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("LRU prunes the least-recently-settled settled agent first, never running or queued", () => {
    const m2 = makeManager({ maxTracked: 3 }).manager;
    const a = m2.spawn({ prompt: "a" }).id;
    const b = m2.spawn({ prompt: "b" }).id;
    const c = m2.spawn({ prompt: "c" }).id;
    const children = (m2 as unknown as { children: Map<string, FakeChild> }).children;
    children.get(a)?.settle("done");
    children.get(b)?.settle("done");
    children.get(c)?.settle("done");
    // refresh b so a is the least-recently-settled
    children.get(b)?.settle("done");
    const d = m2.spawn({ prompt: "d" }).id;
    children.get(d)?.settle("done");
    const listed = m2.list().map((s) => s.id);
    expect(listed).not.toContain(a);
    expect(listed).toEqual(expect.arrayContaining([b, c, d]));
    expect(m2.get(a)).toBeUndefined();
  });

  it("check does not set consumed and does not trigger deliver", () => {
    const deliver = vi.fn();
    const { manager } = makeManager({ deliver });
    const id = manager.spawn({ prompt: "p" }).id;
    const snapshot = manager.check(id);
    expect(snapshot.status).toBe("running");
    expect(snapshot.consumed).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("send forwards to a running child (steer path) and to a settled child (follow_up path)", () => {
    const { manager }  = makeManager({});
    const id = manager.spawn({ prompt: "p" }).id;
    const children = (manager as unknown as { children: Map<string, FakeChild> }).children;
    manager.send(id, "hello");
    expect(children.get(id)?.snapshot.latestText).toBe("hello");
    expect(children.get(id)?.sentTexts).toEqual(["hello"]);
    children.get(id)?.settle("done");
    manager.send(id, "again");
    expect(children.get(id)?.snapshot.latestText).toBe("again");
    expect(children.get(id)?.sentTexts).toEqual(["hello", "again"]);
  });

  it("send throws an unknown-id error that lists the known ids", () => {
    const { manager }  = makeManager({});
    manager.spawn({ prompt: "p" });
    expect(() => manager.send("sa-99", "x")).toThrowError(/unknown agent id: sa-99.*sa-1/s);
  });

  it("check throws an unknown-id error that lists the known ids", () => {
    const { manager }  = makeManager({});
    manager.spawn({ prompt: "p" });
    expect(() => manager.check("sa-99")).toThrowError(/unknown agent id: sa-99.*sa-1/s);
  });

  it("check after settle returns the snapshot with consumed=false and does not add a deliver call", () => {
    const deliver = vi.fn();
    const { manager } = makeManager({ deliver });
    const id = manager.spawn({ prompt: "p" }).id;
    (manager as unknown as { children: Map<string, FakeChild> }).children.get(id)?.settle("done");
    const callsBeforeCheck = deliver.mock.calls.length;
    const snapshot = manager.check(id);
    expect(snapshot.status).toBe("done");
    expect(snapshot.consumed).toBe(false);
    expect(deliver.mock.calls.length).toBe(callsBeforeCheck);
  });

  it("cancel of a queued agent removes it and promotes the next queued agent to running", async () => {
    const { manager } = makeManager({ maxRunning: 1, abortTimeoutMs: 50, factory: (id) => makeFactory({ ignoreAbort: true }).spawn(id) });
    const a = manager.spawn({ prompt: "a" }).id;
    const b = manager.spawn({ prompt: "b" }).id;
    const c = manager.spawn({ prompt: "c" }).id;
    expect(manager.get(a)?.status).toBe("running");
    expect(manager.get(b)?.status).toBe("queued");
    expect(manager.get(c)?.status).toBe("queued");

    const events: string[] = [];
    const unsub = manager.subscribe(() => events.push(manager.get(c)?.status ?? ""));
    try {
      await manager.cancel(b);
      expect(manager.get(b)).toBeUndefined();
      expect(manager.get(a)?.status).toBe("running");
      expect(manager.get(c)?.status).toBe("queued");
      expect(events).toContain("queued");
    } finally {
      unsub();
    }
  });

  it("cancel of a running abort-ignoring child force-settles interrupted and promotes the queued next", async () => {
    const { manager } = makeManager({ maxRunning: 1, abortTimeoutMs: 50, factory: (id) => makeFactory({ ignoreAbort: true }).spawn(id) });
    const a = manager.spawn({ prompt: "a" }).id;
    const b = manager.spawn({ prompt: "b" }).id;
    expect(manager.get(a)?.status).toBe("running");
    expect(manager.get(b)?.status).toBe("queued");
    await manager.cancel(a);
    expect(manager.get(a)?.status).toBe("interrupted");
    expect(manager.get(a)?.settledAt).toBeDefined();
    expect(manager.get(b)?.status).toBe("running");
  });

  it("cancel of a settled agent reports the was-already outcome and keeps its original status", async () => {
    const { manager } = makeManager({});
    const id = manager.spawn({ prompt: "p" }).id;
    (manager as unknown as { children: Map<string, FakeChild> }).children.get(id)?.settle("done");
    expect(manager.get(id)?.status).toBe("done");
    await manager.cancel(id);
    expect(manager.get(id)?.status).toBe("done");
    expect(manager.get(id)?.settledAt).toBeDefined();
  });

  it("cancel throws an unknown-id error that lists the known ids", async () => {
    const { manager } = makeManager({});
    manager.spawn({ prompt: "p" });
    await expect(manager.cancel("sa-99")).rejects.toThrowError(/unknown agent id: sa-99.*sa-1/s);
  });

  it("list returns snapshots in spawn order and get returns undefined for unknown ids", () => {
    const { manager }  = makeManager({});
    manager.spawn({ prompt: "a" });
    manager.spawn({ prompt: "b" });
    expect(manager.list().map((s) => s.id)).toEqual(["sa-1", "sa-2"]);
    expect(manager.get("sa-99")).toBeUndefined();
  });

  it("disposeAll cancels running agents and resolves", async () => {
    const { manager } = makeManager({});
    const a = manager.spawn({ prompt: "a" });
    const b = manager.spawn({ prompt: "b" });
    expect(a.status).toBe("running");
    expect(b.status).toBe("running");
    await manager.disposeAll();
    expect(manager.list().length).toBe(0);
  });
});
