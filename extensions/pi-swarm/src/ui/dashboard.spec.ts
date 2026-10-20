import { describe, expect, it, vi } from "vitest";
import type { AgentSnapshot } from "../domain.ts";
import { createDashboard, type DashboardReadModel } from "./dashboard.ts";
import { transcriptOverlayRows } from "./fleetview.ts";

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

function makeReadModel(agents: AgentSnapshot[]): DashboardReadModel & { emit: () => void; cancel: ReturnType<typeof vi.fn> } {
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

function setup(agents: AgentSnapshot[]) {
  const model = makeReadModel(agents);
  const component = createDashboard(model);
  return { model, component };
}

function selectedLine(component: ReturnType<typeof createDashboard>): string {
  const line = component.render(80).find((l) => l.includes("❯"));
  expect(line).toBeDefined();
  return line!;
}

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const ENTER = "\r";
const ESC = "\x1b";

describe("dashboard rows", () => {
  it("renders every tracked agent, including settled ones", () => {
    const { component } = setup([
      snap({ id: "sa-1", title: "running-one", status: "running", createdAt: 1 }),
      snap({ id: "sa-2", title: "queued-one", status: "queued", createdAt: 2 }),
      snap({ id: "sa-3", title: "done-one", status: "done", createdAt: 3, settledAt: 100, finalText: "final", tokens: 12_400 }),
      snap({ id: "sa-4", title: "error-one", status: "error", createdAt: 4, settledAt: 200 }),
      snap({ id: "sa-5", title: "interrupted-one", status: "interrupted", createdAt: 5, settledAt: 300 }),
    ]);
    const lines = component.render(120);
    for (const title of ["running-one", "queued-one", "done-one", "error-one", "interrupted-one"]) {
      expect(lines.some((l) => l.includes(title)), `row for ${title}`).toBe(true);
    }
    const done = lines.find((l) => l.includes("done-one"))!;
    expect(done).toContain("✓");
    expect(done).toContain("12.4k");
  });

  it("renders settled rows in launch order without a main row", () => {
    const { component } = setup([
      snap({ id: "sa-2", title: "second", status: "done", createdAt: 2 }),
      snap({ id: "sa-1", title: "first", status: "done", createdAt: 1 }),
    ]);
    const lines = component.render(80).filter((l) => l.includes("first") || l.includes("second"));
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("first");
    expect(lines[1]).toContain("second");
    expect(component.render(80).some((l) => l.includes("❯ main"))).toBe(false);
  });

  it("shows a hint row", () => {
    const { component } = setup([snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 })]);
    const last = component.render(80).at(-1);
    expect(last).toContain("j/k move");
  });

  it("renders an empty state when no agents are tracked", () => {
    const { component } = setup([]);
    const lines = component.render(80);
    expect(lines.some((l) => l.toLowerCase().includes("no swarm agents"))).toBe(true);
  });
});

