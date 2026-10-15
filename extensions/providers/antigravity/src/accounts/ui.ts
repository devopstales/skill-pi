import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { OAuthLoginCallbacks } from "@earendil-works/pi-ai";
import { loginAntigravity } from "../auth/oauth.js";
import { fetchAccountUsage, formatModelsList } from "../usage/usage.js";
import {
  getAccountCredentials,
  getLinkedAccounts,
  getNextAvailableSlot,
  getValidAccountApiKey,
  removeAntigravityAccount,
  saveAntigravityAccount,
  type StoredAntigravityAccount,
} from "./store.js";
import type { AntigravityAccountPool } from "./pool.js";
import type { AntigravityOAuthCredentials } from "../types/types.js";

function openBrowserUrl(url: string): void {
  import("node:child_process")
    .then(({ exec }) => {
      const openCmd =
        process.platform === "darwin"
          ? "open"
          : process.platform === "win32"
            ? "start"
            : "xdg-open";
      exec(`${openCmd} "${url}"`, () => {});
    })
    .catch(() => {});
}

function makeLoginCallbacks(ctx: ExtensionCommandContext): OAuthLoginCallbacks {
  return {
    onAuth: ({ url, instructions }) => {
      openBrowserUrl(url);
      if (ctx.hasUI) {
        ctx.ui.notify(instructions || "Opening Google sign-in in your browser…", "info");
      }
    },
    onDeviceCode: () => {},
    onPrompt: async ({ message, placeholder }) => {
      if (!ctx.hasUI) throw new Error("Manual code entry requires interactive UI");
      const answer = await ctx.ui.input(message, placeholder);
      if (answer === undefined) throw new Error("Login cancelled");
      return answer;
    },
    onSelect: async ({ message, options }) => {
      if (!ctx.hasUI) return options[0]?.id;
      const labels = options.map((opt) => opt.label);
      const chosen = await ctx.ui.select(message, labels);
      if (!chosen) return undefined;
      return options.find((opt) => opt.label === chosen)?.id;
    },
  };
}

export function formatAccountSummaryText(pool: AntigravityAccountPool): string {
  const linked = getLinkedAccounts();
  const preferred = pool.getPreferred();

  if (linked.length === 0) {
    return [
      "Antigravity account pool: No accounts linked yet.",
      "Run /login antigravity or /antigravity to link your first Google account.",
    ].join("\n");
  }

  const lines = ["Antigravity account pool:"];
  for (const account of linked) {
    const isPreferred = account.id === preferred.id;
    const marker = isPreferred ? "● [ACTIVE] " : "○ [STANDBY]";
    const emailStr = account.email ? ` (${account.email})` : "";
    lines.push(`  ${marker} ${account.label}${emailStr}  [slot: ${account.id}]`);
  }
  lines.push("");
  lines.push(`Active failover preference: ${preferred.label}`);
  return lines.join("\n");
}

async function handleAddAccount(ctx: ExtensionCommandContext): Promise<void> {
  const nextSlot = getNextAvailableSlot();
  if (!nextSlot) {
    ctx.ui.notify("Account pool is full (maximum 10 accounts reached).", "warning");
    return;
  }

  ctx.ui.notify(`Starting Google sign-in for ${nextSlot.label}…`, "info");
  try {
    const credentials = await loginAntigravity(makeLoginCallbacks(ctx));
    saveAntigravityAccount(nextSlot.id, credentials);
    const emailInfo = credentials.email ? ` (${credentials.email})` : "";
    ctx.ui.notify(`Successfully linked ${nextSlot.label}${emailInfo}!`, "info");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/cancelled/i.test(msg)) {
      ctx.ui.notify(`Failed to link ${nextSlot.label}: ${msg}`, "error");
    }
  }
}

