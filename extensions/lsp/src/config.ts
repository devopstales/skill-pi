import { execFileSync } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync } from "node:fs";
import { dirname, extname, join, resolve } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { minimatch } from "minimatch";
import type {
  ExtensionConfig,
  LspServerConfig,
  WorkspaceMatch,
} from "./types.ts";
import {
  DEFAULT_LIMIT,
  DEFAULT_MAX_LIMIT,
  parseConfigDocument,
} from "./config-validate.ts";

const CONFIG_FILE = "lsp.conf";

// ADR 0008 conf.d contract: user scope derives from the host's agent home
// (dirname(getAgentDir())), project scope lives under <git-root>/.skill-pi/conf.d.
// The same code resolves to the right home under stock pi and skill-pi.
export function userConfPath(): string {
  return join(dirname(getAgentDir()), "conf.d", CONFIG_FILE);
}

export function resolveProjectRoot(cwd: string): string {
  try {
    const out = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out ? resolve(out) : resolve(cwd);
  } catch {
    return resolve(cwd);
  }
}

export function projectConfPath(cwd: string): string {
  return join(resolveProjectRoot(cwd), ".skill-pi", "conf.d", CONFIG_FILE);
}

export interface ConfPaths {
  user: string;
  project: string;
}

export function getConfPaths(cwd: string): ConfPaths {
  return {
    user: userConfPath(),
    project: projectConfPath(cwd),
  };
}

function loadConfigFromFile(
  path: string,
  label: string,
): ExtensionConfig | undefined {
  if (!existsSync(path)) return undefined;
  return parseConfigDocument(readFileSync(path, "utf8"), label);
}

function mergeConfigs(
  global: ExtensionConfig,
  local: ExtensionConfig,
): ExtensionConfig {
  const localIds = new Set(local.servers.map((s) => s.id));
  const globalOnly = global.servers.filter((s) => !localIds.has(s.id));
  return {
    servers: [...local.servers, ...globalOnly],
    defaultLimit: local.defaultLimit ?? global.defaultLimit,
    maxLimit: local.maxLimit ?? global.maxLimit,
    eagerInit: local.eagerInit ?? global.eagerInit,
  };
}

export function loadConfig(cwd: string): ExtensionConfig {
  const userConfig = loadConfigFromFile(userConfPath(), userConfPath());
  const projectConfig = loadConfigFromFile(
    projectConfPath(cwd),
    projectConfPath(cwd),
  );

  if (projectConfig && userConfig) {
    return mergeConfigs(userConfig, projectConfig);
  }
  if (projectConfig) return projectConfig;
  if (userConfig) return userConfig;

  throw new Error(
    `No ${CONFIG_FILE} configuration found (expected in .skill-pi/conf.d or the agent home conf.d)`,
  );
}

export function serversForWorkspace(
  config: ExtensionConfig,
  cwd: string,
): LspServerConfig[] {
  return config.servers.filter((server) => {
    if (!server.rootMarkers || server.rootMarkers.length === 0) return true;
    return server.rootMarkers.some((marker) => pathHasMarker(cwd, marker));
  });
}

function pathHasMarker(path: string, marker: string): boolean {
  try {
    accessSync(join(path, marker), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function findRootPath(
  startPath: string,
  markers: string[] | undefined,
  cwd: string,
): string {
  if (!markers || markers.length === 0) return cwd;
  let current = startPath;
  while (true) {
    if (markers.some((marker) => pathHasMarker(current, marker))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return cwd;
}

export function detectLanguageFromPath(path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  switch (extension) {
    case ".ts":
    case ".tsx":
    case ".mts":
    case ".cts":
      return "typescript";
    case ".js":
    case ".jsx":
    case ".mjs":
    case ".cjs":
      return "javascript";
    case ".py":
      return "python";
    case ".rs":
      return "rust";
    case ".go":
      return "go";
    case ".java":
      return "java";
    case ".c":
    case ".h":
      return "c";
    case ".cc":
    case ".cpp":
    case ".cxx":
    case ".hpp":
      return "cpp";
    case ".json":
      return "json";
    case ".rb":
      return "ruby";
    default:
      return undefined;
  }
}

export function matchServer(
  config: ExtensionConfig,
  cwd: string,
  options: { filePath?: string; language?: string; serverId?: string },
): WorkspaceMatch {
  const absoluteFilePath = options.filePath
    ? resolve(cwd, options.filePath)
    : undefined;
  const relativeFilePath = absoluteFilePath
    ? absoluteFilePath.slice(cwd.length + 1)
    : undefined;
  const language =
    options.language ??
    (absoluteFilePath ? detectLanguageFromPath(absoluteFilePath) : undefined);

  const candidates = config.servers.filter((server) => {
    if (options.serverId && server.id !== options.serverId) {
      return false;
    }
    if (
      language &&
      server.languages &&
      server.languages.length > 0 &&
      !server.languages.includes(language)
    ) {
      return false;
    }
    if (relativeFilePath && server.fileGlobs && server.fileGlobs.length > 0) {
      return server.fileGlobs.some((glob) =>
        minimatch(relativeFilePath, glob, { dot: true }),
      );
    }
    return true;
  });

  if (candidates.length === 0) {
    const target =
      options.serverId ?? language ?? options.filePath ?? "request";
    throw new Error(`No LSP server configuration matches ${target}`);
  }

  const server = candidates[0];
  const rootPath = findRootPath(
    absoluteFilePath ? dirname(absoluteFilePath) : cwd,
    server.rootMarkers,
    cwd,
  );
  return { server, rootPath };
}

export function clampLimit(
  config: ExtensionConfig,
  limit: number | undefined,
): number {
  const fallback = config.defaultLimit ?? DEFAULT_LIMIT;
  const maxLimit = config.maxLimit ?? DEFAULT_MAX_LIMIT;
  const resolved = limit ?? fallback;
  return Math.max(1, Math.min(maxLimit, resolved));
}
