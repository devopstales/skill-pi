import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import type { PlanState } from "./src/plan-state.ts";
import type { ApprovedHandoff } from "./src/handoff.ts";
import type { Mode } from "./src/utils.ts";

export interface PlanSession {
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
