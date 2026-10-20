import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { basename } from "path";
import { loadSettings } from "../core/settings";
import { readIncludes, readIncludedRules } from "../core/includes";
import { readLastCompaction } from "../core/last-compaction";

const MAX_RULES_LINES = 150;
const MAX_RULES_BYTES = 6144;

const formatTokens = (n: number): string => {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
};

const renderLastCompaction = (): string[] => {
  const last = readLastCompaction();
  const lines: string[] = ["Last compaction:"];
  if (!last) {
    lines.push("  none yet");
    return lines;
  }
  lines.push(`  at: ${last.at}`);
  lines.push(`  reason: ${last.reason}`);
  lines.push(`  turns: ${last.keptUserTurns}/${last.totalUserTurns}`);
  lines.push(`  keptTokensEst: ~${formatTokens(last.keptTokensEst)} tok`);
  if (last.smartKeepAdjusted) lines.push("  smart-keep: adjusted");
  lines.push(`  sections: ${last.sections.length > 0 ? last.sections.join(", ") : "none"}`);
  lines.push(`  firstKeptEntryId: ${last.firstKeptEntryId}`);
  lines.push(`  summaryLength: ${last.summaryLength}`);
  return lines;
};

const renderSettings = (): string[] => {
  const settings = loadSettings();
  const lines: string[] = ["Settings:"];
  for (const [key, value] of Object.entries(settings)) {
    lines.push(`  ${key}: ${value}`);
  }
  return lines;
};

const renderIncludes = (): string[] => {
  const entries = readIncludes();
  const lines: string[] = ["Includes:"];
  let totalLines = 0;
  let totalBytes = 0;
  if (entries.length === 0) {
    lines.push(`  none (0/${MAX_RULES_LINES} lines, 0/${MAX_RULES_BYTES} bytes)`);
  }
  for (const entry of entries) {
    // an entry in the result means the file was found, even if the global cap
    // left it 0 lines — that is still "loaded", not "missing"
    const rules = readIncludedRules([entry]);
    if (rules.length > 0) {
      lines.push(`  loaded ${basename(entry.path)}`);
      for (const rule of rules) {
        totalLines += rule.lines.length;
        totalBytes += rule.lines.reduce((sum: number, line: string) => sum + Buffer.byteLength(line, "utf-8"), 0);
      }
    } else {
      lines.push(`  missing ${entry.path}`);
    }
  }
  if (entries.length > 0) {
    lines.push(`  ${totalLines}/${MAX_RULES_LINES} lines, ${totalBytes}/${MAX_RULES_BYTES} bytes`);
  }
  return lines;
};

export const registerVccStatusCommand = (pi: ExtensionAPI) => {
  pi.registerCommand("pi-vcc:status", {
    description: "Show last compaction, settings, and include status",
    handler: async (_args: string, _ctx) => {
      const content = [...renderLastCompaction(), "", ...renderSettings(), "", ...renderIncludes()].join("\n");
      pi.sendMessage({ customType: "pi-vcc-status", content, display: true }, { triggerTurn: true });
    },
  });
};
