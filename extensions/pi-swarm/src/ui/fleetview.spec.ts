import { describe, expect, it, vi } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
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
  const component = createFleetView(model, { clock: { now: () => 0, setTimer: () => 0, clearTimer: () => {} } });
  return { model, component };
}

function selectedLine(component: ReturnType<typeof createFleetView>): string {
  const line = component.render(80).find((l) => l.includes("❯"));
  expect(line).toBeDefined();
  return line!;
}

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

function makeClock(initial = 0) {
  let now = initial;
  const timers = new Map<unknown, { due: number; fn: () => void }>();
  let nextId = 1;
  const clock = {
    now: () => now,
    setTimer: (fn: () => void, delay: number): unknown => {
      const id = nextId++;
      timers.set(id, { due: now + delay, fn });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id);
    },
    advance: (ms: number) => {
      const target = now + ms;
      while (true) {
        let dueId: unknown;
        let dueAt = Infinity;
        for (const [id, t] of timers) {
          if (t.due <= target && t.due < dueAt) {
            dueAt = t.due;
            dueId = id;
          }
        }
        if (dueId === undefined) break;
        now = dueAt;
        const timer = timers.get(dueId)!;
        timers.delete(dueId);
        timer.fn();
      }
      now = target;
    },
  };
  return clock;
}

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

describe("fleetview transcript overlay", () => {
  function transcriptLines(count: number, text = (i: number) => `line ${i}`) {
    return Array.from({ length: count }, (_, i) => ({ kind: "assistant" as const, text: text(i) }));
  }

  it("[R-fleetview-open-transcript] Enter on a running agent renders its transcript sanitized", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: [
        { kind: "user", text: "do the thing" },
        { kind: "assistant", text: "working \x1b[1mnow\x1b[0m" },
        { kind: "tool", text: "grep foo" },
        { kind: "error", text: "boom" },
      ],
    });
    const { component } = setup([agent]);
    component.handleInput!(ENTER);
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("> do the thing"))).toBe(true);
    expect(lines.some((l) => l.includes("working now"))).toBe(true);
    expect(lines.some((l) => l.includes("grep foo"))).toBe(true);
    expect(lines.some((l) => l.includes("boom"))).toBe(true);
    expect(lines.join("\n")).not.toContain("\x1b[1m");
  });

  it("[R-fleetview-open-transcript] a new snapshot with more lines re-renders with the extra line (auto-follow)", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(20),
    });
    const { model, component } = setup([agent]);
    component.handleInput!(ENTER);
    expect(component.render(80).some((l) => l.includes("line 19"))).toBe(true);
    agent.transcript = transcriptLines(21);
    model.emit();
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("line 20"))).toBe(true);
    expect(lines.some((l) => l.includes("line 19"))).toBe(true);
    expect(lines.some((l) => l.includes("line 0"))).toBe(false);
  });

  it("scroll up pauses auto-follow; scrolling to bottom resumes", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(30),
    });
    const { model, component } = setup([agent]);
    component.handleInput!(ENTER);
    expect(component.render(80).some((l) => l.includes("line 29"))).toBe(true);
    component.handleInput!(UP);
    component.handleInput!(UP);
    agent.transcript = transcriptLines(31);
    model.emit();
    let lines = component.render(80);
    expect(lines.some((l) => l.includes("line 30"))).toBe(false);
    expect(lines.some((l) => l.includes("line 27"))).toBe(true);
    for (let i = 0; i < 30; i += 1) component.handleInput!(DOWN);
    agent.transcript = transcriptLines(32);
    model.emit();
    lines = component.render(80);
    expect(lines.some((l) => l.includes("line 31"))).toBe(true);
  });

  it("wraps long transcript lines to the width", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: [{ kind: "assistant", text: "x".repeat(300) }],
    });
    const { component } = setup([agent]);
    component.handleInput!(ENTER);
    const lines = component.render(40).filter((l) => l.length > 0);
    expect(Math.max(...lines.map((l) => visibleWidth(l)))).toBeLessThanOrEqual(40);
  });

  it("[R-fleetview-stop] x twice cancels the open agent", async () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(2),
    });
    const { model, component } = setup([agent]);
    component.handleInput!(ENTER);
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).not.toHaveBeenCalled();
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).toHaveBeenCalledWith("sa-1");
  });

  it("x once then another key does not cancel", async () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(2),
    });
    const { model, component } = setup([agent]);
    component.handleInput!(ENTER);
    component.handleInput!("x");
    component.handleInput!("a");
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).not.toHaveBeenCalled();
  });

  it("x once then expiry does not cancel", async () => {
    const clock = makeClock();
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(2),
    });
    const model = makeReadModel([agent]);
    const component = createFleetView(model, { clock: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer } });
    component.handleInput!(ENTER);
    component.handleInput!("x");
    if (process.env.DEBUG_FV) console.log("TEST before advance");
    clock.advance(2001);
    if (process.env.DEBUG_FV) console.log("TEST after advance");
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).not.toHaveBeenCalled();
  });

  it("Esc in the overlay returns to the list with the selection retained", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(5),
    });
    const { component } = setup([agent]);
    component.handleInput!(ENTER);
    expect(component.render(80).some((l) => l.includes("line 4"))).toBe(true);
    component.handleInput!(ESC);
    const lines = component.render(80);
    expect(lines.find((l) => l.includes("❯"))).toBeDefined();
    expect(lines.find((l) => l.includes("❯"))).toContain("first");
  });

  it("Enter again re-opens the overlay", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(5),
    });
    const { component } = setup([agent]);
    component.handleInput!(ENTER);
    component.handleInput!(ESC);
    component.handleInput!(ENTER);
    expect(component.render(80).some((l) => l.includes("line 4"))).toBe(true);
  });

  it("throttles rapid snapshot updates to a trailing render", () => {
    const clock = makeClock();
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(1),
    });
    const model = makeReadModel([agent]);
    const component = createFleetView(model, { clock: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer } });
    component.handleInput!(ENTER);
    let requestRenders = 0;
    component.tui = { requestRender: () => { requestRenders += 1; } } as never;
    agent.transcript = transcriptLines(2);
    model.emit();
    agent.transcript = transcriptLines(3);
    model.emit();
    expect(requestRenders).toBe(0);
    clock.advance(50);
    expect(requestRenders).toBe(1);
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("line 2"))).toBe(true);
  });

  it("flushes a pending render on dispose", () => {
    const clock = makeClock();
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: transcriptLines(1),
    });
    const model = makeReadModel([agent]);
    const component = createFleetView(model, { clock: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer } });
    component.handleInput!(ENTER);
    let requests = 0;
    component.tui = { requestRender: () => { requests += 1; } } as never;
    agent.transcript = transcriptLines(3);
    model.emit();
    expect(requests).toBe(0);
    clock.advance(50);
    expect(requests).toBe(1);
    component.dispose();
    agent.transcript = transcriptLines(4);
    model.emit();
    clock.advance(50);
    expect(requests).toBe(1);
  });
});
