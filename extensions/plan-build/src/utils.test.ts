import assert from "node:assert/strict";
import os from "node:os";
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { test } from "vitest";
import { buildPlanContext } from "./plan-context.ts";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
	buildPlanReminder,
	COMPLETION_ROUTING_GUIDANCE,
	buildPlanStepReminder,
	buildPlanStepWaitingReminder,
	PLAN_EXIT_DESCRIPTION,
	PLAN_STEP_COMPLETE_DESCRIPTION,
	PLAN_VERIFICATION_GUIDANCE,
	VERIFICATION_GUIDANCE,
} from "./prompts.ts";
import {
	applyManualSelection,
	buildFreshImplementationHandoff,
	buildFreshImplementationRequest,
	buildPlanExitFreshResult,
	buildPlanExitStayResult,
	buildPlanReviewMessage,
	classifyPlanExitChoice,
	decodeModeState,
	decodePlanCollection,
	decodePlanLifecycle,
	displayedPlanTitle,
	extractPlanTitle,
	extractPromptHistory,
	formatInstruction,
	formatModeRail,
	formatModeStatus,
	isAllowedPlanMutation,
	makePlanPath,
	nextMode,
	normalizePlanExitChoice,
	PLAN_EXIT_APPROVE_CHOICE,
	PLAN_EXIT_FRESH_CHOICE,
	PLAN_EXIT_STAY_ACKNOWLEDGEMENT,
	PLAN_EXIT_STAY_CHOICE,
	PLAN_ACTION_ANNOUNCEMENTS,
	PLAN_STEP_READY_ACKNOWLEDGEMENT,
	VALIDATION_NOTICE_HEADING,
	planActionTone,
	sanitizeSessionId,
	validationNotice,
} from "./utils.ts";

test("user-action headings share one bold accent cue and validation content starts below its heading", () => {
	const calls: Array<{ color: string; text: string }> = [];
	const theme = {
		fg(color: string, text: string) { calls.push({ color, text }); return text; },
		bold(text: string) { return `**${text}**`; },
	};
	assert.equal(formatInstruction(theme, VALIDATION_NOTICE_HEADING), "**Awaiting your validation**");
	assert.deepEqual(calls, [{ color: "accent", text: VALIDATION_NOTICE_HEADING }]);
	assert.equal(validationNotice("- Check the fix\n- Check the fallback"), "Awaiting your validation\n\n- Check the fix\n- Check the fallback");
});

test("plan guards normalize Pi paths and resolve filesystem aliases without authorizing unresolved targets", () => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "plan-paths-"));
	try {
		const file = path.join(dir, "plan file.md");
		fs.writeFileSync(file, "# Plan");
		const homePath = `~/${path.relative(os.homedir(), file)}`;
		for (const alias of [file, homePath, `@${homePath}`, pathToFileURL(file).href, file.replace("plan file", "plan\u202Ffile")]) {
			assert.equal(isAllowedPlanMutation(dir, alias, file), true, alias);
		}
		fs.symlinkSync(file, path.join(dir, "alias.md"));
		fs.symlinkSync(dir, path.join(dir, "alias-dir"), "dir");
		assert.equal(isAllowedPlanMutation(dir, "alias.md", file), true);
		assert.equal(isAllowedPlanMutation(dir, "alias-dir/new/nested.md", path.join(dir, "new/nested.md")), true);
		assert.equal(isAllowedPlanMutation(dir, "other.md", file), false);
		fs.symlinkSync("missing.md", path.join(dir, "dangling.md"));
		assert.throws(() => isAllowedPlanMutation(dir, "dangling.md", file), /dangling/);
		fs.symlinkSync("loop.md", path.join(dir, "loop.md"));
		assert.throws(() => isAllowedPlanMutation(dir, "loop.md", file), /ELOOP/);
	} finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("mode rails and status keep the mode colors and glyphs", () => {
	const theme = {
		bold(text: string) { return `\x1b[1m${text}\x1b[22m`; },
		fg(color: "dim" | "warning" | "thinkingLow", text: string) {
			const rgb = {
				dim: "128;128;128",
				warning: "245;167;66",
				thinkingLow: "92;156;245",
			}[color];
			return `\x1b[38;2;${rgb}m${text}\x1b[39m`;
		},
	};
	assert.equal(formatModeRail("plan", theme), "\x1b[38;2;245;167;66m│\x1b[39m");
	assert.equal(formatModeRail("build", theme), "\x1b[38;2;92;156;245m│\x1b[39m");
	assert.equal(formatModeRail("plan", theme, "┆"), "\x1b[38;2;245;167;66m┆\x1b[39m");
	assert.equal(formatModeRail("build", theme, "┇"), "\x1b[38;2;92;156;245m┇\x1b[39m");
	assert.equal(formatModeStatus("plan", theme), "\x1b[38;2;245;167;66m\x1b[1mplan\x1b[22m\x1b[39m");
	assert.equal(formatModeStatus("build", theme), "\x1b[38;2;92;156;245m\x1b[1mbuild\x1b[22m\x1b[39m");
});

