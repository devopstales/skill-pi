import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Markdown, Text } from "@earendil-works/pi-tui";
import { STATE_TYPE, type StoredState } from "./src/plan-state.ts";
import { SOURCE_TRANSFER_NOTICE } from "./src/handoff.ts";
import { PLAN_STEP_READY_ACKNOWLEDGEMENT, buildPlanReviewMessage, formatInstruction, formatModeStatus, VALIDATION_NOTICE_HEADING } from "./src/utils.ts";
import { TRANSCRIPT_PADDING } from "./src/tool-presentation.ts";
import { buildTheme } from "./src/theme.ts";
import { renderPlanCard } from "./src/card.ts";
import { invalidateSidebar } from "../skill-pi-tui/src/sidebar-layout.ts";
import { sidebarPart } from "../skill-pi-tui/src/sidebar.ts";
import type { PlanSession } from "./session-state.ts";

const STATUS_KEY = "skill-pi-plan-mode";
const PLAN_REVIEW_ENTRY_TYPE = "skill-pi-plan-review";
const MODE_NOTICE_ENTRY_TYPE = "skill-pi-plan-notice";
const PLAN_STEP_GUIDANCE_ENTRY_TYPE = "skill-pi-plan-step-guidance";
const VALIDATION_NOTICE_ENTRY_TYPE = "skill-pi-plan-validation-notice";
const FRESH_ANNOUNCEMENT_MESSAGE_TYPE = "skill-pi-plan-fresh-announcement";

export interface CardPart {
	render(width: number): string[];
	invalidate(): void;
	digest(): string;
	dispose(): void;
}

interface UiState {
	pi: ExtensionAPI;
	currentPlanTitle: (current: PlanSession) => string | undefined;
	makeCard: (current: PlanSession) => CardPart;
}

const uiState: Partial<UiState> = {};

export function registerUi(deps: UiState): void {
	Object.assign(uiState, deps);
	const { pi } = deps;

	pi.registerFlag("plan", { description: "Start in Plan mode", type: "boolean", default: false });
	pi.registerFlag("build", { description: "Start in Build mode", type: "boolean", default: false });

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
	pi.registerMessageRenderer<{ content?: unknown }>(FRESH_ANNOUNCEMENT_MESSAGE_TYPE, (message, options, theme) =>
		new Text(theme.fg("success", typeof message.content === "string" ? message.content : ""), options.outputPad, 0));
}

/** Composer status line: mode label, or the plan title when it is shown. */
export function updateStatusLine(current: PlanSession, ctx?: ExtensionContext): void {
	const target = ctx ?? current.currentContext;
	if (!target?.hasUI || !target.ui) return;
	const theme = buildTheme(target.ui.theme);
	const title = uiState.currentPlanTitle?.(current);
	const modeLabel = formatModeStatus(current.selectedMode, theme);
	const status = current.showPlanTitle && title ? theme.fg("warning", title) : modeLabel;
	target.ui.setStatus(STATUS_KEY, status);
}

/** Sidebar plan card: mounted only while a plan is attached. */
export function showCard(current: PlanSession, ctx?: ExtensionContext): void {
	if (current.tui) invalidateSidebar(current.tui);
	const target = ctx ?? current.currentContext;
	if (!target?.hasUI || !target.ui) return;
	current.ui = target.ui;
	if (current.plans.collection.attached === null) {
		target.ui.setWidget("skill-pi-plan", undefined);
		return;
	}
	target.ui.setWidget("skill-pi-plan", (tui) => {
		current.tui = tui;
		current.ui = target.ui;
		const snapshot = current;
		const empty = { render: () => [] as string[], invalidate() {} };
		return sidebarPart(tui, "plan", empty, uiState.makeCard!(snapshot));
	});
}
