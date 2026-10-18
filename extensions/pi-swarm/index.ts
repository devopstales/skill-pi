import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseKey, Text, type Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { MAX_RUNNING, RESULT_CUSTOM_TYPE, type AgentSnapshot } from "./src/domain.ts";
import { SwarmManager, checkPreview, formatStatusline, resultBody, truncate, waitPerAgentBudget } from "./src/manager.ts";
import { resolveSkillPiExe } from "./src/child.ts";
import { formatElapsed, formatTokens } from "./src/format.ts";
import { createFleetView, isFleetViewVisible, type FleetReadModel } from "./src/ui/fleetview.ts";

const MAX_WAIT_IDS = 64;
const FLEETVIEW_WIDGET_KEY = "pi-swarm";

function swarmEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.SKILL_PI_SWARM?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

function swarmMaxRunning(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SKILL_PI_SWARM_MAX?.trim();
  if (!raw) return MAX_RUNNING;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : MAX_RUNNING;
}

function describeLine(s: AgentSnapshot): string {
  const now = Date.now();
  const elapsed = (s.settledAt ?? now) - s.createdAt;
  const modelLabel = s.modelLabel ?? "default";
  return `${s.id} [${s.status}] "${s.title}" (${s.agentType || "generic"}, ${modelLabel}, ${formatTokens(s.tokens)}, ${formatElapsed(elapsed)})`;
}

interface FleetViewSession {
  mgr: SwarmManager;
  focused: boolean;
  ui: ExtensionContext["ui"] | undefined;
  ctx: ExtensionContext | undefined;
  leaderArmed: boolean;
  armedTimer: NodeJS.Timeout | undefined;
  stopInput: () => void;
}

function emptyPrompt(ui: ExtensionContext["ui"]): boolean {
  try {
    return ui.getEditorText().trim() === "";
  } catch {
    return false;
  }
}

function fleetReadModel(mgr: SwarmManager, onExit: () => void): FleetReadModel {
  return {
    list: () => mgr.list(),
    get: (id: string) => mgr.get(id),
    cancel: (id: string) => {
      void Promise.resolve(mgr.cancel(id)).catch(() => {});
      onExit();
    },
    subscribe: (listener: () => void) => mgr.subscribe(listener),
  };
}

function updateFleetWidget(session: FleetViewSession): void {
  const ui = session.ui;
  if (!ui) return;
  const show = isFleetViewVisible(session.mgr.list());
  if (!show) {
    session.focused = false;
    ui.setWidget(FLEETVIEW_WIDGET_KEY, undefined, { placement: "belowEditor" });
    return;
  }
  const component = createFleetView(fleetReadModel(session.mgr, () => updateFleetWidget(session)));
  component.tui = undefined;
  ui.setWidget(
    FLEETVIEW_WIDGET_KEY,
    (tui, theme) => {
      component.tui = tui;
      const wrapped: Component & { dispose(): void } = {
        render: (width: number) => component.render(width),
        handleInput: (data: string) => {
          component.handleInput?.(data);
        },
        invalidate: () => component.invalidate(),
        dispose: () => component.dispose(),
      };
      return wrapped;
    },
    { placement: "belowEditor" },
  );
}

function fleetInputHandler(session: FleetViewSession, onLeaderArm: () => void) {
  return (data: string): { consume?: boolean; data?: string } | undefined => {
    if (session.leaderArmed) return undefined;
    if (!session.ctx || !session.ui) return undefined;
    if (!isFleetViewVisible(session.mgr.list())) return undefined;
    if (parseKey(data) === "ctrl+q") {
      session.leaderArmed = true;
      onLeaderArm();
      return { consume: true };
    }
    const key = parseKey(data);
    if (!key) return undefined;
    if (key === "escape") {
      if (session.focused) {
        session.focused = false;
        return { consume: true };
      }
      return undefined;
    }
    if (!emptyPrompt(session.ui)) {
      if (key === "down" && !session.focused) {
        session.focused = true;
        return { consume: true };
      }
      return undefined;
    }
    if (key === "down" || key === "left") {
      session.focused = true;
      return { consume: true };
    }
    if (key === "up" || key === "enter" || key === "x") {
      if (session.focused) return { consume: true };
      return undefined;
    }
    return undefined;
  };
}

