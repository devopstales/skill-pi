import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  parseFrontmatter,
  type ExtensionAPI,
  type ExtensionContext,
  type SlashCommandInfo,
} from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

import { STATUS_REJECTED } from "./constants.js";
import type { DerivedSkillAllowState, Mode, ParsedRule, PermissionSettings, RuntimeSessionState } from "./models.js";
import { extractBashCommands } from "./bash-parser.js";
import { loadExtensionSettings, resolveProjectRoot } from "./project.js";
import { handleToolCallPermission, persistApprovalRules } from "./tool-call.js";

export { persistApprovalRules, getApprovalRules } from "./tool-call.js";

const EXTENSION = "permission";

const SessionStates = new Map<string, RuntimeSessionState>();

type LocalSkillScope = SlashCommandInfo["sourceInfo"]["scope"];
type LocalSkillCommandInfo = SlashCommandInfo & { source: "skill" };

const LOCAL_SKILL_SCOPES = new Set<LocalSkillScope>(["user", "project"]);

let cachedDerivedSkillAllowState: DerivedSkillAllowState | undefined;

export default function (pi: ExtensionAPI) {
  const initSettings = loadSettings(process.cwd());
  const keybindings = initSettings.keybindings ?? {};

  if (keybindings.autoAcceptEdits) {
    pi.registerShortcut(keybindings.autoAcceptEdits as KeyId, {
      description: "Toggle auto-accept edits",
      handler: toggleAutoAcceptEdits,
    });
  }

  pi.registerCommand("permission-toggle-auto-accept", {
    description: "Toggle auto-accept edits",
    handler: async (_args, ctx) => toggleAutoAcceptEdits(ctx),
  });

  pi.registerCommand("permission-settings", {
    description: "Show resolved permission settings",
    handler: async (_args, ctx) => {
      const sessionState = getSessionState(ctx);
      const derivedSkillAllowState = getDerivedSkillAllowState(pi);
      const persistedSettings = mergeSkillAllowRules(loadSettings(ctx.cwd), derivedSkillAllowState.rules);
      const overrides = Object.fromEntries(sessionState.modeOverrides);
      const sessionApprovedRules = Array.from(sessionState.approvalRules);
      const effectiveSettings = mergeSessionApprovalRules(persistedSettings, sessionApprovedRules);
      const output = JSON.stringify(
        {
          settings: persistedSettings,
          effectiveSettings,
          derivedSkillAllowRules: derivedSkillAllowState.rules,
          skillRuleSources: derivedSkillAllowState.sources,
          sessionApprovedRules,
          sessionOverrides: overrides,
        },
        null,
        2,
      );
      await ctx.ui.editor("Resolved permission settings", output);
    },
  });

  pi.on("session_start", async (_event, ctx) => {
    syncSessionStatus(ctx);
  });

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

    const outcome = await handleToolCallPermission(
      event.toolName,
      event.input as Record<string, unknown>,
      argValue,
      ctx,
      sessionState,
    );
    if (!outcome) return undefined;
    return { block: true, reason: outcome.reason };
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

function mergeSessionApprovalRules(settings: PermissionSettings, sessionRules: string[]): PermissionSettings {
  if (sessionRules.length === 0) return settings;

  return {
    ...settings,
    always: [...new Set([...(settings.always ?? []), ...sessionRules])],
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

function syncSessionStatus(ctx: ExtensionContext) {
  const sessionState = getSessionState(ctx);
  const autoAcceptEnabled =
    sessionState.modeOverrides.get("edit") === "allow" && sessionState.modeOverrides.get("write") === "allow";

  ctx.ui.setStatus("permission", autoAcceptEnabled ? "▶︎ Auto-accept edits" : undefined);
}

export function toggleAutoAcceptEdits(ctx: ExtensionContext) {
  const sessionState = getSessionState(ctx);
  const editCurrent = sessionState.modeOverrides.get("edit");
  const writeCurrent = sessionState.modeOverrides.get("write");

  if (editCurrent === "allow" && writeCurrent === "allow") {
    sessionState.modeOverrides.delete("edit");
    sessionState.modeOverrides.delete("write");
  } else {
    sessionState.modeOverrides.set("edit", "allow");
    sessionState.modeOverrides.set("write", "allow");
  }

  syncSessionStatus(ctx);
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

const ALLOW_BY_DEFAULT = new Set([
  "read",
  "glob",
  "grep",
  "ls",
  "fd",
  "rg",
  "find",
  "task",
  "skill",
]);

const ASK_BY_DEFAULT = new Set([
  "edit",
  "write",
  "bash",
  "webfetch",
  "websearch",
  "fetch",
]);

const PATH_TOOLS = new Set(["read", "edit", "write", "glob", "grep", "ls", "find"]);

function isEnvFile(pathValue: string): boolean {
  if (!pathValue) return false;
  const base = pathValue.split("/").pop() ?? pathValue;
  if (base.endsWith(".env.example")) return false;
  if (base === ".env" || base.startsWith(".env.")) return true;
  return /\b[^/]*\.env$/.test(base) || /\b[^/]*\.env\.[^/]+$/.test(base);
}

function isTempPath(resolved: string): boolean {
  const tmp = os.tmpdir();
  return (
    resolved === tmp ||
    resolved.startsWith(tmp + "/") ||
    resolved === "/tmp" ||
    resolved.startsWith("/tmp/") ||
    resolved === "/var/tmp" ||
    resolved.startsWith("/var/tmp/") ||
    resolved === "/private/tmp" ||
    resolved.startsWith("/private/tmp/")
  );
}

function isExternalPath(argValue: string): boolean {
  if (!argValue) return false;
  const resolved = path.isAbsolute(argValue) ? path.resolve(argValue) : path.resolve(process.cwd(), argValue);
  if (isTempPath(resolved)) return false;
  const projectRoot = resolveProjectRoot(process.cwd());
  return !(resolved === projectRoot || resolved.startsWith(projectRoot + "/"));
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

  if (settings.defaultMode) return settings.defaultMode;

  if (PATH_TOOLS.has(toolName) && isExternalPath(argValue)) return "ask";
  if (toolName === "read" && isEnvFile(argValue)) return "ask";
  if (ASK_BY_DEFAULT.has(toolName)) return "ask";
  if (ALLOW_BY_DEFAULT.has(toolName)) return "allow";

  return "ask";
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
