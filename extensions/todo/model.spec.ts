import { assert, it } from "vitest";
import {
  applyTodo,
  emptyTodo,
  parseSnapshot,
  parseSnapshotMessage,
  replayTodo,
  staleTurns,
  todoStateMessage,
  todoSummary,
  TODO_CLOSED_MARKER,
  TODO_STATE_MESSAGE_TYPE,
  type TodoState,
} from "./src/model.ts";

it("empty list: summary is zero and state message undefined", () => {
  const state = emptyTodo();
  assert.deepEqual(todoSummary(state), { total: 0, open: 0, done: 0, dropped: 0, inProgress: 0, blocked: 0 });
  assert.equal(todoStateMessage(state), undefined);
});

it("write: replaces the list, keeps existing ids, assigns new ids", () => {
  let state = emptyTodo();
  let result = applyTodo(state, { action: "write", tasks: [{ title: "A" }, { title: "B" }] }, 0);
  assert.ok(!result.error);
  state = result.state;
  assert.deepEqual(state.tasks.map((t) => t.id), [1, 2]);
  assert.equal(state.nextId, 3);

  result = applyTodo(state, { action: "write", tasks: [{ id: 1, title: "A2", status: "done" }, { title: "C" }] }, 1);
  assert.ok(!result.error);
  state = result.state;
  assert.deepEqual(state.tasks.map((t) => [t.id, t.title, t.status]), [
    [1, "A2", "done"],
    [3, "C", "pending"],
  ]);
  assert.equal(state.nextId, 4);
});

it("write: rejects duplicate ids", () => {
  const result = applyTodo(emptyTodo(), { action: "write", tasks: [{ id: 5, title: "A" }, { id: 5, title: "B" }] }, 0);
  assert.match(result.error ?? "", /duplicate task id 5/);
  assert.equal(result.changed, false);
});

it("write: defaults status to pending, trims titles, skips empty titles", () => {
  const result = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "  A  " }, { title: "   " }] }, 0);
  state_check(result.state);
  assert.deepEqual(result.state.tasks.map((t) => [t.title, t.status]), [["A", "pending"]]);
});

function state_check(state: TodoState) {
  assert.ok(state);
}

it("add: appends with next id, honors status + note", () => {
  let state = applyTodo(emptyTodo(), { action: "add", title: "First" }, 0).state;
  let result = applyTodo(state, { action: "add", title: "Second", status: "blocked", note: "waiting for X" }, 0);
  assert.ok(!result.error);
  state = result.state;
  assert.deepEqual(state.tasks.map((t) => [t.id, t.title, t.status, t.note]), [
    [1, "First", "pending", undefined],
    [2, "Second", "blocked", "waiting for X"],
  ]);
});

it("add: errors on empty title", () => {
  const result = applyTodo(emptyTodo(), { action: "add", title: "  " }, 0);
  assert.match(result.error ?? "", /title/);
});

it("update: changes title/status/note of an existing task", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }, { title: "B" }] }, 0).state;
  let result = applyTodo(state, { action: "update", id: 1, status: "in_progress", note: "working" }, 1);
  assert.ok(!result.error);
  let next = result.state;
  assert.deepEqual(next.tasks[0], { id: 1, title: "A", status: "in_progress", note: "working" });

  result = applyTodo(next, { action: "update", id: 2, title: "B2", status: "dropped" }, 1);
  assert.ok(!result.error);
  next = result.state;
  assert.equal(next.tasks[1].title, "B2");
  assert.equal(next.tasks[1].status, "dropped");
});

it("update: errors on missing id", () => {
  const result = applyTodo(emptyTodo(), { action: "update", id: 99, status: "done" }, 0);
  assert.match(result.error ?? "", /no task with id 99/);
});

it("clear: empties the list", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }] }, 0).state;
  const result = applyTodo(state, { action: "clear" }, 1);
  assert.deepEqual(result.state, emptyTodo());
  assert.match(result.text, /cleared/);
});

it("list: reports the list without changing state", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }, { title: "B", status: "done" }] }, 0).state;
  const result = applyTodo(state, { action: "list" }, 1);
  assert.equal(result.changed, false);
  assert.equal(result.state, state);
  assert.match(result.text, /A/);
  assert.match(result.text, /B/);
  assert.match(result.text, /1\/2 done/);
});

it("list: empty list message", () => {
  const result = applyTodo(emptyTodo(), { action: "list" }, 0);
  assert.match(result.text, /No todos yet/);
});

