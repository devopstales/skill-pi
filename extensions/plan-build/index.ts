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
import type { AgentToolResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { parseKey } from "@earendil-works/pi-tui";
import {
	PlanState,
	STATE_TYPE,
	STATE_VERSION,
	type StoredState,
} from "./src/plan-state.ts";
import {
	activePlanStep,
	completePlanStep,
	executablePlanStep,
	formatPlanCompletionSummary,
	formatPlanClosureSummary,
	pausePlanExecution,
	type PlanExecutionState,
} from "./src/plan-execution.ts";
import { loadShortcutConfig } from "./src/shortcut-config.ts";
import { noticeTracker } from "./src/tool-presentation.ts";
import { registerQuestionNotice } from "./src/question-ui.ts";
import {
	applyManualSelection,
	decodeModeState,
	displayedPlanTitle,
	extractPlanTitle,
	makePlanPath,
	unique,
	type Mode,
} from "./src/utils.ts";
import { buildTheme } from "./src/theme.ts";
import { renderPlanCard } from "./src/card.ts";
import { registerUi, updateStatusLine, showCard } from "./ui.ts";
import { registerHooks } from "./hooks.ts";
import { registerTools } from "./tools.ts";
import { registerCommands } from "./commands.ts";
import type { PlanSession } from "./session-state.ts";

const MODE_NOTICE_ENTRY_TYPE = "skill-pi-plan-notice";
const VALIDATION_COMPLETION_QUESTION = "Did the required validation pass?";
const COMPLETE_PLAN_CHOICE = "Yes — mark the plan as complete";
const COMPLETE_STEP_CHOICE = "Yes — mark the current step as complete";
const STAY_BUILD_CHOICE = "No — stay in Build mode";
const MANAGED_PLAN_TOOLS = ["plan_task", "plan_exit", "plan_step_control", "plan_step_complete", "plan_complete", "plan_finish"];
const FILE_MUTATION_TOOLS = new Set(["edit", "write", "replace", "insert", "undo_last_change"]);
const SHELL_MUTATION_TOOLS = new Set(["bash", "powershell"]);

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
		} catch { /* unreadable saved plan must not break the card */ }
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

	const taskResult = (current: PlanSession, action: string, title: string, changed = true): AgentToolResult<Record<string, unknown>> => {
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
		const title = ctx.mode === "rpc" ? `${userAction}\n\n${VALIDATION_COMPLETION_QUESTION}` : VALIDATION_COMPLETION_QUESTION;
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

	registerQuestionNotice(pi);
	registerUi({ pi, currentPlanTitle, makeCard });
	const shared = {
		pi,
		currentSessionRef: { get(): PlanSession | undefined { return currentSessionRef; }, set(value: PlanSession | undefined): void { currentSessionRef = value; } },
		sessions,
		session,
		sessionKey,
		currentPlanPath,
		planPathFor,
		stateData,
		persist,
		refreshSavedPlanTitle,
		inspectPlanFileState,
		completablePlanStep,
		completeExecutionStep,
		cancelPlanExecution,
		applyExecutionTransition,
		updateExecution,
		applyTools,
		ensurePlanDirectory,
		clearAttachmentRun,
		syncPlanState,
		syncAttachment,
		closeCurrentPlan,
		abandonCurrentPlan,
		startNewPlan,
		completeCurrentPlan,
		selectMode,
		updateStatusLine,
		showCard,
		isFileMutationTool,
		isProjectMutationTool,
		mutationPath,
		shorten,
		taskResult,
		currentPlanItem,
		planInventory,
		promptForValidationCompletion,
		validationCompletionKind,
		announceValidationCompletion,
	};

	const modeNotices = noticeTracker(pi, MODE_NOTICE_ENTRY_TYPE);
	registerHooks({
		...shared,
		shortcutConfigWarning,
		shortcutConfigPath,
		warningShownBox: { shown: false },
	});
	registerCommands({
		...shared,
		agentDir,
		shortcutConfig,
		shortcutConfigPath,
	});
	registerTools({
		...shared,
		modeNotices,
	});

	const modeLeader: { stop: (() => void) | undefined } = { stop: undefined };
	const modeKeys: Record<string, Mode> = {};
	for (const key of shortcutConfig.planMode) modeKeys[key] = "plan";
	for (const key of shortcutConfig.buildMode) modeKeys[key] = "build";

	const startModeLeader = (ctx: ExtensionContext) => {
		modeLeader.stop?.();
		modeLeader.stop = undefined;
		if (!ctx.hasUI || typeof ctx.ui.onTerminalInput !== "function" || Object.keys(modeKeys).length === 0) return;
		let armed = false;
		modeLeader.stop = ctx.ui.onTerminalInput((data) => {
			if (parseKey(data) === "ctrl+q") {
				armed = true;
				return { consume: true };
			}
			if (armed) {
				const parsed = parseKey(data);
				const mode = parsed ? modeKeys[parsed] : undefined;
				armed = false;
				if (mode) {
					void selectMode(mode, session(ctx), ctx, "manual");
					return { consume: true };
				}
			}
			return undefined;
		});
	};

	pi.on("session_start", (_event, ctx) => startModeLeader(ctx));
	pi.on("session_shutdown", () => {
		modeLeader.stop?.();
		modeLeader.stop = undefined;
	});
}
