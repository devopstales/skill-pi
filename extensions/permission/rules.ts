import * as os from "node:os";
import * as path from "node:path";

import {
  type DerivedExtensionAllowState,
  type Mode,
  type ParsedRule,
  type PermissionSettings,
  type RuntimeSessionState,
} from "./models.js";
import { extractBashCommands } from "./bash-parser.js";
import { resolveProjectRoot } from "./project.js";

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
  extensionAllow: DerivedExtensionAllowState = { cacheKey: "", tools: [] },
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

  if (extensionAllow.tools.includes(toolName)) return "allow";

  return "ask";
}

export async function resolveMode(
  settings: PermissionSettings,
  toolName: string,
  argValue: string,
  sessionState: RuntimeSessionState,
  extensionAllow: DerivedExtensionAllowState = { cacheKey: "", tools: [] },
): Promise<Mode> {
  if (toolName !== "bash" || !argValue) {
    return resolveSingleMode(settings, toolName, argValue, sessionState, extensionAllow);
  }

  const commands = await extractBashCommands(argValue);
  if (commands.length === 0) return "allow";

  let worst: Mode = "allow";

  for (const command of commands) {
    const mode = resolveSingleMode(settings, toolName, command.text, sessionState, extensionAllow);
    if (mode === "deny") return "deny";
    if (mode === "ask") worst = "ask";
  }

  return worst;
}
