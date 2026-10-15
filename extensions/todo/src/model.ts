export const TODO_GLYPH = "◔";

export const TODO_TOOL_NAME = "todo";

export const TODO_DETAILS_KEY = "piTodoState";

export const TODO_STATE_MESSAGE_TYPE = "pi-todo-state";

export const TODO_CLOSED_MARKER = "closed";

export const TODO_REMINDER_MESSAGE_TYPE = "pi-todo-reminder";

export const TODO_REMINDER_TEXT =
  "The todo plan has not been reviewed during several tool-use turns. Check whether it still matches the work performed and update tasks where needed. Do not mark work done without verification.";

export const STATUS_ENUM = ["pending", "in_progress", "blocked", "done", "dropped"] as const;

export type TodoStatus = (typeof STATUS_ENUM)[number];

export interface TodoTask {
  id: number;
  title: string;
  status: TodoStatus;
  note?: string;
}

export interface TodoState {
  nextId: number;
  tasks: TodoTask[];
}

export type TodoAction = "write" | "add" | "update" | "clear" | "list";

export interface TodoTaskInput {
  id?: number;
  title: string;
  status?: TodoStatus;
  note?: string;
}

export interface TodoParams {
  action: TodoAction;
  tasks?: TodoTaskInput[];
  id?: number;
  title?: string;
  status?: TodoStatus;
  note?: string;
}

export interface TodoSummary {
  total: number;
  open: number;
  done: number;
  dropped: number;
  inProgress: number;
  blocked: number;
}

export interface TodoApplyResult {
  state: TodoState;
  text: string;
  error?: string;
  changed: boolean;
}

export function emptyTodo(): TodoState {
  return { nextId: 1, tasks: [] };
}

export function todoSummary(state: TodoState): TodoSummary {
  const summary: TodoSummary = { total: state.tasks.length, open: 0, done: 0, dropped: 0, inProgress: 0, blocked: 0 };
  for (const task of state.tasks) {
    if (task.status === "done") summary.done += 1;
    else if (task.status === "dropped") summary.dropped += 1;
    else {
      summary.open += 1;
      if (task.status === "in_progress") summary.inProgress += 1;
      if (task.status === "blocked") summary.blocked += 1;
    }
  }
  return summary;
}

function isStatus(value: unknown): value is TodoStatus {
  return typeof value === "string" && (STATUS_ENUM as readonly string[]).includes(value);
}

function sanitizeTask(input: TodoTaskInput): TodoTask | undefined {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (title.length === 0) return undefined;
  const status = isStatus(input.status) ? input.status : "pending";
  const task: TodoTask = { id: 0, title, status };
  if (typeof input.id === "number" && Number.isInteger(input.id) && input.id > 0) task.id = input.id;
  const note = typeof input.note === "string" ? input.note.trim() : "";
  if (note.length > 0) task.note = note;
  return task;
}

function requireStatus(params: TodoParams): TodoStatus | undefined {
  return isStatus(params.status) ? params.status : undefined;
}

export function applyTodo(state: TodoState, params: TodoParams, turn: number): TodoApplyResult {
  switch (params.action) {
    case "write":
      return applyWrite(state, params);
    case "add":
      return applyAdd(state, params);
    case "update":
      return applyUpdate(state, params);
    case "clear":
      return state.tasks.length === 0
        ? { state, text: "Todo list is empty.", changed: false }
        : { state: emptyTodo(), text: "Todo list cleared.", changed: true };
    case "list":
      return { state, text: renderList(state), changed: false };
    default:
      return { state, text: "", error: `unknown action: ${String((params as { action?: unknown }).action)}`, changed: false };
  }
  void turn;
}

function applyWrite(state: TodoState, params: TodoParams): TodoApplyResult {
  const inputs = Array.isArray(params.tasks) ? params.tasks : [];
  const tasks: TodoTask[] = [];
  const seen = new Set<number>();
  for (const input of inputs) {
    const task = sanitizeTask(input);
    if (!task) continue;
    if (task.id !== 0) {
      if (seen.has(task.id)) return { state, text: "", error: `duplicate task id ${task.id} in write`, changed: false };
      seen.add(task.id);
      tasks.push(task);
    } else {
      task.id = state.nextId;
      state.nextId += 1;
      tasks.push(task);
    }
  }
  let nextId = state.nextId;
  for (const task of tasks) nextId = Math.max(nextId, task.id + 1);
  const nextState: TodoState = { nextId, tasks };
  return {
    state: nextState,
    text: `Todo list updated: ${tasks.length} task(s), ${todoSummary(nextState).open} open.`,
    changed: true,
  };
}

