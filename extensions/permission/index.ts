import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import {
  parseFrontmatter,
  type ExtensionAPI,
  type ExtensionContext,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";

import {
  APPROVAL_CONFIRM_APPROVE,
  APPROVAL_CONFIRM_BACK,
  APPROVAL_CONFIRM_CHOICES,
  APPROVAL_CONFIRM_REJECT,
  FEEDBACK_PLACEHOLDER,
  PERMISSION_CHOICES,
  PERMISSION_PROMPT_ALLOW_ALWAYS,
  PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION,
  PERMISSION_PROMPT_ALLOW_ONCE,
  PERMISSION_PROMPT_REJECT,
  PERMISSION_PROMPT_REJECT_WITH_FEEDBACK,
  STATUS_REJECTED,
  type PermissionPromptChoice,
} from "./constants.js";
import type { DerivedSkillAllowState, Mode, ParsedRule, PermissionSettings, RuntimeSessionState } from "./models.js";
import { BashArity } from "./bash-arity.js";
import { extractBashCommands } from "./bash-parser.js";
import { getExtensionSettingsPaths, loadExtensionSettings, resolveProjectConfDir } from "./project.js";
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

const SessionStates = new Map<string, RuntimeSessionState>();

type LocalSkillScope = SlashCommandInfo["sourceInfo"]["scope"];
type LocalSkillCommandInfo = SlashCommandInfo & { source: "skill" };

const LOCAL_SKILL_SCOPES = new Set<LocalSkillScope>(["user", "project"]);

let cachedDerivedSkillAllowState: DerivedSkillAllowState | undefined;

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    const sessionState = getSessionState(ctx);
    const derivedSkillAllowState = getDerivedSkillAllowState(pi);
    const settings = mergeSkillAllowRules(loadSettings(ctx.cwd), derivedSkillAllowState.rules);
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

    while (true) {
      const promptResult = await promptForPermission(event.toolName, event.input as Record<string, unknown>, argValue, ctx);
      if (isAutomaticFeedbackRejection(promptResult)) {
        return {
          block: true,
          reason: promptResult.reason,
        };
      }

      if (promptResult === undefined) {
        ctx.abort();
        return {
          block: true,
          reason: buildHardRejectedReason(event.toolName, argValue),
        };
      }

      if (promptResult === PERMISSION_PROMPT_ALLOW_ONCE) {
        return undefined;
      }

      if (promptResult === PERMISSION_PROMPT_ALLOW_ALWAYS) {
        const alwaysRules = await getApprovalRules(event.toolName, argValue);
        const settingsPath = getPersistentApprovalSettingsPath(ctx.cwd);
        const confirmation = await confirmApprovalRules(ctx, event.toolName, alwaysRules, {
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
            event.toolName,
            argValue,
          );
          if (rejection.kind === "back") {
            continue;
          }
          ctx.abort();
          return {
            block: true,
            reason: rejection.reason,
          };
        }
      }

      if (promptResult === PERMISSION_PROMPT_ALLOW_ALWAYS_FOR_SESSION) {
        const sessionRules = await getApprovalRules(event.toolName, argValue);
        const confirmation = await confirmApprovalRules(ctx, event.toolName, sessionRules, { scope: "session" });

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
            event.toolName,
            argValue,
          );
          if (rejection.kind === "back") {
            continue;
          }
          ctx.abort();
          return {
            block: true,
            reason: rejection.reason,
          };
        }
      }

      const rejection = await resolvePermissionRejection(ctx, promptResult, event.toolName, argValue);
      if (rejection.kind === "back") {
        continue;
      }
      if (rejection.kind === "hard") {
        ctx.abort();
      }
      return {
        block: true,
        reason: rejection.reason,
      };
    }
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

export function getSkillAllowedRules(skillPath: string): string[] {
  try {
    const content = fs.readFileSync(skillPath, "utf-8");
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    return [...parseRuleList(frontmatter.allowed_tools), ...parseRuleList(frontmatter["allowed-tools"])];
  } catch {
    return [];
  }
}

function buildSkillAllowCacheKey(skills: LocalSkillCommandInfo[]): string {
  return skills
    .map((skill) => {
      const skillPath = skill.sourceInfo.path;
      let stamp = "missing";

      if (skillPath) {
        try {
          const stat = fs.statSync(skillPath);
          stamp = `${stat.mtimeMs}:${stat.size}`;
        } catch {
          stamp = "missing";
        }
      }

      return `${skill.sourceInfo.scope}:${skillPath}:${stamp}`;
    })
    .sort()
    .join("\n");
}

function isLocalSkillCommand(command: SlashCommandInfo): command is LocalSkillCommandInfo {
  return command.source === "skill" && LOCAL_SKILL_SCOPES.has(command.sourceInfo.scope);
}

export function getDerivedSkillAllowState(pi: ExtensionAPI): DerivedSkillAllowState {
  const rawCommands = pi.getCommands();
  const skills = rawCommands
    .filter(isLocalSkillCommand)
    .sort((a, b) => a.sourceInfo.path.localeCompare(b.sourceInfo.path));

  const cacheKey = buildSkillAllowCacheKey(skills);
  if (cachedDerivedSkillAllowState && cachedDerivedSkillAllowState.cacheKey === cacheKey) {
    return cachedDerivedSkillAllowState;
  }

  const sources = skills
    .map((skill) => {
      const rules = getSkillAllowedRules(skill.sourceInfo.path);
      return {
        skill: skill.name.replace(/^skill:/, ""),
        location: skill.sourceInfo.scope,
        path: skill.sourceInfo.path,
        rules,
      };
    })
    .filter((skill) => skill.rules.length > 0);

  cachedDerivedSkillAllowState = {
    cacheKey,
    rules: [...new Set(sources.flatMap((skill) => skill.rules))],
    sources,
  };
  return cachedDerivedSkillAllowState;
}

function mergeSkillAllowRules(settings: PermissionSettings, skillRules: string[]): PermissionSettings {
  if (skillRules.length === 0) return settings;

  return {
    ...settings,
    allow: [...new Set([...(settings.allow ?? []), ...skillRules])],
  };
}

export function resetDerivedSkillAllowStateCacheForTest(): void {
  cachedDerivedSkillAllowState = undefined;
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

async function getApprovalRules(toolName: string, argValue: string): Promise<string[]> {
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
    const nextSettings: PermissionSettings = {
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

async function writeOwnSettingsFileAtomic(settingsPath: string, settings: PermissionSettings): Promise<void> {
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

async function loadOwnSettingsFile(settingsPath: string): Promise<PermissionSettings> {
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
    return JSON.parse(raw) as PermissionSettings;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid JSON in ${settingsPath}: ${message}`);
  }
}

function getPersistentApprovalErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not save persistent approval rules: ${message}`;
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
