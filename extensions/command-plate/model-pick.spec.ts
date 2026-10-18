import { expect, test } from "vitest";
import {
  getProviders,
  getThinkingDescription,
  highlightItemLabel,
  itemNumber,
  renderSearchWindow,
  resolveScrollOffset,
} from "./model-pick.js";
import type { Theme } from "@earendil-works/pi-coding-agent";

const fakeModel = (provider: string, id: string, name: string) => ({
  provider,
  id,
  name,
  reasoning: false,
  input: ["text"],
});

const plainTheme: Theme = {
  fg: (_role: string, text: string) => text,
  bold: (text: string) => text,
} as unknown as Theme;

const stubFrame = {
  row: (content: string) => `row:${content}`,
  rowTruncated: (content: string) => `rowT:${content}`,
};

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

test("resolveScrollOffset keeps highlight visible inside a 3-slot window", () => {
  expect(resolveScrollOffset(0, 0, 3, 5)).toBe(0);
  expect(resolveScrollOffset(2, 0, 3, 5)).toBe(0);
  expect(resolveScrollOffset(3, 0, 3, 5)).toBe(1);
  expect(resolveScrollOffset(5, 0, 3, 5)).toBe(3);
  expect(resolveScrollOffset(1, 4, 3, 5)).toBe(1);
});

test("highlightItemLabel uses accent+bold for highlighted rows and plain text otherwise", () => {
  const calls: Array<[string, string]> = [];
  const th: Theme = {
    fg: (role: string, text: string) => {
      calls.push([role, text]);
      return text;
    },
    bold: (text: string) => `«${text}»`,
  } as unknown as Theme;

  expect(highlightItemLabel(th, "alpha", true)).toBe("«alpha»");
  expect(highlightItemLabel(th, "beta", false)).toBe("beta");
  expect(calls).toEqual([
    ["accent", "«alpha»"],
    ["text", "beta"],
  ]);
});

test("itemNumber shows the index for the first nine models and a dot beyond", () => {
  const calls: Array<[string, string]> = [];
  const th = plainTheme as unknown as Theme;
  (th as { fg: (role: string, text: string) => void }).fg = (role: string, text: string) => {
    calls.push([role, text]);
    return text;
  };

  expect(itemNumber(th, 0)).toBe("1");
  expect(itemNumber(th, 8)).toBe("9");
  expect(itemNumber(th, 9)).toBe("·");
  expect(calls).toEqual([
    ["dim", "1"],
    ["dim", "9"],
    ["dim", "·"],
  ]);
});

const itemRow = (item: string, isHighlighted: boolean) =>
  `${isHighlighted ? "> " : "  "}${item}`;

test("renderSearchWindow renders visible items with highlight, scroll markers, and remaining count", () => {
  const lines = renderSearchWindow({
    frame: stubFrame as never,
    theme: plainTheme,
    items: ["alpha", "beta", "gamma"],
    highlightedIndex: 2,
    scrollOffset: 0,
    renderRow: itemRow,
  });

  expect(lines).toEqual([
    "rowT:  alpha",
    "rowT:  beta",
    "rowT:> gamma",
  ]);
});

test("renderSearchWindow renders no matches and an empty top when fully scrolled", () => {
  const lines = renderSearchWindow({
    frame: stubFrame as never,
    theme: plainTheme,
    items: [],
    highlightedIndex: 0,
    scrollOffset: 0,
    renderRow: itemRow,
  });
  expect(lines).toEqual(["row:  no matches"]);

  const scrolled = renderSearchWindow({
    frame: stubFrame as never,
    theme: plainTheme,
    items: ["a", "b", "c", "d", "e", "f"],
    highlightedIndex: 4,
    scrollOffset: 3,
    maxVisible: 3,
    renderRow: itemRow,
  });
  expect(scrolled).toEqual([
    "row:  ↑ 3 more",
    "rowT:  d",
    "rowT:> e",
    "rowT:  f",
  ]);
});
