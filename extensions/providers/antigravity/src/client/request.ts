import {
  getCurrentAvailableModels,
  getCurrentEndpoint,
  getCurrentMatchedModelDebug,
} from "../diagnostics/diagnostics.js";
import { Platform } from "../types/enums.js";
import type { AntigravityApiKey } from "../types/types.js";
import { antigravityEnv, isRecord } from "../utils/util.js";
import { safeError } from "../utils/security.js";

/** Metadata lookups (project/model discovery) must be fast; a stalled endpoint should
 * fall through to the next candidate instead of hanging the whole request. */
export const DISCOVERY_TIMEOUT_MS = 8000;

function defaultUserAgent(): string {
  const os =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
  const arch = process.arch === "x64" ? "amd64" : process.arch;
  return `antigravity/1.15.8 ${os}/${arch}`;
}

export function antigravityHeaders(token: string): Record<string, string> {
  const platform =
    process.platform === "darwin"
      ? Platform.Macos
      : process.platform === "win32"
        ? Platform.Windows
        : Platform.Linux;
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "text/event-stream",
    "User-Agent": antigravityEnv("USER_AGENT") || defaultUserAgent(),
    "X-Goog-Api-Client": "google-cloud-sdk vscode_cloudshelleditor/0.1",
    "Client-Metadata": JSON.stringify({
      ideType: "ANTIGRAVITY",
      platform,
      pluginType: "GEMINI",
    }),
  };
}

export function jsonOrTextError(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: string; status?: string; code?: number };
    };
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // not JSON
  }
  return text;
}

export function parseApiKey(apiKeyRaw: string | undefined): AntigravityApiKey {
  if (!apiKeyRaw) {
    throw new Error("No Antigravity OAuth credentials. Run /login antigravity.");
  }
  try {
    const parsed = JSON.parse(apiKeyRaw) as Partial<AntigravityApiKey>;
    if (!parsed.token || !parsed.projectId) throw new Error("missing token or projectId");
    return { token: parsed.token, projectId: parsed.projectId };
  } catch (error) {
    throw new Error(
      `Invalid Antigravity credentials. Run /login antigravity. (${safeError(error)})`,
      { cause: error },
    );
  }
}

/** Build a diagnostic suffix using the active request bag. */
export function formatRequestDiagnostics(extra: {
  projectId: string;
  runtimeModel: string;
}): string {
  return `endpoint=${getCurrentEndpoint() || "unknown"}, project=${extra.projectId}, runtimeModel=${extra.runtimeModel}, matched=${getCurrentMatchedModelDebug() || "none"}, available=${getCurrentAvailableModels() || "unknown"}`;
}
