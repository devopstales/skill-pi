import { describe, expect, it } from "vitest";
import { formatAgentRow, formatElapsed, formatTokens, type FleetTheme } from "./format.ts";
import type { AgentSnapshot } from "./domain.ts";

const theme: FleetTheme = {
  fg: (_c, t) => t,
  bold: (t) => t,
};

function snap(partial: Partial<AgentSnapshot> & { id: string; status: AgentSnapshot["status"] }): AgentSnapshot {
  return {
    title: "title",
    agentType: "",
    createdAt: 0,
    turns: 0,
    tokens: 0,
    finalText: "",
    latestText: "",
    consumed: false,
    transcript: [],
    ...partial,
  };
}

describe("formatElapsed", () => {
  it("formats seconds below a minute", () => {
    expect(formatElapsed(59_000)).toBe("59s");
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  it("formats minutes with zero-padded seconds", () => {
    expect(formatElapsed(61_000)).toBe("1m01s");
    expect(formatElapsed(60_000)).toBe("1m00s");
    expect(formatElapsed(1_201_000)).toBe("20m01s");
  });

  it("formats hours without seconds", () => {
    expect(formatElapsed(7_380_000)).toBe("2h03m");
    expect(formatElapsed(3_600_000)).toBe("1h00m");
  });
});

describe("formatTokens", () => {
  it("returns the raw value below 1000", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(999)).toBe("999");
  });

  it("formats thousands with one decimal", () => {
    expect(formatTokens(12_400)).toBe("12.4k");
    expect(formatTokens(1_000)).toBe("1.0k");
    expect(formatTokens(999_999)).toBe("1000.0k");
  });
});

describe("formatAgentRow", () => {
  it("renders status glyph, title, and dim agentType · modelLabel · tokens · elapsed", () => {
    const s = snap({
      id: "sa-1",
      status: "running",
      title: "research the api",
      agentType: "researcher",
      modelLabel: "opus",
      tokens: 12_400,
      createdAt: 0,
    });
    const line = formatAgentRow(s, 100, 61_000, theme);
    expect(line.startsWith("⠹")).toBe(true);
    expect(line).toContain("research the api");
    expect(line).toContain("researcher · opus · 12.4k · 1m01s");
  });

  it("uses the glyph per status", () => {
    expect(formatAgentRow(snap({ id: "a", status: "done" }), 80, 0, theme).startsWith("✓")).toBe(true);
    expect(formatAgentRow(snap({ id: "a", status: "error" }), 80, 0, theme).startsWith("✗")).toBe(true);
    expect(formatAgentRow(snap({ id: "a", status: "interrupted" }), 80, 0, theme).startsWith("■")).toBe(true);
    expect(formatAgentRow(snap({ id: "a", status: "queued" }), 80, 0, theme).startsWith("…")).toBe(true);
  });

  it("truncates the title to fit the width", () => {
    const s = snap({ id: "a", status: "running", title: "x".repeat(120) });
    const line = formatAgentRow(s, 40, 0, theme);
    expect(line).toContain("…");
    expect(line).not.toContain("x".repeat(50));
    expect(line.length).toBeLessThanOrEqual(40);
  });

  it("uses default when modelLabel is absent", () => {
    const s = snap({ id: "a", status: "done", agentType: "generic", tokens: 500, createdAt: 0, settledAt: 12_000 });
    const line = formatAgentRow(s, 100, 0, theme);
    expect(line).toContain("generic · default · 500 · 12s");
  });
});
