import { assert, it } from "vitest";
import { renderTodoCard, todoCardTone } from "./src/card.ts";
import { CARD_TONE } from "../skill-pi-tui/src/card.ts";
import { applyTodo, emptyTodo } from "./src/model.ts";

const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => `\x1b[48;5;16m${text}\x1b[49m`,
  bold: (text: string) => text,
};

function plain(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, "");
}

it("renderTodoCard: empty state renders a short card within width", () => {
  const lines = renderTodoCard(emptyTodo(), fakeTheme, 40);
  assert.ok(lines.length >= 2, "header + footer at minimum");
  for (const line of lines) {
    assert.ok(plain(line).length <= 40, `line too wide: ${JSON.stringify(line)}`);
  }
});

it("renderTodoCard: lists tasks with status info", () => {
  const state = applyTodo(
    emptyTodo(),
    {
      action: "write",
      tasks: [
        { title: "First task" },
        { title: "Second task", status: "in_progress", note: "writing tests" },
        { title: "Third task", status: "blocked", note: "waiting for admin" },
        { title: "Old task", status: "dropped" },
      ],
    },
    0,
  ).state;
  const flat = renderTodoCard(state, fakeTheme, 40).join("\n");
  assert.match(flat, /Todo/);
  assert.match(flat, /First task/);
  assert.match(flat, /Second task · writing tests/);
  assert.match(flat, /Third task · waiting for admin/);
  assert.match(flat, /Old task/);
  assert.match(flat, /3 open/);
  assert.match(flat, /0\/4 done/);
});

it("renderTodoCard: stale state shows a warning footer", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A" }] }, 0).state;
  const flat = renderTodoCard(state, fakeTheme, 52, { staleTurns: 5 }).join("\n");
  assert.match(flat, /untouched 5 turns/);
  assert.equal(todoCardTone(5), CARD_TONE.WARNING);
  assert.equal(todoCardTone(2), CARD_TONE.INFO);
  assert.equal(todoCardTone(undefined), CARD_TONE.INFO);
});

it("renderTodoCard: collapsed mode shows only a summary line", () => {
  const state = applyTodo(
    emptyTodo(),
    { action: "write", tasks: [{ title: "A" }, { title: "B", status: "in_progress" }, { title: "C", status: "blocked", note: "x" }] },
    0,
  ).state;
  const expanded = renderTodoCard(state, fakeTheme, 52);
  const collapsed = renderTodoCard(state, fakeTheme, 52, { collapsed: true, collapseKey: "ctrl+shift+t" });
  assert.ok(collapsed.length < expanded.length, "collapsed is shorter");
  const flat = collapsed.join("\n");
  assert.match(flat, /3 open \(1 blocked\)/);
  assert.ok(!flat.includes("A"), "task titles hidden when collapsed");
  assert.match(flat, /ctrl\+shift\+t/);
});

it("renderTodoCard: long titles are truncated to fit the width", () => {
  const state = applyTodo(
    emptyTodo(),
    { action: "write", tasks: [{ title: "A very long task title that goes on and on and on beyond the card width entirely" }] },
    0,
  ).state;
  const lines = renderTodoCard(state, fakeTheme, 30);
  for (const line of lines) {
    assert.ok(plain(line).length <= 30, `line too wide: ${JSON.stringify(line)}`);
  }
});

it("renderTodoCard: all-done list shows 0 open", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A", status: "done" }] }, 0).state;
  const flat = renderTodoCard(state, fakeTheme, 40).join("\n");
  assert.match(flat, /0 open/);
  assert.match(flat, /1\/1 done/);
});
