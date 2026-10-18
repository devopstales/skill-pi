import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { Text, type Component } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { MAX_RUNNING, RESULT_CUSTOM_TYPE, type AgentSnapshot } from "./src/domain.ts";
import { SwarmManager, resultBody, truncate, waitPerAgentBudget } from "./src/manager.ts";
import { resolveSkillPiExe } from "./src/child.ts";

const MAX_WAIT_IDS = 64;

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

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m${String(sec).padStart(2, "0")}s`;
}

function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

function describeLine(s: AgentSnapshot): string {
  const now = Date.now();
  const elapsed = (s.settledAt ?? now) - s.createdAt;
  const modelLabel = s.modelLabel ?? "default";
  return `${s.id} [${s.status}] "${s.title}" (${s.agentType || "generic"}, ${modelLabel}, ${formatTokens(s.tokens)}, ${formatElapsed(elapsed)})`;
}

function statusGlyph(s: AgentSnapshot): string {
  switch (s.status) {
    case "running":
      return "⠹";
    case "done":
      return "✓";
    case "error":
      return "✗";
    case "interrupted":
      return "■";
    case "queued":
      return "…";
  }
}

export default function piSwarm(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
  if (!swarmEnabled(env)) return;
  const maxRunning = swarmMaxRunning(env);
  const sessions = new Map<string, SwarmManager>();

  const sessionKey = (ctx: ExtensionContext): string => ctx.sessionManager.getSessionId() ?? "";

  const getManager = (ctx: ExtensionContext): SwarmManager => {
    const key = sessionKey(ctx);
    let mgr = sessions.get(key);
    if (!mgr) {
      const agentDir = getAgentDir();
      const cwd = ctx.cwd;
      mgr = new SwarmManager({
        cwd,
        agentDir,
        deliver: (agentId) => {
          const snapshot = mgr?.get(agentId);
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
      sessions.set(key, mgr);
    }
    return mgr;
  };

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
    const mgr = sessions.get(key);
    if (!mgr) return;
    sessions.delete(key);
    if (ev.reason === "quit") {
      mgr.disposeAll().catch(() => {});
    }
  });
}
