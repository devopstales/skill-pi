export type AntigravityAccount = {
  id: string;
  label: string;
  apiKey: string;
};

export type AntigravityAccountTransition = {
  from: AntigravityAccount;
  to: AntigravityAccount;
  reason: "rate-limit";
};

export type AntigravityAccountPoolOptions = {
  primaryId?: string;
  primaryLabel?: string;
  resolveAdditionalAccounts?: () => Promise<AntigravityAccount[]>;
  onTransition?: (transition: AntigravityAccountTransition) => void;
};

/**
 * Keeps a sticky account preference for the current Pi runtime. Credentials
 * remain in Pi's provider-scoped auth store; this class only handles request
 * ordering and never persists tokens.
 */
export class AntigravityAccountPool {
  private readonly primaryId: string;
  private readonly primaryLabel: string;
  private preferredId: string;
  private preferredLabel: string;

  constructor(private readonly options: AntigravityAccountPoolOptions = {}) {
    this.primaryId = options.primaryId ?? "antigravity";
    this.primaryLabel = options.primaryLabel ?? "account 1";
    this.preferredId = this.primaryId;
    this.preferredLabel = this.primaryLabel;
  }

  reset(): void {
    this.preferredId = this.primaryId;
    this.preferredLabel = this.primaryLabel;
  }

  setPreferred(id: string, label?: string): void {
    this.preferredId = id;
    if (label) this.preferredLabel = label;
  }

  getPreferred(): { id: string; label: string } {
    return { id: this.preferredId, label: this.preferredLabel };
  }

  async resolve(primaryApiKey?: string): Promise<AntigravityAccount[]> {
    let additional: AntigravityAccount[] = [];
    try {
      additional = (await this.options.resolveAdditionalAccounts?.()) ?? [];
    } catch {
      // Extra accounts are optional. A refresh/login failure must not prevent a
      // working account from serving the request.
    }

    const accounts: AntigravityAccount[] = [];
    const seenApiKeys = new Set<string>();
    if (primaryApiKey) {
      accounts.push({ id: this.primaryId, label: this.primaryLabel, apiKey: primaryApiKey });
      seenApiKeys.add(primaryApiKey);
    }
    for (const account of additional) {
      if (!account.apiKey || seenApiKeys.has(account.apiKey)) continue;
      accounts.push(account);
      seenApiKeys.add(account.apiKey);
    }

    if (accounts.length === 0) return accounts;
    const preferredIndex = accounts.findIndex((account) => account.id === this.preferredId);
    if (preferredIndex < 0) {
      this.preferredId = accounts[0].id;
      this.preferredLabel = accounts[0].label;
      return accounts;
    }

    return [...accounts.slice(preferredIndex), ...accounts.slice(0, preferredIndex)];
  }

  markSuccessful(account: AntigravityAccount): void {
    this.preferredId = account.id;
    this.preferredLabel = account.label;
  }

  markRateLimited(account: AntigravityAccount, available: AntigravityAccount[]): void {
    if (available.length < 2) return;
    const currentIndex = available.findIndex((candidate) => candidate.id === account.id);
    if (currentIndex < 0) return;
    const fallback = available[(currentIndex + 1) % available.length];
    if (!fallback || fallback.id === account.id) return;

    this.preferredId = fallback.id;
    this.preferredLabel = fallback.label;
    this.options.onTransition?.({ from: account, to: fallback, reason: "rate-limit" });
  }
}