async function handleSwitchActive(
  ctx: ExtensionCommandContext,
  pool: AntigravityAccountPool,
  linked: StoredAntigravityAccount[],
): Promise<void> {
  const preferred = pool.getPreferred();
  const options = linked.map((a) => {
    const isCurrent = a.id === preferred.id;
    const email = a.email ? ` - ${a.email}` : "";
    return `${isCurrent ? "● (Active) " : "○ "} ${a.label}${email}`;
  });

  const selected = await ctx.ui.select("Select account to use as primary preference:", options);
  if (!selected) return;

  const targetIndex = options.indexOf(selected);
  const target = linked[targetIndex];
  if (target) {
    pool.setPreferred(target.id, target.label);
    ctx.ui.notify(
      `Switched active preference to ${target.label}${target.email ? ` (${target.email})` : ""}.`,
      "info",
    );
  }
}

async function handleCheckQuotas(
  ctx: ExtensionCommandContext,
  linked: StoredAntigravityAccount[],
): Promise<void> {
  ctx.ui.notify("Checking quotas across all linked accounts…", "info");

  const results = await Promise.all(
    linked.map(async (acc) => {
      try {
        const apiKey = await getValidAccountApiKey(acc);
        if (!apiKey) {
          return { acc, error: "No active token (needs re-auth)" };
        }
        const usage = await fetchAccountUsage(apiKey);
        return { acc, usage };
      } catch (err) {
        return { acc, error: err instanceof Error ? err.message : String(err) };
      }
    }),
  );

  const report: string[] = ["Antigravity Quota Summary (All Linked Accounts):", ""];
  for (const item of results) {
    const email = item.acc.email ? ` (${item.acc.email})` : "";
    report.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    report.push(`${item.acc.label}${email}:`);
    if (item.error) {
      report.push(`  ⚠️  ${item.error}`);
    } else if (item.usage) {
      const formatted = formatModelsList(item.usage);
      for (const line of formatted.split("\n")) {
        report.push(`  ${line}`);
      }
    }
    report.push("");
  }

  const reportText = report.join("\n");
  if (ctx.hasUI) {
    ctx.ui.notify(reportText, "info");
  }
}

async function handleUnlinkAccount(
  ctx: ExtensionCommandContext,
  linked: StoredAntigravityAccount[],
  pool: AntigravityAccountPool,
): Promise<void> {
  const options = linked.map((a) => {
    const email = a.email ? ` (${a.email})` : "";
    return `${a.label}${email}`;
  });

  const selected = await ctx.ui.select("Select account to remove / unlink:", options);
  if (!selected) return;

  const targetIndex = options.indexOf(selected);
  const target = linked[targetIndex];
  if (!target) return;

  const confirmed = await ctx.ui.confirm(
    "Unlink Antigravity Account",
    `Remove ${target.label}${target.email ? ` (${target.email})` : ""} from the account pool?`,
  );
  if (!confirmed) return;

  removeAntigravityAccount(target.id);
  const remaining = getLinkedAccounts();
  if (remaining.length > 0 && pool.getPreferred().id === target.id) {
    pool.setPreferred(remaining[0].id, remaining[0].label);
  }
  ctx.ui.notify(`Unlinked ${target.label}.`, "info");
}

async function handleReauthAccount(
  ctx: ExtensionCommandContext,
  target: StoredAntigravityAccount,
): Promise<void> {
  ctx.ui.notify(
    `Re-authenticating ${target.label}${target.email ? ` (${target.email})` : ""}…`,
    "info",
  );
  try {
    const credentials = await loginAntigravity(makeLoginCallbacks(ctx));
    saveAntigravityAccount(target.id, credentials);
    const emailInfo = credentials.email ? ` (${credentials.email})` : "";
    ctx.ui.notify(`Successfully re-authenticated ${target.label}${emailInfo}!`, "info");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (!/cancelled/i.test(msg)) {
      ctx.ui.notify(`Failed to re-authenticate ${target.label}: ${msg}`, "error");
    }
  }
}

