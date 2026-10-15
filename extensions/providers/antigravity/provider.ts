import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { getApiKey, refreshAntigravityToken } from "./src/auth/index.ts";
import { DEFAULT_ENDPOINT, endpointCandidates } from "./src/client/index.ts";
import { getLastDiagnostics, runWithDiagnostics } from "./src/diagnostics/index.ts";
import { ANTIGRAVITY_MODELS, PROVIDER_ID, PROVIDER_NAME } from "./src/models/index.ts";
import {
  AntigravityAccountPool,
  getLinkedAccounts,
  getValidAccountApiKey,
  handleLoginWithManagement,
  showInteractiveAccountDashboard,
  type AntigravityAccount,
} from "./src/accounts/index.ts";
import { ANTIGRAVITY_API, createAntigravityStream } from "./src/stream/index.ts";
import {
  fetchAccountUsage,
  formatModelsList,
  formatUsageSummary,
  resolveApiKeyFromContext,
} from "./src/usage/index.ts";
import { prewarmConnection, redactSecrets } from "./src/utils/index.ts";

/**
 * Pi's interactive `notify` writes into the chat transcript. `console.log` in that
 * mode prints to the raw terminal and paints over the TUI. Use one channel only.
 */
function emitCommandOutput(
  ctx: ExtensionCommandContext,
  text: string,
  type: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(text, type);
    return;
  }
  if (type === "warning" || type === "error") console.error(text);
  else console.log(text);
}

async function withUsage(
  ctx: ExtensionCommandContext,
  fn: (usage: Awaited<ReturnType<typeof fetchAccountUsage>>) => string,
): Promise<void> {
  try {
    const apiKey = await resolveApiKeyFromContext(ctx);
    if (!apiKey) {
      emitCommandOutput(
        ctx,
        "No Antigravity credentials. Run /login antigravity first.",
        "warning",
      );
      return;
    }
    if (ctx.hasUI) ctx.ui.notify("Fetching Antigravity usage…", "info");
    const usage = await runWithDiagnostics(() => fetchAccountUsage(apiKey));
    emitCommandOutput(ctx, fn(usage));
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    emitCommandOutput(ctx, `Antigravity usage failed: ${msg}`, "warning");
  }
}

export function registerAntigravity(pi: ExtensionAPI): void {
  // Open the TLS connection up front so the first message of a session does not pay
  // the handshake. Opt out with ANTIGRAVITY_NO_PREWARM=1.
  const primaryEndpoint = endpointCandidates()[0];
  if (primaryEndpoint) prewarmConnection(primaryEndpoint);

  let resolveAdditionalAccounts: (() => Promise<AntigravityAccount[]>) | undefined;
  let notify: ((message: string) => void) | undefined;
  const accountPool = new AntigravityAccountPool({
    primaryId: PROVIDER_ID,
    primaryLabel: "account 1",
    resolveAdditionalAccounts: async () => resolveAdditionalAccounts?.() ?? [],
    onTransition: ({ from, to }) => {
      notify?.(`Antigravity ${from.label} reached its limit; switched to ${to.label}.`);
    },
  });
  const pooledStream = createAntigravityStream(accountPool);
  const oauth = {
    login: (callbacks: OAuthLoginCallbacks) => handleLoginWithManagement(callbacks, accountPool),
    refreshToken: refreshAntigravityToken,
    getApiKey,
  };

  pi.on("session_start", (_event, ctx) => {
    accountPool.reset();

    resolveAdditionalAccounts = async () => {
      const linked = getLinkedAccounts();
      const results = await Promise.all(
        linked.map(async (acc) => {
          const apiKey = await getValidAccountApiKey(acc);
          if (!apiKey) return undefined;
          return {
            id: acc.id,
            label: acc.email ? `${acc.label} (${acc.email})` : acc.label,
            apiKey,
          };
        }),
      );
      return results.filter((a): a is AntigravityAccount => a !== undefined);
    };

    notify = ctx.hasUI ? (message) => ctx.ui.notify(message, "warning") : undefined;
  });

  pi.on("session_shutdown", () => {
    resolveAdditionalAccounts = undefined;
    notify = undefined;
  });

  // Always register primary provider only (no duplicate provider slots in /login or /model)
  pi.registerProvider(PROVIDER_ID, {
    name: PROVIDER_NAME,
    baseUrl: DEFAULT_ENDPOINT,
    api: ANTIGRAVITY_API,
    models: ANTIGRAVITY_MODELS,
    oauth: { name: PROVIDER_NAME, ...oauth },
    streamSimple: pooledStream,
  });

  pi.registerCommand("antigravity", {
    description: "Open interactive Antigravity account manager (add, switch, quotas, remove)",
    handler: async (_args, ctx) => {
      await showInteractiveAccountDashboard(ctx, accountPool);
    },
  });

  pi.registerCommand("antigravity.accounts", {
    description: "Open interactive Antigravity account manager (add, switch, quotas, remove)",
    handler: async (_args, ctx) => {
      await showInteractiveAccountDashboard(ctx, accountPool);
    },
  });

  pi.registerCommand("antigravity.usage", {
    description: "Show Antigravity shared quota pools (Gemini / Claude+GPT, 5h + weekly)",
    handler: async (_args, ctx) => {
      await withUsage(ctx, formatUsageSummary);
    },
  });

  pi.registerCommand("antigravity.models", {
    description: "List Antigravity runtime models + remaining pool fraction",
    handler: async (args, ctx) => {
      const all = /\ball\b/i.test(args || "");
      await withUsage(ctx, (usage) => formatModelsList(usage, { all }));
    },
  });

  pi.registerCommand("antigravity.doctor", {
    description: "Show sanitized Antigravity provider diagnostics",
    handler: async (_args, ctx) => {
      const d = getLastDiagnostics();
      const lines = [
        `provider=${PROVIDER_ID}`,
        `lastResolvedRuntimeModel=${d.resolvedRuntimeModel || "none"}`,
        `availableModels=${d.availableModels || "none"}`,
        `matchedModel=${d.matchedModelDebug || "none"}`,
        `lastEndpoint=${d.endpoint || "none"}`,
        `lastStatus=${d.status ?? "none"}`,
        `lastProjectId=${d.projectId || "none"}`,
        ...(d.latencyMs !== undefined ? [`lastLatencyMs=${d.latencyMs}`] : []),
        `lastError=${d.error ? redactSecrets(d.error) : "none"}`,
        "transport=native-streamSimple",
        "runtimeCli=not-used",
        "commands=/antigravity /antigravity.accounts /antigravity.usage /antigravity.models /antigravity.doctor",
      ];
      emitCommandOutput(ctx, `Antigravity doctor\n${lines.join("\n")}`);
    },
  });
}
