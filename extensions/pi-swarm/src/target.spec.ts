import { describe, it, expect } from "vitest";
import { createTargetSelector, type TargetId } from "./target.ts";
import type { AgentType } from "./agents.ts";

function agent(name: string, over: Partial<AgentType> = {}): AgentType {
  return {
    name,
    description: name,
    systemPrompt: `You are ${name}.`,
    source: "project",
    ...over,
  };
}

describe("target", () => {
  it("defaults to build with empty agents and no plan", () => {
    const sel = createTargetSelector({ agents: [], planAvailable: false });
    expect(sel.current()).toBe("build");
    expect(sel.cycleList()).toEqual(["build"]);
  });

  it("cycleList builds build -> plan -> agents in discovery order", () => {
    const auditor = agent("auditor");
    const explorer = agent("explorer");
    const sel = createTargetSelector({ agents: [auditor, explorer], planAvailable: true });
    expect(sel.cycleList()).toEqual(["build", "plan", "auditor", "explorer"]);
  });

  it("cycleList omits plan when planAvailable is false", () => {
    const auditor = agent("auditor");
    const sel = createTargetSelector({ agents: [auditor], planAvailable: false });
    expect(sel.cycleList()).toEqual(["build", "auditor"]);
  });

  it("cycle() walks the list and wraps to build", () => {
    const auditor = agent("auditor");
    const explorer = agent("explorer");
    const sel = createTargetSelector({ agents: [auditor, explorer], planAvailable: true });
    expect(sel.cycle()).toBe("plan");
    expect(sel.cycle()).toBe("auditor");
    expect(sel.cycle()).toBe("explorer");
    expect(sel.cycle()).toBe("build");
    expect(sel.current()).toBe("build");
  });

  it("cycle() with only build stays on build", () => {
    const sel = createTargetSelector({ agents: [], planAvailable: false });
    expect(sel.cycle()).toBe("build");
    expect(sel.current()).toBe("build");
  });

  it("matchesAgent returns the AgentType for agent targets", () => {
    const auditor = agent("auditor");
    const explorer = agent("explorer");
    const sel = createTargetSelector({ agents: [auditor, explorer], planAvailable: true });
    expect(sel.matchesAgent("auditor")).toBe(auditor);
    expect(sel.matchesAgent("explorer")).toBe(explorer);
  });

  it("matchesAgent returns undefined for build and plan", () => {
    const auditor = agent("auditor");
    const sel = createTargetSelector({ agents: [auditor], planAvailable: true });
    expect(sel.matchesAgent("build")).toBeUndefined();
    expect(sel.matchesAgent("plan")).toBeUndefined();
  });

  it("matchesAgent returns undefined for unknown ids", () => {
    const auditor = agent("auditor");
    const sel = createTargetSelector({ agents: [auditor], planAvailable: false });
    expect(sel.matchesAgent("ghost")).toBeUndefined();
  });

  it("set() moves to a known id and reports it", () => {
    const auditor = agent("auditor");
    const sel = createTargetSelector({ agents: [auditor], planAvailable: true });
    expect(sel.set("auditor")).toBe("auditor");
    expect(sel.current()).toBe("auditor");
  });

  it("set() to an unknown id is a no-op", () => {
    const sel = createTargetSelector({ agents: [], planAvailable: false });
    expect(sel.set("ghost")).toBe("build");
    expect(sel.current()).toBe("build");
  });

  it("set() to plan requires planAvailable", () => {
    const sel = createTargetSelector({ agents: [], planAvailable: false });
    expect(sel.set("plan")).toBe("build");
    const withPlan = createTargetSelector({ agents: [], planAvailable: true });
    expect(withPlan.set("plan")).toBe("plan");
  });
});
