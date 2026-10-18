import {
  ABORT_TIMEOUT_MS,
  CHECK_BUDGET,
  CHECK_MAX_LINES,
  MAX_RUNNING,
  MAX_TRACKED,
  RESULT_BUDGET,
  WAIT_BUDGET_PER_AGENT,
  WAIT_BUDGET_TOTAL,
  type SpawnRequest,
  type SwarmStatus,
} from "./domain.ts";
import { buildChildInvocation, SwarmChild } from "./child.ts";
import type { AgentSnapshot, SwarmChildHandle } from "./domain.ts";

export function truncate(text: string, budget: number): string {
  if (text.length <= budget) return text;
  return text.slice(0, budget) + `\n[truncated: ${text.length - budget} more bytes]`;
}

export function waitPerAgentBudget(ids: number): number {
  const count = Math.max(1, ids);
  if (count * WAIT_BUDGET_PER_AGENT > WAIT_BUDGET_TOTAL) return Math.floor(WAIT_BUDGET_TOTAL / count);
  return WAIT_BUDGET_PER_AGENT;
}

const STATUSLINE_ORDER: SwarmStatus[] = ["running", "done", "error", "interrupted", "queued"];

export function formatStatusline(agents: readonly AgentSnapshot[]): string | undefined {
  const counts = new Map<SwarmStatus, number>();
  for (const agent of agents) counts.set(agent.status, (counts.get(agent.status) ?? 0) + 1);
  const parts = STATUSLINE_ORDER.filter((status) => counts.get(status)).map(
    (status) => `${counts.get(status)} ${status}`,
  );
  if (parts.length === 0) return undefined;
  const hasActionable = (counts.get("running") ?? 0) > 0 || (counts.get("queued") ?? 0) > 0;
  return hasActionable ? `swarm: ${parts.join(" · ")} · /swarm` : `swarm: ${parts.join(" · ")}`;
}

export function checkPreview(text: string): string {
  if (text.length === 0) return "";
  const lines = text.split("\n");
  if (lines.length > CHECK_MAX_LINES) {
    return lines.slice(0, CHECK_MAX_LINES).join("\n") + `\n[truncated: ${lines.length - CHECK_MAX_LINES} more lines]`;
  }
  return truncate(text, CHECK_BUDGET);
}

export function resultBody(snapshot: AgentSnapshot): string {
  const body =
    snapshot.finalText !== ""
      ? snapshot.finalText
      : [...snapshot.transcript].reverse().find((line) => line.kind === "assistant")?.text ??
        `${snapshot.id} finished with no text output`;
  return truncate(body, RESULT_BUDGET);
}

interface AgentRecord {
  id: string;
  child: SwarmChildHandle;
  snapshot: AgentSnapshot;
  createdAt: number;
  waiters: number;
}

export interface SwarmManagerOptions {
  cwd: string;
  agentDir: string;
  deliver: (agentId: string) => void;
  maxRunning?: number;
  maxTracked?: number;
  abortTimeoutMs?: number;
  spawnChild?: (id: string, createdAt: number) => SwarmChildHandle;
}

export class SwarmManager {
  readonly children = new Map<string, SwarmChildHandle>();
  private readonly records = new Map<string, AgentRecord>();
  private readonly listeners = new Set<() => void>();
  private readonly agentListeners = new Map<string, Set<(s: AgentSnapshot) => void>>();
  private readonly opts: Required<Pick<SwarmManagerOptions, "cwd" | "agentDir" | "deliver" | "maxRunning" | "maxTracked" | "abortTimeoutMs">> &
    Pick<SwarmManagerOptions, "spawnChild">;
  private runningCount = 0;
  private seq = 0;

  constructor(opts: SwarmManagerOptions) {
    this.opts = {
      cwd: opts.cwd,
      agentDir: opts.agentDir,
      deliver: opts.deliver,
      maxRunning: opts.maxRunning ?? MAX_RUNNING,
      maxTracked: opts.maxTracked ?? MAX_TRACKED,
      abortTimeoutMs: opts.abortTimeoutMs ?? ABORT_TIMEOUT_MS,
      spawnChild: opts.spawnChild,
    };
  }

