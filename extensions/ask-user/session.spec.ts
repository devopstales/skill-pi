import type { Theme } from "@earendil-works/pi-coding-agent";
import type { TUI } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { buildQuestionnaireResponse } from "./envelope.js";
import { QuestionnaireSession } from "./state/questionnaire-session.js";
import type { QuestionnaireResult, QuestionParams } from "./types.js";
import type { WrappingSelectItem } from "./view/components/wrapping-select.js";

const DOWN = "\x1b[B";
const UP = "\x1b[A";
const ENTER = "<ENTER>";
const CTRL_G = "\x07";
const CTRL_U = "\x15";
const SHIFT_ENTER = "\x1b\r";
const TAB = "\t";

const makeTheme = (): Theme =>
  ({
    fg: (_color: string, text: string) => text,
    bg: (_color: string, text: string) => text,
    bold: (text: string) => text,
    strikethrough: (text: string) => text,
    dim: (text: string) => text,
  }) as unknown as Theme;

const params: QuestionParams = {
  questions: [
    {
      question: "Which?",
      header: "Pick",
      options: [
        { label: "A", description: "a" },
        { label: "B", description: "b" },
      ],
    },
  ],
};

function itemsFor(value: QuestionParams): WrappingSelectItem[][] {
  return value.questions.map((question) => [
    ...question.options.map((option) => ({
      kind: "option" as const,
      label: option.label,
      description: option.description,
    })),
    { kind: "other" as const, label: "Type something." },
  ]);
}

const keybindings = {
  matches(data: string, name: string): boolean {
    switch (name) {
      case "tui.select.up":
        return data === UP;
      case "tui.select.down":
        return data === DOWN;
      case "tui.select.confirm":
        return data === ENTER;
      case "tui.input.newLine":
        return data === SHIFT_ENTER;
      case "tui.editor.cursorUp":
        return data === UP;
      case "tui.editor.cursorDown":
        return data === DOWN;
      case "tui.select.cancel":
        return data === "\x1b";
      case "tui.editor.deleteToLineStart":
        return data === CTRL_U;
      case "app.editor.external":
        return data === CTRL_G;
      default:
        return false;
    }
  },
};

interface SessionTestOptions {
  params?: QuestionParams;
  itemsByTab?: WrappingSelectItem[][];
  editInput?: (value: string) => Promise<string | undefined>;
  keybindings?: typeof keybindings;
}

function makeSession(options: SessionTestOptions = {}) {
  const sessionParams = options.params ?? params;
  const done = vi.fn<(result: QuestionnaireResult) => void>();
  const session = new QuestionnaireSession({
    tui: { terminal: { columns: 120, rows: 40 }, requestRender: vi.fn() } as unknown as TUI,
    theme: makeTheme(),
    params: sessionParams,
    itemsByTab: options.itemsByTab ?? itemsFor(sessionParams),
    done,
    keybindings: options.keybindings ?? keybindings,
    editInput: options.editInput ?? (async () => undefined),
    collapseKey: "off",
    canReopenWhileHidden: false,
    rowBudget: (rows) => rows,
  });
  return { session, done };
}

function focusCustomAnswer(session: QuestionnaireSession): void {
  session.dispatch(DOWN);
  session.dispatch(DOWN);
}

