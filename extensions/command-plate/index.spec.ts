import { expect, test, vi } from "vitest";
import { buildEntries } from "./index.js";

const keys = (
  entries: ReturnType<typeof buildEntries>,
) => entries.map((entry) => (entry.type === "group" ? entry.group.key : entry.key));

test("the command plate only exposes frequent actions", () => {
  const entries = buildEntries({} as never, async () => {});
  expect(keys(entries)).toEqual(["m", "s", "q"]);
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
