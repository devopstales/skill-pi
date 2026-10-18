import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface LastCompaction {
  at: string;
  reason: string;
  keptUserTurns: number;
  totalUserTurns: number;
  keptTokensEst: number;
  smartKeepAdjusted: boolean;
  sections: string[];
  firstKeptEntryId: string;
  summaryLength: number;
}

export const LAST_COMPACT_PATH_DEFAULT: string = join(getAgentDir(), "last-compaction.json");
export const lastCompactPath = (): string => process.env.PI_VCC_LAST_COMPACT_PATH ?? LAST_COMPACT_PATH_DEFAULT;

export const writeLastCompaction = (record: LastCompaction): void => {
  try {
    writeFileSync(lastCompactPath(), `${JSON.stringify(record, null, 2)}\n`);
  } catch {}
};

export const readLastCompaction = (): LastCompaction | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(lastCompactPath(), "utf-8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return parsed as LastCompaction;
};