  spawn(req: SpawnRequest): AgentSnapshot {
    const id = `sa-${++this.seq}`;
    const createdAt = Date.now();
    this.runningCount += 1;
    const status = this.runningCount <= this.opts.maxRunning ? "running" : "queued";
    const title = req.title ?? req.prompt.split("\n")[0]?.slice(0, 80) ?? id;
    const record: AgentRecord = {
      id,
      child: this.createChild(id, createdAt),
      snapshot: {
        id,
        title,
        agentType: req.agentType ?? "",
        status,
        createdAt,
        turns: 0,
        tokens: 0,
        finalText: "",
        latestText: "",
        consumed: false,
        transcript: [],
      },
      createdAt,
      waiters: 0,
    };
    this.children.set(id, record.child);
    this.records.set(id, record);
    record.child.onSnapshot((s) => this.onChildSnapshot(id, s));
    if (status === "queued") {
      const settledCount = [...this.records.values()].filter((r) => isSettled(r.snapshot.status)).length;
      if (settledCount >= this.opts.maxTracked) this.prune();
    }
    this.notify();
    return record.snapshot;
  }

  get(id: string): AgentSnapshot | undefined {
    return this.records.get(id)?.snapshot;
  }

  list(): readonly AgentSnapshot[] {
    return [...this.records.values()].map((r) => r.snapshot);
  }

  send(id: string, text: string): void {
    const record = this.records.get(id);
    if (!record) throw new Error(`unknown agent id: ${id}; known: ${this.knownIds()}`);
    record.child.send(text);
  }

