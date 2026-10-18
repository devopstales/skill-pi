import { describe, it, expect } from "vitest";
import { decodeJsonlLine, decodeJsonlBuffer } from "./jsonl.ts";

describe("jsonl", () => {
  it("decodes a complete line", () => {
    expect(decodeJsonlLine('{"type":"agent_start"}\n')).toEqual({ type: "agent_start" });
  });
  it("returns undefined for invalid json and empty lines", () => {
    expect(decodeJsonlLine("not json\n")).toBeUndefined();
    expect(decodeJsonlLine("\n")).toBeUndefined();
  });
  it("buffers partial lines across chunks", () => {
    const a = decodeJsonlBuffer('{"type":"agent_s');
    expect(a.events).toEqual([]);
    expect(a.remainder).toBe('{"type":"agent_s');
    const b = decodeJsonlBuffer(a.remainder + 'tart"}\n{"type":"agent_end"}');
    expect(b.events).toEqual([{ type: "agent_start" }]);
    expect(b.remainder).toBe('{"type":"agent_end"}');
  });
});
