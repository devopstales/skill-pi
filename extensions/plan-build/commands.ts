import fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { startFreshHandoff } from "./src/handoff.ts";
import {
	loadShortcutConfig,
	saveDefaultMode,
	saveShortcutPreset,
	saveShowPlanTitle,
	saveStableToolCatalog,
	SHORTCUT_PRESETS,
	shortcutPresetLabel,
} from "./src/shortcut-config.ts";
import type { Mode } from "./src/utils.ts";
import { displayInspection } from "./reconciliation.ts";
import type { PlanSession } from "./session-state.ts";

export interface CommandDeps {
	pi: ExtensionAPI;
	sessions: Map<string, PlanSession>;
	session: (ctx: ExtensionContext) => PlanSession;
	currentPlanPath: (current: PlanSession) => string;
	planPathFor: (sequence: number, ctx: ExtensionContext) => string;
	inspectPlanFileState: (file: string) => PlanSession["savedPlanState"];
	selectMode: (mode: Mode, current: PlanSession, ctx: ExtensionContext, source: "manual" | "tool") => Promise<void>;
	applyTools: (current: PlanSession, mode: Mode) => void;
	ensurePlanDirectory: () => Promise<void>;
	updateStatusLine: (current: PlanSession, ctx?: ExtensionContext) => void;
	abandonCurrentPlan: (current: PlanSession, reason: string, ctx: ExtensionContext) => string;
	startNewPlan: (current: PlanSession, ctx: ExtensionContext) => void;
	completeCurrentPlan: (current: PlanSession, summary?: string) => void;
	planInventory: (current: PlanSession) => string;
	shorten: (filePath: string, cwd: string) => string;
	agentDir: string;
	shortcutConfig: ReturnType<typeof loadShortcutConfig>["config"];
	shortcutConfigPath: string;
}

const appendInspection = (pi: ExtensionAPI) => (markdown: string) => pi.appendEntry("skill-pi-plan-inspection", { markdown });

export function registerCommands(deps: CommandDeps): void {
	const { pi, session, currentPlanPath, planPathFor, inspectPlanFileState, selectMode, applyTools, ensurePlanDirectory, updateStatusLine, abandonCurrentPlan, startNewPlan, completeCurrentPlan, planInventory, shorten, agentDir, shortcutConfig, shortcutConfigPath } = deps;
	const inspect = { appendInspection: appendInspection(pi) };

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
						displayInspection(inspect, ctx, records.length ? records.map(({ plan }) => {
							const detail = plan.status === "transferred" ? "Implementation transferred to a linked session." : plan.abandonReason ?? plan.completionSummary ?? "No completion summary recorded.";
							return `## ${plan.sequence}: ${plan.task?.title ?? "Untitled task"}\n\n${plan.status}\n\n${planPathFor(plan.sequence, ctx)}\n\n${detail}`;
						}).join("\n\n") : "No completed, abandoned, or transferred plans on this session branch.");
					} else if (!current.plans.attached) displayInspection(inspect, ctx, "Current plan: none.");
					else {
						const file = currentPlanPath(current);
						let markdown = "";
						let fileState = inspectPlanFileState(file);
						try { markdown = await fs.promises.readFile(file, "utf8"); }
						catch { if (fileState !== "absent") fileState = "unavailable"; }
						const progress = current.plans.execution ? `\n\nExecution: ${current.plans.execution.status}\n${current.plans.execution.steps.map((step, i) => `${i + 1}. [${step.status}] ${step.text}`).join("\n")}\n\nSay ‘Proceed’ to start a ready step; pause/resume or revise through ordinary prompts.` : "";
						const outcome = current.plans.plan.outcome;
						displayInspection(inspect, ctx, `# ${current.plans.plan.task?.title ?? "Untitled task"}\n\n${file} (${fileState})${progress}${outcome ? `\n\n${outcome.reason}\n${outcome.userAction ?? ""}` : ""}\n\n${markdown}`);
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
					for (const value of deps.sessions.values()) value.showPlanTitle = enabled;
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
					for (const value of deps.sessions.values()) value.stableToolCatalog = enabled;
					current.stableToolCatalog = enabled;
					if (ctx.isIdle()) applyTools(current, current.runMode ?? current.selectedMode);
					ctx.ui.notify(`Stable tool catalog ${enabled ? "on" : "off"}.`, "info");
				} catch (error) {
					ctx.ui.notify(`Could not save ${shortcutConfigPath}: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}
			const shortcutSelection = await ctx.ui.select(
				`Plan/Build shortcuts — active: ${shortcutPresetLabel(shortcutConfig)} (plan: ${shortcutConfig.planMode.join(", ") || "none"}, build: ${shortcutConfig.buildMode.join(", ") || "none"})`,
				[...Object.keys(SHORTCUT_PRESETS), customOption],
			);
			if (!shortcutSelection) return;
			if (shortcutSelection === customOption) {
				ctx.ui.notify(
					`Edit ${shortcutConfigPath}, then run /reload. Example: {"showPlanTitle":true,"shortcuts":{"planMode":["p"],"buildMode":["b"]}}. Keys are the second key of the Ctrl+Q leader. Use [] to disable.`,
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
}
