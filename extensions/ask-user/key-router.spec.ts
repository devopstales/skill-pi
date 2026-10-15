import { describe, expect, it } from "vitest";
import { allAnswered, routeKey, wrapTab } from "./state/key-router.js";
import type { QuestionAnswer, QuestionData } from "./types.js";
import type { QuestionnaireRuntime, QuestionnaireState } from "./state/state.js";
import type { WrappingSelectItem } from "./view/components/wrapping-select.js";

const KEY = {
  UP: "tui.select.up",
  DOWN: "tui.select.down",
  CONFIRM: "tui.select.confirm",
  SUBMIT: "tui.input.submit",
  CANCEL: "tui.select.cancel",
  NEW_LINE: "tui.input.newLine",
  EDITOR_UP: "tui.editor.cursorUp",
  EDITOR_DOWN: "tui.editor.cursorDown",
  CLEAR: "tui.editor.deleteToLineStart",
  EXTERNAL_EDITOR: "app.editor.external",
};
const sentinel = (name: string) => `<KEY:${name}>`;
const keybindings = { matches: (data: string, name: string) => data === sentinel(name) };

const BYTE_TAB = "\t";
const BYTE_SHIFT_TAB = "\x1b[Z";
const BYTE_RIGHT = "\x1b[C";
const BYTE_LEFT = "\x1b[D";
const BYTE_SPACE = " ";

function makeQuestion(over: Partial<QuestionData> = {}): QuestionData {
  return {
    question: over.question ?? "Pick one",
    header: over.header ?? "H",
    options: over.options ?? [
      { label: "A", description: "a" },
      { label: "B", description: "b" },
      { label: "C", description: "c" },
    ],
    multiSelect: over.multiSelect,
  };
}

function makeAnswer(over: Partial<QuestionAnswer> = {}): QuestionAnswer {
  return {
    questionIndex: over.questionIndex ?? 0,
    question: over.question ?? "q",
    kind: over.kind ?? "option",
    answer: over.answer ?? "A",
  };
}

function makeState(over: Partial<QuestionnaireState> = {}): QuestionnaireState {
  return {
    currentTab: 0,
    optionIndex: 0,
    inputMode: false,
    notesVisible: false,
    answers: new Map<number, QuestionAnswer>(),
    multiSelectChecked: new Set<number>(),
    customDraftsByTab: new Map<number, string>(),
    notesByTab: new Map<number, string>(),
    submitChoiceIndex: 0,
    notesDraft: "",
    collapsed: false,
    ...over,
  };
}

function makeRuntime(over: Partial<QuestionnaireRuntime> = {}): QuestionnaireRuntime {
  const questions = over.questions ?? [makeQuestion(), makeQuestion()];
  const items: WrappingSelectItem[] = over.items
    ? [...over.items]
    : questions[0]!.options.map((o) => ({ kind: "option" as const, label: o.label }));
  return {
    keybindings,
    inputBuffer: "",
    canMoveInputUp: false,
    canMoveInputDown: false,
    questions,
    isMulti: questions.length > 1,
    currentItem: items[0],
    items,
    collapseKey: "ctrl+]",
    ...over,
  };
}

describe("wrapTab + allAnswered", () => {
  it("wraps negative + over-max into [0, total)", () => {
    expect(wrapTab(-1, 3)).toBe(2);
    expect(wrapTab(3, 3)).toBe(0);
    expect(wrapTab(0, 0)).toBe(0);
  });
  it("allAnswered is false when any question lacks an answer", () => {
    expect(allAnswered(makeState({ answers: new Map([[0, makeAnswer({ questionIndex: 0 })]]) }), makeRuntime())).toBe(false);
  });
  it("allAnswered is true when every question has an answer", () => {
    expect(
      allAnswered(
        makeState({
          answers: new Map([
            [0, makeAnswer({ questionIndex: 0 })],
            [1, makeAnswer({ questionIndex: 1 })],
          ]),
        }),
        makeRuntime(),
      ),
    ).toBe(true);
  });
});

