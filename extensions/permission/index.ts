import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  PERMISSION_CHOICES,
  PERMISSION_PROMPT_ALLOW_ALWAYS,
  PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION,
  PERMISSION_PROMPT_ALLOW_ONCE,
  PERMISSION_PROMPT_REJECT,
  PERMISSION_PROMPT_REJECT_WITH_FEEDBACK,
  STATUS_REJECTED,
  type PermissionPromptChoice,
} from "./constants.js";
import type { Mode, ParsedRule, PermissionSettings, RuntimeSessionState } from "./models.js";
import { extractBashCommands } from "./bash-parser.js";
import { loadExtensionSettings } from "./project.js";
import { buildHardRejectedReason } from "./rejection.js";
import { showPermissionReviewDialog } from "./review-dialog.js";
import {
  buildEditPermissionPreview,
  buildWritePermissionPreview,
  type PermissionEditPreviewInput,
  type PermissionReviewPreview,
  type PermissionWritePreviewInput,
} from "./review-preview.js";

const EXTENSION = "permission";

const SessionStates = new Map<string, RuntimeSessionState>();

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const settings = loadSettings(ctx.cwd);
    const sessionState = getSessionState(ctx);
    const argValue = getMatchValue(event.toolName, event.input as Record<string, unknown>) ?? "";
    const mode = await resolveMode(settings, event.toolName, argValue, sessionState);

    if (mode === "allow") {
      return undefined;
    }

    if (mode === "deny") {
      ctx.abort();
      return {
        block: true,
        reason: `${STATUS_REJECTED} Denied by permission settings (${event.toolName})`,
      };
    }

    if (!ctx.hasUI) {
      return {
        block: true,
        reason: `${STATUS_REJECTED} Blocked (no UI for confirmation): ${event.toolName}`,
      };
    }

    const promptResult = await promptForPermission(event.toolName, event.input as Record<string, unknown>, argValue, ctx);
    if (isAutomaticFeedbackRejection(promptResult)) {
      return {
        block: true,
        reason: promptResult.reason,
      };
    }
    if (promptResult === PERMISSION_PROMPT_ALLOW_ONCE) {
      return undefined;
    }
    ctx.abort();
    return {
      block: true,
      reason: buildHardRejectedReason(event.toolName, argValue),
    };
  });
}

function mergePermissions(base: Partial<PermissionSettings>, override: Partial<PermissionSettings>): Partial<PermissionSettings> {
  return {
    defaultMode: override.defaultMode ?? base.defaultMode,
    always: [...(base.always ?? []), ...(override.always ?? [])],
    allow: [...(base.allow ?? []), ...(override.allow ?? [])],
    deny: [...(base.deny ?? []), ...(override.deny ?? [])],
    ask: [...(base.ask ?? []), ...(override.ask ?? [])],
    keybindings: { ...base.keybindings, ...override.keybindings },
  };
}

export function loadSettings(cwd: string): Partial<PermissionSettings> {
  return loadExtensionSettings<PermissionSettings>(EXTENSION, cwd, mergePermissions);
}

function getSessionState(ctx: ExtensionContext): RuntimeSessionState {
  const sessionId = ctx.sessionManager.getSessionId();
  const existing = SessionStates.get(sessionId);
  if (existing) return existing;

  const state: RuntimeSessionState = {
    modeOverrides: new Map<string, Mode>(),
    approvalRules: new Set<string>(),
  };
  SessionStates.set(sessionId, state);
  return state;
}

export function parseRule(rule: string): ParsedRule {
  const match = rule.match(/^([^(]+)\((.+)\)$/);
  if (match) {
    return { toolPattern: match[1], argPattern: match[2] };
  }
  return { toolPattern: rule };
}

export function matchPattern(pattern: string, value: string): boolean {
  const wildcard = "__PI_PERMISSION_WILDCARD__";
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, wildcard);
  const adjusted = escaped
    .replace(new RegExp(` ${wildcard}$`), "(?: [\\s\\S]*)?")
    .replaceAll(wildcard, "[\\s\\S]*");
  return new RegExp(`^${adjusted}$`).test(value);
}

export function matchesAnyRule(rules: string[], toolName: string, argValue: string): boolean {
  return rules.some((rule) => {
    const parsed = parseRule(rule);
    if (!matchPattern(parsed.toolPattern, toolName)) return false;
    if (parsed.argPattern) return matchPattern(parsed.argPattern, argValue);
    return true;
  });
}

