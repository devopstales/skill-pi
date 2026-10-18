import type { ExtensionConfig, LspServerConfig } from "./types.ts";

const DEFAULT_LIMIT = 25;
const DEFAULT_MAX_LIMIT = 100;

/**
 * Validation and normalization of a single lsp.conf document. Split from
 * config.ts so the shape rules (which fields exist, which are strings / string
 * arrays, which enum values are legal) live in one place that config.ts
 * delegates to on every load.
 */

function stripJsonComments(text: string): string {
  return text.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every((entry) => typeof entry === "string");
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === "string")
  );
}

export function parseServerConfig(value: unknown, index: number): LspServerConfig {
  if (!value || typeof value !== "object") {
    throw new Error(`Invalid server config at index ${index}`);
  }
  const record = value as Record<string, unknown>;
  const command = record.command;
  if (!command || typeof command !== "object") {
    throw new Error(`Server ${index} is missing command`);
  }
  const commandRecord = command as Record<string, unknown>;
  if (
    typeof commandRecord.command !== "string" ||
    commandRecord.command.trim().length === 0
  ) {
    throw new Error(
      `Server ${index} command.command must be a non-empty string`,
    );
  }
  if (commandRecord.args !== undefined && !isStringArray(commandRecord.args)) {
    throw new Error(`Server ${index} command.args must be a string array`);
  }
  if (commandRecord.env !== undefined && !isStringRecord(commandRecord.env)) {
    throw new Error(`Server ${index} command.env must be an object of strings`);
  }
  if (record.id !== undefined && typeof record.id !== "string") {
    throw new Error(`Server ${index} id must be a string`);
  }
  if (record.name !== undefined && typeof record.name !== "string") {
    throw new Error(`Server ${index} name must be a string`);
  }
  if (record.languages !== undefined && !isStringArray(record.languages)) {
    throw new Error(`Server ${index} languages must be a string array`);
  }
  if (record.fileGlobs !== undefined && !isStringArray(record.fileGlobs)) {
    throw new Error(`Server ${index} fileGlobs must be a string array`);
  }
  if (record.rootMarkers !== undefined && !isStringArray(record.rootMarkers)) {
    throw new Error(`Server ${index} rootMarkers must be a string array`);
  }
  if (
    record.treeSitterLanguage !== undefined &&
    typeof record.treeSitterLanguage !== "string"
  ) {
    throw new Error(`Server ${index} treeSitterLanguage must be a string`);
  }
  if (
    record.trace !== undefined &&
    record.trace !== "off" &&
    record.trace !== "messages" &&
    record.trace !== "verbose"
  ) {
    throw new Error(
      `Server ${index} trace must be one of off, messages, verbose`,
    );
  }
  return {
    id: typeof record.id === "string" ? record.id : `server-${index + 1}`,
    name: typeof record.name === "string" ? record.name : undefined,
    languages: isStringArray(record.languages) ? record.languages : undefined,
    fileGlobs: isStringArray(record.fileGlobs) ? record.fileGlobs : undefined,
    rootMarkers: isStringArray(record.rootMarkers)
      ? record.rootMarkers
      : undefined,
    command: {
      command: commandRecord.command,
      args: isStringArray(commandRecord.args) ? commandRecord.args : undefined,
      env: isStringRecord(commandRecord.env) ? commandRecord.env : undefined,
    },
    initializationOptions: record.initializationOptions,
    trace: record.trace as "off" | "messages" | "verbose" | undefined,
    treeSitterLanguage:
      typeof record.treeSitterLanguage === "string"
        ? record.treeSitterLanguage
        : undefined,
  };
}

/**
 * Parse and validate a full lsp.conf JSONC document into an ExtensionConfig.
 * Throws when the `servers` array is missing or empty, or when any server
 * entry fails validation.
 */
export function parseConfigDocument(
  text: string,
  label: string,
): ExtensionConfig {
  const parsed = JSON.parse(stripJsonComments(text)) as Record<string, unknown>;
  const serversValue = parsed.servers;
  if (!Array.isArray(serversValue) || serversValue.length === 0) {
    throw new Error(
      `${label} must define a non-empty servers array`,
    );
  }
  const servers = serversValue.map((entry, index) =>
    parseServerConfig(entry, index),
  );
  const defaultLimit =
    typeof parsed.defaultLimit === "number"
      ? parsed.defaultLimit
      : DEFAULT_LIMIT;
  const maxLimit =
    typeof parsed.maxLimit === "number" ? parsed.maxLimit : DEFAULT_MAX_LIMIT;
  const eagerInit = parsed.eagerInit === true;
  return { servers, defaultLimit, maxLimit, eagerInit };
}

export { DEFAULT_LIMIT, DEFAULT_MAX_LIMIT };