describe("routeKey — nav", () => {
  it("UP from a non-zero index decrements by 1", () => {
    expect(routeKey(sentinel(KEY.UP), makeState({ optionIndex: 2 }), makeRuntime())).toEqual({
      kind: "nav",
      nextIndex: 1,
      inputValue: "",
    });
  });
  it("DOWN advances by 1", () => {
    expect(routeKey(sentinel(KEY.DOWN), makeState(), makeRuntime())).toEqual({
      kind: "nav",
      nextIndex: 1,
      inputValue: "",
    });
  });
  it("DOWN at the last item wraps to 0", () => {
    expect(routeKey(sentinel(KEY.DOWN), makeState({ optionIndex: 2 }), makeRuntime())).toEqual({
      kind: "nav",
      nextIndex: 0,
      inputValue: "",
    });
  });
});

describe("routeKey — tab_switch (Tab / Shift+Tab / arrows)", () => {
  it("Tab cycles forward through total tabs (questions + Submit)", () => {
    expect(routeKey(BYTE_TAB, makeState(), makeRuntime())).toEqual({ kind: "tab_switch", nextTab: 1 });
  });
  it("Right is an alias for Tab", () => {
    expect(routeKey(BYTE_RIGHT, makeState(), makeRuntime())).toEqual({ kind: "tab_switch", nextTab: 1 });
  });
  it("Shift+Tab wraps backward from tab 0 to the Submit tab", () => {
    expect(routeKey(BYTE_SHIFT_TAB, makeState({ currentTab: 0 }), makeRuntime())).toEqual({ kind: "tab_switch", nextTab: 2 });
  });
  it("Left is an alias for Shift+Tab", () => {
    expect(routeKey(BYTE_LEFT, makeState({ currentTab: 1 }), makeRuntime())).toEqual({ kind: "tab_switch", nextTab: 0 });
  });
  it("Tab is a no-op in single-question mode", () => {
    expect(routeKey(BYTE_TAB, makeState(), makeRuntime({ isMulti: false, questions: [makeQuestion()] }))).toEqual({
      kind: "ignore",
    });
  });
});

describe("routeKey — confirm (single-select)", () => {
  it("Enter emits confirm with autoAdvanceTab pointing at the next tab", () => {
    expect(routeKey(sentinel(KEY.CONFIRM), makeState({ currentTab: 0 }), makeRuntime())).toMatchObject({
      kind: "confirm",
      answer: { questionIndex: 0, answer: "A", kind: "option" },
      autoAdvanceTab: 1,
    });
  });
  it("last question -> autoAdvanceTab points at the Submit tab", () => {
    expect(routeKey(sentinel(KEY.CONFIRM), makeState({ currentTab: 1 }), makeRuntime())).toMatchObject({
      kind: "confirm",
      autoAdvanceTab: 2,
    });
  });
  it("single-question -> autoAdvanceTab is undefined (dialog submits)", () => {
    const action = routeKey(
      sentinel(KEY.CONFIRM),
      makeState(),
      makeRuntime({
        isMulti: false,
        questions: [makeQuestion()],
        items: [
          { kind: "option", label: "A" },
          { kind: "option", label: "B" },
          { kind: "option", label: "C" },
        ],
      }),
    );
    expect(action).toMatchObject({ kind: "confirm" });
    if (action.kind === "confirm") expect(action.autoAdvanceTab).toBeUndefined();
  });
  it("inline-input mode: Enter confirms with the buffered text + kind:'custom'", () => {
    const other: WrappingSelectItem = { kind: "other", label: "Type something." };
    const action = routeKey(sentinel(KEY.CONFIRM), makeState({ inputMode: true }), makeRuntime({ currentItem: other, inputBuffer: "my custom answer" }));
    expect(action.kind).toBe("confirm");
    if (action.kind === "confirm") {
      expect(action.answer.answer).toBe("my custom answer");
      expect(action.answer.kind).toBe("custom");
    }
  });
});