test("mode status truncates safely at narrow widths", () => {
	const theme = {
		bold(text: string) { return text; },
		fg(color: string, text: string) { return text; },
	};
	for (const mode of ["plan", "build"] as const) {
		const status = formatModeStatus(mode, theme);
		assert.ok(visibleWidth(status) <= 8);
		assert.doesNotMatch(status, /[\x00-\x1f\x7f-\x9f]/);
	}
});

test("saved plan headings supply only a safe display fallback for unfinished tasks", () => {
	const markdown = "```md\n# Ignore\n```\n~~~\n# Ignore too\n~~~\n## Not top-level\n# Fix login ###\n# Later title";
	assert.equal(extractPlanTitle(markdown), "Fix login");
	assert.equal(extractPlanTitle("# \n## Only a subheading"), undefined);
	assert.equal(extractPlanTitle("# \x1b[31mSafe\x07 title"), "Safe title");
	const open = { sequence: 1, status: "open" } as const;
	assert.equal(displayedPlanTitle(open, false), undefined);
	assert.equal(displayedPlanTitle(open, true), "Untitled task");
	assert.equal(displayedPlanTitle(open, true, "Saved title"), "Saved title");
	assert.equal(displayedPlanTitle({ ...open, task: { title: "Metadata", scope: "Scope", decisions: [] } }, true, "Saved title"), "Metadata");
	assert.equal(displayedPlanTitle({ ...open, status: "completed" }, true, "Saved title"), undefined);
	assert.equal(displayedPlanTitle({ ...open, status: "abandoned", abandonReason: "No longer needed" }, true, "Saved title"), undefined);
	assert.equal(displayedPlanTitle({ ...open, status: "transferred" }, true, "Saved title"), undefined);
});

test("plan collection decoder rejects dangling attachments and preserves inert detached records", () => {
	const records = [{ plan: { sequence: 1, status: "open" } }, { plan: { sequence: 2, status: "completed" } }, { plan: { sequence: 3, status: "abandoned", abandonReason: "Superseded" } }, { plan: { sequence: 4, status: "transferred" } }];
	assert.deepEqual(decodePlanCollection({ records, attached: null, counter: 0 }), { records, attached: null, counter: 4 });
	assert.deepEqual(decodePlanLifecycle({ sequence: 3, status: "abandoned", abandonReason: " Superseded ", outcome: { kind: "blocked", reason: "old" } }), { sequence: 3, status: "abandoned", abandonReason: "Superseded" });
	assert.equal(decodePlanLifecycle({ sequence: 3, status: "abandoned" }), undefined);
	assert.equal(decodePlanCollection({ records, attached: 99, counter: 2 }), undefined);
	assert.equal(decodePlanCollection({ records, attached: 2, counter: 2 }), undefined);
	assert.equal(decodePlanCollection({ records: [records[0], records[0]], attached: 1, counter: 2 }), undefined);
	assert.equal(decodePlanCollection({ records, attached: null, counter: -1 }), undefined);
});

test("mode state decodes current and legacy shapes safely", () => {
	assert.deepEqual(decodeModeState({ version: 1, selectedMode: "plan" }), { version: 1, selectedMode: "plan" });
	assert.deepEqual(decodeModeState({ mode: "build" }), { version: 1, selectedMode: "build" });
	assert.equal(decodeModeState({ selectedMode: "danger" }), undefined);
	assert.equal(decodeModeState(null), undefined);
});

test("session ids produce stable paths inside the plan root", () => {
	const root = path.join(os.tmpdir(), "pi-plans");
	const first = makePlanPath(root, "session/../../escape");
	assert.equal(path.dirname(first), path.resolve(root));
	assert.equal(first, makePlanPath(root, "session/../../escape"));
	assert.equal(sanitizeSessionId("../"), "ephemeral");
});

