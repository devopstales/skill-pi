import * as fs from "node:fs";

import {
  parseFrontmatter,
  type ExtensionAPI,
  type ExtensionContext,
  type SlashCommandInfo,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import type { KeyId } from "@earendil-works/pi-tui";

import { STATUS_REJECTED } from "./constants.js";
import type {
  DerivedExtensionAllowState,
  DerivedSkillAllowState,
  Mode,
  PermissionSettings,
  RuntimeSessionState,
} from "./models.js";
import { loadExtensionSettings } from "./project.js";
import { handleToolCallPermission, persistApprovalRules } from "./tool-call.js";
import { getMatchValue, resolveMode } from "./rules.js";

export { persistApprovalRules, getApprovalRules } from "./tool-call.js";
export {
  parseRule,
  matchPattern,
  matchesAnyRule,
  getMatchValue,
  resolveSingleMode,
  resolveMode,
} from "./rules.js";

const EXTENSION = "permission";

const SessionStates = new Map<string, RuntimeSessionState>();

type LocalSkillScope = SlashCommandInfo["sourceInfo"]["scope"];
type LocalSkillCommandInfo = SlashCommandInfo & { source: "skill" };

const LOCAL_SKILL_SCOPES = new Set<LocalSkillScope>(["user", "project"]);

let cachedDerivedSkillAllowState: DerivedSkillAllowState | undefined;
let cachedDerivedExtensionAllowState: DerivedExtensionAllowState | undefined;

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
      const derivedExtensionAllowState = getDerivedExtensionAllowState(pi);
      const output = JSON.stringify(
        {
          settings: persistedSettings,
          effectiveSettings,
          derivedSkillAllowRules: derivedSkillAllowState.rules,
          skillRuleSources: derivedSkillAllowState.sources,
          derivedExtensionAllowTools: derivedExtensionAllowState.tools,
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
    const derivedExtensionAllowState = getDerivedExtensionAllowState(pi);
    const settings = mergeSkillAllowRules(loadSettings(ctx.cwd), derivedSkillAllowState.rules);
    const argValue = getMatchValue(event.toolName, event.input as Record<string, unknown>) ?? "";
    const mode = await resolveMode(settings, event.toolName, argValue, sessionState, derivedExtensionAllowState);

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

function isSyntheticToolPath(pathValue: string): boolean {
  return typeof pathValue !== "string" || !pathValue.startsWith("/");
}

function buildExtensionAllowCacheKey(tools: ToolInfo[]): string {
  return tools
    .map((tool) => `${tool.name}:${tool.sourceInfo.path}:${tool.namespace?.name ?? ""}`)
    .sort()
    .join("\n");
}

export function getDerivedExtensionAllowState(pi: ExtensionAPI): DerivedExtensionAllowState {
  const tools = pi
    .getAllTools()
    .filter((tool) => !tool.namespace && !isSyntheticToolPath(tool.sourceInfo.path))
    .sort((a, b) => a.name.localeCompare(b.name));

  const cacheKey = buildExtensionAllowCacheKey(tools);
  if (cachedDerivedExtensionAllowState && cachedDerivedExtensionAllowState.cacheKey === cacheKey) {
    return cachedDerivedExtensionAllowState;
  }

  cachedDerivedExtensionAllowState = {
    cacheKey,
    tools: [...new Set(tools.map((tool) => tool.name))],
  };
  return cachedDerivedExtensionAllowState;
}

export function resetDerivedExtensionAllowStateCacheForTest(): void {
  cachedDerivedExtensionAllowState = undefined;
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


