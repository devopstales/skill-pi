import * as fsp from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  APPROVAL_CONFIRM_APPROVE,
  APPROVAL_CONFIRM_BACK,
  APPROVAL_CONFIRM_CHOICES,
  APPROVAL_CONFIRM_REJECT,
  PERMISSION_CHOICES,
  PERMISSION_PROMPT_ALLOW_ALWAYS,
  PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION,
  PERMISSION_PROMPT_ALLOW_ONCE,
  PERMISSION_PROMPT_REJECT,
  PERMISSION_PROMPT_REJECT_WITH_FEEDBACK,
  STATUS_REJECTED,
  type PermissionPromptChoice,
} from "./constants.js";
import type { RuntimeSessionState } from "./models.js";
import { BashArity } from "./bash-arity.js";
import { extractBashCommands } from "./bash-parser.js";
import { getExtensionSettingsPaths, resolveProjectConfDir } from "./project.js";
import { buildHardRejectedReason, resolvePermissionRejection } from "./rejection.js";
import { showPermissionReviewDialog } from "./review-dialog.js";
import {
  buildEditPermissionPreview,
  buildWritePermissionPreview,
  type PermissionEditPreviewInput,
  type PermissionReviewPreview,
  type PermissionWritePreviewInput,
} from "./review-preview.js";

const EXTENSION = "permission";
const PERSISTENT_APPROVAL_LOCK_RETRY_MS = 50;
const PERSISTENT_APPROVAL_LOCK_TIMEOUT_MS = 5_000;
const PERSISTENT_APPROVAL_LOCK_STALE_MS = 30_000;

export interface PermissionOutcome {
  block: boolean;
  reason?: string;
}

export async function handleToolCallPermission(
  toolName: string,
  input: Record<string, unknown>,
  argValue: string,
  ctx: ExtensionContext,
  sessionState: RuntimeSessionState,
): Promise<PermissionOutcome | undefined> {
  if (!ctx.hasUI) {
    return {
      block: true,
      reason: `${STATUS_REJECTED} Blocked (no UI for confirmation): ${toolName}`,
    };
  }

  while (true) {
    const promptResult = await promptForPermission(toolName, input, argValue, ctx);
    if (isAutomaticFeedbackRejection(promptResult)) {
      return { block: true, reason: promptResult.reason };
    }

    if (promptResult === undefined) {
      ctx.abort();
      return { block: true, reason: buildHardRejectedReason(toolName, argValue) };
    }

    if (promptResult === PERMISSION_PROMPT_ALLOW_ONCE) {
      return undefined;
    }

    if (promptResult === PERMISSION_PROMPT_ALLOW_ALWAYS) {
      const alwaysRules = await getApprovalRules(toolName, argValue);
      const settingsPath = getPersistentApprovalSettingsPath(ctx.cwd);
      const confirmation = await confirmApprovalRules(ctx, toolName, alwaysRules, {
        scope: "persistent",
        settingsPath,
      });

      if (confirmation === "approved") {
        try {
          const result = await persistApprovalRules(ctx.cwd, alwaysRules);
          const action = result.added.length === 0 ? "Already saved" : "Saved";
          ctx.ui.notify(
            `${action} persistent approval rule${alwaysRules.length === 1 ? "" : "s"} in ${result.settingsPath}: ${alwaysRules.join(", ")}`,
            "info",
          );
          ctx.ui.notify(
            "No reload needed for permission rules — they are re-read on the next tool call.",
            "info",
          );
          return undefined;
        } catch (error) {
          ctx.ui.notify(getPersistentApprovalErrorMessage(error), "error");
          continue;
        }
      }

      if (confirmation === "back") {
        continue;
      }

      if (confirmation === "reject") {
        const rejection = await resolvePermissionRejection(
          ctx,
          PERMISSION_PROMPT_REJECT,
          toolName,
          argValue,
        );
        if (rejection.kind === "back") {
          continue;
        }
        ctx.abort();
        return { block: true, reason: rejection.reason };
      }
    }

    if (promptResult === PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION) {
      const sessionRules = await getApprovalRules(toolName, argValue);
      const confirmation = await confirmApprovalRules(ctx, toolName, sessionRules, { scope: "session" });

      if (confirmation === "approved") {
        for (const rule of sessionRules) {
          sessionState.approvalRules.add(rule);
        }
        ctx.ui.notify(
          `Added session approval rule${sessionRules.length === 1 ? "" : "s"}: ${sessionRules.join(", ")}`,
          "info",
        );
        return undefined;
      }

      if (confirmation === "back") {
        continue;
      }

      if (confirmation === "reject") {
        const rejection = await resolvePermissionRejection(
          ctx,
          PERMISSION_PROMPT_REJECT,
          toolName,
          argValue,
        );
        if (rejection.kind === "back") {
          continue;
        }
        ctx.abort();
        return { block: true, reason: rejection.reason };
      }
    }

    const rejection = await resolvePermissionRejection(ctx, promptResult, toolName, argValue);
    if (rejection.kind === "back") {
      continue;
    }
    if (rejection.kind === "hard") {
      ctx.abort();
    }
    return { block: true, reason: rejection.reason };
  }
}

export async function getApprovalRules(toolName: string, argValue: string): Promise<string[]> {
  if (toolName === "bash") {
    const commands = await extractBashCommands(argValue);
    return [
      ...new Set(
        commands
          .map((command) => getBashAlwaysPattern(command.tokens))
          .filter((rule): rule is string => Boolean(rule)),
      ),
    ];
  }

  return [toolName];
}

