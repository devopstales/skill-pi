import type { SearchHit } from "./search-entries";
import type { IncludeEntry } from "./includes";
import { readIncludedRules } from "./includes";
import { basename } from "path";

const MAX_REFS_PER_PAGE = 10;
const MAX_REF_LINES = 40;
const MAX_REF_BYTES = 2 * 1024;

export interface RecallOutputOpts {
  expandRefs?: boolean;
  knownIncludes?: IncludeEntry[];
}

// Fence-safe: fenced blocks are skipped. Matches the same @path shape as
// Task 1's extractRefTokens, which only sees line starts; rendered hit lines
// carry a "#N [role]" prefix, so we also try the body with that prefix off.
const REF_RE = /^\s*(?:[-*+]|\d+\.)?\s*@(\S+)/;

const refTokensIn = (body: string): string[] => {
  const out: string[] = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    for (const candidate of [line, line.replace(/^\S+\s+/, "")]) {
      const m = REF_RE.exec(candidate);
      if (m && !m[1].includes("@")) {
        out.push(`@${m[1]}`);
        break;
      }
    }
  }
  return out;
};

const expandRef = (token: string, knownIncludes: IncludeEntry[]): string => {
  const entry = knownIncludes.find((i) => i.path === token.slice(1));
  if (!entry) return "";
  const rules = readIncludedRules([entry]);
  if (rules.length === 0) return "";
  const rule = rules[0];
  const kept: string[] = [];
  let bytes = 0;
  for (const line of rule.lines) {
    if (kept.length >= MAX_REF_LINES || bytes + Buffer.byteLength(line, "utf-8") > MAX_REF_BYTES) break;
    kept.push(line);
    bytes += Buffer.byteLength(line, "utf-8");
  }
  const truncated = rule.truncated || rule.dropped > 0 || kept.length < rule.lines.length;
  const suffix = truncated ? " (truncated)" : "";
  return `@ref: ${basename(rule.file)}${suffix}\n${kept.join("\n")}`;
};

export const formatRecallOutput = (
  entries: SearchHit[],
  query?: string,
  headerOverride?: string,
  opts?: RecallOutputOpts,
): string => {
  if (entries.length === 0) {
    return query
      ? `No matches for "${query}" in session history.`
      : "No entries in session history.";
  }

  const header = headerOverride
    ? `${headerOverride} for "${query}":`
    : query
      ? `Found ${entries.length} matches for "${query}":`
      : `Session history (${entries.length} entries):`;

  let refsUsed = 0;
  const lines = entries.map((e) => {
    const body = query && e.snippet ? e.snippet : e.summary;
    const fileSuffix = e.files?.length ? ` files:[${e.files.join(", ")}]` : "";
    const line = `#${e.index} [${e.role}]${fileSuffix} ${body}`;
    if (!opts?.expandRefs || !opts.knownIncludes?.length || refsUsed >= MAX_REFS_PER_PAGE) {
      return line;
    }
    for (const token of refTokensIn(body)) {
      const ref = expandRef(token, opts.knownIncludes);
      if (ref) {
        refsUsed++;
        return `${line}\n${ref}`;
      }
    }
    return line;
  });

  return `${header}\n\n${lines.join("\n\n")}`;
};
