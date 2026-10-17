import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  antigravityHeaders,
  endpointCandidates,
  extractProjectId,
  parseApiKey,
  resolveProjectId,
} from "../client/client.js";
import {
  setLastEndpoint,
  setLastError,
  setLastProjectId,
  setLastStatus,
} from "../diagnostics/diagnostics.js";
import { isRecord } from "../utils/util.js";
import { safeError } from "../utils/security.js";
import { antigravityFetch } from "../utils/http.js";
import { getLinkedAccounts, getValidAccountApiKey } from "../accounts/store.js";
import type {
  AccountUsage,
  ApiErrorBody,
  AvailableModelsRaw,
  LoadCodeAssistRaw,
} from "../types/types.js";
import {
  formatModelsList,
  formatUsageSummary,
  parseModels,
  parseQuotaSummary,
  parseTier,
} from "./usage-calc.js";

function jsonHeaders(token: string): Record<string, string> {
  return {
    ...antigravityHeaders(token),
    Accept: "application/json",
  };
}

async function postJson(
  path: string,
  token: string,
  body: Record<string, unknown>,
): Promise<{ endpoint: string; status: number; data: unknown }> {
  let lastErrorText = "";
  for (const endpoint of endpointCandidates()) {
    try {
      const res = await antigravityFetch(`${endpoint}${path}`, {
        method: "POST",
        headers: jsonHeaders(token),
        body: JSON.stringify(body),
      });
      setLastEndpoint(endpoint);
      setLastStatus(res.status);
      const text = await res.text();
      let data: unknown;
      try {
        data = JSON.parse(text) as unknown;
      } catch {
        data = { raw: text } satisfies ApiErrorBody;
      }
      if (!res.ok) {
        const errorBody = isRecord(data) ? (data as ApiErrorBody) : undefined;
        lastErrorText =
          typeof errorBody?.error?.message === "string" ? errorBody.error.message : text;
        if (![403, 404, 429, 500, 502, 503, 504].includes(res.status)) {
          throw new Error(`${path} failed (${String(res.status)}): ${lastErrorText.slice(0, 300)}`);
        }
        continue;
      }
      return { endpoint, status: res.status, data };
    } catch (error) {
      lastErrorText = safeError(error);
      setLastError(lastErrorText);
    }
  }
  throw new Error(`${path} failed: ${lastErrorText || "no endpoint available"}`);
}

async function fetchAvailableModelsFromEndpoint(
  endpoint: string,
  token: string,
  projectId: string,
): Promise<{ endpoint: string; status: number; data: unknown } | undefined> {
  // `{}` and `{ project: projectId }` return byte-identical catalogs on this endpoint
  // (verified against the live backend) — one body is the full search space per host.
  try {
    const res = await antigravityFetch(`${endpoint}/v1internal:fetchAvailableModels`, {
      method: "POST",
      headers: jsonHeaders(token),
      body: JSON.stringify({ project: projectId }),
    });
    const text = await res.text();
    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      data = { raw: text } satisfies ApiErrorBody;
    }
    if (!res.ok) {
      const errorBody = isRecord(data) ? (data as ApiErrorBody) : undefined;
      const lastErrorText =
        typeof errorBody?.error?.message === "string" ? errorBody.error.message : text;
      setLastError(lastErrorText);
      return undefined;
    }
    return { endpoint, status: res.status, data };
  } catch (error) {
    setLastError(safeError(error));
    return undefined;
  }
}

/**
 * Merge fetchAvailableModels across endpoint candidates so daily/sandbox-only
 * models (e.g. Gemini 3.6 Flash) appear alongside production catalog entries.
 */
async function fetchMergedAvailableModels(
  token: string,
  projectId: string,
): Promise<{ endpoint: string; status: number; data: AvailableModelsRaw }> {
  // Both endpoints are always queried to merge their catalogs — fetch them concurrently
  // instead of blocking on production before starting the daily/sandbox request.
  const results = await Promise.all(
    endpointCandidates().map((endpoint) =>
      fetchAvailableModelsFromEndpoint(endpoint, token, projectId),
    ),
  );

  const mergedModels: Record<string, unknown> = {};
  let defaultAgentModelId: string | undefined;
  let lastEndpoint = "";
  let lastStatus = 0;

  for (const result of results) {
    if (!result) continue;
    setLastEndpoint(result.endpoint);
    setLastStatus(result.status);
    lastEndpoint = result.endpoint;
    lastStatus = result.status;
    const data = result.data;
    if (isRecord(data) && isRecord(data.models)) {
      Object.assign(mergedModels, data.models);
    }
    if (isRecord(data) && typeof data.defaultAgentModelId === "string") {
      defaultAgentModelId = data.defaultAgentModelId;
    }
  }

  if (!lastEndpoint) {
    throw new Error(`/v1internal:fetchAvailableModels failed: no endpoint available`);
  }

  return {
    endpoint: lastEndpoint,
    status: lastStatus,
    data: {
      models: mergedModels as AvailableModelsRaw["models"],
      defaultAgentModelId,
    },
  };
}