describe("dashboard keys", () => {
  it("j/k move the selection", () => {
    const { component } = setup([
      snap({ id: "sa-1", title: "first", status: "done", createdAt: 1 }),
      snap({ id: "sa-2", title: "second", status: "running", createdAt: 2 }),
    ]);
    expect(selectedLine(component)).toContain("first");
    component.handleInput!("k");
    expect(selectedLine(component)).toContain("first");
    component.handleInput!("j");
    expect(selectedLine(component)).toContain("second");
    component.handleInput!("k");
    expect(selectedLine(component)).toContain("first");
  });

  it("up/down arrows move the selection", () => {
    const { component } = setup([
      snap({ id: "sa-1", title: "first", status: "done", createdAt: 1 }),
      snap({ id: "sa-2", title: "second", status: "running", createdAt: 2 }),
    ]);
    component.handleInput!(DOWN);
    expect(selectedLine(component)).toContain("second");
    component.handleInput!(UP);
    expect(selectedLine(component)).toContain("first");
    component.handleInput!(UP);
    expect(selectedLine(component)).toContain("first");
  });

  it("Enter takes over the selected agent with its transcript", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "done",
      createdAt: 1,
      settledAt: 100,
      transcript: [{ kind: "assistant", text: "settled \x1b[1moutput\x1b[0m" }],
    });
    const { component } = setup([agent]);
    component.handleInput!(ENTER);
    const lines = component.render(80);
    expect(lines.some((l) => l.includes("settled output"))).toBe(true);
    expect(lines.join("\n")).not.toContain("\x1b[1m");
    expect(component.overlayOpen()).toBe(true);
    expect(component.overlayId()).toBe("sa-1");
  });

  it("Enter in the overlay reuses the shared fleetview overlay rows", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: [
        { kind: "user", text: "do the thing" },
        { kind: "assistant", text: "answer" },
      ],
    });
    const { component } = setup([agent]);
    component.handleInput!(ENTER);
    const width = 100;
    const lines = component.render(width);
    const bodyStart = lines.findIndex((l) => l.startsWith("│"));
    expect(bodyStart).toBeGreaterThanOrEqual(1);
    const inner = width - 2;
    const expected = transcriptOverlayRows(agent.transcript, inner, 0, { fg: (_c, t) => t, bold: (t) => t });
    expect(lines.slice(bodyStart, bodyStart + expected.length)).toEqual(expected);
  });

  it("x twice cancels the selected agent; x once does not", async () => {
    const { model, component } = setup([
      snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 }),
    ]);
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).not.toHaveBeenCalled();
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).toHaveBeenCalledWith("sa-1");
  });

  it("x cancels the open overlay agent with the same two-press confirm", async () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: [{ kind: "assistant", text: "line" }],
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

  it("a different key after x disarms the confirm", async () => {
    const { model, component } = setup([
      snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 }),
    ]);
    component.handleInput!("x");
    component.handleInput!("a");
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).not.toHaveBeenCalled();
  });

  it("Esc closes the dashboard", () => {
    const { component } = setup([
      snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 }),
    ]);
    expect(component.isOpen()).toBe(true);
    component.handleInput!(ESC);
    expect(component.isOpen()).toBe(false);
    expect(component.render(80)).toEqual([]);
  });

  it("Esc in the overlay returns to the list without closing the dashboard", () => {
    const agent = snap({
      id: "sa-1",
      title: "first",
      status: "running",
      createdAt: 1,
      transcript: [{ kind: "assistant", text: "line" }],
    });
    const { component } = setup([agent]);
    component.handleInput!(ENTER);
    expect(component.overlayOpen()).toBe(true);
    component.handleInput!(ESC);
    expect(component.isOpen()).toBe(true);
    expect(component.overlayOpen()).toBe(false);
    expect(selectedLine(component)).toContain("first");
  });

  it("x on a settled agent is a no-op", async () => {
    const { model, component } = setup([
      snap({ id: "sa-1", title: "first", status: "done", createdAt: 1, settledAt: 100 }),
    ]);
    component.handleInput!("x");
    component.handleInput!("x");
    await Promise.resolve();
    expect(model.cancel).not.toHaveBeenCalled();
  });
});

describe("dashboard re-render", () => {
  it("re-renders within the 100ms cadence on snapshot changes", () => {
    const clock = makeClock();
    const agent = snap({ id: "sa-1", title: "first", status: "running", createdAt: 1, tokens: 0 });
    const model = makeReadModel([agent]);
    const component = createDashboard(model, { clock: { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer } });
    let renders = 0;
    component.tui = { requestRender: () => { renders += 1; } } as never;
    agent.tokens = 12_400;
    model.emit();
    expect(renders).toBe(0);
    clock.advance(99);
    expect(renders).toBe(0);
    clock.advance(1);
    expect(renders).toBe(1);
    expect(component.render(120).find((l) => l.includes("first"))).toContain("12.4k");
  });

  it("dispose stops listening", () => {
    const agent = snap({ id: "sa-1", title: "first", status: "running", createdAt: 1 });
    const { model, component } = setup([agent]);
    component.dispose();
    expect(() => model.emit()).not.toThrow();
  });
});
