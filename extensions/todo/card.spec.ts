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

it("renderTodoCard: long titles wrap to multiple lines within width", () => {
  const state = applyTodo(
    emptyTodo(),
    { action: "write", tasks: [{ title: "A very long task title that goes on and on and on beyond the card width entirely" }] },
    0,
  ).state;
  const lines = renderTodoCard(state, fakeTheme, 30);
  for (const line of lines) {
    assert.ok(plain(line).length <= 30, `line too wide: ${JSON.stringify(line)}`);
  }
  // The full title must appear across the wrapped lines (not truncated).
  const flat = lines.map(plain).join(" ");
  assert.ok(flat.includes("beyond the card width"), "wrapped title includes later words");
  assert.ok(flat.includes("entirely"), "wrapped title includes the final word");
});

it("renderTodoCard: in-progress note wraps with the title", () => {
  const state = applyTodo(
    emptyTodo(),
    { action: "write", tasks: [{ title: "Write API integration tests", status: "in_progress", note: "Covering error paths and rate limiting cases" }] },
    0,
  ).state;
  const lines = renderTodoCard(state, fakeTheme, 30);
  for (const line of lines) {
    assert.ok(plain(line).length <= 30, `line too wide: ${JSON.stringify(line)}`);
  }
  const flat = lines.map(plain).join(" ");
  assert.ok(flat.includes("Write API"), "title is present");
  assert.ok(flat.includes("tests"), "title continues on wrapped line");
  assert.ok(flat.includes("Covering error"), "note is present");
  assert.ok(flat.includes("rate limiting"), "note continues on wrapped line");
  assert.ok(flat.includes("cases"), "note final word present");
});

it("renderTodoCard: lines fit within width even with wide glyphs (emoji)", async () => {
  const { visibleWidth } = await import("@earendil-works/pi-tui");
  const state = applyTodo(
    emptyTodo(),
    { action: "write", tasks: [{ title: "Fix memory leak in websocket handler", status: "blocked", note: "Waiting for dev to confirm the heap snapshot from the staging server" }] },
    0,
  ).state;
  const lines = renderTodoCard(state, fakeTheme, 48);
  const over = lines.filter((l) => visibleWidth(l) > 48);
  assert.equal(over.length, 0, `lines over 48 cols: ${over.map((l) => JSON.stringify(plain(l).slice(0, 50))).join(", ")}`);
});

it("renderTodoCard: all-done list shows 0 open", () => {
  const state = applyTodo(emptyTodo(), { action: "write", tasks: [{ title: "A", status: "done" }] }, 0).state;
  const flat = renderTodoCard(state, fakeTheme, 40).join("\n");
  assert.match(flat, /0 open/);
  assert.match(flat, /1\/1 done/);
});
