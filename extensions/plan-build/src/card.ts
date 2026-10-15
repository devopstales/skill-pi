import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import { CARD_TONE, cardBottom, cardTop } from "../../skill-pi-tui/src/card.ts";
import type { PlanTheme } from "./theme.ts";
import type { PlanExecutionState, PlanStep } from "./plan-execution.ts";
import type { Mode, PlanLifecycle } from "./utils.ts";

export const PLAN_GLYPH = "◔";

export interface PlanCardModel {
	mode: Mode;
	plan?: PlanLifecycle;
	execution?: PlanExecutionState;
}

export interface PlanCardOptions {
	collapsed?: boolean;
}

const STEP_GLYPHS: Record<PlanStep["status"], string> = {
	pending: "○",
	ready: "▷",
	active: "▶",
	completed: "✓",
	skipped: "–",
};

export function planCardTone(model: PlanCardModel): typeof CARD_TONE.INFO | typeof CARD_TONE.WARNING {
	if (model.plan?.outcome?.kind === "awaiting_validation") return CARD_TONE.WARNING;
	if (model.execution?.status === "paused") return CARD_TONE.WARNING;
	return CARD_TONE.INFO;
}

export function planCardSummary(model: PlanCardModel): { title: string; subtitle: string } | undefined {
	const plan = model.plan;
	if (!plan || plan.status !== "open") return undefined;
	const title = plan.task?.title ?? "Untitled task";
	const execution = model.execution;
	if (execution && execution.status !== "completed") {
		const done = execution.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
		const status = execution.status === "paused" ? "paused" : "running";
		return { title, subtitle: `${done}/${execution.steps.length} · ${status}` };
	}
	const status = plan.outcome?.kind === "awaiting_validation" ? "awaiting validation" : model.mode;
	return { title, subtitle: status };
}

function stepRow(step: PlanStep, index: number, theme: PlanTheme): string {
	const glyph = theme.fg(stepGlyphRole(step.status), STEP_GLYPHS[step.status]);
	const prefix = `${glyph} ${index + 1}. `;
	const text = step.status === "completed" || step.status === "skipped" ? theme.fg("dim", step.text) : step.text;
	return `${prefix}${text}`;
}

function stepGlyphRole(status: PlanStep["status"]): "accent" | "success" | "muted" {
	if (status === "completed") return "success";
	if (status === "active" || status === "ready") return "accent";
	return "muted";
}

export function renderPlanCard(model: PlanCardModel, theme: PlanTheme, width: number, options: PlanCardOptions = {}): string[] {
	const summary = planCardSummary(model);
	if (!summary) return [];
	const tone = planCardTone(model);
	const inner = Math.max(1, width - 4);
	const body: string[] = [];

	if (options.collapsed) {
		const execution = model.execution;
		if (execution && execution.status !== "completed") {
			const done = execution.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
			body.push(theme.fg("muted", `${done}/${execution.steps.length} · ${execution.status}`));
		} else if (model.plan?.outcome?.kind === "awaiting_validation") {
			body.push(theme.fg("warning", "awaiting your validation"));
		} else {
			body.push(theme.fg("muted", model.plan?.task?.scope ?? ""));
		}
	} else if (model.execution && model.execution.status !== "completed") {
		model.execution.steps.forEach((step, index) => {
			body.push(stepRow(step, index, theme));
		});
	} else {
		const plan = model.plan!;
		if (plan.task?.scope) body.push(theme.fg("muted", plan.task.scope));
		if (plan.outcome) {
			body.push(theme.fg("accent", plan.outcome.kind.replaceAll("_", " ")));
			if (plan.outcome.reason) body.push(theme.fg("text", plan.outcome.reason));
			if (plan.outcome.kind === "awaiting_validation" && plan.outcome.userAction) body.push(theme.fg("accent", plan.outcome.userAction));
		}
	}

	const footerBits: string[] = [];
	if (model.execution && model.execution.status !== "completed") {
		const done = model.execution.steps.filter((step) => step.status === "completed" || step.status === "skipped").length;
		footerBits.push(`${done}/${model.execution.steps.length} · ${model.execution.status}`);
	} else if (model.plan?.outcome?.kind === "awaiting_validation") {
		footerBits.push(theme.fg("warning", "awaiting validation"));
	} else {
		footerBits.push(model.mode);
	}

	const wrapped = body.flatMap((line) => wrapTextWithAnsi(line, inner).map((wrapped) => padLine(wrapped, inner)));
	return [
		cardTop({ title: summary.title, subtitle: summary.subtitle, body: [], tone }, theme, width),
		...wrapped,
		cardBottom(tone, theme, width, truncateToWidth(footerBits.join(" · "), width, "…")),
	];
}

function padLine(line: string, inner: number): string {
	const clipped = truncateToWidth(line, inner, "…");
	const pad = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
	return `│ ${clipped}${pad} │`;
}
