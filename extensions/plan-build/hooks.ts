import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import {
	allocationHighWater,
	latestPlanState,
	restoreCollection,
	STATE_VERSION,
	type LegacyState,
} from "./src/plan-state.ts";
import { buildPlanContext, isObsoletePlanContext, RECONCILIATION_CONTEXT_TYPE, TASK_CONTEXT_TYPE } from "./src/plan-context.ts";
import { executablePlanStep, type PlanExecutionState } from "./src/plan-execution.ts";
import { makePlanPath, decodeModeState, isAllowedPlanMutation, PLAN_ACTION_ANNOUNCEMENTS, shouldReconcileCompletion, type Mode } from "./src/utils.ts";
import { beginReconciliation, resetReconciliation, armReconciliation } from "./reconciliation.ts";
import type { PlanSession } from "./session-state.ts";

const VALIDATION_NOTICE_ENTRY_TYPE = "skill-pi-plan-validation-notice";
const FRESH_ANNOUNCEMENT_MESSAGE_TYPE = "skill-pi-plan-fresh-announcement";
const MANAGED_PLAN_TOOLS = new Set(["plan_task", "plan_exit", "plan_step_control", "plan_step_complete", "plan_complete", "plan_finish"]);
const DEPENDENT_PLAN_TOOLS = new Set(["plan_complete", "plan_finish", "plan_step_control", "plan_step_complete", "plan_exit"]);

export interface HookDeps {
	pi: ExtensionAPI;
	currentSessionRef: { get(): PlanSession | undefined; set(value: PlanSession | undefined): void };
	sessions: Map<string, PlanSession>;
	session: (ctx: ExtensionContext) => PlanSession;
	sessionKey: (ctx: ExtensionContext) => string;
	currentPlanPath: (current: PlanSession) => string;
	planPathFor: (sequence: number, ctx: ExtensionContext) => string;
	stateData: (current: PlanSession) => unknown;
	persist: (current: PlanSession) => void;
	refreshSavedPlanTitle: (current: PlanSession, knownState?: PlanSession["savedPlanState"]) => void;
	inspectPlanFileState: (file: string) => PlanSession["savedPlanState"];
	completablePlanStep: (current: PlanSession) => unknown;
	completeExecutionStep: (current: PlanSession, id: string, summary?: string) => string | undefined;
	cancelPlanExecution: (current: PlanSession) => void;
	applyExecutionTransition: (current: PlanSession, next: PlanExecutionState) => string | undefined;
	updateExecution: (current: PlanSession, next: PlanExecutionState) => void;
	applyTools: (current: PlanSession, mode: Mode) => void;
	ensurePlanDirectory: () => Promise<void>;
	clearAttachmentRun: (current: PlanSession) => void;
	syncPlanState: (current: PlanSession, ctx?: ExtensionContext) => void;
	syncAttachment: (current: PlanSession, ctx?: ExtensionContext) => void;
	closeCurrentPlan: (current: PlanSession, summary?: string) => void;
	abandonCurrentPlan: (current: PlanSession, reason: string, ctx: ExtensionContext) => string;
	startNewPlan: (current: PlanSession, ctx: ExtensionContext, task?: { title: string; scope: string; decisions: Array<{ topic: string; outcome: "include" | "discussion" }> }) => void;
	completeCurrentPlan: (current: PlanSession, summary?: string) => void;
	selectMode: (mode: Mode, current: PlanSession, ctx: ExtensionContext, source: "manual" | "tool") => Promise<void>;
	updateStatusLine: (current: PlanSession, ctx?: ExtensionContext) => void;
	showCard: (current: PlanSession, ctx?: ExtensionContext) => void;
	isFileMutationTool: (toolName: string) => boolean;
	isProjectMutationTool: (toolName: string) => boolean;
	mutationPath: (input: unknown) => unknown;
	shorten: (filePath: string, cwd: string) => string;
	taskResult: (current: PlanSession, action: string, title: string, changed?: boolean) => unknown;
	currentPlanItem: (current: PlanSession) => unknown;
	planInventory: (current: PlanSession) => string;
	promptForValidationCompletion: (current: PlanSession, userAction: string, ctx: ExtensionContext) => Promise<void>;
	validationCompletionKind: (current: PlanSession) => "plan" | "step" | undefined;
	announceValidationCompletion: (current: PlanSession, message: string, ctx: ExtensionContext) => void;
	shortcutConfigWarning: string | undefined;
	shortcutConfigPath: string;
	warningShownBox: { shown: boolean };
}

export function registerHooks(deps: HookDeps): void {
	const {
		pi, currentSessionRef, sessions, session, sessionKey, currentPlanPath, planPathFor, stateData,
		refreshSavedPlanTitle, inspectPlanFileState, applyTools, ensurePlanDirectory, updateStatusLine, showCard,
		isFileMutationTool, isProjectMutationTool, mutationPath, promptForValidationCompletion,
		shortcutConfigWarning, shortcutConfigPath, warningShownBox,
	} = deps;
	const reconcileDeps = { currentPlanPath, inspectPlanFileState };
	const managedTools = MANAGED_PLAN_TOOLS;

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

	pi.on("input", (event) => {
		const current = currentSessionRef.get();
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
		if (!targetsTrackedPlan) armReconciliation(reconcileDeps, current, ctx);
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
		const current = currentSessionRef.get();
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
			deps.persist(current);
		}
		beginReconciliation(reconcileDeps, current, ctx);
		current.runMode = current.selectedMode;
		if (announceFresh) armReconciliation(reconcileDeps, current, ctx);
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
			deps.persist(current);
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
		if (shortcutConfigWarning && !warningShownBox.shown && ctx.hasUI) {
			warningShownBox.shown = true;
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
			deps.persist(current);
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
		currentSessionRef.set(undefined);
	});
}
