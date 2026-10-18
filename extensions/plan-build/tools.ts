import fs from "node:fs";
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	activePlanStep,
	createPlanExecution,
	pausePlanExecution,
	revisePlanStep,
	skipPlanStep,
	startPlanStep,
	updatePlanStepInstruction,
	type PlanExecutionState,
} from "./src/plan-execution.ts";
import { handoffSnapshot } from "./src/handoff.ts";
import {
	COMPLETION_ROUTING_GUIDANCE,
	PLAN_EXIT_DESCRIPTION,
	PLAN_STEP_COMPLETE_DESCRIPTION,
} from "./src/prompts.ts";
import { noticeTracker, pendingOrError, renderStepResult, resultText, statusCall, TRANSCRIPT_PADDING } from "./src/tool-presentation.ts";
import {
	buildFreshImplementationRequest,
	buildPlanExitFreshResult,
	buildPlanExitStayResult,
	buildPlanReviewMessage,
	classifyPlanExitChoice,
	cleanTaskTitle,
	normalizePlanExitChoice,
	PLAN_ACTION_ANNOUNCEMENTS,
	formatInstruction,
	PLAN_EXIT_APPROVE_CHOICE,
	PLAN_EXIT_FRESH_CHOICE,
	PLAN_EXIT_STAY_CHOICE,
	planActionTone,
	validationNotice,
	type Mode,
	type PlanOutcome,
} from "./src/utils.ts";
import { armReconciliation } from "./reconciliation.ts";
import type { PlanSession } from "./session-state.ts";

const PLAN_REVIEW_ENTRY_TYPE = "skill-pi-plan-review";
const PLAN_STEP_GUIDANCE_ENTRY_TYPE = "skill-pi-plan-step-guidance";
const PLAN_STEP_CHOICE = "Implement step by step";
const EMPTY_PARAMETERS = Type.Object({});

export interface ToolDeps {
	pi: ExtensionAPI;
	session: (ctx: ExtensionContext) => PlanSession;
	currentPlanPath: (current: PlanSession) => string;
	stateData: (current: PlanSession) => unknown;
	refreshSavedPlanTitle: (current: PlanSession) => void;
	completablePlanStep: (current: PlanSession) => { id: string } | undefined;
	completeExecutionStep: (current: PlanSession, id: string, summary?: string) => string | undefined;
	cancelPlanExecution: (current: PlanSession) => void;
	applyExecutionTransition: (current: PlanSession, next: PlanExecutionState) => string | undefined;
	updateExecution: (current: PlanSession, next: PlanExecutionState) => void;
	selectMode: (mode: Mode, current: PlanSession, ctx: ExtensionContext, source: "manual" | "tool") => Promise<void>;
	syncPlanState: (current: PlanSession, ctx?: ExtensionContext) => void;
	syncAttachment: (current: PlanSession, ctx?: ExtensionContext) => void;
	closeCurrentPlan: (current: PlanSession, summary?: string) => void;
	abandonCurrentPlan: (current: PlanSession, reason: string, ctx: ExtensionContext) => string;
	startNewPlan: (current: PlanSession, ctx: ExtensionContext, task?: { title: string; scope: string; decisions: Array<{ topic: string; outcome: "include" | "discussion" }> }) => void;
	completeCurrentPlan: (current: PlanSession, summary?: string) => void;
	shorten: (filePath: string, cwd: string) => string;
	taskResult: (current: PlanSession, action: string, title: string, changed?: boolean) => AgentToolResult<Record<string, unknown>>;
	modeNotices: ReturnType<typeof noticeTracker>;
}