  check(id: string): AgentSnapshot {
    const record = this.records.get(id);
    if (!record) throw new Error(`unknown agent id: ${id}; known: ${this.knownIds()}`);
    return record.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeTo(id: string, listener: (s: AgentSnapshot) => void): () => void {
    let set = this.agentListeners.get(id);
    if (!set) {
      set = new Set();
      this.agentListeners.set(id, set);
    }
    set.add(listener);
    return () => {
      set?.delete(listener);
      if (set?.size === 0) this.agentListeners.delete(id);
    };
  }

  waitFor(ids: string[]): Promise<AgentSnapshot[]> {
    for (const id of ids) this.check(id);
    const waiters = ids.map((id) => {
      const record = this.records.get(id)!;
      record.waiters += 1;
      return { record, settled: this.whenSettled(record) };
    });
    return Promise.all(
      waiters.map(({ record, settled }) =>
        settled.then((s) => this.finishWait(record, s)),
      ),
    ).then((snapshots) => {
      for (const { record } of waiters) record.waiters -= 1;
      this.prune();
      this.notify();
      return snapshots;
    });
  }

  async cancel(id: string): Promise<AgentSnapshot | undefined> {
    const record = this.records.get(id);
    if (!record) throw new Error(`unknown agent id: ${id}; known: ${this.knownIds()}`);
    if (record.snapshot.status === "queued") {
      this.runningCount = Math.max(0, this.runningCount - 1);
      this.remove(record);
      this.rebalance();
      return;
    }
    if (isSettled(record.snapshot.status)) {
      return { ...record.snapshot };
    }
    const child = record.child;
    const abortPromise = child.abort();
    const timeout = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.forceSettle(record);
        resolve();
      }, this.opts.abortTimeoutMs);
      (timer as { unref?: () => void }).unref?.();
    });
    await Promise.race([abortPromise, timeout]);
    if (!isSettled(record.snapshot.status)) {
      this.forceSettle(record);
    } else {
      this.rebalance();
    }
  }

  disposeAll(): Promise<void> {
    const cancelled = Promise.all(
      [...this.records.keys()].filter((id) => !isSettled(this.get(id)!.status)).map((id) => this.cancel(id)),
    ).then(() => undefined);
    for (const record of [...this.records.values()]) this.remove(record);
    this.listeners.clear();
    this.agentListeners.clear();
    return cancelled;
  }

  private createChild(id: string, _createdAt: number): SwarmChildHandle {
    if (this.opts.spawnChild) return this.opts.spawnChild(id, _createdAt);
    const invocation = buildChildInvocation(this.opts.cwd, this.opts.agentDir);
    const childPromise = SwarmChild.spawn(invocation, this.opts.cwd);
    let cached: AgentSnapshot = {
      id,
      title: "",
      agentType: "",
      status: "running",
      createdAt: Date.now(),
      turns: 0,
      tokens: 0,
      finalText: "",
      latestText: "",
      consumed: false,
      transcript: [],
    };
    let unsub: (() => void) | undefined;
    const listeners = new Set<(s: AgentSnapshot) => void>();
    let resolved: SwarmChild | undefined;
    childPromise.then((c) => {
      resolved = c;
      unsub = c.onSnapshot((s) => {
        cached = s;
        for (const l of [...listeners]) l(cached);
      });
    });
    return {
      id,
      get snapshot() {
        return resolved?.snapshot ?? cached;
      },
      send: (text: string) => {
        resolved?.send(text);
      },
      abort: () => resolved?.abort() ?? childPromise.then((c) => c.abort()),
      onSnapshot: (listener: (s: AgentSnapshot) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    };
  }

  private onChildSnapshot(id: string, childSnapshot: AgentSnapshot): void {
    const record = this.records.get(id);
    if (!record) return;
    const wasRunning = record.snapshot.status === "running";
    record.snapshot = { ...childSnapshot, title: record.snapshot.title, agentType: record.snapshot.agentType, consumed: record.snapshot.consumed };
    if (isSettled(record.snapshot.status)) this.onSettled(record, wasRunning);
    const set = this.agentListeners.get(id);
    if (set) for (const listener of [...set]) listener(record.snapshot);
    this.notify();
  }

  private onSettled(record: AgentRecord, wasRunning: boolean): void {
    if (!record.snapshot.settledAt) record.snapshot = { ...record.snapshot, settledAt: Date.now() };
    if (wasRunning) this.runningCount = Math.max(0, this.runningCount - 1);
    this.rebalance(record);
  }

  private rebalance(settledRecord?: AgentRecord): void {
    this.prune();
    let runningNow = [...this.records.values()].filter((r) => r.snapshot.status === "running").length;
    for (const record of [...this.records.values()]) {
      if (runningNow >= this.opts.maxRunning) break;
      if (record.snapshot.status !== "queued") continue;
      runningNow += 1;
      record.snapshot = { ...record.snapshot, status: "running" };
    }
    this.notify();
    if (settledRecord && isSettled(settledRecord.snapshot.status) && settledRecord.waiters === 0 && !settledRecord.snapshot.consumed) {
      this.opts.deliver(settledRecord.id);
    }
  }

  private whenSettled(record: AgentRecord): Promise<AgentSnapshot> {
    if (isSettled(record.snapshot.status)) return Promise.resolve(record.snapshot);
    return new Promise((resolve) => {
      const unsub = this.subscribeTo(record.id, (s) => {
        if (isSettled(s.status)) {
          unsub();
          resolve(s);
        }
      });
    });
  }

  private finishWait(record: AgentRecord, _snapshot: AgentSnapshot): AgentSnapshot {
    record.snapshot = { ...record.snapshot, consumed: true };
    return record.snapshot;
  }

  private forceSettle(record: AgentRecord): void {
    const wasRunning = record.snapshot.status === "running";
    record.snapshot = { ...record.snapshot, status: "interrupted", settledAt: record.snapshot.settledAt ?? Date.now() };
    this.onSettled(record, wasRunning);
  }

  private prune(): void {
    const settled = [...this.records.values()].filter((r) => isSettled(r.snapshot.status) && r.waiters === 0);
    if (settled.length + 0 <= this.opts.maxTracked) return;
    settled.sort((a, b) => (a.snapshot.settledAt ?? 0) - (b.snapshot.settledAt ?? 0));
    const excess = settled.length - (this.opts.maxTracked - [...this.records.values()].filter((r) => !isSettled(r.snapshot.status)).length);
    for (const record of settled.slice(0, Math.max(0, excess))) this.remove(record);
  }

  private remove(record: AgentRecord): void {
    this.records.delete(record.id);
    this.children.delete(record.id);
    this.agentListeners.delete(record.id);
    this.notify();
  }

  private knownIds(): string {
    const ids = [...this.records.keys()];
    return ids.length === 0 ? "(none)" : ids.join(", ");
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

function isSettled(status: AgentSnapshot["status"]): boolean {
  return status === "done" || status === "error" || status === "interrupted";
}
