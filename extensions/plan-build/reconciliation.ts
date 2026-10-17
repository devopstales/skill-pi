import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { PlanSession } from "./session-state.ts";

export interface ReconciliationDeps {
	currentPlanPath: (current: PlanSession) => string;
	inspectPlanFileState: (file: string) => PlanSession["savedPlanState"];
}

/** Pure reconciliation state transitions; shared by the event hooks, state restore, and tools. */
export function resetReconciliation(current: PlanSession, sequence: number | null, sessionId: string, consumed = false): void {
	current.activeReconciliationId = undefined;
	current.reconciliationFollowUp = false;
	current.reconciliation = sequence === null ? undefined : {
		sequence, sessionId, consumed, eligible: false, handled: false, failed: false, terminal: false,
	};
}

export function beginReconciliation(deps: ReconciliationDeps, current: PlanSession, ctx: ExtensionContext): void {
	if (current.reconciliationFollowUp) current.reconciliationFollowUp = false;
	else resetReconciliation(current, current.plans.collection.attached, ctx.sessionManager.getSessionId()!);
}

export function armReconciliation(deps: ReconciliationDeps, current: PlanSession, ctx: ExtensionContext): void {
	if ((current.runMode ?? current.selectedMode) !== "build" || current.plans.collection.attached === null || current.plans.execution || deps.inspectPlanFileState(deps.currentPlanPath(current)) !== "saved") return;
	if (current.plans.plan.outcome?.kind === "awaiting_validation") return;
	if (!current.reconciliation || current.reconciliation.sequence !== current.plans.collection.attached || current.reconciliation.sessionId !== ctx.sessionManager.getSessionId()) {
		resetReconciliation(current, current.plans.collection.attached, ctx.sessionManager.getSessionId()!);
	}
	if (current.reconciliation!.consumed || current.reconciliation!.handled) return;
	current.reconciliation!.eligible = true;
}

/** Show plan Markdown through the RPC notify channel or a transcript inspection entry. */
export function displayInspection(deps: { appendInspection: (markdown: string) => void }, ctx: ExtensionContext, markdown: string): void {
	if (ctx.mode === "rpc") ctx.ui.notify(markdown, "info");
	else deps.appendInspection(markdown);
}
