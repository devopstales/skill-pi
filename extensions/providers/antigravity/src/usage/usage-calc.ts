import { isRecord } from "../utils/util.js";
import type {
  ModelQuotaRow,
  QuotaBucket,
  QuotaGroup,
  QuotaSummaryRaw,
  TierInfo,
  TierRaw,
} from "../types/types.js";

function clampFraction(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function remainingPercent(remaining?: number): number | undefined {
  if (remaining === undefined) return undefined;
  return Math.round(remaining * 1000) / 10;
}

function progressBar(remaining?: number, width = 20): string {
  if (remaining === undefined) return `[${"?".repeat(width)}]`;
  const filled = Math.max(0, Math.min(width, Math.round(remaining * width)));
  return `[${"#".repeat(filled)}${"-".repeat(width - filled)}]`;
}

function formatReset(resetTime?: string): string {
  if (!resetTime) return "n/a";
  const ts = Date.parse(resetTime);
  if (!Number.isFinite(ts)) return resetTime;
  const delta = ts - Date.now();
  if (delta <= 0) return "now";
  const totalMin = Math.round(delta / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function parseQuotaSummary(data: unknown): { groups: QuotaGroup[]; description?: string } {
  const summary = (isRecord(data) ? data : {}) as QuotaSummaryRaw;
  const groups: QuotaGroup[] = [];
  for (const group of summary.groups || []) {
    const buckets: QuotaBucket[] = [];
    for (const bucket of group.buckets || []) {
      const remaining = clampFraction(bucket.remainingFraction);
      if (remaining === undefined && !bucket.bucketId) continue;
      buckets.push({
        bucketId: String(bucket.bucketId || bucket.displayName || "unknown"),
        displayName: String(bucket.displayName || bucket.bucketId || "Limit"),
        window: bucket.window ? String(bucket.window) : undefined,
        resetTime: bucket.resetTime ? String(bucket.resetTime) : undefined,
        description: bucket.description ? String(bucket.description) : undefined,
        remainingFraction: remaining ?? 0,
      });
    }
    if (!buckets.length && !group.displayName) continue;
    groups.push({
      displayName: String(group.displayName || "Quota group"),
      description: group.description ? String(group.description) : undefined,
      buckets,
    });
  }
  return {
    groups,
    description: summary.description ? String(summary.description) : undefined,
  };
}

export function parseModels(data: unknown): {
  models: ModelQuotaRow[];
  defaultAgentModelId?: string;
} {
  const raw = (isRecord(data) ? data : {}) as AvailableModelsRawLike;
  const modelsObj = raw.models && isRecord(raw.models) ? raw.models : {};
  const models: ModelQuotaRow[] = [];
  for (const [modelId, info] of Object.entries(modelsObj)) {
    if (!info || !isRecord(info)) continue;
    if (info.isInternal || String(modelId).startsWith("chat_")) continue;
    const qi = isRecord(info.quotaInfo) ? info.quotaInfo : {};
    models.push({
      modelId,
      displayName:
        typeof info.displayName === "string"
          ? info.displayName
          : typeof info.label === "string"
            ? info.label
            : typeof info.modelName === "string"
              ? info.modelName
              : undefined,
      remainingFraction: clampFraction(qi.remainingFraction),
      resetTime: qi.resetTime ? String(qi.resetTime) : undefined,
      modelProvider:
        typeof info.modelProvider === "string"
          ? info.modelProvider
          : typeof info.apiProvider === "string"
            ? info.apiProvider
            : undefined,
      supportsThinking: !!info.supportsThinking,
      supportsImages: !!info.supportsImages,
      recommended: !!info.recommended,
    });
  }
  models.sort((a, b) => a.modelId.localeCompare(b.modelId));
  return {
    models,
    defaultAgentModelId:
      raw.defaultAgentModelId || raw.defaultAgentModel
        ? String(raw.defaultAgentModelId || raw.defaultAgentModel)
        : undefined,
  };
}

interface AvailableModelsRawLike {
  models?: Record<string, unknown>;
  defaultAgentModelId?: unknown;
  defaultAgentModel?: unknown;
}

export function parseTier(value: unknown): TierInfo | undefined {
  if (!isRecord(value)) return undefined;
  const tier = value as TierRaw;
  if (!tier.id && !tier.name) return undefined;
  return {
    id: tier.id ? String(tier.id) : undefined,
    name: tier.name ? String(tier.name) : undefined,
    description: tier.description ? String(tier.description) : undefined,
  };
}

function quotaErrorNote(msg: string): string {
  if (/SUBSCRIPTION_REQUIRED|#3501|(?:lack|missing).*license/i.test(msg)) {
    return "Aggregate quota summary needs a paid subscription (free-tier can't use that endpoint). Per-model usage is still available via /antigravity.models.";
  }
  return `Aggregate quota summary unavailable: ${msg.slice(0, 160)}`;
}

export function formatUsageSummary(usage: AccountUsageLike): string {
  const lines: string[] = [];

  if (usage.planLabel) lines.push(usage.planLabel);

  if (!usage.groups.length) {
    if (usage.quotaSummaryError) {
      lines.push(quotaErrorNote(usage.quotaSummaryError));
    } else {
      lines.push("No quota groups returned.");
    }
    return lines.join("\n");
  }

  for (const group of usage.groups) {
    if (lines.length) lines.push("");
    lines.push(group.displayName);
    for (const bucket of group.buckets) {
      const rem = remainingPercent(bucket.remainingFraction);
      lines.push(
        `  ${progressBar(bucket.remainingFraction)} ${bucket.displayName}: ${rem ?? "?"}% left · resets ${formatReset(bucket.resetTime)}`,
      );
    }
  }

  return lines.join("\n").trimEnd();
}

export function formatModelsList(usage: AccountUsageLike, opts?: { all?: boolean }): string {
  const lines: string[] = [];
  lines.push("Antigravity available models");
  lines.push(`project=${usage.projectId}`);
  if (usage.defaultAgentModelId) lines.push(`defaultAgentModel=${usage.defaultAgentModelId}`);
  lines.push("");

  const rows = opts?.all
    ? usage.models
    : usage.models.filter((m) => !/tab_|chat_/i.test(m.modelId));

  if (!rows.length) {
    lines.push("No models returned.");
    return lines.join("\n");
  }

  const maxId = Math.max(...rows.map((m) => m.modelId.length), 8);
  for (const m of rows) {
    const rem = remainingPercent(m.remainingFraction);
    const flags = [
      m.recommended ? "recommended" : "",
      m.supportsThinking ? "thinking" : "",
      m.supportsImages ? "images" : "",
    ]
      .filter(Boolean)
      .join(",");
    const name = m.displayName && m.displayName !== m.modelId ? `  ${m.displayName}` : "";
    lines.push(
      `${m.modelId.padEnd(maxId)}  rem ${rem === undefined ? "  ?" : String(rem).padStart(5)}%  reset ${formatReset(m.resetTime).padEnd(8)}${flags ? `  [${flags}]` : ""}${name}`,
    );
  }
  lines.push("");
  lines.push("Note: remaining % is pool-shared (not a private per-model budget).");
  return lines.join("\n");
}

interface AccountUsageLike {
  projectId: string;
  planLabel?: string;
  groups: QuotaGroup[];
  quotaSummaryError?: string;
  models: ModelQuotaRow[];
  defaultAgentModelId?: string;
}