async function loadCodeAssistSafe(token: string) {
  try {
    return await postJson("/v1internal:loadCodeAssist", token, {
      metadata: {
        ideType: "ANTIGRAVITY",
        platform: "PLATFORM_UNSPECIFIED",
        pluginType: "GEMINI",
      },
    });
  } catch {
    return null;
  }
}

/**
 * The user-quota-summary RPC is gated behind a paid subscription: free-tier
 * accounts get 403 SUBSCRIPTION_REQUIRED (#3501). It is best-effort diagnostics
 * only — never let it block the rest of the account data (models, tier, project).
 */
async function fetchQuotaSummarySafe(token: string): Promise<
  | { ok: true; result: { endpoint: string; status: number; data: unknown } }
  | {
      ok: false;
      error: string;
    }
> {
  try {
    return { ok: true, result: await postJson("/v1internal:retrieveUserQuotaSummary", token, {}) };
  } catch (error) {
    const msg = safeError(error);
    setLastError(msg);
    return { ok: false, error: msg };
  }
}

export async function fetchAccountUsage(apiKeyRaw?: string): Promise<AccountUsage> {
  const creds = parseApiKey(apiKeyRaw);
  const initialProjectId =
    creds.projectId ||
    resolveProjectId({
      token: creds.token,
      credentialProjectId: creds.projectId,
    });

  // Fetch loadCodeAssist, quota summary, and available models all in parallel
  // to minimize command execution latency.
  const [assistResult, summaryRes, available] = await Promise.all([
    loadCodeAssistSafe(creds.token),
    fetchQuotaSummarySafe(creds.token),
    fetchMergedAvailableModels(creds.token, initialProjectId),
  ]);

  // Derive project ID from the loadCodeAssist response or stored project ID.
  const discoveredProject = assistResult ? extractProjectId(assistResult.data) : undefined;
  const projectId = resolveProjectId({
    token: creds.token,
    warmedProject: discoveredProject ?? null,
    credentialProjectId: creds.projectId,
  });
  setLastProjectId(projectId);

  const summary = summaryRes.ok ? summaryRes.result : null;
  const quotaSummaryError = summaryRes.ok ? undefined : summaryRes.error;
  const { groups, description } = summary
    ? parseQuotaSummary(summary.data)
    : { groups: [], description: undefined };
  const { models, defaultAgentModelId } = parseModels(available.data);

  const assistData = (isRecord(assistResult?.data) ? assistResult.data : {}) as LoadCodeAssistRaw;
  const productTier = parseTier(assistData.currentTier);
  const paidTier = parseTier(assistData.paidTier);

  // Google returns currentTier=free-tier even for Google AI Pro accounts.
  // The real subscription lives in paidTier (e.g. g1-pro-tier / Google AI Pro).
  const planLabel = paidTier?.name
    ? `${paidTier.name}${paidTier.id ? ` (${paidTier.id})` : ""}`
    : productTier?.name
      ? `${productTier.name}${productTier.id ? ` (${productTier.id})` : ""}`
      : undefined;

  return {
    projectId,
    endpoint: summary?.endpoint ?? available.endpoint ?? assistResult?.endpoint,
    productTier,
    paidTier,
    planLabel,
    groups,
    groupDescription: description,
    quotaSummaryError,
    models,
    defaultAgentModelId,
    fetchedAt: Date.now(),
  };
}

export { formatUsageSummary, formatModelsList } from "./usage-calc.js";

export async function resolveApiKeyFromContext(
  ctx: ExtensionCommandContext,
): Promise<string | undefined> {
  try {
    const key = await ctx.modelRegistry.getApiKeyForProvider("antigravity");
    if (key) return key;
  } catch {
    // fallback
  }
  const linked = getLinkedAccounts();
  if (linked.length > 0 && linked[0]) {
    return await getValidAccountApiKey(linked[0]);
  }
  return undefined;
}