export function registerTools(deps: ToolDeps): void {
	const {
		pi, session, currentPlanPath, stateData, refreshSavedPlanTitle, completablePlanStep, completeExecutionStep,
		cancelPlanExecution, applyExecutionTransition, updateExecution, selectMode, syncPlanState, syncAttachment,
		closeCurrentPlan, abandonCurrentPlan, startNewPlan, completeCurrentPlan, shorten, taskResult, modeNotices,
	} = deps;

	pi.registerTool({
		name: "plan_task",
		label: "Plan Task",
		description: "Manage the one current plan's metadata, not its Markdown. new is Plan-only; include adds explicit user-approved work using the complete merged scope; update is only for a rename, identity correction, or material correction/constraint within the existing deliverable; discussion records an explicit exclusion; abandon requires explicit direction and a reason; list is read-only. Supply expectedAttached (or legacy sequence). Deprecated pause/resume never mutate state. Keep transitions separate from dependent writes or shell calls.",
		promptGuidelines: ["Use plan_task once to establish an imperative, single-action title and detailed scope—for example `Add color to the composer`. Use include with the complete merged scope for an explicit user-approved addition. Use update only for a rename, identity correction, or material correction/constraint within the existing deliverable; do not use it for additions, progress, or implementation details. Create only after an explicit planning request or accepted concrete proposal, with expectedAttached: null, then use the returned path. Never replace an unfinished plan; abandon only on explicit user direction."],
		parameters: Type.Object({
			action: Type.String({ enum: ["list", "pause", "resume", "update", "include", "discussion", "new", "abandon"] }),
			sequence: Type.Optional(Type.Integer({ minimum: 0 })),
			expectedAttached: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
			targetSequence: Type.Optional(Type.Integer({ minimum: 0 })),
			title: Type.Optional(Type.String({ maxLength: 160, description: "One imperative phrase naming the action, its object, and at most a short goal, e.g. `Add color to the composer`. Keep it to a single action; put additional requirements in scope." })),
			scope: Type.Optional(Type.String({ maxLength: 4000 })),
			topic: Type.Optional(Type.String({ maxLength: 1000 })),
			reason: Type.Optional(Type.String({ maxLength: 1000 })),
		}),
		executionMode: "sequential",
		async execute(_id, params, signal, _onUpdate, ctx) {
			const current = session(ctx);
			current.currentContext = ctx;
			if (signal?.aborted) throw new Error("Task update cancelled");
			const action = params.action;
			current.plans.assertUsable();
			if (action === "list") return taskResult(current, "list", "");
			const expected = params.expectedAttached !== undefined ? params.expectedAttached : params.sequence;
			if (expected === undefined || expected !== current.plans.collection.attached) throw new Error(`Stale task sequence/attachment: expected ${expected === undefined ? "not supplied" : expected === null ? "none" : expected}; actual ${current.plans.collection.attached ?? "none"}${current.plans.collection.attached !== null ? ` (${current.plans.plan.task?.title ?? "empty reservation"})` : ""}. Reconsider the requested action using this current plan.`);
			if (action === "pause" || action === "resume") throw new Error("Plan pause/resume is no longer supported. Complete or explicitly abandon the current plan before starting another.");
			if (action === "abandon") {
				if (!current.plans.attached) throw new Error("No current plan to abandon");
				if (!params.reason?.trim()) throw new Error("Abandoning a plan requires a concise reason based on explicit user direction");
				return taskResult(current, "abandon", abandonCurrentPlan(current, params.reason, ctx));
			}
			if (!["update", "include", "discussion", "new"].includes(action)) throw new Error("Unknown task action");
			if (action === "new" && (current.runMode ?? current.selectedMode) !== "plan") throw new Error("New plans require Plan mode");
			if (action === "new" && current.plans.attached) throw new Error("Complete or explicitly abandon the current plan before starting another");
			if (action !== "new" && current.plans.collection.attached === null) throw new Error("No current plan; start one before changing task metadata");
			const existing = action === "new" ? undefined : current.plans.plan.task;
			const title = cleanTaskTitle(params.title ?? existing?.title ?? "");
			const scope = (params.scope ?? existing?.scope ?? "").trim();
			if (!title || !scope) throw new Error("A task requires a title and scope");
			if ((action === "include" || action === "discussion") && !params.topic?.trim()) throw new Error("A boundary decision requires a topic");
			if (action === "include" && !params.scope?.trim()) throw new Error("Include requires the complete user-approved scope");
			if (action === "discussion" && !existing) throw new Error("Establish the active task before recording a discussion decision");
			const decisions = [...(existing?.decisions ?? [])];
			if (action === "include" || action === "discussion") {
				const topic = params.topic!.trim();
				const index = decisions.findIndex((d) => d.topic.toLowerCase() === topic.toLowerCase());
				const decision = { topic, outcome: action as "include" | "discussion" };
				if (index >= 0) decisions[index] = decision;
				else decisions.push(decision);
			}
			const task = { title: action === "discussion" ? existing!.title : title, scope: action === "discussion" ? existing!.scope : scope, decisions };
			const changed = action === "new" || JSON.stringify(task) !== JSON.stringify(current.plans.plan.task);
			const scopeChanged = existing !== undefined && task.scope !== existing.scope;
			if (action === "new") startNewPlan(current, ctx, task);
			else if (changed) {
				current.plans.updateTask(task);
				if (scopeChanged) current.plans.outcome(undefined);
				syncPlanState(current, ctx);
			}
			return taskResult(current, action, task.title, changed);
		},
		renderCall: statusCall("Updating plan task…"),
		renderResult(result, { expanded, isPartial }, theme, context) {
			const status = pendingOrError(result, { isPartial }, theme, context, "Updating plan task…", "Plan task update failed");
			if (status) return status;
			const details = result.details as { action?: string; changed?: boolean; attached?: number | null; planPath?: string; fileState?: string; plans?: Array<{ sequence: number; title: string; path: string; fileState: string; outcome?: PlanOutcome }> } | undefined;
			const resultLine = resultText(result);
			const changed = details?.action !== "list" && (details?.changed ?? (details?.action !== undefined && !resultLine.startsWith("Plan unchanged:")));
			const primary = theme.fg(changed ? "success" : "muted", resultLine);
			const metadata: string[] = [];
			if (expanded && !context.isError && details) {
				metadata.push(`Attachment: ${details.attached ?? "none"}`);
				if (details.planPath && !details.plans?.length) metadata.push(`${details.planPath} (${details.fileState})`);
				for (const item of details.plans ?? []) metadata.push(`${item.sequence}: ${item.title}`, `${item.path} (${item.fileState})`, ...(item.outcome ? [item.outcome.reason, ...(item.outcome.userAction ? [`User action: ${item.outcome.userAction}`] : [])] : []));
			}
			return new Text([primary, ...(metadata.length ? [theme.fg("muted", metadata.join("\n"))] : [])].join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: "plan_finish",
		label: "Record Plan Outcome",
		description: "Record why an attached Build plan remains unfinished. awaiting_validation requires an essential userAction and pauses an active step; blocked, waiting_for_input, and still_working require a reason. Use plan_complete only when all work and required checks passed.",
		promptGuidelines: ["After awaiting_validation, summarize work and checks without restating the action or tool bookkeeping; the extension displays it. Use one Markdown bullet per check when multiple. Optional feedback is not validation, and step summaries cover only the active step."],
		parameters: Type.Object({
			expectedAttached: Type.Integer({ minimum: 0 }),
			outcome: Type.String({ enum: ["awaiting_validation", "blocked", "waiting_for_input", "still_working"] }),
			reason: Type.String({ minLength: 1, maxLength: 2000 }),
			userAction: Type.Optional(Type.String({ maxLength: 2000, description: "Concrete user-only validation instructions. For multiple checks, use a concise Markdown bullet list with one concrete check per bullet; a single check can be a short sentence." })),
		}),
		executionMode: "sequential",
		async execute(_id, params, _signal, _update, ctx) {
			const current = session(ctx);
			current.currentContext = ctx;
			current.plans.assertUsable();
			if ((current.runMode ?? current.selectedMode) !== "build") throw new Error("plan_finish requires Build mode");
			if (current.plans.collection.attached === null || params.expectedAttached !== current.plans.collection.attached) throw new Error("Stale attachment; reconsider the outcome against the current unfinished plan");
			if (!["awaiting_validation", "blocked", "waiting_for_input", "still_working"].includes(params.outcome) || !params.reason.trim()) throw new Error("A valid outcome and explanation are required");
			if (params.outcome === "awaiting_validation" && !params.userAction?.trim()) throw new Error("Essential user validation requires a concrete userAction");
			const sequence = current.plans.collection.attached;
			const title = current.plans.plan.task?.title ?? `Plan ${sequence}`;
			const file = currentPlanPath(current);
			if (params.outcome === "awaiting_validation" && current.plans.execution) {
				if (!activePlanStep(current.plans.execution)) throw new Error("Only an active implementation step can await essential validation");
				if (current.plans.execution.status === "running") current.plans.updateExecution(pausePlanExecution(current.plans.execution));
			}
			const outcome = { kind: params.outcome as PlanOutcome["kind"], reason: params.reason.trim(), ...(params.userAction?.trim() ? { userAction: params.userAction.trim() } : {}) };
			current.plans.outcome(outcome);
			if (current.reconciliation) current.reconciliation.handled = true;
			syncAttachment(current, ctx);
			const awaitingValidation = params.outcome === "awaiting_validation";
			const text = awaitingValidation
				? validationNotice(params.userAction!.trim())
				: `${title}: ${params.outcome.replaceAll("_", " ")}.`;
			if (awaitingValidation) current.pendingValidationNotice = params.userAction!.trim();
			return { content: [{ type: "text", text }], details: { sequence, title, planPath: file, fileState: current.savedPlanState, outcome, attached: current.plans.collection.attached } };
		},
		renderCall: statusCall("Recording plan outcome…"),
		renderResult(result, options, theme, context) {
			const status = pendingOrError(result, options, theme, context, "Recording plan outcome…", "Recording plan outcome failed");
			if (status) return status;
			let text = resultText(result) || "No outcome available";
			const details = result.details as { planPath?: string; fileState?: string; outcome?: PlanOutcome } | undefined;
			if (details?.outcome?.kind === "awaiting_validation") {
				if (!options.expanded) return new Text("", 0, 0);
				return new Text([
					theme.fg("muted", "Validation request recorded."),
					formatInstruction(theme, "Required validation:"),
					formatInstruction(theme, details.outcome.userAction ?? ""),
					...(details.planPath ? [theme.fg("muted", `${details.planPath} (${details.fileState})`)] : []),
					theme.fg("text", details.outcome.reason),
				].join("\n"), 0, 0);
			}
			const lines = [theme.fg(details?.outcome ? "warning" : "muted", text)];
			if (options.expanded && details) {
				if (details.planPath) lines.push(theme.fg("muted", `${details.planPath} (${details.fileState})`));
				for (const extra of [details.outcome?.reason, details.outcome?.userAction]) {
					if (extra && !text.includes(extra)) lines.push(theme.fg("text", extra));
				}
			}
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: "plan_complete",
		label: "Complete Plan",
		description: "Complete the entire attached Build plan, including during step execution, after work/checks pass or explicit user-directed whole-plan closure. Closure removes execution and records partial progress without marking remaining steps or checks passed. Never use for one step, errors, or approval alone.",
		promptGuidelines: [`${COMPLETION_ROUTING_GUIDANCE} During incomplete execution record factual progress without claiming remaining checks passed. Otherwise complete only after work/checks pass; use plan_finish for unfinished outcomes or plan_finish blocked when missing scope prevents assessment.`],
		parameters: Type.Object({ summary: Type.Optional(Type.String({ maxLength: 4000, description: "Optional factual summary of implementation and verification; omit rather than invent evidence." })) }),
		executionMode: "sequential",
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const current = session(ctx);
			current.currentContext = ctx;
			const planPath = currentPlanPath(current);
			completeCurrentPlan(current, params.summary);
			return {
				content: [{ type: "text", text: "Plan complete." }],
				details: { planPath, completed: true },
			};
		},
		renderCall: statusCall("Completing plan…"),
		renderResult(result, options, theme, context) {
			const status = pendingOrError(result, options, theme, context, "Completing plan…", "Plan completion failed");
			if (status) return status;
			const details = result.details as { completed?: boolean; planPath?: string } | undefined;
			if (!details?.completed) return new Text(theme.fg("muted", "Completion status unavailable"), 0, 0);
			return new Text([theme.fg("success", "Plan complete."), ...(options.expanded && details.planPath ? [theme.fg("muted", details.planPath)] : [])].join("\n"), 0, 0);
		},
	});

	pi.registerTool({
		name: "plan_step_control",
		label: "Control Plan Execution",
		description: `In Build mode only, apply one clear single-step or execution-control action: start or skip a ready step; record one explicitly identified finished step; revise an unimplemented step; pause/resume/cancel execution; or hide/show the panel. ${COMPLETION_ROUTING_GUIDANCE} A paused active step may complete after successful required validation; failure may resume it for remediation. Never advance on hypothetical, ambiguous, or unrelated text.`,
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("start"),
				Type.Literal("complete"),
				Type.Literal("skip"),
				Type.Literal("revise"),
				Type.Literal("pause"),
				Type.Literal("resume"),
				Type.Literal("cancel"),
				Type.Literal("hide"),
				Type.Literal("show"),
			]),
			step: Type.Optional(Type.Number({ description: "One-based step number; defaults to the current ready step", minimum: 1 })),
			instruction: Type.Optional(Type.String({ description: "Replacement instruction required for revise" })),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const current = session(ctx);
			current.currentContext = ctx;
			current.plans.assertUsable();
			if ((current.runMode ?? current.selectedMode) !== "build") throw new Error("Step control requires Build mode");
			if (!current.plans.execution) throw new Error("No step-by-step plan is active");
			const target = params.step === undefined
				? params.action === "complete" && current.plans.plan.outcome?.kind === "awaiting_validation"
					? activePlanStep(current.plans.execution)
					: current.plans.execution.steps.find((step) => step.status === "ready")
				: current.plans.execution.steps[Math.floor(params.step) - 1];
			const finish = (message: string, extraDetails?: { planCompleted?: boolean; awaitingUser?: boolean; changed?: boolean; confirmation?: string; instruction?: string }) => ({
				content: [{ type: "text" as const, text: message }],
				details: { action: params.action, stepId: target?.id, changed: true, ...extraDetails },
				terminate: true,
			});

			if (params.action === "cancel") {
				cancelPlanExecution(current);
				return finish("Step-by-step execution was cancelled. The panel and execution guards were removed; the saved plan file remains available.");
			}
			if (params.action === "hide" || params.action === "show") {
				updateExecution(current, { ...current.plans.execution, panelVisible: params.action === "show" });
				return finish(`The visual plan panel is now ${params.action === "show" ? "visible" : "hidden"}. Progress is unchanged.`);
			}
			if (current.plans.execution.status === "completed") throw new Error("The plan is already complete");
			if (params.action === "pause" || params.action === "resume") {
				if ((params.action === "pause") === (current.plans.execution.status === "paused")) return finish(`Plan execution is already ${params.action === "pause" ? "paused" : "running"}.`, { changed: false });
				if (params.action === "resume" && current.plans.plan.outcome?.kind === "awaiting_validation") current.plans.outcome(undefined);
				updateExecution(current, pausePlanExecution(current.plans.execution));
				return finish(`Plan execution is now ${params.action === "pause" ? "paused" : "running"}.`);
			}
			if (!target) throw new Error("No matching plan step is available for that action");
			if (params.action === "start") {
				if (current.plans.execution.status === "paused") throw new Error("Resume plan execution before starting a step");
				updateExecution(current, startPlanStep(current.plans.execution, target.id));
				pi.sendUserMessage("Implement the approved active plan step now.", { deliverAs: "followUp" });
				return finish("The requested step is approved. Its implementation is starting in a follow-up turn.");
			}
			if (params.action === "complete") {
				const completion = completeExecutionStep(current, target.id);
				return finish(
					completion ?? "The step was marked complete. The next step is ready and awaits user instruction.",
					{ planCompleted: completion !== undefined, awaitingUser: completion === undefined, ...(completion === undefined ? { confirmation: "The step was marked complete.", instruction: "The next step is ready and awaits user instruction." } : {}) },
				);
			}
			if (params.action === "skip") {
				const completion = applyExecutionTransition(current, skipPlanStep(current.plans.execution, target.id));
				return finish(
					completion ?? "The step was skipped. The next step awaits user instruction.",
					{ planCompleted: completion !== undefined, awaitingUser: completion === undefined, ...(completion === undefined ? { confirmation: "The step was skipped.", instruction: "The next step awaits user instruction." } : {}) },
				);
			}
			if (!params.instruction?.trim()) throw new Error("Revising a step requires a replacement instruction");
			revisePlanStep(current.plans.execution, target.id, params.instruction);
			await withFileMutationQueue(currentPlanPath(current), async () => {
				const plan = await fs.promises.readFile(currentPlanPath(current), "utf8");
				if (plan !== current.plans.execution!.planMarkdown) throw new Error("The saved plan changed; the step cannot be revised safely");
				const updatedPlan = updatePlanStepInstruction(plan, target.sourceLine, params.instruction!, target.text);
				const next = revisePlanStep(current.plans.execution!, target.id, params.instruction!, updatedPlan);
				await fs.promises.writeFile(currentPlanPath(current), updatedPlan, "utf8");
				updateExecution(current, next);
			});
			return finish("The plan step instruction was revised and is awaiting user approval.", { awaitingUser: true, confirmation: "The plan step instruction was revised", instruction: "and is awaiting user approval." });
		},
		renderCall: statusCall("Updating step…"),
		renderResult(result, options, theme, context) {
			return renderStepResult(result, options, theme, context, "Updating step…", "Step status unavailable");
		},
	});

	pi.registerTool({
		name: "plan_step_complete",
		label: "Complete Plan Step",
		description: PLAN_STEP_COMPLETE_DESCRIPTION,
		parameters: Type.Object({
			summary: Type.String({ description: "Concise summary of what was implemented and verified" }),
		}),
		executionMode: "sequential",
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const current = session(ctx);
			current.currentContext = ctx;
			current.plans.assertUsable();
			if ((current.runMode ?? current.selectedMode) !== "build") throw new Error("Step completion requires Build mode");
			const step = completablePlanStep(current);
			if (!current.plans.execution || !step) throw new Error("No plan step is currently active");
			const completion = completeExecutionStep(current, step.id, params.summary);
			return {
				content: [{ type: "text", text: completion ?? "The step was completed. The next step is ready and awaits user instruction." }],
				details: { stepId: step.id, completed: true, planCompleted: completion !== undefined, awaitingUser: completion === undefined, ...(completion === undefined ? { confirmation: "The step was completed.", instruction: "The next step is ready and awaits user instruction." } : {}) },
				terminate: true,
			};
		},
		renderCall: statusCall("Completing step…"),
		renderResult(result, options, theme, context) {
			return renderStepResult(result, options, theme, context, "Completing step…", "Step completion status unavailable");
		},
	});

	pi.registerTool({
		name: "plan_exit",
		// Upstream port: plan_exit renders its own transcript rows (review +
		// approval result) without pi's default tool-call padding box.
		renderShell: "self",
		label: "Exit Plan Mode",
		description: PLAN_EXIT_DESCRIPTION,
		promptSnippet: "Display the saved plan and request user approval",
		promptGuidelines: ["Call plan_exit only after finalizing the saved plan for review."],
		parameters: EMPTY_PARAMETERS,
		executionMode: "sequential",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const current = session(ctx);
			current.currentContext = ctx;
			current.plans.assertUsable();
			if ((current.runMode ?? current.selectedMode) !== "plan") throw new Error("plan_exit requires Plan mode");
			if (!ctx.hasUI) throw new Error("plan_exit requires an interactive TUI or RPC client");
			if (current.plans.collection.attached === null) throw new Error("No attached plan to approve");
			const reviewedAttachment = current.plans.collection.attached;
			const reviewedPath = currentPlanPath(current);
			const reviewedMode = current.runMode ?? current.selectedMode;
			let plan: string;
			try {
				plan = await fs.promises.readFile(currentPlanPath(current), "utf8");
			} catch (error: unknown) {
				const detail = error instanceof Error ? error.message : String(error);
				throw new Error(`Cannot request plan approval because the plan file could not be read: ${detail}`);
			}
			if (!plan.trim()) throw new Error("Cannot request plan approval because the plan file is empty");
			refreshSavedPlanTitle(current);
			pi.appendEntry(PLAN_REVIEW_ENTRY_TYPE, { plan, planPath: currentPlanPath(current) });
			const displayPath = shorten(currentPlanPath(current), ctx.cwd);
			let stepExecution: PlanExecutionState | undefined;
			let stepsError: string | undefined;
			try {
				stepExecution = createPlanExecution(plan);
			} catch (error: unknown) {
				stepsError = error instanceof Error ? error.message : String(error);
			}
			const choices = [
				PLAN_EXIT_APPROVE_CHOICE,
				PLAN_EXIT_FRESH_CHOICE,
				...(stepExecution ? [PLAN_STEP_CHOICE] : []),
				PLAN_EXIT_STAY_CHOICE,
			];
			const approvalQuestion = `Build Agent: Plan at ${displayPath} is complete. What would you like to do?`;
			const selection = normalizePlanExitChoice(await ctx.ui.select(
				ctx.mode === "rpc" ? `${buildPlanReviewMessage(plan)}\n\n${approvalQuestion}` : approvalQuestion,
				choices,
			));
			const action = selection.choice === PLAN_STEP_CHOICE && stepExecution
				? "step-by-step"
				: classifyPlanExitChoice(selection.choice);
			if (action !== "stay") {
				let unchanged = false;
				try { unchanged = await fs.promises.readFile(reviewedPath, "utf8") === plan; } catch { /* A fresh review is required. */ }
				if (!unchanged || current.plans.collection.attached !== reviewedAttachment || currentPlanPath(current) !== reviewedPath || (current.runMode ?? current.selectedMode) !== reviewedMode) {
					current.freshImplementationRequest = undefined;
					ctx.ui.notify("The plan changed or became unavailable during review. Review it again before implementation.", "warning");
					return { content: [{ type: "text", text: "Approval was not applied: a fresh plan review is required." }], details: { approved: false }, terminate: true };
				}
			}
			if (action !== "implement-fresh") {
				const message = PLAN_ACTION_ANNOUNCEMENTS[action];
				modeNotices.append(message, _toolCallId, { tone: planActionTone(action) });
				if (ctx.mode === "rpc") ctx.ui.notify(message, "info");
			}
			if (selection.choice === PLAN_STEP_CHOICE && stepExecution) {
				current.freshImplementationRequest = undefined;
				current.plans.updateExecution(stepExecution);
				await selectMode("build", current, ctx, "tool");
				pi.appendEntry(PLAN_STEP_GUIDANCE_ENTRY_TYPE);
				if (ctx.mode === "rpc") ctx.ui.notify("Step-by-step execution ready. Say ‘Proceed’ to start. Use /plan show to inspect progress.", "info");
				return {
					content: [{ type: "text", text: "Step-by-step execution ready. Awaiting your instruction." }],
					details: { approved: true, action: "step-by-step", mode: "build", planPath: currentPlanPath(current) },
					terminate: true,
				};
			}
			if (!stepExecution && stepsError) {
				ctx.ui.notify(`Step-by-step execution is unavailable: ${stepsError}.`, "warning");
			}
			const decision = classifyPlanExitChoice(selection.choice);
			if (decision === "stay") {
				current.freshImplementationRequest = undefined;
				return buildPlanExitStayResult(currentPlanPath(current), selection.cancelled);
			}
			if (decision === "implement-fresh") {
				current.handoffSequence = current.plans.collection.attached ?? undefined;
				current.freshImplementationRequest = handoffSnapshot(buildFreshImplementationRequest(
					plan,
					ctx.model ? { provider: ctx.model.provider, id: ctx.model.id } : undefined,
					pi.getThinkingLevel(),
				), current.plans.plan.task, current.toolsBeforeModes, stateData(current) as import("./src/plan-state.ts").StoredState);
				pi.sendUserMessage("/build-fresh", {
					deliverAs: "followUp",
					expandPromptTemplates: true,
				});
				return buildPlanExitFreshResult(currentPlanPath(current));
			}
			current.freshImplementationRequest = undefined;
			await selectMode("build", current, ctx, "tool");
			armReconciliation({ currentPlanPath, inspectPlanFileState: (file) => current.savedPlanState }, current, ctx);
			return {
				content: [
					{
						type: "text",
						text: "Plan approved; implement it now under Build guidance. Continue through required verification; acknowledgment or inspection alone is not completion. Stop for blockers, essential input, or separately required deployment/restart approval.",
					},
				],
				details: { approved: true, mode: "build", planPath: currentPlanPath(current) },
			};
		},
		renderCall: statusCall("Processing plan approval…", TRANSCRIPT_PADDING),
		renderResult(result, options, theme, context) {
			const status = pendingOrError(result, options, theme, context, "Processing plan approval…", "Plan approval failed", TRANSCRIPT_PADDING);
			if (status) return status;
			const details = result.details as { approved?: boolean; action?: string } | undefined;
			if (!options.expanded && typeof details?.approved === "boolean" && modeNotices.has(context)) return new Text("", 0, 0);
			if (details?.action === "step-by-step" && !context.isError) {
				return new Text(theme.fg("success", "Step-by-step execution ready"), TRANSCRIPT_PADDING, 0);
			}
			if (details?.action === "implement-fresh" && !context.isError) {
				return new Text(
					theme.fg("success", "Clean-session implementation selected — starting automatically."),
					TRANSCRIPT_PADDING,
					0,
				);
			}
			if (details?.approved === true && !context.isError) {
				return new Text(theme.fg("success", "Plan approved; switched to Build mode"), TRANSCRIPT_PADDING, 0);
			}
			if (details?.approved === false) return new Text(theme.fg("muted", "Remaining in Plan mode"), TRANSCRIPT_PADDING, 0);
			return new Text(theme.fg("muted", "Plan approval status unavailable"), TRANSCRIPT_PADDING, 0);
		},
	});
}