export async function showInteractiveAccountDashboard(
  ctx: ExtensionCommandContext,
  pool: AntigravityAccountPool,
): Promise<void> {
  if (!ctx.hasUI) {
    console.log(formatAccountSummaryText(pool));
    return;
  }

  while (true) {
    const linked = getLinkedAccounts();
    const preferred = pool.getPreferred();
    const activeAccount = linked.find((a) => a.id === preferred.id);
    const activeInfo = activeAccount?.email ? ` (${activeAccount.email})` : "";

    const menuTitle = `Google Antigravity Accounts [Active: ${preferred.label}${activeInfo}]`;
    const nextSlot = getNextAvailableSlot();

    const options: string[] = [];
    if (nextSlot) {
      options.push(`➕ Add new account (${nextSlot.label})`);
    }
    if (linked.length >= 2) {
      options.push("🔀 Switch active account");
    }
    if (linked.length > 0) {
      options.push("📊 Check quotas for all accounts");
      if (linked.length === 1 && linked[0]) {
        options.push(
          `🔄 Re-authenticate ${linked[0].label}${linked[0].email ? ` (${linked[0].email})` : ""}`,
        );
      } else {
        options.push("🔄 Re-authenticate an account");
      }
      options.push("❌ Unlink an account");
    }
    options.push("🚪 Done / Close");

    const selection = await ctx.ui.select(menuTitle, options);
    if (!selection || selection.includes("Done / Close")) {
      break;
    }

    if (selection.includes("Add new account")) {
      await handleAddAccount(ctx);
    } else if (selection.includes("Switch active account")) {
      await handleSwitchActive(ctx, pool, linked);
    } else if (selection.includes("Check quotas")) {
      await handleCheckQuotas(ctx, linked);
    } else if (selection.includes("Unlink an account")) {
      await handleUnlinkAccount(ctx, linked, pool);
    } else if (selection.includes("Re-authenticate")) {
      if (linked.length === 1 && linked[0]) {
        await handleReauthAccount(ctx, linked[0]);
      } else if (linked.length > 1) {
        const subOptions = linked.map((a) => `${a.label}${a.email ? ` (${a.email})` : ""}`);
        const subChoice = await ctx.ui.select("Select account to re-authenticate:", subOptions);
        if (subChoice) {
          const idx = subOptions.indexOf(subChoice);
          const target = linked[idx];
          if (target) await handleReauthAccount(ctx, target);
        }
      }
    }
  }
}

/**
 * Entry point invoked when Pi runs `/login antigravity` or selects Google Antigravity in `/login`.
 * Provides an interactive menu if accounts already exist, or proceeds straight to login if fresh.
 */
