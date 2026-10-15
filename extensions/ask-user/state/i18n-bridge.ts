/**
 * i18n bridge for ask-user — single thin import surface so every call site
 * routes through one place. Self-contained: loads locale JSON from the
 * extension's `locales/` directory, selected by `LC_ALL`/`LANG`, with a
 * canonical-English fallback for every key.
 *
 * - `t(key, fallback)` returns the locale string for `key` when the active
 *   locale file has it, otherwise the inline English `fallback`. Call sites
 *   MUST use this at render time — never bake the result into a top-level
 *   `const X = t(...)`.
 * - `displayLabel(kind)` resolves a sentinel kind to its locale-aware label,
 *   with the canonical English `ROW_INTENT_META[kind].label` as fallback.
 *
 * Reserved-label validation stays English-locked: `RESERVED_LABEL_SET` checks
 * the canonical `ROW_INTENT_META[kind].label`, never `displayLabel(kind)`.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ROW_INTENT_META, type SentinelKind } from "./row-intent.js";

type ScopeFn = (key: string, fallback: string) => string;

const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "locales");

function normalizeLocale(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const value = raw.trim();
  if (!value) return undefined;
  // "pt_BR.UTF-8" -> "pt-br", "en_US" -> "en-us"
  const cleaned = value.replace(/[.].*$/, "").replace(/_/g, "-");
  return cleaned;
}

function resolveLocale(): string {
  const candidates = [normalizeLocale(process.env.LC_ALL), normalizeLocale(process.env.LC_MESSAGES), normalizeLocale(process.env.LANG)];
  for (const c of candidates) {
    if (!c) continue;
    const lower = c.toLowerCase();
    const exact = `${lower}.json`;
    if (existsSync(join(LOCALES_DIR, exact))) return lower;
    // try language-only prefix ("pt-br" -> "pt")
    const prefix = lower.split("-")[0];
    if (prefix && prefix !== lower && existsSync(join(LOCALES_DIR, `${prefix}.json`))) return prefix;
  }
  return "en";
}

function loadLocale(locale: string): Record<string, string> {
  try {
    const raw = readFileSync(join(LOCALES_DIR, `${locale}.json`), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const locale = resolveLocale();
const strings: Record<string, string> = loadLocale(locale);

const scopeImpl: ScopeFn = (key, fallback) => strings[key] ?? fallback;

export const t: ScopeFn = scopeImpl;

export function displayLabel(kind: SentinelKind): string {
  return t(`sentinel.${kind}`, ROW_INTENT_META[kind].label);
}