export function getMatchValue(tool: string, input: Record<string, unknown>): string | undefined {
  switch (tool) {
    case "bash":
      return input.command as string | undefined;
    case "edit":
    case "write":
    case "read":
      return input.path as string | undefined;
    case "fetch":
      return input.url as string | undefined;
    case "grep":
    case "find":
    case "ls":
      return (input.path as string | undefined) ?? "";
    default:
      return undefined;
  }
}

export function resolveSingleMode(
  settings: PermissionSettings,
  toolName: string,
  argValue: string,
  sessionState: RuntimeSessionState,
): Mode {
  const override = sessionState.modeOverrides.get(toolName);
  if (override) return override;

  if (matchesAnyRule(settings.deny ?? [], toolName, argValue)) return "deny";
  if (matchesAnyRule(settings.always ?? [], toolName, argValue)) return "allow";
  if (matchesAnyRule(Array.from(sessionState.approvalRules), toolName, argValue)) return "allow";
  if (matchesAnyRule(settings.ask ?? [], toolName, argValue)) return "ask";
  if (matchesAnyRule(settings.allow ?? [], toolName, argValue)) return "allow";

  return settings.defaultMode ?? "ask";
}

export async function resolveMode(
  settings: PermissionSettings,
  toolName: string,
  argValue: string,
  sessionState: RuntimeSessionState,
): Promise<Mode> {
  if (toolName !== "bash" || !argValue) {
    return resolveSingleMode(settings, toolName, argValue, sessionState);
  }

  const commands = await extractBashCommands(argValue);
  if (commands.length === 0) return "allow";

  let worst: Mode = "allow";

  for (const command of commands) {
    const mode = resolveSingleMode(settings, toolName, command.text, sessionState);
    if (mode === "deny") return "deny";
    if (mode === "ask") worst = "ask";
  }

  return worst;
}

type PermissionPromptResult = PermissionPromptChoice | undefined | AutomaticFeedbackRejection;

type AutomaticFeedbackRejection = {
  kind: "automatic-feedback-rejection";
  reason: string;
};

async function promptForPermission(
  toolName: string,
  input: Record<string, unknown>,
  argValue: string,
  ctx: ExtensionContext,
): Promise<PermissionPromptResult> {
  if (toolName === "edit") {
    const preview = await buildEditPermissionPreview(asEditToolInput(input), ctx.cwd);
    return asPromptResult(preview) ?? showPermissionReviewDialog(ctx, preview);
  }

  if (toolName === "write") {
    const preview = await buildWritePermissionPreview(asWriteToolInput(input), ctx.cwd);
    return asPromptResult(preview) ?? showPermissionReviewDialog(ctx, preview);
  }

  const details = argValue ?? JSON.stringify(input, null, 2);
  const title = `${toolName}\n\n${details}\n\nChoose permission:`;
  const choice = await ctx.ui.select(title, [...PERMISSION_CHOICES]);
  return isPermissionPromptChoice(choice) ? choice : undefined;
}

function asEditToolInput(input: Record<string, unknown>): PermissionEditPreviewInput {
  return {
    path: typeof input.path === "string" ? input.path : "",
    edits: Array.isArray(input.edits)
      ? input.edits
          .filter(
            (edit): edit is { oldText: string; newText: string } =>
              typeof edit === "object" &&
              edit !== null &&
              typeof edit.oldText === "string" &&
              typeof edit.newText === "string",
          )
          .map((edit) => ({ oldText: edit.oldText, newText: edit.newText }))
      : [],
  };
}

function asWriteToolInput(input: Record<string, unknown>): PermissionWritePreviewInput {
  return {
    path: typeof input.path === "string" ? input.path : "",
    content: typeof input.content === "string" ? input.content : "",
  };
}

function asPromptResult(preview: PermissionReviewPreview): AutomaticFeedbackRejection | undefined {
  if (preview.kind !== "error") return undefined;

  return {
    kind: "automatic-feedback-rejection",
    reason: preview.error,
  };
}

function isAutomaticFeedbackRejection(value: PermissionPromptResult): value is AutomaticFeedbackRejection {
  return typeof value === "object" && value !== null && value.kind === "automatic-feedback-rejection";
}

function isPermissionPromptChoice(value: string | undefined): value is PermissionPromptChoice {
  return (
    value === PERMISSION_PROMPT_ALLOW_ONCE ||
    value === PERMISSION_PROMPT_ALLOW_ALWAYS ||
    value === PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION ||
    value === PERMISSION_PROMPT_REJECT ||
    value === PERMISSION_PROMPT_REJECT_WITH_FEEDBACK
  );
}
