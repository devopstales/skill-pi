/**
 * Shared JSON persistence utilities.
 * Consolidated file I/O patterns from usage-store.ts and free-tier-limits.ts
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createLogger } from "./logger.js";
import { ensureDir } from "./paths.js";
const _logger = createLogger("json-persistence");
function safeJsonReviver(_key, value) {
    if (_key === "__proto__" || _key === "constructor") {
        return undefined;
    }
    return value;
}
class Lock {
    promise = Promise.resolve();
    async acquire() {
        let release;
        const newPromise = new Promise((resolve) => {
            release = resolve;
        });
        const previous = this.promise;
        this.promise = previous.then(() => newPromise);
        await previous;
        return release;
    }
}
/**
 * Create a JSON file store with automatic directory creation and error handling.
 */
export function createJSONStore(filepath, defaultValue, options = {}) {
    let cached = null;
    const lock = new Lock();
    const debounceMs = options.debounceMs ?? 0;
    let flushTimer;
    function load() {
        if (cached)
            return cached;
        try {
            if (existsSync(filepath)) {
                cached = JSON.parse(readFileSync(filepath, "utf-8"), safeJsonReviver);
                return cached;
            }
        }
        catch (err) {
            _logger.warn("Failed to load JSON store, using default", {
                filepath,
                error: err,
            });
        }
        cached = defaultValue;
        return cached;
    }
    function writeDisk(data) {
        try {
            ensureDir(dirname(filepath));
            writeFileSync(filepath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
        }
        catch (err) {
            _logger.warn("Failed to save JSON store", { filepath, error: err });
        }
    }
    function save(data) {
        // The in-memory cache is always updated immediately so load() returns
        // fresh data right away. Only the disk flush is deferred when debouncing.
        cached = data;
        if (debounceMs <= 0) {
            writeDisk(data);
            return;
        }
        // Coalesce rapid successive updates: reset the pending timer so only
        // the final state is written once the burst settles.
        if (flushTimer !== undefined)
            clearTimeout(flushTimer);
        flushTimer = setTimeout(() => {
            flushTimer = undefined;
            if (cached !== null)
                writeDisk(cached);
        }, debounceMs);
    }
    async function flush() {
        if (flushTimer !== undefined) {
            clearTimeout(flushTimer);
            flushTimer = undefined;
        }
        if (cached !== null)
            writeDisk(cached);
    }
    async function update(updater) {
        const release = await lock.acquire();
        try {
            const data = load();
            const updated = updater(data);
            save(updated);
            return updated;
        }
        finally {
            release();
        }
    }
    return { load, save, update, flush };
}
/**
 * Create a JSONL (newline-delimited JSON) store for append-only logs.
 *
 * `append` and `clear` are async and serialised by an internal lock to
 * prevent interleaved writes (e.g. `clear` truncating the file while
 * `append` is mid-write).
 */
export function createJSONLStore(filepath) {
    const lock = new Lock();
    function load() {
        try {
            if (existsSync(filepath)) {
                const content = readFileSync(filepath, "utf-8");
                const lines = content.split("\n").filter((line) => line.trim());
                const entries = [];
                for (const [index, line] of lines.entries()) {
                    try {
                        entries.push(JSON.parse(line, safeJsonReviver));
                    }
                    catch (err) {
                        _logger.warn("Malformed JSONL line skipped", {
                            filepath,
                            line: index + 1,
                            error: err,
                        });
                    }
                }
                return entries;
            }
        }
        catch (err) {
            _logger.warn("Failed to load JSONL store, using empty array", {
                filepath,
                error: err,
            });
        }
        return [];
    }
    async function append(entry) {
        const release = await lock.acquire();
        try {
            ensureDir(dirname(filepath));
            const line = JSON.stringify(entry);
            writeFileSync(filepath, `${line}\n`, { flag: "a", encoding: "utf-8" });
        }
        catch (err) {
            _logger.warn("Failed to append to JSONL store", { filepath, error: err });
        }
        finally {
            release();
        }
    }
    async function clear() {
        const release = await lock.acquire();
        try {
            writeFileSync(filepath, "", "utf-8");
        }
        catch (err) {
            _logger.warn("Failed to clear JSONL store", { filepath, error: err });
        }
        finally {
            release();
        }
    }
    return { load, append, clear };
}
//# sourceMappingURL=json-persistence.js.map