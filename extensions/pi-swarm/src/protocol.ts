import { PROTOCOL_VERSION, isSettled, type AgentSnapshot, type SpawnRequest, type SwarmStatus } from "./domain.ts";

export interface RpcEnvelope {
  v: number;
  reqId: string;
  type: string;
  payload: unknown;
}

export interface RpcBus {
  emit(channel: string, data: unknown): void;
  on(channel: string, handler: (data: unknown) => void): () => void;
}

export interface SwarmProtocolManager {
  spawn(req: SpawnRequest): AgentSnapshot;
  get(id: string): AgentSnapshot | undefined;
  list(): readonly AgentSnapshot[];
  send(id: string, text: string): void;
  cancel(id: string): Promise<unknown>;
  consume(id: string): AgentSnapshot;
  subscribe(listener: () => void): () => void;
}

const RPC_CHANNELS: Record<string, string> = {
  "swarm:rpc:ping": "ping",
  "swarm:rpc:spawn": "spawn",
  "swarm:rpc:steer": "steer",
  "swarm:rpc:consume": "consume",
  "swarm:rpc:stop": "stop",
};

const REPLY_CHANNEL = "swarm:rpc:reply";

export function installSwarmProtocol(bus: RpcBus, manager: SwarmProtocolManager): { dispose(): void } {
  const prevStatus = new Map<string, SwarmStatus>();
  const settledBase = new Map<string, { tokens: number; turns: number }>();
  const disposers: Array<() => void> = [];

  const unsubscribe = manager.subscribe(() => {
    for (const snapshot of manager.list()) {
      const prev = prevStatus.get(snapshot.id);
      const status = snapshot.status;
      if (status === "queued" || status === "running") {
        if (status === "running") settledBase.delete(snapshot.id);
        prevStatus.set(snapshot.id, status);
        if (status === "running" && (prev === undefined || prev === "queued")) {
          bus.emit("swarm:started", snapshot);
        }
        continue;
      }
      if (isSettled(status)) {
        if (prev === undefined || prev === "queued" || prev === "running") {
          if (status === "done") bus.emit("swarm:completed", snapshot);
          if (status === "error") bus.emit("swarm:failed", snapshot);
          const base = settledBase.get(snapshot.id) ?? { tokens: 0, turns: 0 };
          bus.emit("swarm:usage", { id: snapshot.id, tokens: Math.max(0, snapshot.tokens - base.tokens), turns: Math.max(0, snapshot.turns - base.turns) });
        }
        settledBase.set(snapshot.id, { tokens: snapshot.tokens, turns: snapshot.turns });
        prevStatus.set(snapshot.id, status);
      }
    }
  });
  disposers.push(unsubscribe);

  const emitCreated = (snapshot: AgentSnapshot): void => {
    bus.emit("swarm:created", snapshot);
  };

  const reply = (reqId: string, payload: unknown): void => {
    bus.emit(REPLY_CHANNEL, { v: PROTOCOL_VERSION, reqId, type: "reply", payload });
  };

  const handle = (channel: string) => (data: unknown): void => {
    if (typeof data !== "object" || data === null || Array.isArray(data)) return;
    const envelope = data as Partial<RpcEnvelope>;
    if (typeof envelope.reqId !== "string") return;
    const { reqId, v } = envelope;
    const type = typeof envelope.type === "string" ? envelope.type : undefined;
    const { payload } = envelope;
    if (v !== PROTOCOL_VERSION) {
      reply(reqId, { error: "unsupported_version", supported: [PROTOCOL_VERSION] });
      return;
    }
    const kind = RPC_CHANNELS[channel];
    if (!kind || kind !== type) {
      reply(reqId, { error: "unknown_request" });
      return;
    }
    const p = (payload ?? {}) as Record<string, unknown>;
    try {
      switch (kind) {
        case "ping": {
          const agents = manager.list();
          reply(reqId, {
            ok: true,
            version: PROTOCOL_VERSION,
            counts: {
              running: agents.filter((s) => s.status === "running").length,
              queued: agents.filter((s) => s.status === "queued").length,
              tracked: agents.length,
            },
          });
          return;
        }
        case "spawn": {
          const req: SpawnRequest = {
            prompt: typeof p.prompt === "string" ? p.prompt : "",
            title: typeof p.title === "string" ? p.title : undefined,
            agentType: typeof p.agentType === "string" ? p.agentType : undefined,
            model: typeof p.model === "string" ? p.model : undefined,
          };
          const snapshot = manager.spawn(req);
          emitCreated(snapshot);
          reply(reqId, { id: snapshot.id });
          return;
        }
        case "steer": {
          if (typeof p.id !== "string" || typeof p.text !== "string") {
            reply(reqId, { error: "unknown_request" });
            return;
          }
          manager.send(p.id, p.text);
          const snapshot = manager.get(p.id);
          if (snapshot) bus.emit("swarm:steered", snapshot);
          reply(reqId, { ok: true });
          return;
        }
        case "consume": {
          if (typeof p.id !== "string") {
            reply(reqId, { error: "unknown_request" });
            return;
          }
          const snapshot = manager.get(p.id);
          if (!snapshot) {
            reply(reqId, { error: `unknown agent id: ${p.id}` });
            return;
          }
          reply(reqId, { snapshot });
          manager.consume(p.id);
          return;
        }
        case "stop": {
          if (typeof p.id !== "string") {
            reply(reqId, { error: "unknown_request" });
            return;
          }
          const stopId = p.id;
          manager.cancel(stopId).then(() => {
            const snapshot = manager.get(stopId);
            reply(reqId, { ok: true, status: snapshot?.status ?? "interrupted" });
          }).catch((err) => {
            reply(reqId, { error: (err as Error).message });
          });
          return;
        }
      }
    } catch (err) {
      reply(reqId, { error: (err as Error).message });
    }
  };

  for (const channel of Object.keys(RPC_CHANNELS)) {
    disposers.push(bus.on(channel, handle(channel)));
  }

  return {
    dispose: () => {
      for (const dispose of disposers) dispose();
    },
  };
}
