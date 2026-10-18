import { assert, it } from "vitest";
import { renderPlanCard } from "./card.ts";
import type { PlanTheme } from "./theme.ts";
import type { PlanExecutionState, PlanStep } from "./plan-execution.ts";
import type { PlanLifecycle } from "./utils.ts";

const theme = {
	fg: (_color: string, text: string) => text,
	bold: (text: string) => text,
} satisfies PlanTheme;

function openPlan(overrides: Partial<PlanLifecycle> = {}): PlanLifecycle {
	return { sequence: 1, status: "open", task: { title: "Fix login redirects", scope: "Handle 302 loops in auth middleware.", decisions: [] }, ...overrides };
}

function steps(): PlanStep[] {
	return [
		{ id: "step-1", status: "completed", text: "Add middleware", sourceLine: 4 },
		{ id: "step-2", status: "completed", text: "Wire it up", sourceLine: 5 },
		{ id: "step-3", status: "ready", text: "Write regression test", sourceLine: 6 },
		{ id: "step-4", status: "active", text: "Implement middleware", sourceLine: 7 },
		{ id: "step-5", status: "pending", text: "Verify the fix", sourceLine: 8 },
		{ id: "step-6", status: "skipped", text: "Legacy cleanup", sourceLine: 9 },
	];
}

function execution(overrides: Partial<PlanExecutionState> = {}): PlanExecutionState {
	return {
		version: 1,
		status: "running",
		panelVisible: true,
		planMarkdown: "# Plan\n\n## Implementation Steps\n\n1. a\n2. b\n",
		steps: steps(),
		...overrides,
	};
}

const CASES: Array<{ name: string; model: { mode: "plan" | "build"; plan?: PlanLifecycle; execution?: PlanExecutionState }; width: number; options?: { collapsed?: boolean } }> = [
	{ name: "open-plan-plan-mode", model: { mode: "plan", plan: openPlan() }, width: 48 },
	{ name: "open-plan-build-mode-narrow", model: { mode: "build", plan: openPlan() }, width: 30 },
	{ name: "running-execution", model: { mode: "build", plan: openPlan(), execution: execution() }, width: 48 },
	{ name: "running-execution-narrow", model: { mode: "build", plan: openPlan(), execution: execution() }, width: 30 },
	{ name: "paused-execution", model: { mode: "build", plan: openPlan(), execution: execution({ status: "paused" }) }, width: 48 },
	{ name: "completed-execution", model: { mode: "build", plan: openPlan(), execution: execution({ status: "completed" }) }, width: 48 },
	{ name: "collapsed-running", model: { mode: "build", plan: openPlan(), execution: execution() }, width: 48, options: { collapsed: true } },
	{ name: "collapsed-completed", model: { mode: "build", plan: openPlan(), execution: execution({ status: "completed" }) }, width: 48, options: { collapsed: true } },
	{ name: "awaiting-validation", model: { mode: "build", plan: openPlan({ outcome: { kind: "awaiting_validation", reason: "Needs a browser check", userAction: "- Click login" } }) }, width: 48 },
	{ name: "awaiting-validation-collapsed", model: { mode: "build", plan: openPlan({ outcome: { kind: "awaiting_validation", reason: "Needs a browser check", userAction: "- Click login" } }) }, width: 48, options: { collapsed: true } },
	{ name: "very-narrow-running", model: { mode: "build", plan: openPlan(), execution: execution() }, width: 7 },
];

