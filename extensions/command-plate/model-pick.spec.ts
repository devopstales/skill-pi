import { expect, test } from "vitest";
import { getThinkingDescription, getProviders } from "./model-pick.js";

const fakeModel = (provider: string, id: string, name: string) => ({
  provider,
  id,
  name,
  reasoning: false,
  input: ["text"],
});

test("providers are aggregated per provider and sorted", () => {
  const models = [
    fakeModel("b", "x", "B X"),
    fakeModel("a", "y", "A Y"),
    fakeModel("a", "z", "A Z"),
  ];
  const ctx = {
    cwd: "/nonexistent-dir-for-test",
    modelRegistry: { getAvailable: () => models },
  } as never;

  const providers = getProviders(ctx);
  expect(providers.map((p) => p.name)).toEqual(["a", "b"]);
  expect(providers[0].modelCount).toBe(2);
  expect(providers[1].modelCount).toBe(1);
});

test("thinking descriptions cover every level", () => {
  expect(getThinkingDescription("off")).toBe("No extended thinking");
  expect(getThinkingDescription("xhigh")).toBe("Maximum reasoning effort");
  expect(getThinkingDescription("medium")).toBe("Moderate reasoning effort");
});
