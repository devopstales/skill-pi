import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { getApiKey, refreshAntigravityToken } from "../auth/oauth.js";
import type { AntigravityOAuthCredentials } from "../types/types.js";

export const MAX_ACCOUNT_SLOTS = 10;

export type StoredAntigravityAccount = {
  slotNumber: number;
  id: string;
  label: string;
  email?: string;
  projectId?: string;
  expires?: number;
  hasRefreshToken: boolean;
};

export function getAuthFilePath(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  return join(agentDir, "auth.json");
}

export function readAuthStore(): Record<string, unknown> {
  const file = getAuthFilePath();
  if (!existsSync(file)) return {};
  try {
    const raw = readFileSync(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function writeAuthStore(store: Record<string, unknown>): void {
  const file = getAuthFilePath();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(store, null, 2) + "\n", { mode: 0o600, encoding: "utf8" });
}

export function getSlotId(slotNumber: number): string {
  return slotNumber === 1 ? "antigravity" : `antigravity-${slotNumber}`;
}

export function getSlotLabel(slotNumber: number): string {
  return `account ${slotNumber}`;
}

export function getLinkedAccounts(): StoredAntigravityAccount[] {
  const store = readAuthStore();
  const accounts: StoredAntigravityAccount[] = [];

  for (let slotNumber = 1; slotNumber <= MAX_ACCOUNT_SLOTS; slotNumber++) {
    const id = getSlotId(slotNumber);
    const rawCred = store[id];
    if (!rawCred || typeof rawCred !== "object") continue;
    const cred = rawCred as Record<string, unknown>;
    if (cred.type !== "oauth" && !cred.access && !cred.token && !cred.refresh) continue;

    const email = typeof cred.email === "string" ? cred.email : undefined;
    const projectId = typeof cred.projectId === "string" ? cred.projectId : undefined;
    const expires = typeof cred.expires === "number" ? cred.expires : undefined;
    const hasRefreshToken = typeof cred.refresh === "string" && cred.refresh.length > 0;

    accounts.push({
      slotNumber,
      id,
      label: getSlotLabel(slotNumber),
      email,
      projectId,
      expires,
      hasRefreshToken,
    });
  }

  return accounts;
}

export function getNextAvailableSlot():
  { slotNumber: number; id: string; label: string } | undefined {
  const linked = new Set(getLinkedAccounts().map((a) => a.slotNumber));
  for (let slotNumber = 1; slotNumber <= MAX_ACCOUNT_SLOTS; slotNumber++) {
    if (!linked.has(slotNumber)) {
      return {
        slotNumber,
        id: getSlotId(slotNumber),
        label: getSlotLabel(slotNumber),
      };
    }
  }
  return undefined;
}

export function saveAntigravityAccount(
  slotId: string,
  credentials: AntigravityOAuthCredentials,
): void {
  const store = readAuthStore();
  store[slotId] = {
    type: "oauth",
    ...credentials,
  };
  writeAuthStore(store);
}

export function removeAntigravityAccount(slotId: string): boolean {
  const store = readAuthStore();
  if (!(slotId in store)) return false;
  delete store[slotId];
  writeAuthStore(store);
  return true;
}

export async function getAccountCredentials(
  slotId: string,
): Promise<AntigravityOAuthCredentials | undefined> {
  const store = readAuthStore();
  let cred = store[slotId] as AntigravityOAuthCredentials | undefined;
  if (!cred || !cred.access) return undefined;

  // Refresh if token is expired or within 2 minutes of expiration
  if (cred.refresh && (!cred.expires || Date.now() >= cred.expires - 2 * 60 * 1000)) {
    try {
      cred = await refreshAntigravityToken(cred);
      saveAntigravityAccount(slotId, cred);
    } catch {
      // If refresh fails, fall back to current credentials
    }
  }

  return cred;
}

export async function getValidAccountApiKey(
  account: StoredAntigravityAccount,
): Promise<string | undefined> {
  const cred = await getAccountCredentials(account.id);
  if (!cred) return undefined;
  return getApiKey(cred);
}