it("summary: counts open/done/dropped/inProgress/blocked", () => {
  const state = applyTodo(
    emptyTodo(),
    {
      action: "write",
      tasks: [
        { title: "a" },
        { title: "b", status: "in_progress" },
        { title: "c", status: "blocked", note: "x" },
        { title: "d", status: "done" },
        { title: "e", status: "dropped" },
      ],
    },
    0,
  ).state;
  assert.deepEqual(todoSummary(state), { total: 5, open: 3, done: 1, dropped: 1, inProgress: 1, blocked: 1 });
});

it("todoStateMessage: open list renders numbered lines", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }, { title: "B", status: "blocked", note: "waiting" }] }, 0).state;
  const message = todoStateMessage(state);
  assert.ok(message);
  assert.match(message, /- \[1\] A \(pending\)/);
  assert.match(message, /- \[2\] B \(blocked: waiting\)/);
});

it("parseSnapshot: round-trips an open state message", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }, { title: "B", status: "in_progress" }, { title: "C", status: "blocked", note: "waiting for admin" }] }, 0).state;
  const message = todoStateMessage(state);
  assert.ok(message);
  const parsed = parseSnapshot(message!);
  assert.ok(parsed);
  assert.deepEqual(parsed!.tasks.map((t) => [t.id, t.title, t.status, t.note]), [
    [1, "A", "pending", undefined],
    [2, "B", "in_progress", undefined],
    [3, "C", "blocked", "waiting for admin"],
  ]);
  assert.equal(parsed!.nextId, 4);
});

it("parseSnapshot: closed marker returns empty state", () => {
  assert.deepEqual(parseSnapshot(TODO_CLOSED_MARKER), emptyTodo());
});

it("parseSnapshot: garbage returns undefined", () => {
  assert.equal(parseSnapshot("hello\nworld"), undefined);
});

it("parseSnapshotMessage: matches custom message entries only", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }] }, 0).state;
  const message = todoStateMessage(state);
  assert.ok(message);
  const entry = { type: "custom_message", customType: TODO_STATE_MESSAGE_TYPE, content: message!, display: false };
  const parsed = parseSnapshotMessage(entry);
  assert.ok(parsed);
  assert.equal(parsed!.tasks.length, 1);
  assert.equal(parseSnapshotMessage({ type: "message", customType: TODO_STATE_MESSAGE_TYPE, content: message! }), undefined);
  assert.equal(parseSnapshotMessage({ type: "custom_message", customType: "other", content: message! }), undefined);
});

it("replayTodo: rebuilds state from a branch", () => {
  const written = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }, { title: "B" }] }, 0).state;
  const updated = applyTodo(written, { action: "update", id: 1, status: "done" }, 1).state;
  const message1 = todoStateMessage(written);
  const message2 = todoStateMessage(updated);
  assert.ok(message1 && message2);
  const branch = [
    { type: "message", message: { role: "user" } },
    { type: "custom_message", customType: TODO_STATE_MESSAGE_TYPE, content: message1!, display: false },
    { type: "compaction", summary: "x" },
    { type: "custom_message", customType: TODO_STATE_MESSAGE_TYPE, content: message2!, display: false },
  ];
  const replayed = replayTodo(branch);
  assert.equal(replayed.tasks.length, 2);
  assert.equal(replayed.tasks[0].status, "done");
  assert.equal(replayed.tasks[1].status, "pending");
});

it("replayTodo: closed marker after open snapshot clears the list", () => {
  const written = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }] }, 0).state;
  const message1 = todoStateMessage(written);
  assert.ok(message1);
  const allDone = applyTodo(written, { action: "update", id: 1, status: "done" }, 1).state;
  const branch = [
    { type: "custom_message", customType: TODO_STATE_MESSAGE_TYPE, content: message1!, display: false },
    { type: "custom_message", customType: TODO_STATE_MESSAGE_TYPE, content: TODO_CLOSED_MARKER, display: false },
  ];
  const replayed = replayTodo(branch);
  assert.deepEqual(replayed, emptyTodo());
  void allDone;
});

it("staleTurns: zero when nothing open, negative before first write, else turn delta", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }] }, 0).state;
  assert.equal(staleTurns(state, 0, -1), 0);
  assert.equal(staleTurns(state, 3, 0), 3);
  assert.equal(staleTurns(state, 2, 3), 0);
  const done = applyTodo(state, { action: "update", id: 1, status: "done" }, 2).state;
  assert.equal(staleTurns(done, 9, 2), 0);
});