function applyAdd(state: TodoState, params: TodoParams): TodoApplyResult {
  const title = typeof params.title === "string" ? params.title.trim() : "";
  if (title.length === 0) return { state, text: "", error: "add requires a non-empty title", changed: false };
  const status = requireStatus(params) ?? "pending";
  const task: TodoTask = { id: state.nextId, title, status };
  const note = typeof params.note === "string" ? params.note.trim() : "";
  if (note.length > 0) task.note = note;
  const nextState: TodoState = { nextId: state.nextId + 1, tasks: [...state.tasks, task] };
  return { state: nextState, text: `Added task ${task.id}: ${title}`, changed: true };
}

function applyUpdate(state: TodoState, params: TodoParams): TodoApplyResult {
  if (typeof params.id !== "number" || !Number.isInteger(params.id) || params.id <= 0) {
    return { state, text: "", error: "update requires a task id", changed: false };
  }
  const index = state.tasks.findIndex((task) => task.id === params.id);
  if (index === -1) return { state, text: "", error: `no task with id ${params.id}`, changed: false };
  const current = state.tasks[index];
  const title = typeof params.title === "string" && params.title.trim().length > 0 ? params.title.trim() : current.title;
  const status = requireStatus(params) ?? current.status;
  const task: TodoTask = { id: current.id, title, status };
  const note = params.note === undefined ? current.note : params.note.trim();
  if (note) task.note = note;
  const tasks = [...state.tasks];
  tasks[index] = task;
  const nextState: TodoState = { nextId: state.nextId, tasks };
  return { state: nextState, text: `Updated task ${task.id} → ${task.status}`, changed: true };
}

function renderList(state: TodoState): string {
  if (state.tasks.length === 0) return "No todos yet. Ask the agent to add some!";
  const lines = state.tasks.map((task) => `${GLYPHS[task.status]} [${task.id}] ${task.title}${task.note ? ` — ${task.note}` : ""}`);
  const summary = todoSummary(state);
  return [...lines, "", `${summary.done}/${summary.total} done · ${summary.open} open`].join("\n");
}

export const GLYPHS: Record<TodoStatus, string> = {
  pending: "○",
  in_progress: "▶",
  blocked: "⛔",
  done: "✓",
  dropped: "⊘",
};

export function todoStateMessage(state: TodoState): string | undefined {
  if (state.tasks.length === 0) return undefined;
  const summary = todoSummary(state);
  if (summary.open === 0) return TODO_CLOSED_MARKER;
  const lines = [
    "Todo plan (current work). Keep this list accurate with the todo tool as work moves.",
    ...state.tasks.map((task) => {
      const marker = task.status === "in_progress" ? " (in progress)" : task.status === "blocked" ? ` (blocked: ${task.note ?? "unknown reason"})` : ` (${task.status})`;
      return `- [${task.id}] ${task.title}${marker}`;
    }),
  ];
  return lines.join("\n");
}

export interface TodoReplayInput {
  type?: string;
  customType?: string;
  content?: unknown;
}

export function parseSnapshotMessage(entry: TodoReplayInput): TodoState | undefined {
  if (entry.type !== "custom_message" || entry.customType !== TODO_STATE_MESSAGE_TYPE) return undefined;
  const content = entry.content;
  if (typeof content !== "string") return undefined;
  return parseSnapshot(content);
}

export function parseSnapshot(content: string): TodoState | undefined {
  if (content === TODO_CLOSED_MARKER) return emptyTodo();
  const tasks: TodoTask[] = [];
  const lines = content.split("\n");
  let nextId = 1;
  for (const line of lines) {
    const match = /^- \[(\d+)\] (.+)$/.exec(line.trim());
    if (!match) continue;
    const id = Number.parseInt(match[1], 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    const rest = match[2];
    const marker = / \((in progress|blocked: [^)]*|pending|done|dropped)\)$/.exec(rest);
    let status: TodoStatus = "pending";
    let title = rest;
    if (marker) {
      title = rest.slice(0, marker.index).trim();
      const word = marker[1];
      if (word === "in progress") status = "in_progress";
      else if (word.startsWith("blocked:")) status = "blocked";
      else if (word === "done") status = "done";
      else if (word === "dropped") status = "dropped";
    }
    const task: TodoTask = { id, title, status };
    if (status === "blocked") {
      const blocked = / \(blocked: ([^)]*)\)$/.exec(rest);
      if (blocked && blocked[1].length > 0) task.note = blocked[1];
    }
    if (title.length > 0) {
      tasks.push(task);
      nextId = Math.max(nextId, id + 1);
    }
  }
  if (tasks.length === 0) return undefined;
  return { nextId, tasks };
}

export function replayTodo(entries: readonly TodoReplayInput[]): TodoState {
  let state = emptyTodo();
  for (const entry of entries) {
    const snapshot = parseSnapshotMessage(entry);
    if (snapshot) state = snapshot;
  }
  return state;
}

export function staleTurns(state: TodoState, turn: number, lastWriteTurn: number): number {
  const summary = todoSummary(state);
  if (summary.open === 0) return 0;
  if (lastWriteTurn < 0) return 0;
  return Math.max(0, turn - lastWriteTurn);
}
