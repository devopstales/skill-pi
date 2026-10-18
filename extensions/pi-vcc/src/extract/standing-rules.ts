import { basename } from "path";
import { readIncludedRules, type IncludeEntry } from "../core/includes";

export const buildStandingRules = (entries?: IncludeEntry[]): string[] => {
  const rules = readIncludedRules(entries);
  const lines: string[] = [];
  for (const r of rules) {
    lines.push(...r.lines);
    if (r.truncated) lines.push(`(+${r.dropped} more in ${basename(r.file)})`);
  }
  return lines;
};
