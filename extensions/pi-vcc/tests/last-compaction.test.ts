import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { LAST_COMPACT_PATH_DEFAULT, readLastCompaction, writeLastCompaction, type LastCompaction } from "../src/core/last-compaction";

const tmp = () => mkdtempSync(join(tmpdir(), "pi-vcc-last-compact-"));

const RECORD: LastCompaction = {
  at: "2026-10-18T09:00:00.000Z",
  reason: "manual",
  keptUserTurns: 2,
  totalUserTurns: 5,
  keptTokensEst: 3200,
  smartKeepAdjusted: true,
  sections: ["Goals", "State"],
  firstKeptEntryId: "u3",
  summaryLength: 4321,
};

afterAll(() => {
  delete process.env.PI_VCC_LAST_COMPACT_PATH;
});

describe("last-compaction module", () => {
  it("exposes LAST_COMPACT_PATH_DEFAULT ending in last-compaction.json", () => {
    expect(LAST_COMPACT_PATH_DEFAULT.endsWith("last-compaction.json")).toBe(true);
  });
});

describe("readLastCompaction", () => {
  it("returns null when the file is missing", () => {
    process.env.PI_VCC_LAST_COMPACT_PATH = join(tmp(), "none.json");
    expect(readLastCompaction()).toBeNull();
  });

  it("parses a valid last-compaction.json", () => {
    const p = join(tmp(), "last.json");
    writeFileSync(p, JSON.stringify(RECORD));
    process.env.PI_VCC_LAST_COMPACT_PATH = p;
    expect(readLastCompaction()).toEqual(RECORD);
  });

  it("returns null on invalid JSON (no throw)", () => {
    const p = join(tmp(), "bad.json");
    writeFileSync(p, "{bad");
    process.env.PI_VCC_LAST_COMPACT_PATH = p;
    expect(readLastCompaction()).toBeNull();
  });

  it("returns null when JSON is not an object", () => {
    const p = join(tmp(), "arr.json");
    writeFileSync(p, "[1,2,3]");
    process.env.PI_VCC_LAST_COMPACT_PATH = p;
    expect(readLastCompaction()).toBeNull();
  });

  it("resolves the env override path at read time, not import time", () => {
    const p = join(tmp(), "later.json");
    writeFileSync(p, JSON.stringify({ ...RECORD, at: "later" }));
    process.env.PI_VCC_LAST_COMPACT_PATH = p;
    expect(readLastCompaction()!.at).toBe("later");
  });
});

describe("writeLastCompaction", () => {
  it("writes and reads back the record", () => {
    const p = join(tmp(), "roundtrip.json");
    process.env.PI_VCC_LAST_COMPACT_PATH = p;
    writeLastCompaction(RECORD);
    expect(readLastCompaction()).toEqual(RECORD);
    expect(readFileSync(p, "utf-8")).toContain('"keptUserTurns": 2');
  });

  it("does not throw when the target path is not writable", () => {
    process.env.PI_VCC_LAST_COMPACT_PATH = "/nope/none-dir/last.json";
    expect(() => writeLastCompaction(RECORD)).not.toThrow();
  });
});
