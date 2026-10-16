import { assert, it } from "vitest";
import { renderTodoCard } from "./src/card.ts";
import { applyTodo, emptyTodo } from "./src/model.ts";

const fakeTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
};

function state(tasks: any[]): ReturnType<typeof applyTodo>["state"] {
	return applyTodo(emptyTodo(), { action: "write", tasks }, 0).state;
}

const CASES: Array<{ name: string; tasks: any[]; width: number; options?: { collapsed?: boolean; staleTurns?: number; collapseKey?: string } }> = [
	{ name: "empty", tasks: [], width: 40 },
	{ name: "all-statuses", tasks: [
		{ title: "First task" },
		{ title: "Second task", status: "in_progress", note: "writing tests" },
		{ title: "Third task", status: "blocked", note: "waiting for admin" },
		{ title: "Old task", status: "dropped" },
		{ title: "Shipped", status: "done" },
	], width: 48 },
	{ name: "stale", tasks: [{ title: "A" }], width: 52, options: { staleTurns: 5 } },
	{ name: "stale-collapsed-key", tasks: [{ title: "A" }, { title: "B", status: "in_progress" }, { title: "C", status: "blocked", note: "x" }], width: 52, options: { collapsed: true, collapseKey: "t", staleTurns: 6 } },
	{ name: "collapsed-all-done", tasks: [{ title: "A", status: "done" }], width: 40, options: { collapsed: true } },
	{ name: "long-title-narrow", tasks: [{ title: "A very long task title that goes on and on and on beyond the card width entirely" }], width: 30 },
	{ name: "very-narrow", tasks: [{ title: "A" }], width: 7 },
];

const GOLDEN: Record<string, string[]> = {
	empty: [
		"╭─ ◔ Todo · 0/0 · 0 open ──────────────╮",
		"│ No todos yet.                        │",
		"╰─────────────────── 0 open · 0/0 done ╯",
	],
	"all-statuses": [
		"╭─ ◔ Todo · 1/5 · 3 open ──────────────────────╮",
		"│ ○ First task                                 │",
		"│ ▶ Second task · writing tests                │",
		"│ ⛔ Third task · waiting for admin            │",
		"│ ⊘ Old task                                   │",
		"│ ✓ Shipped                                    │",
		"╰─────────────────────────── 3 open · 1/5 done ╯",
	],
	stale: [
		"╭─ ◔ Todo · 0/1 · 1 open ──────────────────────────╮",
		"│ ○ A                                              │",
		"╰─────────── untouched 5 turns · 1 open · 0/1 done ╯",
	],
	"stale-collapsed-key": [
		"╭─ ◔ Todo · 0/3 · 3 open ──────── stale · ctrl+q t ╮",
		"│ 3 open (1 blocked)                               │",
		"╰──────────────────────────────────────────────────╯",
	],
	"collapsed-all-done": [
		"╭─ ◔ Todo · 1/1 · 0 open ──────────────╮",
		"│ all done                             │",
		"╰──────────────────────────────────────╯",
	],
	"long-title-narrow": [
		"╭─ ◔ Todo · 0/1 · 1 open ────╮",
		"│ ○ A very long task title   │",
		"│ that goes on and on and on │",
		"│ beyond the card width      │",
		"│ entirely                   │",
		"╰───────── 1 open · 0/1 done ╯",
	],
	"very-narrow": [
		"╭─ ◔ \u001b[0m ╮",
		"│ ○ A │",
		"╰─────╯",
	],
};

function dump(): void {
	for (const c of CASES) {
		const actual = renderTodoCard(state(c.tasks), fakeTheme, c.width, c.options);
		// eslint-disable-next-line no-console
		console.log(JSON.stringify({ name: c.name, lines: actual }));
	}
}

it("renderTodoCard golden: output is stable across the dedup refactor", () => {
	if (process.env.DUMP_GOLDEN) {
		dump();
		assert.fail("dump mode");
	}
	for (const c of CASES) {
		const s = state(c.tasks);
		const actual = renderTodoCard(s, fakeTheme, c.width, c.options);
		const expected = GOLDEN[c.name];
		assert.deepEqual(actual, expected, `case ${c.name}\n--- expected ---\n${expected.map((l) => JSON.stringify(l)).join("\n")}\n--- actual ---\n${actual.map((l) => JSON.stringify(l)).join("\n")}`);
	}
});