test("only the exact plan path can be mutated", () => {
	const cwd = path.resolve("/tmp/project");
	const plan = path.resolve(cwd, ".pi/plans/session.md");
	assert.equal(isAllowedPlanMutation(cwd, ".pi/plans/session.md", plan), true);
	assert.equal(isAllowedPlanMutation(cwd, "./.pi/plans/../plans/session.md", plan), true);
	assert.equal(isAllowedPlanMutation(cwd, "@.pi/plans/session.md", plan), true);
	assert.equal(isAllowedPlanMutation(cwd, ".pi/plans/other.md", plan), false);
	assert.equal(isAllowedPlanMutation(cwd, "../../etc/passwd", plan), false);
});

test("manual changes defer run mode while busy", () => {
	assert.deepEqual(applyManualSelection("plan", "build", false), { selectedMode: "plan", runMode: "build" });
	assert.deepEqual(applyManualSelection("plan", undefined, true), { selectedMode: "plan", runMode: "plan" });
	assert.equal(nextMode("build"), "plan");
	assert.equal(nextMode("plan"), "build");
});

test("plan review preserves the complete plan without truncation", () => {
	const plan = `${"section line\n".repeat(500)}FINAL LINE`;
	const review = buildPlanReviewMessage(plan);
	assert.equal(review, `# Plan for Review\n\n${plan}`);
	assert.equal(review.endsWith("FINAL LINE"), true);
	assert.equal(review.includes("truncated"), false);
});

test("stay acknowledgement is stable and actionable", () => {
	assert.equal(
		PLAN_EXIT_STAY_ACKNOWLEDGEMENT,
		"I’ll stay in Plan mode and wait for your next instruction.",
	);
});

test("every plan action has a single-line next-action announcement", () => {
	assert.deepEqual(Object.keys(PLAN_ACTION_ANNOUNCEMENTS).sort(), ["implement-fresh", "implement-here", "stay", "step-by-step"]);
	for (const message of Object.values(PLAN_ACTION_ANNOUNCEMENTS)) {
		assert.ok(message.startsWith("I’ll "));
		assert.equal(/[\r\n]/.test(message), false);
	}
	assert.match(PLAN_ACTION_ANNOUNCEMENTS["step-by-step"], /wait for your instruction before starting a step/);
});

test("plan action announcements classify instructions and acknowledgements", () => {
	assert.equal(planActionTone("stay"), "instruction");
	assert.equal(planActionTone("step-by-step"), "instruction");
	assert.equal(planActionTone("implement-here"), "ack");
	assert.equal(planActionTone("implement-fresh"), "ack");
});

test("step-by-step startup guidance works without a panel", () => {
	assert.equal(PLAN_STEP_READY_ACKNOWLEDGEMENT, "Write “Proceed” to start the first step. Use /plan show for progress and instructions, also shown at the bottom of the plan card when available.");
});

test("declining plan exit stays in Plan mode and terminates the run", () => {
	const declined = buildPlanExitStayResult("/tmp/plan.md", false);
	assert.equal(declined.terminate, true);
	assert.deepEqual(declined.details, {
		approved: false,
		mode: "plan",
		planPath: "/tmp/plan.md",
		cancelled: false,
	});
	assert.equal(declined.content[0].text, "Remaining in Plan mode.");

	const cancelled = buildPlanExitStayResult("/tmp/plan.md", true);
	assert.equal(cancelled.terminate, true);
	assert.equal(cancelled.details.cancelled, true);
});

test("plan exit normalizes Escape to the explicit Stay choice", () => {
	assert.deepEqual(normalizePlanExitChoice(undefined), {
		choice: PLAN_EXIT_STAY_CHOICE,
		cancelled: true,
	});
	assert.deepEqual(normalizePlanExitChoice(PLAN_EXIT_STAY_CHOICE), {
		choice: PLAN_EXIT_STAY_CHOICE,
		cancelled: false,
	});
});

test("plan exit classifies all three choices and fails safe", () => {
	assert.equal(classifyPlanExitChoice(PLAN_EXIT_APPROVE_CHOICE), "implement-here");
	assert.equal(classifyPlanExitChoice(PLAN_EXIT_FRESH_CHOICE), "implement-fresh");
	assert.equal(classifyPlanExitChoice(PLAN_EXIT_STAY_CHOICE), "stay");
	assert.equal(classifyPlanExitChoice("unexpected value"), "stay");
});

