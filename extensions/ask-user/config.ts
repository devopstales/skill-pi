import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export type CollapseKeySpec = string;

export const DEFAULT_COLLAPSE_KEY: CollapseKeySpec = "ctrl+]";
export const COLLAPSE_KEY_OFF: CollapseKeySpec = "off";

export interface GuidanceFields {
  promptSnippet?: string;
  promptGuidelines?: string[];
  description?: string;
}

export interface AskUserQuestionConfig {
  guidance?: GuidanceFields;
  /**
   * Key spec for the collapse/expand shortcut, in the same format as pi-coding-agent
   * keybinding ids (`modifier+key`, e.g. `ctrl+]`, `alt+o`, `ctrl+shift+h`). Defaults
   * to `"ctrl+]"`. Set this to a key that is reachable on your keyboard layout.
   * Pass `"off"` to disable the collapse shortcut entirely.
   */
  collapseKey?: CollapseKeySpec;
}

const SPECIAL_KEYS = new Set([
  "escape",
  "esc",
  "enter",
  "return",
  "tab",
  "space",
  "backspace",
  "delete",
  "insert",
  "clear",
  "home",
  "end",
  "pageup",
  "pagedown",
  "up",
  "down",
  "left",
  "right",
  ...Array.from({ length: 12 }, (_, i) => `f${i + 1}`),
]);

const MODIFIERS = new Set(["ctrl", "shift", "alt", "super"]);

function isValidCollapseKeySpec(spec: string): boolean {
  if (!spec) return false;
  if (spec.startsWith("+") || spec.endsWith("+") || spec.includes("++")) return false;
  const parts = spec.split("+");
  const base = parts[parts.length - 1] ?? "";
  const modifiers = parts.slice(0, -1);
  if (modifiers.length !== new Set(modifiers).size) return false;
  if (!modifiers.every((m) => MODIFIERS.has(m))) return false;
  return base.length === 1 ? /[a-z0-9_\-!@#$%^&*()|~`'":;,./<>?[\]{}=\\]/.test(base) : SPECIAL_KEYS.has(base);
}

export function resolveCollapseKey(config: Pick<AskUserQuestionConfig, "collapseKey">): CollapseKeySpec {
  const raw = config.collapseKey?.trim().toLowerCase();
  if (raw === undefined || raw === "") return DEFAULT_COLLAPSE_KEY;
  if (raw === COLLAPSE_KEY_OFF) return COLLAPSE_KEY_OFF;
  return isValidCollapseKeySpec(raw) ? raw : DEFAULT_COLLAPSE_KEY;
}

const COMPOUND_KEY_DISPLAY: Record<string, string> = {
  pageup: "PageUp",
  pagedown: "PageDown",
};

export function formatKeySpecForDisplay(spec: CollapseKeySpec): string {
  return spec
    .split("+")
    .map((part) =>
      COMPOUND_KEY_DISPLAY[part] ??
      (part.length <= 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)),
    )
    .join("+");
}

export function validateGuidanceFields(fields: unknown): GuidanceFields {
  if (!fields || typeof fields !== "object") return {};
  const g = fields as Record<string, unknown>;
  const result: GuidanceFields = {};
  if (typeof g.promptSnippet === "string" && g.promptSnippet.length > 0) {
    result.promptSnippet = g.promptSnippet;
  }
  if (
    Array.isArray(g.promptGuidelines) &&
    g.promptGuidelines.length > 0 &&
    g.promptGuidelines.every((s) => typeof s === "string" && s.length > 0)
  ) {
    result.promptGuidelines = g.promptGuidelines;
  }
  if (typeof g.description === "string" && g.description.length > 0) {
    result.description = g.description;
  }
  return result;
}

export function configPath(): string {
  return join(dirname(getAgentDir()), "conf.d", "ask-user.conf");
}

export function loadConfig(): AskUserQuestionConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const source = parsed as Record<string, unknown>;
    const config: AskUserQuestionConfig = {};
    if (source.collapseKey !== undefined) config.collapseKey = source.collapseKey as CollapseKeySpec;
    if (source.guidance !== undefined) config.guidance = validateGuidanceFields(source.guidance);
    return config;
  } catch (err) {
    console.warn(`ask-user: invalid JSON at ${path}, using default ({}) — ${(err as Error).message}`);
    return {};
  }
}