describe("routeKey — multiSelect", () => {
  const multiQ = makeQuestion({
    multiSelect: true,
    options: [
      { label: "FE", description: "FE" },
      { label: "BE", description: "BE" },
      { label: "Tests", description: "T" },
    ],
  });
  const multiItems: WrappingSelectItem[] = [
    { kind: "option", label: "FE" },
    { kind: "option", label: "BE" },
    { kind: "option", label: "Tests" },
    { kind: "other", label: "Type something." },
    { kind: "next", label: "Next" },
  ];

  it("Space emits toggle for the current optionIndex", () => {
    expect(
      routeKey(BYTE_SPACE, makeState({ optionIndex: 1 }), makeRuntime({ questions: [multiQ], isMulti: false, items: multiItems, currentItem: { kind: "option", label: "BE" } })),
    ).toEqual({ kind: "toggle", index: 1 });
  });
  it("Enter on a regular row toggles (not submits)", () => {
    expect(
      routeKey(sentinel(KEY.CONFIRM), makeState({ optionIndex: 1 }), makeRuntime({ questions: [multiQ], isMulti: false, items: multiItems, currentItem: { kind: "option", label: "BE" } })),
    ).toEqual({ kind: "toggle", index: 1 });
  });
  it("Space on the Next sentinel is ignored", () => {
    expect(
      routeKey(BYTE_SPACE, makeState({ optionIndex: 4 }), makeRuntime({ questions: [multiQ], isMulti: false, items: multiItems, currentItem: { kind: "next", label: "Next" } })),
    ).toEqual({ kind: "ignore" });
  });
  it("Enter on Next emits selected labels (authored order) + custom text", () => {
    expect(
      routeKey(
        sentinel(KEY.CONFIRM),
        makeState({ optionIndex: 4, multiSelectChecked: new Set([2, 0]) }),
        makeRuntime({ questions: [multiQ], isMulti: false, inputBuffer: "custom detail", items: multiItems, currentItem: { kind: "next", label: "Next" } }),
      ),
    ).toEqual({ kind: "multi_confirm", selected: ["FE", "Tests"], answer: "custom detail", autoAdvanceTab: undefined });
  });
  it("multi-question multi-select on last tab: Enter on Next advances to the Submit tab", () => {
    const action = routeKey(
      sentinel(KEY.CONFIRM),
      makeState({ currentTab: 1, optionIndex: 4, multiSelectChecked: new Set([0]) }),
      makeRuntime({ questions: [makeQuestion(), multiQ], isMulti: true, items: multiItems, currentItem: { kind: "next", label: "Next" } }),
    );
    expect(action.kind).toBe("multi_confirm");
    if (action.kind === "multi_confirm") expect(action.autoAdvanceTab).toBe(2);
  });
});

describe("routeKey — cancel + submit", () => {
  it("Esc cancels the entire questionnaire from any tab", () => {
    expect(routeKey(sentinel(KEY.CANCEL), makeState(), makeRuntime())).toEqual({ kind: "cancel" });
    expect(routeKey(sentinel(KEY.CANCEL), makeState({ currentTab: 2 }), makeRuntime())).toEqual({ kind: "cancel" });
  });
  it("Submit tab + Enter on Submit row + allAnswered -> submit", () => {
    expect(
      routeKey(
        sentinel(KEY.CONFIRM),
        makeState({
          currentTab: 2,
          submitChoiceIndex: 0,
          answers: new Map([
            [0, makeAnswer({ questionIndex: 0 })],
            [1, makeAnswer({ questionIndex: 1 })],
          ]),
        }),
        makeRuntime(),
      ),
    ).toEqual({ kind: "submit" });
  });
  it("Submit tab + Enter on Submit row when not allAnswered -> submit (partial)", () => {
    expect(
      routeKey(
        sentinel(KEY.CONFIRM),
        makeState({ currentTab: 2, submitChoiceIndex: 0, answers: new Map([[0, makeAnswer({ questionIndex: 0 })]]) }),
        makeRuntime(),
      ),
    ).toEqual({ kind: "submit" });
  });
});

describe("routeKey — notes ('n')", () => {
  it("'n' emits notes_enter regardless of preview", () => {
    expect(routeKey("n", makeState(), makeRuntime())).toEqual({ kind: "notes_enter" });
  });
  it("Esc in the notes editor emits notes_exit", () => {
    expect(routeKey(sentinel(KEY.CANCEL), makeState({ notesVisible: true }), makeRuntime())).toEqual({ kind: "notes_exit" });
  });
});