test("fresh implementation captures the selected model and thinking level", () => {
	assert.deepEqual(
		buildFreshImplementationRequest("plan", { provider: "openai", id: "gpt-5.6" }, "high"),
		{
			plan: "plan",
			model: { provider: "openai", id: "gpt-5.6" },
			thinkingLevel: "high",
		},
	);
	assert.deepEqual(buildFreshImplementationRequest("plan", undefined, "off"), {
		plan: "plan",
		model: undefined,
		thinkingLevel: "off",
	});
});

test("fresh implementation selection terminates and preserves the handoff", () => {
	const result = buildPlanExitFreshResult("/tmp/plan.md");
	assert.equal(result.terminate, true);
	assert.deepEqual(result.details, {
		approved: true,
		action: "implement-fresh",
		mode: "plan",
		planPath: "/tmp/plan.md",
	});
	assert.equal(result.content[0].text, "Fresh-session implementation selected.");
	const plan = "first line\nlast line";
	const handoff = buildFreshImplementationHandoff(plan);
	assert.match(handoff, /Full tool access is restored/);
	assert.equal(handoff.endsWith(plan), true);
});

test("plan guidance supports conversation before persisted finalization", () => {
	const reminder = buildPlanReminder("No plan file exists yet. Create it only when finalizing.");
	assert.match(reminder, /During research or discussion, answer normally without writing Markdown or calling plan_exit/);
	assert.match(reminder, /Continue discussion until material questions are settled/);
	assert.match(reminder, /write the complete plan to its canonical path, and call plan_exit/);
	assert.match(reminder, /Design a brief `## Verification` section/);
	assert.match(reminder, /standalone `\*\*Agent\*\*` label/);
	assert.equal((reminder.match(/one empty line between the label and its bulleted list/g) ?? []).length, 2);
	assert.match(reminder, /Execution remains deferred until approval/);
	assert.match(reminder, /repository-supported commands and expected observable results/);
	assert.match(reminder, /Never invent commands/i);
	assert.match(reminder, /do not present build\/type-check alone as runtime proof/);
	assert.match(reminder, /standalone `\*\*User\*\*` label only for essential checks/);
	assert.match(reminder, /must not perform it without separate authorization/);
	assert.doesNotMatch(reminder, /`### (?:Agent|User)`|\*\*(?:Agent|User):\*\*/);
	assert.match(PLAN_EXIT_DESCRIPTION, /saving the complete plan and resolving planning questions/);
	assert.match(reminder, /## Implementation Steps/);
	assert.match(reminder, /ordered top-level items \(`1\. \.\.\.`, `2\. \.\.\.`\)/);
	assert.match(reminder, /without checkboxes or completion markers/);
	assert.match(reminder, /Record progress only with extension tools/);
	assert.equal(reminder.includes("- [ ]"), false);
});

test("phase-specific verification policy remains complete and bounded", () => {
	const planning = buildPlanReminder("Plan path: /tmp/plan.md");
	const build = buildPlanContext("build", { records: [{ plan: { sequence: 1, status: "open" } }], attached: 1, counter: 1 }, { path: "/tmp/plan.md", state: "saved" })!;
	const handoff = buildFreshImplementationHandoff("Approved plan");
	const step = buildPlanStepReminder("/tmp/plan.md", 1, 2, "Update behavior");
	assert.equal(planning.split(PLAN_VERIFICATION_GUIDANCE).length, 2);
	for (const prompt of [build, handoff, step]) assert.equal(prompt.split(VERIFICATION_GUIDANCE).length, 2);
	assert.equal(build.split(COMPLETION_ROUTING_GUIDANCE).length, 2);

	assert.match(PLAN_VERIFICATION_GUIDANCE, /smallest credible proof of changed behavior/);
	assert.match(PLAN_VERIFICATION_GUIDANCE, /repository-supported commands and expected observable results/);
	assert.match(PLAN_VERIFICATION_GUIDANCE, /Never invent commands/);
	assert.match(PLAN_VERIFICATION_GUIDANCE, /build\/type-check alone as runtime proof/);
	assert.match(PLAN_VERIFICATION_GUIDANCE, /User.*only for essential checks/);
	assert.match(VERIFICATION_GUIDANCE, /smallest sufficient check, then stop/);
	assert.match(VERIFICATION_GUIDANCE, /one focused behavioral test or smoke check/);
	assert.match(VERIFICATION_GUIDANCE, /existing coverage misses changed behavior/);
	assert.match(VERIFICATION_GUIDANCE, /concrete uncovered risk, observed failure, or explicit user\/repository requirement/);
	assert.match(VERIFICATION_GUIDANCE, /Reuse passing results unless later changes could invalidate them/);
	assert.match(VERIFICATION_GUIDANCE, /Report passed, blocked, and unperformed checks truthfully/);
	assert.match(VERIFICATION_GUIDANCE, /Never weaken checks, claim an unperformed check passed, or fix unrelated failures/);

	assert.ok(planning.length <= 3500, `planning context grew to ${planning.length} characters`);
	assert.ok(build.length <= 3900, `Build context grew to ${build.length} characters`);
	assert.ok(step.length <= 1900, `step context grew to ${step.length} characters`);
	assert.ok(handoff.length - "Approved plan".length <= 1200, `fresh handoff overhead grew to ${handoff.length} characters`);
});

test("step execution prompts constrain work to an approved active step", () => {
	const reminder = buildPlanStepReminder("/tmp/plan.md", 2, 4, "Build the parser");
	assert.match(reminder, /only step 2 of 4/);
	assert.match(reminder, /Build the parser/);
	assert.match(reminder, /Do not edit approved Markdown or begin later steps/);
	assert.match(reminder, /plan_step_complete/);
	assert.match(reminder, /Verify only this step where possible/);
	assert.match(reminder, /Defer checks dependent on later steps/);
	assert.match(reminder, /report the deferral, never a pass/);
	assert.match(PLAN_STEP_COMPLETE_DESCRIPTION, /after its implementation and applicable checks/);
	assert.match(PLAN_STEP_COMPLETE_DESCRIPTION, /report later-step deferrals without claiming they passed/);
	const waiting = buildPlanStepWaitingReminder("1. [ready] Build parser");
	assert.match(waiting, /No step is approved for project mutation/);
	assert.match(waiting, /Interpret clear intent contextually/);
	assert.match(waiting, /running, paused, or awaiting validation/);
	assert.match(waiting, /approval\/proceed starts the ready step with plan_step_control start/);
	assert.match(waiting, /records past work and authorizes no implementation/);
	assert.match(waiting, /handles skip, revise, pause\/resume, cancel/);
	assert.match(waiting, /sidebar is passive/i);
	assert.match(COMPLETION_ROUTING_GUIDANCE, /whole-plan completion.*plan_complete/i);
	assert.match(COMPLETION_ROUTING_GUIDANCE, /identified step.*step tool/i);
	assert.match(COMPLETION_ROUTING_GUIDANCE, /clarify.*bare completion/i);
	for (const prompt of [reminder, waiting, PLAN_STEP_COMPLETE_DESCRIPTION]) {
		assert.equal(prompt.split(COMPLETION_ROUTING_GUIDANCE).length, 2);
	}
});

test("prompt history restores normalized user text in chronological order", () => {
	const entries = [
		{ type: "message", message: { role: "assistant", content: [{ type: "text", text: "ignore" }] } },
		{ type: "message", message: { role: "user", content: "  first prompt  " } },
		{ type: "custom_message", content: "ignore injected context" },
		{
			type: "message",
			message: {
				role: "user",
				content: [
					{ type: "text", text: "second " },
					{ type: "image", data: "...", mimeType: "image/png" },
					{ type: "text", text: "prompt" },
				],
			},
		},
		{ type: "message", message: { role: "user", content: "second prompt" } },
		{ type: "message", message: { role: "user", content: [{ type: "image", data: "..." }] } },
	];
	assert.deepEqual(extractPromptHistory(entries), ["first prompt", "second prompt"]);
});

test("prompt history keeps the latest 100 entries", () => {
	const entries = Array.from({ length: 105 }, (_, index) => ({
		type: "message",
		message: { role: "user", content: `prompt ${index}` },
	}));
	const history = extractPromptHistory(entries);
	assert.equal(history.length, 100);
	assert.equal(history[0], "prompt 5");
	assert.equal(history.at(-1), "prompt 104");
	assert.deepEqual(extractPromptHistory(entries, 2), ["prompt 103", "prompt 104"]);
	assert.deepEqual(extractPromptHistory(entries, 0), []);
});
