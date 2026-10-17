import type { StoredAntigravityAccount } from "./store.js";
import type { AntigravityAccountPool } from "./pool.js";

/**
 * Text rendering of the account pool: the linked accounts with their active /
 * standby markers, and the label options for the interactive selects. Split
 * from ui.ts so the list geometry can be tested and reused without loading the
 * full dashboard (browser launch, OAuth, quota fetch).
 */

export interface AccountPoolSummaryInput {
  linked: StoredAntigravityAccount[];
  preferred: { id: string; label: string };
}

export function formatAccountPoolSummary({ linked, preferred }: AccountPoolSummaryInput): string {
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

/** Select options for "switch active account", with the current one marked. */
export function switchAccountOptions(
  linked: StoredAntigravityAccount[],
  preferred: { id: string; label: string },
): string[] {
  return linked.map((a) => {
    const isCurrent = a.id === preferred.id;
    const email = a.email ? ` - ${a.email}` : "";
    return `${isCurrent ? "● (Active) " : "○ "} ${a.label}${email}`;
  });
}

/** Select options for "unlink an account". */
export function unlinkAccountOptions(linked: StoredAntigravityAccount[]): string[] {
  return linked.map((a) => {
    const email = a.email ? ` (${a.email})` : "";
    return `${a.label}${email}`;
  });
}

/** Select options for "re-authenticate an account". */
export function reauthAccountOptions(linked: StoredAntigravityAccount[]): string[] {
  return linked.map((a) => `${a.label}${a.email ? ` (${a.email})` : ""}`);
}