export async function handleLoginWithManagement(
  callbacks: OAuthLoginCallbacks,
  pool?: AntigravityAccountPool,
): Promise<AntigravityOAuthCredentials> {
  const linked = getLinkedAccounts();

  // If no accounts linked yet, or non-interactive/headless, run direct login to slot 1
  if (linked.length === 0 || !callbacks.onSelect) {
    const creds = await loginAntigravity(callbacks);
    saveAntigravityAccount("antigravity", creds);
    pool?.reset();
    return creds;
  }

  const preferred = pool?.getPreferred() ?? { id: "antigravity", label: "account 1" };
  const activeAccount = linked.find((a) => a.id === preferred.id) ?? linked[0];
  const nextSlot = getNextAvailableSlot();

  const menuOptions: Array<{ id: string; label: string; details?: string[] }> = [];

  if (nextSlot) {
    menuOptions.push({
      id: "add",
      label: `➕ Add new account (${nextSlot.label})`,
      details: [`Link an additional Google account into ${nextSlot.label} for quota failover`],
    });
  }

  if (linked.length >= 2) {
    menuOptions.push({
      id: "switch",
      label: `🔀 Switch active account`,
      details: [`Current active preference: ${activeAccount.label}`],
    });
  }

  menuOptions.push({
    id: "reauth",
    label: `🔄 Re-authenticate ${linked.length === 1 ? activeAccount.label : "an account"}`,
    details: ["Sign in again to refresh expired or updated account credentials"],
  });

  menuOptions.push({
    id: "unlink",
    label: `❌ Unlink / remove an account`,
    details: ["Remove a Google account from the failover pool"],
  });

  menuOptions.push({
    id: "continue",
    label: `✅ Continue with current account (${activeAccount.label}${activeAccount.email ? ` - ${activeAccount.email}` : ""})`,
    details: ["Keep current credentials and continue"],
  });

  const selectedId = await callbacks.onSelect({
    message: `Google Antigravity Accounts [Active: ${activeAccount.label}${activeAccount.email ? ` (${activeAccount.email})` : ""}]`,
    options: menuOptions,
  });

  if (!selectedId || selectedId === "continue") {
    const creds = await getAccountCredentials(activeAccount.id);
    if (creds) return creds;
    const newCreds = await loginAntigravity(callbacks);
    saveAntigravityAccount(activeAccount.id, newCreds);
    return newCreds;
  }

  if (selectedId === "add") {
    if (!nextSlot) {
      throw new Error("Antigravity account pool is full (maximum 10 accounts reached).");
    }
    callbacks.onProgress?.(`Starting Google sign-in for ${nextSlot.label}…`);
    const newCreds = await loginAntigravity(callbacks);
    saveAntigravityAccount(nextSlot.id, newCreds);
    const primary = await getAccountCredentials("antigravity");
    return primary ?? newCreds;
  }

  if (selectedId === "switch") {
    const switchOptions = linked.map((acc) => ({
      id: acc.id,
      label: `${acc.id === preferred.id ? "● (Active) " : "○ "}${acc.label}${acc.email ? ` (${acc.email})` : ""}`,
    }));
    const targetId = await callbacks.onSelect({
      message: "Select account to use as primary preference:",
      options: switchOptions,
    });
    if (targetId) {
      const target = linked.find((a) => a.id === targetId);
      if (target && pool) {
        pool.setPreferred(target.id, target.label);
      }
      const creds = await getAccountCredentials(targetId);
      if (creds) return creds;
    }
    const current = await getAccountCredentials(activeAccount.id);
    return current ?? (await loginAntigravity(callbacks));
  }

  if (selectedId === "reauth") {
    let targetSlot = activeAccount.id;
    let targetLabel = activeAccount.label;
    if (linked.length > 1) {
      const reauthOptions = linked.map((acc) => ({
        id: acc.id,
        label: `${acc.label}${acc.email ? ` (${acc.email})` : ""}`,
      }));
      const choice = await callbacks.onSelect({
        message: "Select account to re-authenticate:",
        options: reauthOptions,
      });
      if (!choice) throw new Error("Login cancelled");
      targetSlot = choice;
      const t = linked.find((a) => a.id === choice);
      if (t) targetLabel = t.label;
    }
    callbacks.onProgress?.(`Re-authenticating ${targetLabel}…`);
    const creds = await loginAntigravity(callbacks);
    saveAntigravityAccount(targetSlot, creds);
    return creds;
  }

  if (selectedId === "unlink") {
    const unlinkOptions = linked.map((acc) => ({
      id: acc.id,
      label: `${acc.label}${acc.email ? ` (${acc.email})` : ""}`,
    }));
    const targetId = await callbacks.onSelect({
      message: "Select account to remove / unlink:",
      options: unlinkOptions,
    });
    if (targetId) {
      removeAntigravityAccount(targetId);
      const remaining = getLinkedAccounts();
      if (remaining.length > 0) {
        if (pool && preferred.id === targetId) {
          pool.setPreferred(remaining[0].id, remaining[0].label);
        }
        const creds = await getAccountCredentials(remaining[0].id);
        if (creds) return creds;
      }
    }
    return await loginAntigravity(callbacks);
  }

  const defaultCreds = await getAccountCredentials(activeAccount.id);
  return defaultCreds ?? (await loginAntigravity(callbacks));
}