describe("QuestionnaireSession — custom-answer drafts", () => {
  it("preserves a draft while browsing options and restores it on return", () => {
    const { session, done } = makeSession();
    focusCustomAnswer(session);
    session.dispatch("draft answer");
    session.dispatch(UP);
    const browsingView = session.component.render(120).join("\n");
    expect(browsingView).toContain("draft answer");
    expect(browsingView).not.toContain("Type something.");
    session.dispatch(DOWN);
    session.dispatch(ENTER);

    expect(done).toHaveBeenCalledWith({
      answers: [
        {
          questionIndex: 0,
          question: "Which?",
          kind: "custom",
          answer: "draft answer",
        },
      ],
      cancelled: false,
    });
  });

  it("submits a multiline custom answer composed with Shift+Enter", () => {
    const { session, done } = makeSession();
    focusCustomAnswer(session);
    session.dispatch("first line");
    session.dispatch(SHIFT_ENTER);
    session.dispatch("second line");
    const view = session.component.render(120).join("\n");
    expect(view).toContain("first line");
    expect(view).toContain("second line");
    session.dispatch(ENTER);

    expect(done).toHaveBeenCalledWith({
      answers: [expect.objectContaining({ kind: "custom", answer: "first line\nsecond line" })],
      cancelled: false,
    });
  });

  it("uses vertical arrows within the draft and returns to row navigation at the boundary", () => {
    const { session, done } = makeSession();
    focusCustomAnswer(session);
    session.dispatch("first");
    session.dispatch(SHIFT_ENTER);
    session.dispatch("second");
    session.dispatch(UP);
    session.dispatch("!");
    session.dispatch(UP);
    session.dispatch(DOWN);
    session.dispatch(ENTER);

    expect(done).toHaveBeenCalledWith({
      answers: [expect.objectContaining({ kind: "custom", answer: "first!\nsecond" })],
      cancelled: false,
    });
  });

  it("clears the whole draft with Pi's Ctrl+U line-kill binding", () => {
    const { session, done } = makeSession();
    focusCustomAnswer(session);
    session.dispatch("discard me");
    session.dispatch(CTRL_U);
    session.dispatch(ENTER);
    expect(done).not.toHaveBeenCalled();
  });

  it("replaces the inline draft with the external editor result", async () => {
    const editInput = vi.fn(async (value: string) => `${value} + edited`);
    const { session, done } = makeSession({ editInput });
    focusCustomAnswer(session);
    session.dispatch("draft");
    session.dispatch(CTRL_G);
    await Promise.resolve();
    await Promise.resolve();
    expect(editInput).toHaveBeenCalledWith("draft");
    session.dispatch(ENTER);

    expect(done).toHaveBeenLastCalledWith({
      answers: [expect.objectContaining({ kind: "custom", answer: "draft + edited" })],
      cancelled: false,
    });
  });

  it("keeps input exclusive while the external editor is open", async () => {
    let resolveEditor!: (value: string | undefined) => void;
    const editInput = vi.fn(
      () =>
        new Promise<string | undefined>((resolve) => {
          resolveEditor = resolve;
        }),
    );
    const { session, done } = makeSession({ editInput });
    focusCustomAnswer(session);
    session.dispatch("draft");
    session.dispatch(CTRL_G);

    session.dispatch(UP);
    session.dispatch("late input");
    resolveEditor("edited");
    await Promise.resolve();
    await Promise.resolve();
    session.dispatch(ENTER);

    expect(done).toHaveBeenCalledWith({
      answers: [expect.objectContaining({ kind: "custom", answer: "edited" })],
      cancelled: false,
    });
  });

  it("attaches multiline notes composed with Shift+Enter", () => {
    const { session, done } = makeSession();
    session.dispatch("n");
    session.dispatch("first note");
    session.dispatch(SHIFT_ENTER);
    session.dispatch("second note");
    session.dispatch(ENTER);
    session.dispatch(ENTER);

    expect(done).toHaveBeenCalledWith({
      answers: [expect.objectContaining({ kind: "option", notes: "first note\nsecond note" })],
      cancelled: false,
    });
  });

  it("keeps each question's latest draft isolated through real navigation and tab switches", () => {
    const multiParams: QuestionParams = {
      questions: [
        { ...params.questions[0]!, question: "First?", header: "First" },
        { ...params.questions[0]!, question: "Second?", header: "Second" },
      ],
    };
    const { session } = makeSession({ params: multiParams });

    focusCustomAnswer(session);
    session.dispatch("first");
    session.dispatch(UP);
    session.dispatch(DOWN);
    session.dispatch("-latest");
    session.dispatch(ENTER);

    focusCustomAnswer(session);
    session.dispatch("second");
    session.dispatch(UP);
    session.dispatch(TAB);
    session.dispatch(TAB);
    expect(session.component.render(120).join("\n")).toContain("first-latest");

    session.dispatch(TAB);
    expect(session.component.render(120).join("\n")).toContain("second");
  });
});

