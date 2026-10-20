import { expect, test, vi } from "vitest";
import { buildEntries } from "./index.js";

const keys = (
  entries: ReturnType<typeof buildEntries>,
) => entries.map((entry) => (entry.type === "group" ? entry.group.key : entry.key));

const group = (entries: ReturnType<typeof buildEntries>, key: string) =>
  entries.find((entry): entry is Extract<ReturnType<typeof buildEntries>[number], { type: "group" }> =>
    entry.type === "group" && entry.group.key === key
  )?.group;

const groupKeys = (entries: ReturnType<typeof buildEntries>, key: string) =>
  (group(entries, key)?.items ?? []).map((item: { key: string }) => item.key);

test("the command plate exposes frequent actions plus the target group", () => {
  const entries = buildEntries(
    {} as never,
    async () => {},
    async () => "build",
    () => {},
    { agents: [] },
  );
  expect(keys(entries)).toEqual(["m", "s", "t", "q"]);
});

test("target group lists modes plus discovered agent types", () => {
  const entries = buildEntries(
    {} as never,
    async () => {},
    async () => "build",
    () => {},
    { agents: [{ name: "reviewer", description: "reviews code" }] },
  );
  expect(groupKeys(entries, "t")).toEqual(["build", "plan", "reviewer"]);
});

test("target group dedupes agent types that collide with modes", () => {
  const entries = buildEntries(
    {} as never,
    async () => {},
    async () => "build",
    () => {},
    { agents: [{ name: "plan", description: "shadows the mode" }] },
  );
  expect(groupKeys(entries, "t")).toEqual(["build", "plan"]);
});

test("target entries carry the target id and a readable description", () => {
  const entries = buildEntries(
    {} as never,
    async () => {},
    async () => "build",
    () => {},
    { agents: [{ name: "reviewer", description: "reviews code" }] },
  );
  const items = group(entries, "t")?.items ?? [];
  expect(items).toEqual([
    expect.objectContaining({ key: "build", label: "build", description: "prompt target: main agent" }),
    expect.objectContaining({ key: "plan", label: "plan", description: "prompt target: plan-build" }),
    expect.objectContaining({ key: "reviewer", label: "reviewer", description: "prompt target: agent (reviews code)" }),
  ]);
});

test("selecting a target emits swarm:target-set with the target id", async () => {
  const emit = vi.fn();
  const getCurrent = vi.fn(async () => "build");
  const entries = buildEntries(
    { events: { emit } } as never,
    async () => {},
    getCurrent,
    () => {},
    { agents: [{ name: "reviewer", description: "reviews code" }] },
  );
  const entry = group(entries, "t")?.items.find((item: { key: string }) => item.key === "reviewer");
  expect(entry).toBeDefined();
  await entry!.action!({} as never);
  expect(getCurrent).toHaveBeenCalledTimes(1);
  expect(emit).toHaveBeenCalledWith("swarm:target-set", { v: 1, target: "reviewer" });
});

test("selecting the current target does not emit", async () => {
  const emit = vi.fn();
  const entries = buildEntries(
    { events: { emit } } as never,
    async () => {},
    async () => "build",
    () => {},
    { agents: [] },
  );
  const entry = group(entries, "t")?.items.find((item: { key: string }) => item.key === "build");
  expect(entry).toBeDefined();
  await entry!.action!({} as never);
  expect(emit).not.toHaveBeenCalled();
});

test("missing swarm is tolerated: selection still emits", async () => {
  const emit = vi.fn();
  const entries = buildEntries(
    { events: { emit } } as never,
    async () => {},
    async () => "build",
    () => {},
    { agents: [] },
  );
  const entry = group(entries, "t")?.items.find((item: { key: string }) => item.key === "plan");
  expect(entry).toBeDefined();
  await entry!.action!({} as never);
  expect(emit).toHaveBeenCalledWith("swarm:target-set", { v: 1, target: "plan" });
});

test("plate actions stage their native commands and quit directly", async () => {
  const entries = buildEntries(
    {} as never,
    async () => {},
    async () => "build",
    () => {},
    { agents: [] },
  );
  const setEditorText = vi.fn();
  const shutdown = vi.fn();
  const ctx = {
    ui: {
      setEditorText,
    },
    shutdown,
  } as never;
  const stdinEmit = vi
    .spyOn(process.stdin, "emit")
    .mockImplementation(((..._args: unknown[]) => true) as never);

  try {
    for (const key of ["s", "q"]) {
      const entry = entries.find((candidate) => candidate.type === "action" && candidate.key === key);
      if (entry?.type !== "action") throw new Error(`Action ${key} missing`);
      await entry.action(ctx);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setEditorText.mock.calls.map(([command]) => command)).toEqual(["/subagents"]);
    expect(shutdown).toHaveBeenCalledTimes(1);
  } finally {
    stdinEmit.mockRestore();
  }
});
