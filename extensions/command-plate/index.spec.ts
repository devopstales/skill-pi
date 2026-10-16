import { expect, test, vi } from "vitest";
import { buildEntries } from "./index.js";

const keys = (
  entries: ReturnType<typeof buildEntries>,
) => entries.map((entry) => (entry.type === "group" ? entry.group.key : entry.key));

test("the command plate only exposes frequent actions", () => {
  const entries = buildEntries({} as never, async () => {});
  expect(keys(entries)).toEqual(["m", "a", "t", "q"]);

  const agents = entries.find((entry) => entry.type === "group" && entry.group.key === "a");
  expect(agents?.type).toBe("group");
  if (agents?.type === "group") {
    expect(agents.group.items.map((item) => item.key)).toEqual(["s", "p"]);
  }
});

test("plate actions stage their native commands and quit directly", async () => {
  const entries = buildEntries({} as never, async () => {});
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
    const agents = entries.find((entry) => entry.type === "group" && entry.group.key === "a");
    if (agents?.type !== "group") throw new Error("Agents group missing");
    for (const key of ["s", "p"]) {
      await agents.group.items.find((item) => item.key === key)?.action(ctx);
    }

    for (const key of ["t", "q"]) {
      const entry = entries.find((candidate) => candidate.type === "action" && candidate.key === key);
      if (entry?.type !== "action") throw new Error(`Action ${key} missing`);
      await entry.action(ctx);
    }
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(setEditorText.mock.calls.map(([command]) => command)).toEqual([
      "/subagents",
      "/ps",
      "/tree",
    ]);
    expect(shutdown).toHaveBeenCalledTimes(1);
  } finally {
    stdinEmit.mockRestore();
  }
});