const GOLDEN: Record<string, string[]> = {
	"open-plan-plan-mode": [
		"╭─ ✿ Fix login redirects · plan ───────────────╮",
		"│ Handle 302 loops in auth middleware.         │",
		"╰──────────────────────────────────────── plan ╯",
	],
	"open-plan-build-mode-narrow": [
		"╭─ ✿ Fix login redirects · b\u001b[0m ╮",
		"│ Handle 302 loops in auth   │",
		"│ middleware.                │",
		"╰───────────────────── build ╯",
	],
	"running-execution": [
		"╭─ ✿ Fix login redirects · 3/6 · running ──────╮",
		"│ ✓ 1. Add middleware                          │",
		"│ ✓ 2. Wire it up                              │",
		"│ ▷ 3. Write regression test                   │",
		"│ ▶ 4. Implement middleware                    │",
		"│ ○ 5. Verify the fix                          │",
		"│ – 6. Legacy cleanup                          │",
		"╰─────────────────────────────── 3/6 · running ╯",
	],
	"running-execution-narrow": [
		"╭─ ✿ Fix login redirects · 3\u001b[0m ╮",
		"│ ✓ 1. Add middleware        │",
		"│ ✓ 2. Wire it up            │",
		"│ ▷ 3. Write regression test │",
		"│ ▶ 4. Implement middleware  │",
		"│ ○ 5. Verify the fix        │",
		"│ – 6. Legacy cleanup        │",
		"╰───────────── 3/6 · running ╯",
	],
	"paused-execution": [
		"╭─ ✿ Fix login redirects · 3/6 · paused ───────╮",
		"│ ✓ 1. Add middleware                          │",
		"│ ✓ 2. Wire it up                              │",
		"│ ▷ 3. Write regression test                   │",
		"│ ▶ 4. Implement middleware                    │",
		"│ ○ 5. Verify the fix                          │",
		"│ – 6. Legacy cleanup                          │",
		"╰──────────────────────────────── 3/6 · paused ╯",
	],
	"completed-execution": [
		"╭─ ✿ Fix login redirects · build ──────────────╮",
		"│ Handle 302 loops in auth middleware.         │",
		"╰─────────────────────────────────────── build ╯",
	],
	"collapsed-running": [
		"╭─ ✿ Fix login redirects · 3/6 · running ──────╮",
		"│ 3/6 · running                                │",
		"╰─────────────────────────────── 3/6 · running ╯",
	],
	"collapsed-completed": [
		"╭─ ✿ Fix login redirects · build ──────────────╮",
		"│ Handle 302 loops in auth middleware.         │",
		"╰─────────────────────────────────────── build ╯",
	],
	"awaiting-validation": [
		"╭─ ✿ Fix login redirects · awaiting validation ╮",
		"│ Handle 302 loops in auth middleware.         │",
		"│ awaiting validation                          │",
		"│ Needs a browser check                        │",
		"│ - Click login                                │",
		"╰───────────────────────── awaiting validation ╯",
	],
	"awaiting-validation-collapsed": [
		"╭─ ✿ Fix login redirects · awaiting validation ╮",
		"│ awaiting your validation                     │",
		"╰───────────────────────── awaiting validation ╯",
	],
	"very-narrow-running": [
		"╭─ ✿ \u001b[0m ╮",
		"│ ✓   │",
		"│ 1.  │",
		"│ Add │",
		"│ mid │",
		"│ dle │",
		"│ war │",
		"│ e   │",
		"│ ✓   │",
		"│ 2.  │",
		"│ Wir │",
		"│ e   │",
		"│ it  │",
		"│ up  │",
		"│ ▷   │",
		"│ 3.  │",
		"│ Wri │",
		"│ te  │",
		"│ reg │",
		"│ res │",
		"│ sio │",
		"│ n   │",
		"│ tes │",
		"│ t   │",
		"│ ▶   │",
		"│ 4.  │",
		"│ Imp │",
		"│ lem │",
		"│ ent │",
		"│ mid │",
		"│ dle │",
		"│ war │",
		"│ e   │",
		"│ ○   │",
		"│ 5.  │",
		"│ Ver │",
		"│ ify │",
		"│ the │",
		"│ fix │",
		"│ –   │",
		"│ 6.  │",
		"│ Leg │",
		"│ acy │",
		"│ cle │",
		"│ anu │",
		"│ p   │",
		"╰─────╯",
	],
};

function dump(): void {
	for (const c of CASES) {
		const actual = renderPlanCard(c.model, theme, c.width, c.options);
		// eslint-disable-next-line no-console
		console.log(JSON.stringify({ name: c.name, lines: actual }));
	}
}

it("renderPlanCard golden: output is stable across the dedup refactor", () => {
	if (process.env.DUMP_GOLDEN) {
		dump();
		assert.fail("dump mode");
	}
	for (const c of CASES) {
		const actual = renderPlanCard(c.model, theme, c.width, c.options);
		const expected = GOLDEN[c.name];
		assert.deepEqual(actual, expected, `case ${c.name}\n--- expected ---\n${expected.map((l) => JSON.stringify(l)).join("\n")}\n--- actual ---\n${actual.map((l) => JSON.stringify(l)).join("\n")}`);
	}
});