function getBashAlwaysPattern(tokens: string[]): string | undefined {
  const prefix = BashArity.prefix(tokens);
  if (prefix.length === 0) return undefined;
  return `bash(${prefix.join(" ")} *)`;
}

function getPersistentApprovalSettingsPath(cwd: string): string {
  return getExtensionSettingsPaths(EXTENSION, cwd).project;
}

type PersistApprovalRulesResult = {
  settingsPath: string;
  added: string[];
};

export async function persistApprovalRules(cwd: string, rules: string[]): Promise<PersistApprovalRulesResult> {
  const settingsPath = getPersistentApprovalSettingsPath(cwd);
  await fsp.mkdir(resolveProjectConfDir(cwd), { recursive: true });

  return withPersistentApprovalLock(settingsPath, async () => {
    const existing = await loadOwnSettingsFile(settingsPath);
    const currentAlways = parseRuleList(existing.always);
    const nextAlways = [...new Set([...currentAlways, ...rules])];
    const added = rules.filter((rule) => !currentAlways.includes(rule));
    const nextSettings = {
      ...existing,
      always: nextAlways,
    };

    await writeOwnSettingsFileAtomic(settingsPath, nextSettings);

    return {
      settingsPath,
      added,
    };
  });
}

async function withPersistentApprovalLock<T>(settingsPath: string, action: () => Promise<T> | T): Promise<T> {
  const lockPath = `${settingsPath}.lock`;
  const start = Date.now();

  while (true) {
    let lockHandle: FileHandle | undefined;

    try {
      lockHandle = await fsp.open(lockPath, "wx");
      return await action();
    } catch (error) {
      if (!isErrnoCode(error, "EEXIST")) {
        throw error;
      }

      if (await isStalePersistentApprovalLock(lockPath)) {
        try {
          await fsp.unlink(lockPath);
          continue;
        } catch (unlinkError) {
          if (!isErrnoCode(unlinkError, "ENOENT")) {
            throw unlinkError;
          }
        }
      }

      if (Date.now() - start >= PERSISTENT_APPROVAL_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting to update ${settingsPath} because another approval save is still in progress`);
      }

      await delay(PERSISTENT_APPROVAL_LOCK_RETRY_MS);
    } finally {
      if (lockHandle) {
        await lockHandle.close();
        try {
          await fsp.unlink(lockPath);
        } catch (unlinkError) {
          if (!isErrnoCode(unlinkError, "ENOENT")) {
            throw unlinkError;
          }
        }
      }
    }
  }
}

async function isStalePersistentApprovalLock(lockPath: string): Promise<boolean> {
  try {
    return Date.now() - (await fsp.stat(lockPath)).mtimeMs >= PERSISTENT_APPROVAL_LOCK_STALE_MS;
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return false;
    }
    throw error;
  }
}

async function writeOwnSettingsFileAtomic(settingsPath: string, settings: Record<string, unknown>): Promise<void> {
  const tempPath = `${settingsPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await fsp.writeFile(tempPath, `${JSON.stringify(settings, null, 4)}\n`, "utf-8");
    await fsp.rename(tempPath, settingsPath);
  } catch (error) {
    try {
      await fsp.unlink(tempPath);
    } catch (unlinkError) {
      if (!isErrnoCode(unlinkError, "ENOENT")) {
        throw unlinkError;
      }
    }
    throw error;
  }
}

function isErrnoCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadOwnSettingsFile(settingsPath: string): Promise<Record<string, unknown>> {
  let raw: string;

  try {
    raw = await fsp.readFile(settingsPath, "utf-8");
  } catch (error) {
    if (isErrnoCode(error, "ENOENT")) {
      return {};
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${settingsPath}: ${message}`);
  }
}

function parseRuleList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }

  return [];
}

function getPersistentApprovalErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not save persistent approval rules: ${message}`;
}

type ConfirmApprovalRulesOptions =
  | {
      scope: "persistent";
      settingsPath: string;
    }
  | {
      scope: "session";
    };

async function confirmApprovalRules(
  ctx: ExtensionContext,
  toolName: string,
  rules: string[],
  options: ConfirmApprovalRulesOptions,
): Promise<"approved" | "back" | "reject"> {
  if (rules.length === 0) {
    const scopeLabel = options.scope === "persistent" ? "persistent" : "session";
    ctx.ui.notify(`Could not derive a ${scopeLabel} approval rule for ${toolName}`, "error");
    return "back";
  }

  const suffix = rules.length === 1 ? "rule" : "rules";
  const message =
    options.scope === "persistent"
      ? `Allow always will save the following ${suffix} to:\n\n${options.settingsPath}\n\n${rules
          .map((rule) => `- ${rule}`)
          .join("\n")}`
      : `Allow always for this session will add the following ${suffix}:\n\n${rules
          .map((rule) => `- ${rule}`)
          .join("\n")}`;

  const choice = await ctx.ui.select(message, [...APPROVAL_CONFIRM_CHOICES]);
  if (choice === APPROVAL_CONFIRM_APPROVE) return "approved";
  if (choice === APPROVAL_CONFIRM_REJECT) return "reject";
  if (choice === APPROVAL_CONFIRM_BACK) return "back";
  return "back";
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