describe("QuestionnaireSession — multi-select custom text joins checked options", () => {
  const SPACE = " ";
  const multiParams: QuestionParams = {
    questions: [{ ...params.questions[0]!, multiSelect: true }],
  };
  const multiItems: WrappingSelectItem[][] = [
    [...itemsFor(multiParams)[0]!, { kind: "next" as const, label: "Next" }],
  ];
  const both = {
    answers: [{ questionIndex: 0, question: "Which?", kind: "multi", answer: "my text", selected: ["A"] }],
    cancelled: false,
  };

  function checkAThenType(): ReturnType<typeof makeSession> {
    const made = makeSession({ params: multiParams, itemsByTab: multiItems });
    made.session.dispatch(SPACE);
    focusCustomAnswer(made.session);
    made.session.dispatch("my text");
    return made;
  }

  it("Enter in the custom input submits the checked options AND the text", () => {
    const { session, done } = checkAThenType();
    session.dispatch(ENTER);
    expect(done).toHaveBeenCalledWith(both);
    expect(buildQuestionnaireResponse(done.mock.calls[0]![0], multiParams).content[0]!.text).toContain(
      '"Which?"="A, my text"',
    );
  });

  it("Next submits the checked options AND the text", () => {
    const { session, done } = checkAThenType();
    session.dispatch(DOWN);
    session.dispatch(ENTER);
    expect(done).toHaveBeenCalledWith(both);
  });

  it("the custom row is checked while it holds text and unchecked once cleared", () => {
    const { session } = checkAThenType();
    expect(session.component.render(120).join("\n")).toMatch(/\[✔\] my text/);
    session.dispatch(CTRL_U);
    expect(session.component.render(120).join("\n")).toMatch(/3\. \[ \]/);
  });
});

describe("QuestionnaireSession — a saved note stays visible", () => {
  const NOTE_LABEL = "Note for this answer:";
  const view = (session: QuestionnaireSession) => session.component.render(120).join("\n");
  function saveNote(session: QuestionnaireSession, text: string): void {
    session.dispatch("n");
    session.dispatch(text);
    session.dispatch(ENTER);
  }

  it("shows the note on the question tab once its editor closes", () => {
    const { session } = makeSession();
    expect(view(session)).not.toContain(NOTE_LABEL);
    saveNote(session, "remember the cache");
    expect(view(session)).toContain(`${NOTE_LABEL} remember the cache`);
  });

  it("keeps a multi-line note to one row", () => {
    const { session } = makeSession();
    session.dispatch("n");
    session.dispatch("first line");
    session.dispatch(SHIFT_ENTER);
    session.dispatch("second line");
    session.dispatch(ENTER);
    const lines = session.component.render(120).filter((l) => l.includes(NOTE_LABEL));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("first line …");
    expect(view(session)).not.toContain("second line");
  });

  it("labels the note the same way on the review tab", () => {
    const twoQuestions: QuestionParams = {
      questions: [
        { ...params.questions[0]!, question: "First?", header: "First" },
        { ...params.questions[0]!, question: "Second?", header: "Second" },
      ],
    };
    const { session } = makeSession({ params: twoQuestions });
    saveNote(session, "remember the cache");
    session.dispatch(ENTER);
    session.dispatch(TAB);
    const review = view(session);
    expect(review).toContain(`${NOTE_LABEL} remember the cache`);
    expect(review).not.toContain("notes: remember the cache");
  });
});

describe("QuestionnaireSession — collapsed row with collapseKey 'off'", () => {
  it("renders the cancel-only line, never a literal 'Off to expand'", () => {
    const { session } = makeSession();
    session.toggleCollapsedExternal();
    const collapsed = session.component.render(120);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]).toContain("Esc to cancel");
    expect(collapsed[0]).not.toContain("to expand");
    expect(collapsed[0]).not.toContain("Off");
  });
});
