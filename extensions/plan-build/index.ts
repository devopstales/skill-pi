/**
 * pi-plan-build (skill-pi) — Plan/Build modes with a persistent plan, explicit
 * approval, clean-session handoff, and step-by-step execution. The visual
 * surface is the skill-pi-tui sidebar plan card (same component machinery as
 * the todo card); the mode rail is a composer status line, not a custom editor.
 *
 * Core lifecycle forked from janvitos/pi-plan-build (MIT); composer and
 * plan-panel UI replaced by the sidebar card integration.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir, getMarkdownTheme, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Markdown, Text, type TUI } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	PlanState,
	allocationHighWater,
	latestPlanState,
	restoreCollection,
	STATE_TYPE,
	STATE_VERSION,
	type LegacyState,
	type StoredState,
} from "./src/plan-state.ts";
import {
	activePlanStep,
	completePlanStep,
	createPlanExecution,
	executablePlanStep,
	formatPlanCompletionSummary,
	formatPlanClosureSummary,
	pausePlanExecution,
	revisePlanStep,
	skipPlanStep,
	startPlanStep,
	updatePlanStepInstruction,
	type PlanExecutionState,
} from "./src/plan-execution.ts";
import { buildPlanContext, isObsoletePlanContext, RECONCILIATION_CONTEXT_TYPE, TASK_CONTEXT_TYPE } from "./src/plan-context.ts";
import { handoffSnapshot, SOURCE_TRANSFER_NOTICE, startFreshHandoff, type ApprovedHandoff } from "./src/handoff.ts";
import {
	loadShortcutConfig,
	saveDefaultMode,
	saveShortcutPreset,
	saveShowPlanTitle,
	saveStableToolCatalog,
	SHORTCUT_PRESETS,
	shortcutPresetLabel,
} from "./src/shortcut-config.ts";
import {
	COMPLETION_ROUTING_GUIDANCE,
	PLAN_EXIT_DESCRIPTION,
	PLAN_STEP_COMPLETE_DESCRIPTION,
} from "./src/prompts.ts";
import { pendingOrError, renderStepResult, resultText, statusCall, noticeTracker, TRANSCRIPT_PADDING } from "./src/tool-presentation.ts";
import { registerQuestionNotice } from "./src/question-ui.ts";
import {
	applyManualSelection,
	buildFreshImplementationHandoff,
	buildFreshImplementationRequest,
	PLAN_STEP_READY_ACKNOWLEDGEMENT,
	buildPlanExitFreshResult,
	buildPlanExitStayResult,
	buildPlanReviewMessage,
	classifyPlanExitChoice,
	cleanTaskTitle,
	decodeModeState,
	displayedPlanTitle,
	extractPlanTitle,
	formatInstruction,
	formatModeStatus,
	isAllowedPlanMutation,
	makePlanPath,
	nextMode,
	normalizePlanExitChoice,
	PLAN_ACTION_ANNOUNCEMENTS,
	PLAN_EXIT_APPROVE_CHOICE,
	PLAN_EXIT_FRESH_CHOICE,
	PLAN_EXIT_STAY_CHOICE,
	planActionTone,
	shouldReconcileCompletion,
	unique,
	validationNotice,
	VALIDATION_NOTICE_HEADING,
	type Mode,
	type PlanOutcome,
} from "./src/utils.ts";
import { buildTheme, type PlanTheme } from "./src/theme.ts";
import { renderPlanCard } from "./src/card.ts";
import { invalidateSidebar } from "../skill-pi-tui/src/sidebar-layout.ts";
import { sidebarPart } from "../skill-pi-tui/src/sidebar.ts";

const PLAN_REVIEW_ENTRY_TYPE = "skill-pi-plan-review";
const MODE_NOTICE_ENTRY_TYPE = "skill-pi-plan-notice";
const PLAN_STEP_GUIDANCE_ENTRY_TYPE = "skill-pi-plan-step-guidance";
const VALIDATION_NOTICE_ENTRY_TYPE = "skill-pi-plan-validation-notice";
const FRESH_ANNOUNCEMENT_MESSAGE_TYPE = "skill-pi-plan-fresh-announcement";
const PLAN_STEP_CHOICE = "Implement step by step";
const VALIDATION_COMPLETION_QUESTION = "Did the required validation pass?";
const COMPLETE_PLAN_CHOICE = "Yes — mark the plan as complete";
const COMPLETE_STEP_CHOICE = "Yes — mark the current step as complete";
const STAY_BUILD_CHOICE = "No — stay in Build mode";
const STATUS_KEY = "skill-pi-plan-mode";
const MANAGED_PLAN_TOOLS = ["plan_task", "plan_exit", "plan_step_control", "plan_step_complete", "plan_complete", "plan_finish"];
const FILE_MUTATION_TOOLS = new Set(["edit", "write", "replace", "insert", "undo_last_change"]);
const SHELL_MUTATION_TOOLS = new Set(["bash", "powershell"]);
const DEPENDENT_PLAN_TOOLS = new Set(["plan_complete", "plan_finish", "plan_step_control", "plan_step_complete", "plan_exit"]);
const EMPTY_PARAMETERS = Type.Object({});

function isFileMutationTool(toolName: string): boolean {
	return FILE_MUTATION_TOOLS.has(toolName);
}

function isProjectMutationTool(toolName: string): boolean {
	return isFileMutationTool(toolName) || SHELL_MUTATION_TOOLS.has(toolName);
}

function mutationPath(input: unknown): unknown {
	return input && typeof input === "object" ? (input as { path?: unknown }).path : undefined;
}

function shorten(filePath: string, cwd: string): string {
	const relative = path.relative(cwd, filePath);
	if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) return relative;
	const home = os.homedir();
	return filePath.startsWith(`${home}${path.sep}`) ? `~${filePath.slice(home.length)}` : filePath;
}

interface PlanSession {
	selectedMode: Mode;
	runMode: Mode | undefined;
	pendingMode: Mode | undefined;
	plans: PlanState;
	toolsBeforeModes: string[];
	currentContext: ExtensionContext | undefined;
	ui: ExtensionContext["ui"] | undefined;
	tui: TUI | undefined;
	currentChanges: string;
	lastSnapshot: string;
	savedPlanState: "saved" | "absent" | "unavailable";
	savedPlanHeading: string | undefined;
	pendingFreshAnnouncement: boolean;
	pendingValidationNotice: string | undefined;
	reconciliation: { sequence: number; sessionId: string; eligible: boolean; consumed: boolean; handled: boolean; failed: boolean; terminal: boolean } | undefined;
	reconciliationFollowUp: boolean;
	activeReconciliationId: string | undefined;
	handoffSequence: number | undefined;
	freshImplementationRequest: ApprovedHandoff | undefined;
	modeTransition: number;
	stableToolCatalog: boolean;
	showPlanTitle: boolean;
}

function newSession(selectedMode: Mode, stableToolCatalog: boolean, showPlanTitle: boolean): PlanSession {
	return {
		selectedMode,
		runMode: undefined,
		pendingMode: undefined,
		plans: new PlanState(),
		toolsBeforeModes: [],
		currentContext: undefined,
		ui: undefined,
		tui: undefined,
		currentChanges: "",
		lastSnapshot: "",
		savedPlanState: "absent",
		savedPlanHeading: undefined,
		pendingFreshAnnouncement: false,
		pendingValidationNotice: undefined,
		reconciliation: undefined,
		reconciliationFollowUp: false,
		activeReconciliationId: undefined,
		handoffSequence: undefined,
		freshImplementationRequest: undefined,
		modeTransition: 0,
		stableToolCatalog,
		showPlanTitle,
	};
}

export default function piPlanBuild(pi: ExtensionAPI): void {
	let currentSessionRef: PlanSession | undefined;
	const agentDir = getAgentDir();
	const { stableToolCatalog: configuredStableToolCatalog, config: shortcutConfig, showPlanTitle, defaultMode: configuredDefaultMode, path: shortcutConfigPath, warning: shortcutConfigWarning } = loadShortcutConfig(agentDir);
	let shortcutConfigWarningShown = false;
	const sessions = new Map<string, PlanSession>();

	function sessionKey(ctx: ExtensionContext): string {
		return ctx.sessionManager.getSessionId() ?? "";
	}

	function session(ctx: ExtensionContext): PlanSession {
		const key = sessionKey(ctx);
		let current = sessions.get(key);
		if (!current) {
			current = newSession(configuredDefaultMode, configuredStableToolCatalog, showPlanTitle);
			sessions.set(key, current);
		}
		currentSessionRef = current;
		return current;
	}

	const managedTools = new Set(MANAGED_PLAN_TOOLS);

	function currentPlanPath(current: PlanSession): string {
		const ctx = current.currentContext;
		return current.plans.collection.attached !== null && ctx ? planPathFor(current.plans.collection.attached, ctx) : "";
	}

	function planPathFor(sequence: number, ctx: ExtensionContext): string {
		return makePlanPath(path.join(getAgentDir(), "plans"), ctx.sessionManager.getSessionId(), sequence);
	}

	function stateData(current: PlanSession): StoredState {
		return {
			version: STATE_VERSION,
			selectedMode: current.selectedMode,
			collection: current.plans.collection,
			toolsBeforeModes: current.toolsBeforeModes,
			planSessionId: current.currentContext?.sessionManager.getSessionId(),
			...(current.pendingFreshAnnouncement ? { pendingFreshAnnouncement: true } : {}),
		};
	}

	function persist(current: PlanSession): void {
		if (current.plans.error) return;
		const snapshot = JSON.stringify(stateData(current));
		if (snapshot === current.lastSnapshot) return;
		pi.appendEntry(STATE_TYPE, JSON.parse(snapshot));
		current.lastSnapshot = snapshot;
	}

	function currentPlanTitle(current: PlanSession): string | undefined {
		if (current.plans.collection.attached === null) return undefined;
		return displayedPlanTitle(current.plans.plan, current.savedPlanState === "saved", current.savedPlanHeading);
	}

	function refreshSavedPlanTitle(current: PlanSession, knownState?: typeof current.savedPlanState): void {
		current.savedPlanState = knownState ?? (currentPlanPath(current) ? inspectPlanFileState(currentPlanPath(current)) : "absent");
		current.savedPlanHeading = undefined;
		if (current.savedPlanState !== "saved" || current.plans.attached?.plan.task?.title) return;
		try {
			current.savedPlanHeading = extractPlanTitle(fs.readFileSync(currentPlanPath(current), "utf8"));
		} catch {
			// An unreadable saved plan must not break the card.
		}
	}

	function inspectPlanFileState(file: string): "saved" | "absent" | "unavailable" {
		try { return fs.statSync(file).isFile() ? "saved" : "unavailable"; }
		catch (error) { return (error as NodeJS.ErrnoException).code === "ENOENT" ? "absent" : "unavailable"; }
	}

	function completablePlanStep(current: PlanSession) {
		return executablePlanStep(current.plans.execution) ?? (current.plans.plan.outcome?.kind === "awaiting_validation" ? activePlanStep(current.plans.execution) : undefined);
	}

	function completeExecutionStep(current: PlanSession, id: string, summary?: string): string | undefined {
		const execution = current.plans.execution!;
		const validated = current.plans.plan.outcome?.kind === "awaiting_validation" && execution.status === "paused" && activePlanStep(execution)?.id === id;
		const next = completePlanStep(validated ? pausePlanExecution(execution) : execution, id, summary);
		if (validated) current.plans.outcome(undefined);
		return applyExecutionTransition(current, next);
	}

	function cancelPlanExecution(current: PlanSession): void {
		current.plans.updateExecution(undefined);
		syncPlanState(current);
	}

	function applyExecutionTransition(current: PlanSession, next: PlanExecutionState): string | undefined {
		if (next.status !== "completed") {
			updateExecution(current, next);
			return undefined;
		}
		const summary = formatPlanCompletionSummary(next);
		closeCurrentPlan(current, summary);
		return summary;
	}

	function updateExecution(current: PlanSession, next: PlanExecutionState): void {
		current.plans.updateExecution(next);
		syncPlanState(current);
	}

	function discoverUnmanagedTools(current: PlanSession): void {
		current.toolsBeforeModes = pi.getActiveTools().filter((name) => !managedTools.has(name));
	}

	function setToolsIfChanged(names: string[]): void {
		const next = unique(names);
		const active = pi.getActiveTools();
		if (active.length !== next.length || active.some((name, index) => name !== next[index])) pi.setActiveTools(next);
	}

	function applyTools(current: PlanSession, mode: Mode): void {
		discoverUnmanagedTools(current);
		const base = [...current.toolsBeforeModes];
		if (current.stableToolCatalog) {
			setToolsIfChanged([...base, ...MANAGED_PLAN_TOOLS]);
			return;
		}
		if (mode === "plan") {
			setToolsIfChanged([...base, "plan_exit", "plan_task"]);
			return;
		}
		setToolsIfChanged([
			...base,
			...(current.plans.collection.attached !== null && current.plans.plan.status === "open" ? ["plan_task", "plan_complete", "plan_finish"] : []),
			...(current.plans.execution && current.plans.execution.status !== "completed" ? ["plan_step_control"] : []),
			...(current.plans.collection.attached !== null && completablePlanStep(current) ? ["plan_step_complete"] : []),
		]);
	}

	async function ensurePlanDirectory(): Promise<void> {
		await fs.promises.mkdir(path.join(getAgentDir(), "plans"), { recursive: true });
	}

	function clearAttachmentRun(current: PlanSession): void {
		current.activeReconciliationId = undefined;
		if (current.reconciliation) current.reconciliation.handled = true;
		current.freshImplementationRequest = undefined;
		current.pendingFreshAnnouncement = false;
		current.handoffSequence = undefined;
	}

	function syncPlanState(current: PlanSession, ctx?: ExtensionContext): void {
		applyTools(current, current.runMode ?? current.selectedMode);
		updateStatusLine(current, ctx);
		showCard(current, ctx);
		persist(current);
	}

	function syncAttachment(current: PlanSession, ctx?: ExtensionContext): void {
		refreshSavedPlanTitle(current);
		syncPlanState(current, ctx);
	}

	function closeCurrentPlan(current: PlanSession, summary?: string): void {
		current.plans.complete(summary);
		clearAttachmentRun(current);
		syncAttachment(current);
	}

	function abandonCurrentPlan(current: PlanSession, reason: string, ctx: ExtensionContext): string {
		const title = current.plans.plan.task?.title ?? "Untitled task";
		current.plans.abandon(reason);
		clearAttachmentRun(current);
		syncAttachment(current, ctx);
		return title;
	}

	function startNewPlan(current: PlanSession, ctx: ExtensionContext, task?: { title: string; scope: string; decisions: Array<{ topic: string; outcome: "include" | "discussion" }> }): void {
		current.plans.assertUsable();
		let sequence = current.plans.collection.counter;
		for (;;) {
			if (!Number.isSafeInteger(++sequence)) throw new Error("Plan allocation exhausted");
			const status = inspectPlanFileState(planPathFor(sequence, ctx));
			if (status === "unavailable") throw new Error("Plan allocation path unavailable; refusing to overwrite it");
			if (status === "absent") break;
		}
		current.plans.newPlan(sequence, task);
		clearAttachmentRun(current);
		syncAttachment(current, ctx);
	}

	function completeCurrentPlan(current: PlanSession, summary?: string): void {
		current.plans.assertUsable();
		if ((current.runMode ?? current.selectedMode) !== "build") throw new Error("Switch to Build mode before completing implementation");
		if (current.plans.collection.attached === null) throw new Error("No current plan to complete");
		const completionSummary = current.plans.execution ? formatPlanClosureSummary(current.plans.execution, summary) : summary;
		closeCurrentPlan(current, completionSummary);
	}

	async function selectMode(mode: Mode, current: PlanSession, ctx: ExtensionContext, source: "manual" | "tool"): Promise<void> {
		if (mode === (current.pendingMode ?? current.selectedMode) && (source === "manual" || mode === current.runMode)) return;
		const transition = ++current.modeTransition;
		current.pendingMode = mode;
		if (source === "tool" || ctx.isIdle()) {
			// Mode switching has no per-model routing in this port; nothing to await.
		}
		if (transition !== current.modeTransition) return;
		current.pendingMode = undefined;
		current.activeReconciliationId = undefined;
		if (mode !== "build" && current.reconciliation) current.reconciliation.handled = true;
		if (source === "manual") {
			const next = applyManualSelection(mode, current.runMode, ctx.isIdle());
			current.selectedMode = next.selectedMode;
			current.runMode = next.runMode;
			if (ctx.isIdle()) applyTools(current, mode);
		} else {
			current.selectedMode = mode;
			current.runMode = mode;
			applyTools(current, mode);
		}
		updateStatusLine(current, ctx);
		showCard(current, ctx);
		persist(current);
	}

	function updateStatusLine(current: PlanSession, ctx?: ExtensionContext): void {
		const target = ctx ?? current.currentContext;
		if (!target?.hasUI || !target.ui) return;
		const theme = buildTheme(target.ui.theme);
		const title = currentPlanTitle(current);
		const modeLabel = formatModeStatus(current.selectedMode, theme);
		const status = current.showPlanTitle && title ? theme.fg("warning", title) : modeLabel;
		target.ui.setStatus(STATUS_KEY, status);
	}

	const makeCard = (current: PlanSession) => ({
		render(width: number): string[] {
			if (!current.ui) return [];
			const theme = buildTheme(current.ui.theme);
			return renderPlanCard(
				{
					mode: current.selectedMode,
					plan: current.plans.attached?.plan,
					execution: current.plans.execution,
				},
				theme,
				width,
			);
		},
		invalidate() {},
		digest: () => JSON.stringify([current.selectedMode, current.plans.collection.attached, current.plans.plan.status, current.plans.execution?.status, current.plans.execution?.steps.map((s) => s.status), current.plans.plan.outcome?.kind, current.showPlanTitle, current.savedPlanState]),
		dispose() {},
	});

	function showCard(current: PlanSession, ctx?: ExtensionContext): void {
		if (current.tui) invalidateSidebar(current.tui);
		const target = ctx ?? current.currentContext;
		if (!target?.hasUI || !target.ui) return;
		current.ui = target.ui;
		if (current.plans.collection.attached === null) {
			target.ui.setWidget("skill-pi-plan", undefined);
			return;
		}
		target.ui.setWidget("skill-pi-plan", (tui, theme) => {
			current.tui = tui;
			current.ui = target.ui;
			const snapshot = current;
			const empty = { render: () => [] as string[], invalidate() {} };
			const part = sidebarPart(tui, "plan", empty, makeCard(snapshot));
			return part;
		});
	}

	pi.registerFlag("plan", { description: "Start in Plan mode", type: "boolean", default: false });
	pi.registerFlag("build", { description: "Start in Build mode", type: "boolean", default: false });

	registerQuestionNotice(pi);
	const modeNotices = noticeTracker(pi, MODE_NOTICE_ENTRY_TYPE);

	pi.registerEntryRenderer<StoredState>(STATE_TYPE, (entry, _options, theme) =>
		entry.data?.sourceTransferNotice === true ? new Text(theme.fg("success", SOURCE_TRANSFER_NOTICE), TRANSCRIPT_PADDING, 0) : undefined);
	pi.registerEntryRenderer<{ markdown: string }>("skill-pi-plan-inspection", (entry) =>
		new Markdown(entry.data?.markdown ?? "Plan inspection unavailable", TRANSCRIPT_PADDING, 0, getMarkdownTheme()));
	pi.registerEntryRenderer<{ plan: string }>(PLAN_REVIEW_ENTRY_TYPE, (entry) => {
		const plan = typeof entry.data?.plan === "string" ? entry.data.plan : "Plan unavailable";
		return new Markdown(buildPlanReviewMessage(plan), TRANSCRIPT_PADDING, 0, getMarkdownTheme());
	});
	pi.registerEntryRenderer<{ message: string; tone?: "instruction" | "ack" }>(MODE_NOTICE_ENTRY_TYPE, (entry, _options, theme) => {
		const message = typeof entry.data?.message === "string" ? entry.data.message : "Plan mode unchanged.";
		if (entry.data?.tone === "instruction") return new Text(formatInstruction(theme, message), TRANSCRIPT_PADDING, 0);
		if (entry.data?.tone === "ack") return new Text(theme.fg("success", message), TRANSCRIPT_PADDING, 0);
		return new Text(theme.fg("muted", message), TRANSCRIPT_PADDING, 0);
	});
	pi.registerEntryRenderer(PLAN_STEP_GUIDANCE_ENTRY_TYPE, (_entry, _options, theme) =>
		new Text(formatInstruction(theme, PLAN_STEP_READY_ACKNOWLEDGEMENT), TRANSCRIPT_PADDING, 0));
	pi.registerEntryRenderer<{ userAction?: string; message?: string }>(VALIDATION_NOTICE_ENTRY_TYPE, (entry, _options, theme) => {
		const userAction = typeof entry.data?.userAction === "string" && entry.data.userAction.trim()
			? entry.data.userAction.trim()
			: "Validation instructions unavailable.";
		return new Text([formatInstruction(theme, VALIDATION_NOTICE_HEADING), "", userAction].join("\n"), TRANSCRIPT_PADDING, 0);
	});
	pi.registerMessageRenderer(FRESH_ANNOUNCEMENT_MESSAGE_TYPE, (message, options, theme) =>
		new Text(theme.fg("success", typeof message.content === "string" ? message.content : ""), options.outputPad, 0));

	const taskResult = (current: PlanSession, action: string, title: string, changed = true) => {
		const labels: Record<string, string> = { update: "Plan title/scope updated", include: "Plan scope updated", discussion: "Discussion decision saved", new: "New plan started", abandon: "Plan abandoned" };
		const item = action === "list" ? currentPlanItem(current) : undefined;
		const text = action === "list" ? planInventory(current) : `${changed ? labels[action] ?? "Plan updated" : "Plan unchanged"}: ${title}`;
		return {
			content: [{ type: "text" as const, text }],
			details: {
				action, changed, attached: current.plans.collection.attached,
				...(current.plans.collection.attached !== null ? { planPath: currentPlanPath(current), fileState: current.savedPlanState, plan: structuredClone(current.plans.plan) } : {}),
				...(action === "list" ? { plans: item ? [item] : [] } : {}),
			},
		};
	};

	function currentPlanItem(current: PlanSession) {
		if (!current.plans.attached) return undefined;
		const plan = current.plans.plan;
		return {
			sequence: plan.sequence,
			title: plan.task?.title ?? current.savedPlanHeading ?? "Untitled task",
			state: plan.outcome?.kind === "awaiting_validation" ? "awaiting_validation" : "current",
			path: currentPlanPath(current),
			fileState: current.savedPlanState,
			...(plan.outcome ? { outcome: plan.outcome } : {}),
		};
	}

	function planInventory(current: PlanSession): string {
		current.plans.assertUsable();
		const item = currentPlanItem(current);
		if (!item) return "Current plan: none.";
		const status = item.state === "awaiting_validation" ? "awaiting validation" : "open";
		return `Current plan: ${item.sequence} · ${item.title} · ${status}`;
	}

	async function promptForValidationCompletion(current: PlanSession, userAction: string, ctx: ExtensionContext): Promise<void> {
		if (!ctx.hasUI || current.plans.collection.attached === null || current.plans.plan.outcome?.kind !== "awaiting_validation") return;
		const sequence = current.plans.collection.attached;
		const stepId = activePlanStep(current.plans.execution)?.id;
		const completionKind = validationCompletionKind(current);
		if (!completionKind) return;
		const completeChoice = completionKind === "step" ? COMPLETE_STEP_CHOICE : COMPLETE_PLAN_CHOICE;
		const title = ctx.mode === "rpc" ? `${validationNotice(userAction)}\n\n${VALIDATION_COMPLETION_QUESTION}` : VALIDATION_COMPLETION_QUESTION;
		const selection = await ctx.ui.select(title, [completeChoice, STAY_BUILD_CHOICE]);
		if (selection !== completeChoice) return;
		const currentStepId = activePlanStep(current.plans.execution)?.id;
		const outcome = current.plans.attached?.plan.outcome;
		if ((current.runMode ?? current.selectedMode) !== "build" || current.plans.collection.attached !== sequence || outcome?.kind !== "awaiting_validation" || outcome.userAction !== userAction || currentStepId !== stepId || validationCompletionKind(current) !== completionKind) {
			ctx.ui.notify("The plan or validation request changed while the prompt was open. Nothing was completed.", "warning");
			return;
		}
		if (stepId) {
			const completion = completeExecutionStep(current, stepId);
			announceValidationCompletion(current, completion === undefined
				? "The current step is complete. The next step is ready and awaits your instruction."
				: "Plan complete.", ctx);
			return;
		}
		completeCurrentPlan(current);
		announceValidationCompletion(current, "Plan complete.", ctx);
	}

	function validationCompletionKind(current: PlanSession): "plan" | "step" | undefined {
		if (!current.plans.execution) return "plan";
		const active = activePlanStep(current.plans.execution);
		if (!active) return undefined;
		return current.plans.execution.steps.every((step) => step.id === active.id || step.status === "completed" || step.status === "skipped")
			? "plan"
			: "step";
	}

	function announceValidationCompletion(_current: PlanSession, message: string, ctx: ExtensionContext): void {
		pi.appendEntry(MODE_NOTICE_ENTRY_TYPE, { message, tone: "ack" });
		if (ctx.mode === "rpc") ctx.ui.notify(message, "info");
	}

	function resetReconciliation(current: PlanSession, sequence: number | null, sessionId: string, consumed = false): void {
		current.activeReconciliationId = undefined;
		current.reconciliationFollowUp = false;
		current.reconciliation = sequence === null ? undefined : {
			sequence, sessionId, consumed, eligible: false, handled: false, failed: false, terminal: false,
		};
	}

	function beginReconciliation(current: PlanSession, ctx: ExtensionContext): void {
		if (current.reconciliationFollowUp) current.reconciliationFollowUp = false;
		else resetReconciliation(current, current.plans.collection.attached, ctx.sessionManager.getSessionId()!);
	}

	function armReconciliation(current: PlanSession, ctx: ExtensionContext): void {
		if ((current.runMode ?? current.selectedMode) !== "build" || current.plans.collection.attached === null || current.plans.execution || inspectPlanFileState(currentPlanPath(current)) !== "saved") return;
		if (current.plans.plan.outcome?.kind === "awaiting_validation") return;
		if (!current.reconciliation || current.reconciliation.sequence !== current.plans.collection.attached || current.reconciliation.sessionId !== ctx.sessionManager.getSessionId()) {
			resetReconciliation(current, current.plans.collection.attached, ctx.sessionManager.getSessionId()!);
		}
		if (current.reconciliation!.consumed || current.reconciliation!.handled) return;
		current.reconciliation!.eligible = true;
	}

	function displayInspection(ctx: ExtensionContext, markdown: string): void {
		if (ctx.mode === "rpc") ctx.ui.notify(markdown, "info");
		else pi.appendEntry("skill-pi-plan-inspection", { markdown });
	}

	pi.registerCommand("plan", {
		description: "Plan mode and lifecycle: new, done, abandon, list, show, history",
		getArgumentCompletions: (prefix) => ["new", "done", "abandon", "list", "show", "history"].filter((value) => value.startsWith(prefix)).map((value) => ({ value, label: value })),
		handler: async (args, ctx) => {
			const current = session(ctx);
			current.currentContext = ctx;
			const [action, target, ...extra] = args.trim().split(/\s+/);
			if (!action) return selectMode("plan", current, ctx, "manual");
			if (!["new", "done", "abandon", "list", "show", "history", "pause", "resume"].includes(action) || extra.length || (target && action !== "resume")) {
				ctx.ui.notify("Usage: /plan [new|done|abandon|list|show|history]", "warning");
				return;
			}
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the agent to finish before changing the current plan.", "warning");
				return;
			}
			if (action === "pause" || action === "resume") {
				ctx.ui.notify("Plan pause/resume is no longer supported. Complete or explicitly abandon the current plan before starting another.", "warning");
				return;
			}
			if (action === "show" || action === "history") {
				try {
					current.plans.assertUsable();
					if (action === "history") {
						const records = current.plans.collection.records.filter(({ plan }) => plan.status !== "open");
						displayInspection(ctx, records.length ? records.map(({ plan }) => {
							const detail = plan.status === "transferred" ? "Implementation transferred to a linked session." : plan.abandonReason ?? plan.completionSummary ?? "No completion summary recorded.";
							return `## ${plan.sequence}: ${plan.task?.title ?? "Untitled task"}\n\n${plan.status}\n\n${planPathFor(plan.sequence, ctx)}\n\n${detail}`;
						}).join("\n\n") : "No completed, abandoned, or transferred plans on this session branch.");
					} else if (!current.plans.attached) displayInspection(ctx, "Current plan: none.");
					else {
						const file = currentPlanPath(current);
						let markdown = "";
						let fileState = inspectPlanFileState(file);
						try { markdown = await fs.promises.readFile(file, "utf8"); }
						catch { if (fileState !== "absent") fileState = "unavailable"; }
						const progress = current.plans.execution ? `\n\nExecution: ${current.plans.execution.status}\n${current.plans.execution.steps.map((step, i) => `${i + 1}. [${step.status}] ${step.text}`).join("\n")}\n\nSay ‘Proceed’ to start a ready step; pause/resume or revise through ordinary prompts.` : "";
						const outcome = current.plans.plan.outcome;
						displayInspection(ctx, `# ${current.plans.plan.task?.title ?? "Untitled task"}\n\n${file} (${fileState})${progress}${outcome ? `\n\n${outcome.reason}\n${outcome.userAction ?? ""}` : ""}\n\n${markdown}`);
					}
				} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
				return;
			}
			if (action === "list") {
				ctx.ui.notify(planInventory(current), "info");
				return;
			}
			if (action === "done") {
				try {
					completeCurrentPlan(current);
					ctx.ui.notify("Plan completed. The next planning task will use a new file.", "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning");
				}
				return;
			}
			if (action === "abandon") {
				try {
					if (!current.plans.attached) throw new Error("No current plan to abandon");
					if (!ctx.hasUI || !await ctx.ui.confirm("Abandon current plan?", `${current.plans.plan.task?.title ?? "Untitled task"}\n\nThe plan file will be preserved, but this plan cannot be resumed.`)) return;
					const title = abandonCurrentPlan(current, "Explicitly abandoned by the user through /plan abandon.", ctx);
					ctx.ui.notify(`Plan abandoned: ${title}. Its file was preserved.`, "info");
				} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
				return;
			}
			try {
				current.plans.assertUsable();
				if (current.plans.attached) throw new Error("Complete or explicitly abandon the current plan before starting another");
				await selectMode("plan", current, ctx, "manual");
				current.runMode = undefined;
				startNewPlan(current, ctx);
				await ensurePlanDirectory();
				ctx.ui.notify(`New plan: ${shorten(currentPlanPath(current), ctx.cwd)}. Previous plan files are preserved.`, "info");
			} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"); }
		},
	});

	pi.registerCommand("build", {
		description: "Switch to Build mode",
		handler: async (_args, ctx) => selectMode("build", session(ctx), ctx, "manual"),
	});

	pi.registerCommand("build-fresh", {
		description: "Start a clean linked session and implement the plan selected in plan_exit",
		handler: async (_args, ctx) => {
			const current = session(ctx);
			current.currentContext = ctx;
			const request = current.freshImplementationRequest;
			if (request && (current.plans.collection.attached === null || current.handoffSequence !== current.plans.collection.attached)) {
				current.freshImplementationRequest = undefined;
				ctx.ui.notify("The approved plan is no longer current. Select its implementation action again.", "warning");
				return;
			}
			if (!request) {
				ctx.ui.notify("No fresh implementation is pending. Choose ‘Start fresh and implement’ from plan_exit first.", "warning");
				return;
			}
			if (current.selectedMode !== "plan") {
				current.freshImplementationRequest = undefined;
				ctx.ui.notify("Fresh implementation is no longer available because Plan mode is not active.", "warning");
				return;
			}
			current.freshImplementationRequest = undefined;
			try {
				const retry = await startFreshHandoff(pi, ctx, request);
				if (retry) current.freshImplementationRequest = request;
			} catch (error) {
				current.freshImplementationRequest = request;
				throw error;
			}
		},
	});

	pi.registerCommand("plan-settings", {
		description: "Configure Plan/Build settings",
		handler: async (_args, ctx) => {
			const current = session(ctx);
			current.currentContext = ctx;
			if (!ctx.hasUI) return;
			const customOption = "Custom (edit config file)";
			const shortcutOption = `Shortcuts (active: ${shortcutPresetLabel(shortcutConfig)})`;
			const defaultModeOption = `Default mode (active: ${current.selectedMode})`;
			const titleOption = `Plan title (active: ${current.showPlanTitle ? "on" : "off"})`;
			const catalogOption = `Stable tool catalog (active: ${current.stableToolCatalog ? "on" : "off"})`;
			const selected = await ctx.ui.select("Plan/Build settings", [defaultModeOption, shortcutOption, titleOption, catalogOption]);
			if (!selected) return;
			if (selected === defaultModeOption) {
				const choice = await ctx.ui.select("Default mode for new sessions", ["Build (default)", "Plan"]);
				if (!choice) return;
				try {
					const mode: Mode = choice === "Plan" ? "plan" : "build";
					saveDefaultMode(agentDir, mode);
					ctx.ui.notify(`New sessions start in ${mode === "plan" ? "Plan" : "Build"} mode. The current session is unchanged.`, "info");
				} catch (error) {
					ctx.ui.notify(`Could not save ${shortcutConfigPath}: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}
			if (selected === titleOption) {
				const choice = await ctx.ui.select("Composer plan title", ["On (default)", "Off"]);
				if (!choice) return;
				try {
					const enabled = choice === "On (default)";
					saveShowPlanTitle(agentDir, enabled);
					for (const value of sessions.values()) value.showPlanTitle = enabled;
					current.showPlanTitle = enabled;
					updateStatusLine(current, ctx);
					ctx.ui.notify(`Plan title ${enabled ? "on" : "off"}.`, "info");
				} catch (error) {
					ctx.ui.notify(`Could not save ${shortcutConfigPath}: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}
			if (selected === catalogOption) {
				const choice = await ctx.ui.select("Stable tool catalog: keep all plan tools visible so mode and plan changes keep the prompt cache (best with the same model in both modes)", ["On (default)", "Off"]);
				if (!choice) return;
				try {
					const enabled = choice === "On (default)";
					saveStableToolCatalog(agentDir, enabled);
					for (const value of sessions.values()) value.stableToolCatalog = enabled;
					current.stableToolCatalog = enabled;
					if (ctx.isIdle()) applyTools(current, current.runMode ?? current.selectedMode);
					ctx.ui.notify(`Stable tool catalog ${enabled ? "on" : "off"}.`, "info");
				} catch (error) {
					ctx.ui.notify(`Could not save ${shortcutConfigPath}: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}
			const shortcutSelection = await ctx.ui.select(
				`Plan/Build shortcuts — active: ${shortcutPresetLabel(shortcutConfig)} (global: ${shortcutConfig.toggleMode.join(", ") || "none"}; editor: ${shortcutConfig.toggleModeInEditor.join(", ") || "none"})`,
				[...Object.keys(SHORTCUT_PRESETS), customOption],
			);
			if (!shortcutSelection) return;
			if (shortcutSelection === customOption) {
				ctx.ui.notify(
					`Edit ${shortcutConfigPath}, then run /reload. Example: {"showPlanTitle":true,"shortcuts":{"toggleMode":["ctrl+alt+m"],"toggleModeInEditor":["tab"]}}. Use [] to disable an action. Put Tab only in toggleModeInEditor; it switches modes when autocomplete is closed instead of requesting file completion.`,
					"info",
				);
				return;
			}
			try {
				saveShortcutPreset(agentDir, shortcutSelection);
				ctx.ui.notify(`Saved ${shortcutSelection} to ${shortcutConfigPath}. Run /reload to apply the shortcuts.`, "info");
			} catch (error) {
				ctx.ui.notify(`Could not save ${shortcutConfigPath}: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	for (const shortcut of shortcutConfig.toggleMode) {
		pi.registerShortcut(shortcut, {
			description: "Cycle Plan and Build modes",
			handler: async (ctx) => selectMode(nextMode(session(ctx).pendingMode ?? session(ctx).selectedMode), session(ctx), ctx, "manual"),
		});
	}

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
				), current.plans.plan.task, current.toolsBeforeModes, stateData(current));
				pi.sendUserMessage("/build-fresh", {
					deliverAs: "followUp",
					expandPromptTemplates: true,
				});
				return buildPlanExitFreshResult(currentPlanPath(current));
			}
			current.freshImplementationRequest = undefined;
			await selectMode("build", current, ctx, "tool");
			armReconciliation(current, ctx);
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

	pi.on("input", (event) => {
		const current = currentSessionRef;
		if (current && event.source !== "extension") current.reconciliationFollowUp = false;
	});

	pi.on("agent_end", (event, ctx) => {
		const current = session(ctx);
		if (!current.reconciliation) return;
		const messages = event.messages ?? [];
		let last: { role?: string; stopReason?: string } | undefined;
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i] as { role?: string; stopReason?: string };
			if (message?.role === "assistant") { last = message; break; }
		}
		if (last) {
			current.reconciliation.terminal = last.stopReason === "stop";
			if (last.stopReason === "error" || last.stopReason === "aborted") current.reconciliation.failed = true;
		}
	});

	pi.on("tool_result", (event, ctx) => {
		const current = session(ctx);
		if (event.isError && current.reconciliation) current.reconciliation.failed = true;
		if (event.isError || !isFileMutationTool(event.toolName)) return;
		const inputPath = mutationPath(event.input);
		const targetsTrackedPlan = inputPath !== undefined && current.plans.collection.records.some((r) =>
			isAllowedPlanMutation(ctx.cwd, inputPath, planPathFor(r.plan.sequence, ctx)));
		if (!targetsTrackedPlan) armReconciliation(current, ctx);
		if (inputPath === undefined || isAllowedPlanMutation(ctx.cwd, inputPath, currentPlanPath(current))) {
			refreshSavedPlanTitle(current);
			applyTools(current, current.runMode ?? current.selectedMode);
			updateStatusLine(current, ctx);
			showCard(current, ctx);
		}
	});

	pi.on("tool_call", (event, ctx) => {
		const current = session(ctx);
		const effectiveMode = current.runMode ?? current.selectedMode;
		if (current.plans.error && (managedTools.has(event.toolName) || isProjectMutationTool(event.toolName))) return { block: true, reason: `Agent action blocked: plan state is unavailable (${current.plans.error}).` };
		if (isProjectMutationTool(event.toolName) || DEPENDENT_PLAN_TOOLS.has(event.toolName)) {
			const branch = ctx.sessionManager.getBranch();
			let latestAssistant: { type?: string; message?: { role?: string; content?: Array<{ type?: string; name?: string; arguments?: { action?: string } }> } } | undefined;
			for (let i = branch.length - 1; i >= 0; i--) {
				const entry = branch[i]!;
				if (entry.type === "message" && (entry as { message?: { role?: string } }).message?.role === "assistant") { latestAssistant = entry as typeof latestAssistant; break; }
			}
			if (latestAssistant?.type === "message" && latestAssistant.message?.role === "assistant" && latestAssistant.message.content?.some((part) => part.type === "toolCall" && part.name === "plan_task" && !["list", "pause", "resume"].includes((part.arguments as { action?: string })?.action ?? ""))) {
				return { block: true, reason: "Agent action blocked: plan_task must finish before dependent actions." };
			}
		}
		if (effectiveMode === "build" && isFileMutationTool(event.toolName)) {
			const inputPath = mutationPath(event.input);
			if (inputPath !== undefined && (isAllowedPlanMutation(ctx.cwd, inputPath, currentPlanPath(current)) || current.plans.collection.records.some((r) => isAllowedPlanMutation(ctx.cwd, inputPath, planPathFor(r.plan.sequence, ctx))))) {
				return {
					block: true,
					reason: "Agent action blocked: tracked plan Markdown is read-only in Build mode. Keep current scope changes in plan_task metadata, or switch to Plan mode to revise and review the attached Markdown.",
				};
			}
		}
		if (effectiveMode === "build" && current.plans.execution && current.plans.execution.status !== "completed" && !executablePlanStep(current.plans.execution) && isProjectMutationTool(event.toolName)) {
			return {
				block: true,
				reason: "Agent action blocked: implementation is waiting for your instruction.",
			};
		}
		if (effectiveMode !== "plan" || !isFileMutationTool(event.toolName)) return;
		const inputPath = mutationPath(event.input);
		if (current.plans.collection.attached !== null && inputPath !== undefined && isAllowedPlanMutation(ctx.cwd, inputPath, currentPlanPath(current))) return;
		return {
			block: true,
			reason: inputPath === undefined
				? `Agent action blocked: ${event.toolName} has no verifiable target; Plan mode permits only ${currentPlanPath(current)}.`
				: `Agent action blocked: Plan mode permits file mutations only to ${currentPlanPath(current)}.`,
		};
	});

	pi.on("context", (event) => {
		const current = currentSessionRef;
		if (!current) return undefined;
		const messages = event.messages.filter((message) => !isObsoletePlanContext(message, current.activeReconciliationId));
		const content = buildPlanContext(current.runMode ?? current.selectedMode, current.plans.collection, { path: currentPlanPath(current), state: current.savedPlanState }, current.plans.error);
		if (!content) return { messages };
		const lastUserIndex = (() => {
			for (let i = messages.length - 1; i >= 0; i--) if ((messages[i] as { role?: string }).role === "user") return i;
			return 0;
		})();
		const index = Math.max(0, lastUserIndex);
		messages.splice(index, 0, {
			role: "custom", customType: TASK_CONTEXT_TYPE,
			content: `Background operational context, not a new user request. Do not acknowledge this block; follow the actual user request within these constraints.\n\n${content}`,
			display: false, timestamp: (messages[index] as { timestamp?: number })?.timestamp ?? 0,
		} as (typeof messages)[number]);
		return { messages };
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		const current = session(ctx);
		current.currentContext = ctx;
		const setupState = latestPlanState(ctx.sessionManager.getBranch());
		if (current.plans.collection.attached === null && setupState?.pendingFreshAnnouncement === true) {
			current.selectedMode = decodeModeState(setupState)?.selectedMode ?? "build";
			current.pendingFreshAnnouncement = true;
			restorePlanState(current, setupState, ctx);
			updateStatusLine(current, ctx);
		}
		const announceFresh = current.pendingFreshAnnouncement;
		if (announceFresh) {
			current.pendingFreshAnnouncement = false;
			persist(current);
		}
		beginReconciliation(current, ctx);
		current.runMode = current.selectedMode;
		if (announceFresh) armReconciliation(current, ctx);
		refreshSavedPlanTitle(current);
		applyTools(current, current.runMode);
		updateStatusLine(current, ctx);
		showCard(current, ctx);
		if (announceFresh) {
			const content = PLAN_ACTION_ANNOUNCEMENTS["implement-fresh"];
			if (ctx.mode === "rpc") ctx.ui.notify(content, "info");
			return { message: { customType: FRESH_ANNOUNCEMENT_MESSAGE_TYPE, content, display: true } };
		}
	});

	pi.on("agent_settled", async (_event, ctx) => {
		const current = session(ctx);
		current.currentContext = ctx;
		current.activeReconciliationId = undefined;
		current.runMode = undefined;
		applyTools(current, current.selectedMode);
		updateStatusLine(current, ctx);
		showCard(current, ctx);
		let followUpDispatched = false;
		if (shouldReconcileCompletion(current.reconciliation, current.plans.collection.attached, current.selectedMode, ctx.sessionManager.getSessionId()!, !!current.plans.execution, ctx.isIdle(), ctx.hasPendingMessages())) {
			current.reconciliation!.consumed = true;
			current.reconciliationFollowUp = true;
			persist(current);
			current.activeReconciliationId = randomUUID();
			pi.sendMessage({ customType: RECONCILIATION_CONTEXT_TYPE, details: { reconciliationId: current.activeReconciliationId }, display: false, content: "Record the attached plan's truthful terminal outcome now; this grants no more work or verification. Use plan_complete only if all work and required checks passed, otherwise plan_finish with the reason and exact essential validation action when applicable. Then summarize without repeating that action or tool bookkeeping. Do not infer success or rerun checks merely to close the plan." }, { triggerTurn: true, deliverAs: "followUp" });
			followUpDispatched = true;
		}
		if (current.pendingValidationNotice && !followUpDispatched) {
			const userAction = current.pendingValidationNotice;
			current.pendingValidationNotice = undefined;
			const record = current.plans.collection.records.find((candidate) => candidate.plan.sequence === current.plans.collection.attached);
			if (record?.plan.outcome?.kind === "awaiting_validation") {
				pi.appendEntry(VALIDATION_NOTICE_ENTRY_TYPE, { userAction });
				await promptForValidationCompletion(current, userAction, ctx);
			}
		}
	});

	pi.on("session_compact", (_event, ctx) => {
		const current = session(ctx);
		refreshSavedPlanTitle(current);
		applyTools(current, current.runMode ?? current.selectedMode);
		updateStatusLine(current, ctx);
		showCard(current, ctx);
	});

	function restorePlanState(current: PlanSession, raw: LegacyState | undefined, ctx: ExtensionContext, sourceSessionId?: string): void {
		const consumed = raw?.reconciliation as { sequence?: number; sessionId?: string; consumed?: boolean } | undefined;
		if (consumed?.consumed && Number.isSafeInteger(consumed.sequence) && typeof consumed.sessionId === "string") {
			resetReconciliation(current, consumed.sequence!, consumed.sessionId, true);
		} else resetReconciliation(current, null, ctx.sessionManager.getSessionId()!);
		const inspected = new Map<number, "saved" | "absent" | "unavailable">();
		const inspect = (sequence: number) => {
			if (!inspected.has(sequence)) inspected.set(sequence, inspectPlanFileState(planPathFor(sequence, ctx)));
			return inspected.get(sequence)!;
		};
		try {
			current.plans.restore(restoreCollection(raw, inspect, sourceSessionId
				? (sequence: number) => inspectPlanFileState(makePlanPath(path.join(getAgentDir(), "plans"), sourceSessionId, sequence)) : undefined), allocationHighWater(ctx.sessionManager.getEntries()));
		} catch (error) {
			current.plans.collection = { records: [], attached: null, counter: 0 };
			current.plans.error = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Plan state unavailable: ${current.plans.error}. Plan mutations are disabled.`, "error");
		}
		refreshSavedPlanTitle(current, current.plans.collection.attached === null ? "absent" : inspect(current.plans.collection.attached));
		current.lastSnapshot = JSON.stringify(stateData(current));
	}

	pi.on("session_tree", (_event, ctx) => {
		const current = session(ctx);
		current.currentContext = ctx;
		const raw = latestPlanState(ctx.sessionManager.getBranch());
		current.freshImplementationRequest = undefined;
		current.handoffSequence = undefined;
		current.selectedMode = decodeModeState(raw)?.selectedMode ?? "build";
		current.pendingFreshAnnouncement = raw?.pendingFreshAnnouncement === true;
		current.pendingValidationNotice = undefined;
		restorePlanState(current, raw, ctx);
		current.runMode = undefined;
		applyTools(current, current.selectedMode);
		updateStatusLine(current, ctx);
		showCard(current, ctx);
	});

	pi.on("session_start", async (event, ctx) => {
		const current = session(ctx);
		current.currentContext = ctx;
		if (shortcutConfigWarning && !shortcutConfigWarningShown && ctx.hasUI) {
			shortcutConfigWarningShown = true;
			ctx.ui.notify(
				`Invalid Pi Plan Build configuration at ${shortcutConfigPath}: ${shortcutConfigWarning}. Defaults were used for invalid settings.`,
				"warning",
			);
		}
		const raw = latestPlanState(ctx.sessionManager.getBranch());
		const decoded = decodeModeState(raw);
		current.pendingFreshAnnouncement = raw?.pendingFreshAnnouncement === true;
		current.pendingValidationNotice = undefined;
		const flagMode: Mode | undefined = pi.getFlag("plan") === true ? "plan" : pi.getFlag("build") === true ? "build" : undefined;
		current.selectedMode = decoded?.selectedMode ?? flagMode ?? current.selectedMode ?? "build";
		current.toolsBeforeModes = pi.getActiveTools().filter((name) => !managedTools.has(name));
		const plansDir = path.join(getAgentDir(), "plans");
		restorePlanState(current, raw, ctx, event.reason === "fork" ? raw?.planSessionId : undefined);
		current.runMode = undefined;
		let attachedFileChanged = false;
		if (event.reason === "fork" && typeof raw?.planSessionId === "string" && raw.planSessionId !== ctx.sessionManager.getSessionId()) {
			for (const { plan } of current.plans.collection.records) {
				const sourcePath = makePlanPath(plansDir, raw.planSessionId, plan.sequence);
				const destination = planPathFor(plan.sequence, ctx);
				if (fs.existsSync(sourcePath) && !fs.existsSync(destination)) {
					await ensurePlanDirectory();
					await fs.promises.copyFile(sourcePath, destination, fs.constants.COPYFILE_EXCL);
					if (plan.sequence === current.plans.collection.attached) attachedFileChanged = true;
				}
			}
		}
		if (current.plans.execution) await ensurePlanDirectory();
		if (current.plans.execution && !attachedFileChanged && current.savedPlanState === "absent") {
			await fs.promises.writeFile(currentPlanPath(current), current.plans.execution.planMarkdown, { encoding: "utf8", flag: "wx" });
			attachedFileChanged = true;
		}
		if (attachedFileChanged) refreshSavedPlanTitle(current);
		const forkIdentityChanged = event.reason === "fork" && typeof raw?.planSessionId === "string" && raw.planSessionId !== ctx.sessionManager.getSessionId();
		if (forkIdentityChanged || raw?.version !== STATE_VERSION && (current.plans.collection.records.length || current.plans.collection.counter)) {
			current.lastSnapshot = "";
			persist(current);
		}
		applyTools(current, current.selectedMode);
		updateStatusLine(current, ctx);
		showCard(current, ctx);
	});

	pi.on("session_shutdown", (_event, ctx) => {
		const key = sessionKey(ctx);
		const current = sessions.get(key);
		if (current) {
			current.activeReconciliationId = undefined;
			current.modeTransition++;
			current.pendingMode = undefined;
			current.pendingValidationNotice = undefined;
			current.ui = undefined;
			current.tui = undefined;
		}
		sessions.delete(key);
		currentSessionRef = undefined;
	});
}
