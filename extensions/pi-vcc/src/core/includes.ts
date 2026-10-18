import { readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface IncludeEntry {
  path: string;
  source?: string;
}

export interface IncludedRule {
  file: string;
  lines: string[];
  truncated: boolean;
  dropped: number;
}

export const INCLUDES_PATH_DEFAULT: string = join(getAgentDir(), "pi-vcc-includes.json");
const includesPath = (): string => process.env.PI_VCC_INCLUDES_PATH ?? INCLUDES_PATH_DEFAULT;

const MAX_RULES_LINES = 150;
const MAX_RULES_BYTES = 6 * 1024;

export const readIncludes = (): IncludeEntry[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(includesPath(), "utf-8"));
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
  const list = (parsed as { includes?: unknown }).includes;
  if (!Array.isArray(list)) return [];
  const entries: IncludeEntry[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const entry = item as { path?: unknown; source?: unknown };
    if (typeof entry.path !== "string") continue;
    if (!entry.path.startsWith("/") || !entry.path.endsWith(".md")) continue;
    entries.push({
      path: entry.path,
      ...(typeof entry.source === "string" ? { source: entry.source } : {}),
    });
  }
  return entries;
};

const stripFencedLines = (text: string): string[] => {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const t = line.trim();
    if (t) out.push(t);
  }
  return out;
};

const utf8Bytes = (line: string): number => Buffer.byteLength(line, "utf-8");

export const readIncludedRules = (entries: IncludeEntry[] = readIncludes()): IncludedRule[] => {
  const out: IncludedRule[] = [];
  let linesUsed = 0;
  let bytesUsed = 0;
  for (const entry of entries) {
    let text: string;
    try {
      text = readFileSync(entry.path, "utf-8");
    } catch {
      continue;
    }
    const kept: string[] = [];
    let seen = new Set<string>();
    let dropped = 0;
    let truncated = false;
    for (const line of stripFencedLines(text)) {
      if (seen.has(line)) continue;
      const usedLines = linesUsed + kept.length;
      if (usedLines + 1 > MAX_RULES_LINES || bytesUsed + utf8Bytes(line) > MAX_RULES_BYTES) {
        dropped++;
        truncated = true;
        continue;
      }
      seen.add(line);
      kept.push(line);
      bytesUsed += utf8Bytes(line);
    }
    linesUsed += kept.length;
    if (kept.length > 0) out.push({ file: entry.path, lines: kept, truncated, dropped });
  }
  return out;
};

const REF_RE = /^\s*(?:[-*+]|\d+\.)?\s*@(\S+)/;

export const extractRefTokens = (text: string): string[] => {
  const out: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = REF_RE.exec(line);
    if (!m || m[1].includes("@")) continue;
    out.push(`@${m[1]}`);
  }
  return out;
};
