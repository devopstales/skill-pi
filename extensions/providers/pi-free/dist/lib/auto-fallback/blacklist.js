/**
 * In-session blacklist for auto-fallback.
 *
 * Tracks recent failures per `{provider}/{model}` key so the selection layer
 * can avoid retrying a known-broken model. Two eviction rules (Q9 = C):
 *
 *   - **Time window**: a record older than `ttlMs` expires and the model
 *     gets another chance. A single transient quota error should not
 *     permanently ban a perfectly serviceable model.
 *   - **Max strikes**: after `maxStrikes` failures in the TTL window the
 *     record is "promoted" to a hard ban for the rest of the session —
 *     the model is clearly broken (e.g. upstream disabled the endpoint)
 *     and there is no point waiting out the TTL.
 *
 * Blacklist state is in-memory only. It is reset when the extension
 * reloads (extension entry point runs again). Per AGENTS.md convention 18
 * this is intentional — across releases / extension reloads we do not
 * persist "model X was bad last week" because that signal decays fast
 * (free providers flip free/paid status frequently).
 */
/**
 * Current state of the in-memory blacklist. Private; the public API is
 * the factory {@link createBlacklist}.
 */
class BlacklistState {
    entries = new Map();
    ttlMs;
    maxStrikes;
    maxReasons;
    constructor(options = {}) {
        this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
        this.maxStrikes = options.maxStrikes ?? 3;
        this.maxReasons = options.maxReasons ?? 5;
    }
    /**
     * Record a failure for a model.
     *
     * @param key - Composite key, conventionally `${provider}/${modelId}`.
     * @param reason - Short error class label (e.g. "429", "quota"). NOT the
     *     full errorMessage; that is for log/notify only.
     * @returns The updated record, or null if the entry was just evicted.
     */
    recordFailure(key, reason, now = Date.now()) {
        const existing = this.entries.get(key);
        if (existing && now - existing.windowStart > this.ttlMs) {
            // TTL window expired — reset the streak so a single stale
            // failure does not haunt a now-working model.
            this.entries.delete(key);
        }
        const current = this.entries.get(key);
        const nextCount = (current?.count ?? 0) + 1;
        const entry = {
            count: nextCount,
            windowStart: current?.windowStart ?? now,
            lastFailureAt: now,
            reasons: [...(current?.reasons ?? []), reason].slice(-this.maxReasons),
        };
        this.entries.set(key, entry);
        return entry;
    }
    /**
     * Remove the blacklist record (e.g. on a successful run, or via
     * `/reset-fallback-blacklist`). Idempotent.
     */
    clear(key) {
        this.entries.delete(key);
    }
    /** Clear every entry — used by the `/reset-fallback-blacklist` command. */
    clearAll() {
        const n = this.entries.size;
        this.entries.clear();
        return n;
    }
    /**
     * Should the given key be considered blacklisted right now?
     *
     * Excludes entries past their TTL window. An entry that has hit
     * {@link BlacklistOptions.maxStrikes} stays banned for the rest of the
     * session (no automatic expiry).
     */
    isBlacklisted(key, now = Date.now()) {
        const entry = this.entries.get(key);
        if (!entry)
            return false;
        // Hard ban (>= maxStrikes) persists for the session.
        if (entry.count >= this.maxStrikes)
            return true;
        // Soft ban: must also still be inside the window.
        return now - entry.windowStart <= this.ttlMs;
    }
    /** Read-only view of all entries, for `/free-fallback-history`. */
    snapshot() {
        return new Map(this.entries);
    }
    /** Total entries currently tracked (before TTL eviction). */
    size() {
        return this.entries.size;
    }
}
/**
 * Build a fresh blacklist. Each session should hold exactly one — sharing
 * across sessions is not desired (see file header).
 */
export function createBlacklist(options = {}) {
    const state = new BlacklistState(options);
    return {
        recordFailure(key, reason, now) {
            return state.recordFailure(key, reason, now);
        },
        clear(key) {
            state.clear(key);
        },
        clearAll() {
            return state.clearAll();
        },
        isBlacklisted(key, now) {
            return state.isBlacklisted(key, now);
        },
        snapshot() {
            return state.snapshot();
        },
        size() {
            return state.size();
        },
    };
}
//# sourceMappingURL=blacklist.js.map