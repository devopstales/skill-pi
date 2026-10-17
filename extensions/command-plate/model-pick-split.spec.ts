import { expect, test } from "vitest";
import {
  ALL_THINKING_LEVELS,
  getModelsForProvider,
  getProviders,
  getThinkingDescription,
  highlightItemLabel,
  itemNumber,
  loadScopedModels,
  renderSearchWindow,
  resolveScrollOffset,
  buildThinkingItems,
  runModelSwitcher,
  runScopedModels,
  runThinkingPicker,
  searchableSelect,
} from "./model-pick.js";
import {
  buildDisplayRows,
  nthModelRow,
  nextModelRow,
  runScopedModels as ssRunScopedModels,
} from "./scoped-models.js";
import {
  buildThinkingItems as ssBuildThinkingItems,
  getThinkingDescription as thinkingPickerDescription,
  runThinkingPicker as thinkingPickerRunner,
} from "./thinking-picker.js";
import {
  itemNumber as ssItemNumber,
  renderSearchWindow as ssRenderSearchWindow,
  resolveScrollOffset as ssResolveScrollOffset,
  searchableSelect as ssSearchableSelect,
} from "./searchable-select.js";

test("split: the searchable-select module resolves from searchable-select.ts", () => {
  expect(typeof ssSearchableSelect).toBe("function");
  expect(typeof ssRenderSearchWindow).toBe("function");
  expect(typeof ssResolveScrollOffset).toBe("function");
  expect(typeof ssItemNumber).toBe("function");
  expect(ssResolveScrollOffset(3, 0, 3, 5)).toBe(1);
  expect(ssItemNumber({ fg: (_r: string, t: string) => t, bold: (t: string) => t } as never, 9)).toBe("·");
});

test("split: the thinking-picker module resolves from thinking-picker.ts", () => {
  expect(typeof thinkingPickerRunner).toBe("function");
  expect(thinkingPickerDescription("xhigh")).toBe("Maximum reasoning effort");
});

test("split: the scoped-models module resolves from scoped-models.ts", () => {
  expect(typeof ssRunScopedModels).toBe("function");
  expect(typeof buildDisplayRows).toBe("function");
  expect(typeof nextModelRow).toBe("function");
  expect(typeof nthModelRow).toBe("function");

  const rows = buildDisplayRows([
    { label: "A Z", provider: "a", model: "z" },
    { label: "A Y", provider: "a", model: "y" },
    { label: "B X", provider: "b", model: "x" },
  ]);
  expect(rows[0]).toMatchObject({ type: "header", provider: "a", count: 2 });
  expect(rows[3]).toMatchObject({ type: "header", provider: "b", count: 1 });
  expect(rows.filter((r) => r.type === "model")).toHaveLength(3);
  expect(nextModelRow(rows, 0, 1)).toBe(1);
  expect(nextModelRow(rows, 1, 1)).toBe(2);
  expect(nextModelRow(rows, 2, 1)).toBe(4);
  expect(nextModelRow(rows, 4, 1)).toBe(4);
  expect(nextModelRow(rows, 4, -1)).toBe(2);
  expect(nthModelRow(rows, 1)).toBe(2);
  expect(nthModelRow(rows, 5)).toBe(-1);
});

test("split: the extracted modules re-export the same function instances as model-pick", () => {
  expect(ssSearchableSelect).toBe(searchableSelect);
  expect(ssRenderSearchWindow).toBe(renderSearchWindow);
  expect(ssResolveScrollOffset).toBe(resolveScrollOffset);
  expect(ssItemNumber).toBe(itemNumber);
  expect(thinkingPickerDescription).toBe(getThinkingDescription);
  expect(thinkingPickerRunner).toBe(runThinkingPicker);
  expect(ssBuildThinkingItems).toBe(buildThinkingItems);
  expect(buildDisplayRows).toBe(buildDisplayRows);
});

test("split: model-pick still re-exports the kept and extracted APIs", () => {
  expect(ALL_THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high", "xhigh"]);
  expect(typeof getProviders).toBe("function");
  expect(typeof getModelsForProvider).toBe("function");
  expect(typeof loadScopedModels).toBe("function");
  expect(typeof runModelSwitcher).toBe("function");
  expect(typeof runScopedModels).toBe("function");
});
