import { describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "../domain.ts";
import { createFleetView, isFleetViewVisible, type FleetReadModel } from "./fleetview.ts";

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

function makeReadModel(agents: AgentSnapshot[]): FleetReadModel & { emit: () => void; cancel: ReturnType<typeof vi.fn> } {
  const cancel = vi.fn().mockResolvedValue(undefined);
  const listeners = new Set<() => void>();
  const model = {
    list: () => agents,
    get: (id: string) => agents.find((a) => a.id === id),
    cancel,
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    emit: () => {
      for (const l of [...listeners]) l();
    },
  };
  return model;
}

function setup(agents: AgentSnapshot[]) {
  const model = makeReadModel(agents);
  const component = createFleetView(model);
  return { model, component };
}

function selectedLine(component: ReturnType<typeof createFleetView>): string {
  const line = component.render(80).find((l) => l.includes("❯"));
  expect(line).toBeDefined();
  return line!;
}

const UP = "\x1b[A";
const DOWN = "\x1b[B";

describe("isFleetViewVisible", () => {
  it("is false with no agents", () => {
    expect(isFleetViewVisible([])).toBe(false);
  });

  it("is true while an agent is running or queued", () => {
    expect(isFleetViewVisible([snap({ id: "a", status: "running" })])).toBe(true);
    expect(isFleetViewVisible([snap({ id: "a", status: "done" }), snap({ id: "b", status: "queued" })])).toBe(true);
  });

  it("is false when all agents are settled", () => {
    expect(isFleetViewVisible([snap({ id: "a", status: "done" }), snap({ id: "b", status: "error" })])).toBe(false);
  });
});

describe("fleetview rows", () => {
  it("renders the main row first, then agents in launch order", () => {
    const { model, component } = setup([
      snap({ id: "sa-2", title: "second", status: "done", createdAt: 2, agentType: "generic" }),
      snap({ id: "sa-1", title: "first", status: "running", createdAt: 1, agentType: "generic" }),
    ]);
    const lines = component.render(80);
    expect(lines.length).toBeGreaterThan(0);
    const first = lines[0];
    expect(first).toContain("main");
    const i1 = lines.findIndex((l) => l.includes("first"));
    const i2 = lines.findIndex((l) => l.includes("second"));
    expect(i1).toBeGreaterThan(0);
    expect(i2).toBeGreaterThan(i1);
    const last = lines[lines.length - 1];
    expect(last).toContain("esc to return · enter to open · x to stop");
    const selected = selectedLine(component);
    expect(selected).toBe(lines[i1]);
    expect(lines[i2]).not.toContain("❯");
    expect(model.cancel).not.toHaveBeenCalled();
  });

  it("renders no rows when there are no agents", () => {
    const { component } = setup([]);
    expect(component.render(80)).toEqual([]);
  });

  it("selects the first running agent on entry", () => {
    const { component } = setup([
      snap({ id: "sa-1", title: "first", status: "done", createdAt: 1 }),
      snap({ id: "sa-2", title: "second", status: "running", createdAt: 2 }),
    ]);
    expect(selectedLine(component)).toContain("second");
  });
});

describe("fleetview keys", () => {
  it("moves selection down and up", () => {
    const { component } = setup([
      snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 }),
      snap({ id: "sa-2", title: "second", status: "done", createdAt: 2 }),
    ]);
    expect(selectedLine(component)).toContain("first");
    component.handleInput!(DOWN);
    expect(selectedLine(component)).toContain("second");
    component.handleInput!(DOWN);
    expect(selectedLine(component)).toContain("second");
    component.handleInput!(UP);
    expect(selectedLine(component)).toContain("first");
    component.handleInput!(DOWN);
    expect(selectedLine(component)).toContain("second");
    component.handleInput!(UP);
    expect(selectedLine(component)).toContain("first");
  });

  it("reaches the main row above the first agent", () => {
    const { component } = setup([
      snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 }),
      snap({ id: "sa-2", title: "second", status: "done", createdAt: 2 }),
    ]);
    expect(selectedLine(component)).toContain("first");
    component.handleInput!(UP);
    expect(selectedLine(component)).toContain("main");
    component.handleInput!(UP);
    expect(selectedLine(component)).toContain("main");
    component.handleInput!(DOWN);
    expect(selectedLine(component)).toContain("first");
  });

  it("x cancels the selected agent", async () => {
    const { model, component } = setup([
      snap({ id: "sa-1", title: "first", status: "done", createdAt: 1 }),
      snap({ id: "sa-2", title: "second", status: "running", createdAt: 2 }),
    ]);
    expect(selectedLine(component)).toContain("second");
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).toHaveBeenCalledWith("sa-2");
  });

  it("x on the main row does not cancel", async () => {
    const { model, component } = setup([
      snap({ id: "sa-1", title: "first", status: "done", createdAt: 1 }),
      snap({ id: "sa-2", title: "second", status: "running", createdAt: 2 }),
    ]);
    expect(selectedLine(component)).toContain("second");
    for (let i = 0; i < 7; i += 1) component.handleInput!("\x1b[A");
    for (let i = 0; i < 7; i += 1) component.handleInput!("\x1b[B");
    for (let i = 0; i < 7; i += 1) component.handleInput!("\x1b[A");
    expect(selectedLine(component)).toContain("main");
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).not.toHaveBeenCalled();
  });

  it("Enter and Esc are no-ops", () => {
    const { component } = setup([snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 })]);
    expect(() => {
      component.handleInput!("\r");
      component.handleInput!("\x1b");
      component.handleInput!("q");
    }).not.toThrow();
  });
});

describe("fleetview subscription", () => {
  it("re-renders after a read-model change", () => {
    const agent = snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 });
    const { model, component } = setup([agent]);
    expect(component.render(80).find((l) => l.includes("first"))).toBeDefined();
    agent.title = "renamed";
    agent.tokens = 12_400;
    model.emit();
    expect(component.render(80).find((l) => l.includes("renamed"))).toBeDefined();
    expect(component.render(80).find((l) => l.includes("renamed"))).toContain("12.4k");
  });

  it("dispose stops listening", () => {
    const agent = snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 });
    const { model, component } = setup([agent]);
    component.dispose();
    expect(() => model.emit()).not.toThrow();
  });
});