export default function piSwarm(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
  if (!swarmEnabled(env)) return;
  const maxRunning = swarmMaxRunning(env);
  const sessions = new Map<string, SwarmManager>();
  const fleetSessions = new Map<string, FleetViewSession>();

  const sessionKey = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId() ?? "";

  const updateStatusline = (mgr: SwarmManager, ctx: ExtensionContext): void => {
    const agents = mgr.list();
    const text = formatStatusline(agents);
    ctx.ui.setStatus("swarm", text);
  };

  const getFleetSession = (mgr: SwarmManager, ctx: ExtensionContext): FleetViewSession => {
    const key = sessionKey(ctx);
    let current = fleetSessions.get(key);
    if (!current) {
      current = {
        mgr,
        focused: false,
        ui: ctx.hasUI ? ctx.ui : undefined,
        ctx,
        leaderArmed: false,
        armedTimer: undefined,
        stopInput: () => {},
      };
      fleetSessions.set(key, current);
    }
    current.ctx = ctx;
    if (ctx.hasUI) current.ui = ctx.ui;
    return current;
  };

  const updateFleet = (key: string, ctx: ExtensionContext): void => {
    const mgr = sessions.get(key);
    const session = fleetSessions.get(key);
    if (!mgr || !session || !ctx.hasUI) return;
    updateFleetWidget(session);
  };

  const startFleetInput = (key: string, ctx: ExtensionContext): void => {
    const session = fleetSessions.get(key);
    if (!session || !ctx.hasUI || typeof ctx.ui.onTerminalInput !== "function") return;
    session.stopInput();
    session.stopInput = ctx.ui.onTerminalInput(
      fleetInputHandler(session, () => {
        if (session.armedTimer) clearTimeout(session.armedTimer);
        session.armedTimer = setTimeout(() => {
          session.leaderArmed = false;
          session.armedTimer = undefined;
        }, 2000);
      }),
    );
    updateFleetWidget(session);
  };

  const leaderArmed = (ctx: ExtensionContext): boolean => fleetSessions.get(sessionKey(ctx))?.leaderArmed ?? false;

  const getManager = (ctx: ExtensionContext): SwarmManager => {
    const key = sessionKey(ctx);
    const existing = sessions.get(key);
    if (existing) return existing;
    const manager: SwarmManager = new SwarmManager({
      cwd: ctx.cwd,
      agentDir: getAgentDir(),
      deliver: (agentId) => {
        const snapshot = manager.get(agentId);
        if (!snapshot) return;
        const body = resultBody(snapshot);
        pi.sendMessage(
          {
            customType: RESULT_CUSTOM_TYPE,
            content: body,
            display: true,
            details: { id: snapshot.id, title: snapshot.title, status: snapshot.status },
          },
          { deliverAs: "followUp", triggerTurn: true },
        );
      },
      maxRunning,
    });
    manager.subscribe(() => {
      updateStatusline(manager, ctx);
      updateFleet(key, ctx);
    });
    updateStatusline(manager, ctx);
    sessions.set(key, manager);
    getFleetSession(manager, ctx);
    return manager;
  };

  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI) return;
    const key = sessionKey(ctx);
    getFleetSession(getManager(ctx), ctx);
    startFleetInput(key, ctx);
  });

  void leaderArmed;

  pi.registerTool({
    name: "swarm_spawn",
    label: "Swarm Spawn",
    description:
      "Spawn an isolated child skill-pi agent in the background. The child runs as a separate process and its result is delivered as a notification. Fire-and-forget: returns the agent id immediately.",
    promptSnippet: "Spawn parallel isolated child agents for parallelizable work",
    promptGuidelines: [
      "Use swarm_spawn for work that can run in parallel: independent research, file analysis, code review of separate modules.",
      "The child is a fully isolated skill-pi instance — it cannot see the parent's conversation.",
      "Use swarm_wait to collect results; the result is also auto-delivered as a notification when the child settles.",
    ],
    parameters: Type.Object({
      prompt: Type.String({ description: "Self-contained prompt for the child agent." }),
      title: Type.Optional(Type.String({ description: "Short title for the agent (shown in swarm_list)." })),
      agent_type: Type.Optional(Type.String({ description: "Agent type name from .skill-pi/agents/ (optional)." })),
      model: Type.Optional(Type.String({ description: "Model override for the child (optional)." })),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mgr = getManager(ctx);
      try {
        resolveSkillPiExe();
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `skill-pi executable not found: ${(err as Error).message}` }],
          details: { error: true },
          isError: true,
        };
      }
      try {
        const snapshot = mgr.spawn({
          prompt: params.prompt,
          title: params.title,
          agentType: params.agent_type,
          model: params.model,
        });
        return {
          content: [{ type: "text" as const, text: `spawned ${snapshot.id} "${snapshot.title}" (${snapshot.status})` }],
          details: { id: snapshot.id },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `spawn failed: ${(err as Error).message}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "swarm_wait",
    label: "Swarm Wait",
    description:
      "Wait for one or more swarm agents to settle. Blocks until all named agents finish. Consumes the results (suppresses auto-delivery).",
    promptSnippet: "Wait for swarm agents to finish and collect their results",
    promptGuidelines: [
      "Call swarm_wait after swarm_spawn to block until the children settle.",
      "Results are consumed by swarm_wait — the auto-delivery notification is suppressed.",
    ],
    parameters: Type.Object({
      ids: Type.Array(Type.String(), {
        maxItems: MAX_WAIT_IDS,
        description: `Agent ids to wait for (max ${MAX_WAIT_IDS}).`,
      }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const mgr = getManager(ctx);
      if (params.ids.length === 0) {
        return { content: [{ type: "text" as const, text: "no ids to wait for" }], details: {} };
      }
      const ids = params.ids.slice(0, MAX_WAIT_IDS);
      onUpdate?.({
        content: [{ type: "text" as const, text: `Waiting for ${ids.length} agent(s): ${ids.join(", ")}` }],
        details: { waiting: true },
      });
      try {
        const snapshots = await mgr.waitFor(ids);
        const budget = waitPerAgentBudget(snapshots.length);
        const parts: string[] = [];
        for (const s of snapshots) {
          const body = s.finalText !== "" ? s.finalText : s.latestText;
          const truncated = truncate(body, budget);
          parts.push(`--- ${s.id} [${s.status}] ---\n${truncated}`);
        }
        return {
          content: [{ type: "text" as const, text: parts.join("\n\n") }],
          details: { ids: snapshots.map((s) => s.id), statuses: snapshots.map((s) => s.status) },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: `wait failed: ${(err as Error).message}` }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "swarm_list",
    label: "Swarm List",
    description: "List all tracked swarm agents with their status.",
    promptSnippet: "List swarm agents and their status",
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const mgr = getManager(ctx);
      const agents = mgr.list();
      if (agents.length === 0) {
        return { content: [{ type: "text" as const, text: "no swarm agents" }], details: {} };
      }
      const lines = agents.map(describeLine);
      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        details: { count: agents.length },
      };
    },
  });

  pi.registerTool({
    name: "swarm_check",
    label: "Swarm Check",
    description: "Check the status of a swarm agent without consuming its result. Returns status, turns, and a bounded preview of the latest output.",
    promptSnippet: "Check on a running or settled swarm agent without consuming its result",
    promptGuidelines: [
      "Use swarm_check to inspect a child's progress without blocking or consuming its result.",
      "The preview is bounded to 2KB and 20 lines (whichever hits first).",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Agent id to check." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mgr = getManager(ctx);
      try {
        const snapshot = mgr.check(params.id);
        const preview = checkPreview(snapshot.latestText);
        return {
          content: [{ type: "text" as const, text: `${snapshot.id} [${snapshot.status}] turns: ${snapshot.turns}\n${preview}` }],
          details: { id: snapshot.id, status: snapshot.status, turns: snapshot.turns, consumed: snapshot.consumed },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "swarm_send",
    label: "Swarm Send",
    description: "Send a message to a swarm agent. While running, it steers the child. After it settles, it starts a new follow-up run.",
    promptSnippet: "Steer a running swarm agent or send a follow-up to a settled one",
    promptGuidelines: [
      "Use swarm_send to steer a running child mid-task or to send a follow-up after it settles.",
      "The child routes the message as steer (running) or follow_up (settled) automatically.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Agent id to send to." }),
      text: Type.String({ description: "Message text." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mgr = getManager(ctx);
      try {
        mgr.send(params.id, params.text);
        return {
          content: [{ type: "text" as const, text: `sent to ${params.id}` }],
          details: { id: params.id },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  pi.registerTool({
    name: "swarm_cancel",
    label: "Swarm Cancel",
    description: "Cancel a swarm agent. Sends an RPC abort, waits up to 5s for a clean exit, then force-kills. Settled agents report their current status.",
    promptSnippet: "Cancel a running swarm agent",
    promptGuidelines: [
      "Use swarm_cancel to stop a running child. The abort is bounded: 5s then SIGKILL.",
      "A settled child reports its current status (e.g. was already done).",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Agent id to cancel." }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const mgr = getManager(ctx);
      try {
        const before = mgr.get(params.id);
        if (!before) {
          const ids = mgr.list().map((s) => s.id);
          return {
            content: [{ type: "text" as const, text: `unknown agent id: ${params.id}; known: ${ids.length === 0 ? "(none)" : ids.join(", ")}` }],
            details: { error: true },
            isError: true,
          };
        }
        const wasSettled = before.status === "done" || before.status === "error" || before.status === "interrupted";
        await mgr.cancel(params.id);
        const after = mgr.get(params.id);
        if (after) {
          const status = after.status;
          const text = wasSettled ? `${params.id} was already ${before.status}` : `${params.id} cancelled (${status})`;
          return {
            content: [{ type: "text" as const, text }],
            details: { id: params.id, status },
          };
        }
        return {
          content: [{ type: "text" as const, text: `${params.id} cancelled (removed from queue)` }],
          details: { id: params.id, status: "interrupted" },
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: (err as Error).message }],
          details: { error: true },
          isError: true,
        };
      }
    },
  });

  pi.registerMessageRenderer(RESULT_CUSTOM_TYPE, (message, options, theme) => {
    const details = (message.details ?? {}) as { id?: string; title?: string; status?: string };
    const id = details.id ?? "unknown";
    const title = details.title ?? "";
    const status = details.status ?? "done";
    const glyph = status === "done" ? "✓" : status === "error" ? "✗" : "■";
    const header = `${glyph} swarm ${id} · ${title} · ${status === "error" ? "failed" : "finished"}`;
    const lines = String(message.content).split("\n");
    const body = options.expanded ? lines : lines.slice(0, 8).concat(options.expanded ? [] : ["(ctrl+o to expand)"]);
    return new Text(theme.fg("muted", body.join("\n")), 0, 0);
  });

  pi.on("session_shutdown", (ev, ctx) => {
    const key = sessionKey(ctx);
    const session = fleetSessions.get(key);
    if (session) {
      session.stopInput();
      if (session.armedTimer) clearTimeout(session.armedTimer);
      if (session.ui) session.ui.setWidget(FLEETVIEW_WIDGET_KEY, undefined, { placement: "belowEditor" });
      fleetSessions.delete(key);
    }
    const mgr = sessions.get(key);
    if (!mgr) return;
    sessions.delete(key);
    if (ev.reason === "quit") {
      mgr.disposeAll().catch(() => {});
    }
  });
}
