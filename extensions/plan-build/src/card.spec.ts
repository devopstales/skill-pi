import { assert, it } from "vitest";
import { renderPlanCard, planCardSummary, planCardTone } from "./card.ts";
import { CARD_TONE } from "../../skill-pi-tui/src/card.ts";
import type { PlanExecutionState } from "./plan-execution.ts";
import type { PlanLifecycle } from "./utils.ts";

const fakeTheme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => `\x1b[48;5;16m${text}\x1b[49m`,
  bold: (text: string) => text,
};

function plain(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/g, "");
}

function openPlan(overrides: Partial<PlanLifecycle> = {}): PlanLifecycle {
  return { sequence: 1, status: "open", task: { title: "Fix login redirects", scope: "Handle 302 loops in auth middleware.", decisions: [] }, ...overrides };
}

function execution(overrides: Partial<PlanExecutionState> = {}): PlanExecutionState {
  return {
    version: 1,
    status: "running",
    panelVisible: true,
    planMarkdown: "# Plan\n\n## Implementation Steps\n\n1. Add middleware\n2. Test it\n3. Verify",
    steps: [
      { id: "step-1", text: "Add middleware", status: "completed", sourceLine: 4, summary: "Done" },
      { id: "step-2", text: "Test it", status: "active", sourceLine: 5 },
      { id: "step-3", text: "Verify", status: "pending", sourceLine: 6 },
    ],
    ...overrides,
  };
}

it("renderPlanCard: no plan renders nothing", () => {
  assert.deepEqual(renderPlanCard({ mode: "build" }, fakeTheme, 48), []);
  assert.deepEqual(renderPlanCard({ mode: "plan", plan: { sequence: 1, status: "completed" } }, fakeTheme, 48), []);
});

it("renderPlanCard: open plan shows title, mode status, and scope", () => {
  const lines = renderPlanCard({ mode: "plan", plan: openPlan() }, fakeTheme, 48);
  assert.ok(lines.length >= 3, "header + body + footer");
  assert.ok(plain(lines[0]).includes("Fix login redirects"), "card header carries the plan title");
  assert.ok(plain(lines[0]).includes("plan"), "card header carries the mode");
  assert.ok(lines.some((line) => plain(line).includes("Handle 302 loops in auth middleware.")), "scope line present");
  assert.ok(plain(lines.at(-1)!).includes("plan"), "footer carries the mode");
  for (const line of lines) {
    assert.ok(plain(line).length <= 48, `line too wide: ${JSON.stringify(line)}`);
  }
});

it("renderPlanCard: step execution shows step rows with glyphs and progress", () => {
  const lines = renderPlanCard({ mode: "build", plan: openPlan(), execution: execution() }, fakeTheme, 48);
  const joined = lines.map(plain).join("\n");
  assert.ok(joined.includes("✓"), "completed glyph");
  assert.ok(joined.includes("▶"), "active glyph");
  assert.ok(joined.includes("○"), "pending glyph");
  assert.ok(joined.includes("Add middleware"), "step 1 text");
  assert.ok(joined.includes("Test it"), "step 2 text");
  assert.ok(joined.includes("Verify"), "step 3 text");
  assert.ok(lines[0].includes("1/3") || plain(lines[0]).includes("1/3"), "progress in subtitle");
  assert.ok(plain(lines.at(-1)!).includes("1/3"), "progress in footer");
  assert.ok(plain(lines.at(-1)!).includes("running"), "status in footer");
  for (const line of lines) {
    assert.ok(plain(line).length <= 48, `line too wide: ${JSON.stringify(line)}`);
  }
});

it("renderPlanCard: awaiting validation uses warning tone and shows the user action", () => {
  const plan = openPlan({ outcome: { kind: "awaiting_validation", reason: "Needs a browser check", userAction: "- Click login and confirm redirect" } });
  assert.equal(planCardTone({ mode: "build", plan }), CARD_TONE.WARNING);
  const lines = renderPlanCard({ mode: "build", plan }, fakeTheme, 48);
  const joined = lines.map(plain).join("\n");
  assert.ok(joined.includes("awaiting validation"), "status shown");
  assert.ok(joined.includes("Needs a browser check"), "reason shown");
  assert.ok(joined.includes("Click login and confirm redirect"), "user action shown");
  assert.ok(plain(lines.at(-1)!).includes("awaiting validation"), "footer hint");
});

it("renderPlanCard: paused execution uses warning tone", () => {
  assert.equal(planCardTone({ mode: "build", plan: openPlan(), execution: execution({ status: "paused" }) }), CARD_TONE.WARNING);
  const lines = renderPlanCard({ mode: "build", plan: openPlan(), execution: execution({ status: "paused" }) }, fakeTheme, 48);
  assert.ok(plain(lines.at(-1)!).includes("paused"), "footer shows paused");
});

it("renderPlanCard: collapsed shows a one-line summary", () => {
  const lines = renderPlanCard({ mode: "build", plan: openPlan(), execution: execution() }, fakeTheme, 48, { collapsed: true });
  const body = lines.slice(1, -1);
  assert.equal(body.length, 1, "collapsed body is one line");
  assert.ok(plain(body[0]).includes("1/3"), "collapsed body carries progress");
  assert.ok(!lines.map(plain).join("\n").includes("Add middleware"), "step rows hidden when collapsed");
});

it("renderPlanCard: completed execution shows the mode, not progress", () => {
  const lines = renderPlanCard({ mode: "build", plan: openPlan(), execution: execution({ status: "completed" }) }, fakeTheme, 48);
  assert.ok(plain(lines.at(-1)!).includes("build"), "footer falls back to the mode");
  assert.ok(!plain(lines.at(-1)!).includes("running"), "no running status for completed execution");
});

it("planCardSummary: derives title and subtitle", () => {
  assert.equal(planCardSummary({ mode: "build" }), undefined);
  const plan = openPlan();
  assert.deepEqual(planCardSummary({ mode: "plan", plan }), { title: "Fix login redirects", subtitle: "plan" });
  assert.deepEqual(planCardSummary({ mode: "build", plan, execution: execution() }), { title: "Fix login redirects", subtitle: "1/3 · running" });
  assert.deepEqual(planCardSummary({ mode: "build", plan: openPlan({ outcome: { kind: "awaiting_validation", reason: "r" } }) }), { title: "Fix login redirects", subtitle: "awaiting validation" });
});

it("renderPlanCard: long step text wraps within the inner width", () => {
  const long = "Implement the login redirect fix by adding middleware to the auth pipeline and wiring it into the server bootstrap".repeat(2);
  const exec = execution({
    steps: [
      { id: "step-1", text: long, status: "ready", sourceLine: 4 },
    ],
    planMarkdown: "# Plan\n\n## Implementation Steps\n\n1. step\n",
  });
  const lines = renderPlanCard({ mode: "build", plan: openPlan(), execution: exec }, fakeTheme, 30);
  for (const line of lines) {
    assert.ok(plain(line).length <= 30, `line too wide: ${JSON.stringify(line)}`);
  }
});
