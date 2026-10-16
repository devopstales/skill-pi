/**
 * pi-todo — a task list the model keeps while it works, drawn as a card in the
 * skill-pi-tui fullscreen right sidebar. The main-view widget is empty; the
 * todo card lives exclusively in the sidebar rail.
 *
 * The `todo` tool plans and mutates the list. The current open snapshot is
 * mirrored into the transcript as a hidden custom message whenever it changes,
 * so the list survives `/reload`, compaction, and branch navigation: on
 * session start the list is replayed from the session branch, and a `context`
 * handler re-attaches the snapshot to transcripts that lost it.
 *
 * Sources: Gentle-Programming/gentle-shell (extensions/gentle-todo.ts, MIT) and
 * juicesharp/rpiv-mono (packages/rpiv-todo, MIT).
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text, matchesKey, parseKey, truncateToWidth, type Component, type TUI } from "@earendil-works/pi-tui";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import {
  applyTodo,
  emptyTodo,
  headerRowFor,
  replayTodo,
  renderTodoCard,
  staleTurns,
  TODO_CLOSED_MARKER,
  TODO_DETAILS_KEY,
  TODO_GLYPH,
  TODO_REMINDER_MESSAGE_TYPE,
  TODO_REMINDER_TEXT,
  TODO_STATE_MESSAGE_TYPE,
  TODO_TOOL_NAME,
  todoStateMessage,
  todoSummary,
  type TodoCardOptions,
  type TodoParams,
  type TodoState,
} from "./src/index.ts";
import { buildTheme, type TodoTheme } from "./src/theme.ts";
import { invalidateSidebar } from "../skill-pi-tui/src/sidebar-layout.ts";
import { sidebarPart, sidebarState } from "../skill-pi-tui/src/sidebar.ts";

const COLLAPSE_KEY_DEFAULT = "t";
const REMIND_AFTER_TOOL_TURNS = 4;
const WIDGET_KEY = "pi-todo";
const STATUS_ENUM = ["pending", "in_progress", "blocked", "done", "dropped"] as const;

const TOOL_DESCRIPTION =
  "Plan and track multi-step work. Use write to set the whole list, update to move one task, add for a new one, clear to reset, list to read it back.";

const PROMPT_SNIPPET = "Track multi-step work; rewrite the whole list as the plan changes";

const PROMPT_GUIDELINES = [
  "Use todo for work with three or more steps or when the user hands you a list. Skip it for single trivial requests.",
  "Mark a task in_progress before starting it and done right after finishing it; keep exactly one task in_progress.",
  "Prefer write with the complete list whenever the plan changes; keep ids of tasks that already exist.",
  "Never mark a task done while tests fail or the work is partial; add a task for the blocker instead.",
  "Mark a task blocked with a note naming what it waits for only when that is outside the list (a person, another team, an authorization); a prerequisite in the list is ordering, so keep the task pending. Return it to pending once the condition holds.",
  "When the plan changes, mark tasks it made obsolete dropped, never done; dropped tasks no longer count as open.",
];

const STATUS_ACTION_ENUM = ["write", "add", "update", "clear", "list"] as const;

function todoParameters() {
  return Type.Object({
    action: StringEnum(STATUS_ACTION_ENUM, {
      description: "write replaces the whole list; add appends one task; update changes one task by id; clear empties the list; list reports it.",
    }),
    tasks: Type.Optional(
      Type.Array(
        Type.Object({
          id: Type.Optional(Type.Integer({ description: "Existing task id to keep." })),
          title: Type.String({ description: "Short imperative title, e.g. 'Write the parser'." }),
          status: StringEnum(STATUS_ENUM, {
            description: "Defaults to pending. blocked: open but waiting on something outside the list; dropped: will not be done, on purpose.",
          }),
          note: Type.Optional(Type.String({ description: "What is happening right now, shown while in_progress; required for blocked, naming what it waits for." })),
        }),
        { description: "For write: the complete ordered list. Keep the id of tasks that already exist so their history survives; omit it for new ones." },
      ),
    ),
    id: Type.Optional(Type.Integer({ description: "Task id for update." })),
    title: Type.Optional(Type.String({ description: "Title for add, or a new title for update." })),
    status: StringEnum(STATUS_ENUM, { description: "Status for add or update." }),
    note: Type.Optional(Type.String({ description: "Note for add or update; required for blocked." })),
  });
}

export function todoEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.SKILL_PI_TODO?.trim().toLowerCase();
  return !(value === "0" || value === "false" || value === "off");
}

export function todoCollapseKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const value = env.SKILL_PI_TODO_KEY?.trim();
  if (value === undefined) return COLLAPSE_KEY_DEFAULT;
  return value === "" || value.toLowerCase() === "off" ? undefined : value;
}

interface TodoSession {
  state: TodoState;
  turn: number;
  lastWriteTurn: number;
  toolTurnsSinceWrite: number;
  reminded: boolean;
  wroteThisTurn: boolean;
  collapsed: boolean;
  clearOnNextTurn: boolean;
  lastSent: string | undefined;
  pending: string | undefined;
  ui: ExtensionContext["ui"] | undefined;
  host: { requestRender(): void } | undefined;
  tui: TUI | undefined;
  scrollTodo?: (lines: number) => void;
}

function sessionKey(ctx: ExtensionContext): string {
  return ctx.sessionManager.getSessionId() ?? "";
}

export default function piTodo(pi: ExtensionAPI, env: NodeJS.ProcessEnv = process.env): void {
  if (!todoEnabled(env)) return;
  const sessions = new Map<string, TodoSession>();
  const collapseKey = todoCollapseKey(env);

  const session = (ctx: ExtensionContext): TodoSession => {
    const key = sessionKey(ctx);
    let current = sessions.get(key);
    if (!current) {
      current = {
        state: emptyTodo(),
        turn: 0,
        lastWriteTurn: -1,
        toolTurnsSinceWrite: 0,
        reminded: false,
        wroteThisTurn: false,
        collapsed: false,
        clearOnNextTurn: false,
        lastSent: undefined,
        pending: undefined,
        ui: undefined,
        host: undefined,
        tui: undefined,
      };
      sessions.set(key, current);
    }
    return current;
  };

  const persistState = (current: TodoSession, state: string) => {
    if (!pi.sendMessage) return;
    pi.sendMessage({ customType: TODO_STATE_MESSAGE_TYPE, content: state, display: false }, { triggerTurn: false });
    current.lastSent = state;
    current.pending = state;
  };

  const toggle = (current: TodoSession) => {
    current.collapsed = !current.collapsed;
    if (current.tui) invalidateSidebar(current.tui);
    current.host?.requestRender();
  };

  const cardHeaderRow = (theme: TodoTheme, width: number, options: TodoCardOptions): number =>
    headerRowFor(theme, width, options);

  const makeCard = (
    current: TodoSession,
    theme: TodoTheme,
    inSidebar: boolean,
  ): Component & { dispose(): void; digest(): string; scrollBy(lines: number): void } => {
    let bodyLines: string[] = [];
    let topLines: string[] = [];
    let bottomLine = "";
    const scroll = { top: 0, height: 0 };
    const card: Component = {
      render(width: number) {
        const options: TodoCardOptions = {
          collapsed: current.collapsed,
          staleTurns: staleTurns(current.state, current.turn, current.lastWriteTurn),
          collapseKey,
        };
        const rows =
          current.state.tasks.length > 0
            ? renderTodoCard(current.state, theme, width, options)
            : [];
        if (rows.length === 0) {
          topLines = [];
          bodyLines = [];
          bottomLine = "";
          scroll.height = 0;
          return [];
        }
        const headerRow = cardHeaderRow(theme, width, options);
        topLines = rows.slice(0, headerRow + 1);
        bodyLines = rows.slice(headerRow + 1, rows.length - 1);
        bottomLine = rows[rows.length - 1] ?? "";
        const terminalRows = current.tui?.terminal?.rows ?? 48;
        const budget = inSidebar ? 16 : Math.min(16, Math.floor(terminalRows / 3));
        const chrome = topLines.length + 1;
        const room = Math.max(1, budget - chrome);
        scroll.height = Math.min(bodyLines.length, room);
        if (scroll.top > bodyLines.length - scroll.height) scroll.top = Math.max(0, bodyLines.length - scroll.height);
        const visible = bodyLines.slice(scroll.top, scroll.top + scroll.height);
        const overflow = !current.collapsed && bodyLines.length > scroll.height;
        const out = [...topLines, ...visible, bottomLine];
        if (overflow && !inSidebar) {
          out.push(theme.fg("muted", truncateToWidth(`↑↓ ${scroll.top + 1}–${Math.min(bodyLines.length, scroll.top + scroll.height)}/${bodyLines.length}`, width)));
        }
        return out;
      },
      invalidate() {},
    };
    return {
      ...card,
      scrollBy: (lines: number) => {
        if (current.collapsed || bodyLines.length <= scroll.height) return;
        scroll.top = Math.max(0, Math.min(bodyLines.length - scroll.height, scroll.top + lines));
        if (current.tui) invalidateSidebar(current.tui);
        current.host?.requestRender();
      },
      digest: () =>
        JSON.stringify([current.tui?.terminal?.rows, current.collapsed, current.turn, scroll.top, current.state.tasks.length, current.lastWriteTurn]),
      dispose: () => {},
    };
  };

  const show = (current: TodoSession) => {
    if (current.tui) invalidateSidebar(current.tui);
    if (!current.ui) return;
    if (current.state.tasks.length === 0) {
      current.scrollTodo = undefined;
      current.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    const snapshot = current;
    current.ui.setWidget(WIDGET_KEY, (tui, theme) => {
      snapshot.host = tui;
      snapshot.tui = tui;
      const barTheme = buildTheme(theme);
      const rail = makeCard(snapshot, barTheme, true);
      snapshot.scrollTodo = (lines) => rail.scrollBy(lines);
      // Main-view widget renders nothing: the todo card lives exclusively in
      // the skill-pi-tui right sidebar rail. sidebarPart keeps the empty
      // bottom component mounted (required by the layout) and registers the
      // rail for the sidebar.
      const empty: Component = { render: () => [], invalidate() {} };
      return sidebarPart(tui, "todo", empty, rail);
    });
  };

  pi.registerTool({
    name: TODO_TOOL_NAME,
    label: "Todo",
    description: TOOL_DESCRIPTION,
    promptSnippet: PROMPT_SNIPPET,
    promptGuidelines: PROMPT_GUIDELINES,
    parameters: todoParameters(),
    executionMode: "sequential",
    renderCall(args, theme) {
      const params = args as TodoParams;
      return new Text(theme.fg("toolTitle", `${TODO_GLYPH} todo · ${params.action}`), 0, 0);
    },
    renderResult(result, options, theme) {
      const text = result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
      return new Text(options.expanded ? text : theme.fg("muted", text.split("\n")[0] ?? ""), 0, 0);
    },
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const current = session(ctx);
      const result = applyTodo(current.state, params as TodoParams, current.turn);
      if (!result.error) {
        current.state = result.state;
        current.clearOnNextTurn = false;
        if (params.action !== "list") {
          current.lastWriteTurn = current.turn;
          current.toolTurnsSinceWrite = 0;
          current.reminded = false;
          current.wroteThisTurn = true;
          const state = todoStateMessage(current.state) ?? (current.lastSent === undefined ? undefined : TODO_CLOSED_MARKER);
          if (state !== undefined && state !== current.lastSent) persistState(current, state);
        }
        if (current.tui) invalidateSidebar(current.tui);
      }
      const details: Record<string, unknown> = { [TODO_DETAILS_KEY]: result.state };
      if (result.error) details.error = result.error;
      return {
        content: [{ type: "text", text: result.text }],
        details,
      };
    },
  });

  const collapseListener: { stop: (() => void) | undefined } = { stop: undefined };
  let armed = false;
  let armedCtx: ExtensionContext | undefined;
  const pendingKey = collapseKey?.toLowerCase() ?? "";

  const startLeaderListener = (ctx: ExtensionContext) => {
    collapseListener.stop?.();
    collapseListener.stop = undefined;
    if (!ctx.hasUI || typeof ctx.ui.onTerminalInput !== "function") return;
    collapseListener.stop = ctx.ui.onTerminalInput((data) => {
      if (parseKey(data) === "ctrl+q") {
        armed = true;
        armedCtx = ctx;
        return { consume: true };
      }
      if (armed) {
        const parsed = parseKey(data);
        if (parsed && parsed.length === 1 && parsed >= "a" && parsed <= "z" && parsed === pendingKey) {
          const target = armedCtx;
          armed = false;
          if (target) toggle(session(target));
          return { consume: true };
        }
        armed = false;
        return undefined;
      }
      return undefined;
    });
  };

  pi.on("session_start", (_event, ctx) => startLeaderListener(ctx));

  pi.on("session_shutdown", () => {
    collapseListener.stop?.();
    collapseListener.stop = undefined;
    armed = false;
    armedCtx = undefined;
  });

  for (const [key, lines] of [["alt+shift+up", -3], ["alt+shift+down", 3]] as const) {
    pi.registerShortcut(key, {
      description: `Scroll the Todo list ${lines < 0 ? "up" : "down"}`,
      handler: async (ctx) => session(ctx).scrollTodo?.(lines),
    });
  }

  pi.on("session_start", (_event, ctx) => {
    const current = session(ctx);
    const branch = ctx.sessionManager.getBranch();
    const replayed = replayTodo(branch);
    current.state = replayed.tasks.length > 0 && todoSummary(replayed).open === 0 ? { ...replayed, tasks: [] } : replayed;
    current.turn = branch.filter((entry) => entry.type === "message" && (entry as { message?: { role?: string } }).message?.role === "user").length;
    // A replayed open list is the work-in-progress of a continued session;
    // treat it as fresh so the stale counter does not fire on resume.
    current.lastWriteTurn = current.state.tasks.length > 0 && todoSummary(current.state).open > 0 ? current.turn : -1;
    current.toolTurnsSinceWrite = 0;
    current.reminded = false;
    current.wroteThisTurn = false;
    current.clearOnNextTurn = false;
    current.lastSent = undefined;
    current.pending = undefined;
    current.collapsed = false;
    current.ui = ctx.hasUI ? ctx.ui : undefined;
    show(current);
  });

  pi.on("session_shutdown", (_event, ctx) => {
    sessions.delete(sessionKey(ctx));
  });

  pi.on("before_agent_start", (event, ctx) => {
    const current = session(ctx);
    current.turn += 1;
    if (current.tui) invalidateSidebar(current.tui);
    if (current.clearOnNextTurn) {
      current.state = emptyTodo();
      current.clearOnNextTurn = false;
      show(current);
    }
    return undefined;
  });

  pi.on("turn_end", (event, ctx) => {
    const current = session(ctx);
    if (!current.wroteThisTurn && event.message.role === "assistant" && event.message.content.some((part) => part.type === "toolCall")) {
      current.toolTurnsSinceWrite += 1;
    }
    current.wroteThisTurn = false;
    current.pending = undefined;
  });

  pi.on("context", (event, ctx) => {
    const current = session(ctx);
    const trailing: Array<{ role: "custom"; customType: string; content: string; display: false; timestamp: number }> = [];
    const last = [...event.messages].reverse().find((message) => (message as { customType?: string }).customType === TODO_STATE_MESSAGE_TYPE) as { content?: unknown } | undefined;
    const seen = typeof last?.content === "string" ? last.content : undefined;
    const state = todoStateMessage(current.state) ?? (seen === undefined || seen === TODO_CLOSED_MARKER ? undefined : TODO_CLOSED_MARKER);
    if (state !== undefined && seen !== state) {
      // The transcript lost the current snapshot (compaction, branch
      // navigation): treat the re-attached list as fresh so the stale counter
      // does not fire on the next few turns.
      current.lastWriteTurn = current.turn;
      trailing.push({ role: "custom", customType: TODO_STATE_MESSAGE_TYPE, content: state, display: false, timestamp: Date.now() });
      if (current.pending !== state) persistState(current, state);
    }
    const actionable = current.state.tasks.some((task) => task.status === "pending" || task.status === "in_progress");
    if (!current.reminded && current.toolTurnsSinceWrite >= REMIND_AFTER_TOOL_TURNS && actionable) {
      current.reminded = true;
      trailing.push({ role: "custom", customType: TODO_REMINDER_MESSAGE_TYPE, content: TODO_REMINDER_TEXT, display: false, timestamp: Date.now() });
    }
    if (trailing.length === 0) return undefined;
    return { messages: [...event.messages, ...trailing] };
  });

  pi.on("tool_execution_end", (event, ctx) => {
    if (event.toolName !== TODO_TOOL_NAME) return;
    show(session(ctx));
  });

  pi.on("agent_end", (_event, ctx) => {
    const current = session(ctx);
    if (current.state.tasks.length > 0 && todoSummary(current.state).open === 0) current.clearOnNextTurn = true;
    show(current);
  });
}
