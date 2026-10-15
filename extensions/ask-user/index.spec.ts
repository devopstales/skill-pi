import { Value } from "typebox/value";
import { describe, expect, it } from "vitest";
import {
  ASK_USER_BLOCKED_EVENT,
  ASK_USER_PROMPT_EVENT,
  ASK_USER_ANSWER_EVENT,
  ASK_USER_ANSWER_RESULT_EVENT,
  ASK_ANSWERED_EVENT,
  ASK_CANCELLED_EVENT,
} from "./events.js";
import {
  DECLINE_MESSAGE,
  buildQuestionnaireResponse,
  buildToolResult,
  formatAnswerScalar,
} from "./envelope.js";
import {
  normalizeLineTerminators,
  normalizeQuestionParams,
  prepareQuestionArguments,
} from "./normalize.js";
import {
  COLLAPSE_KEY_OFF,
  DEFAULT_COLLAPSE_KEY,
  configPath,
  formatKeySpecForDisplay,
  loadConfig,
  resolveCollapseKey,
  validateGuidanceFields,
} from "./config.js";
import { resolveExternalAnswer } from "./external-answer.js";
import {
  MAX_HEADER_LENGTH,
  MAX_LABEL_LENGTH,
  MAX_OPTIONS,
  MAX_QUESTIONS,
  MIN_OPTIONS,
  QuestionParamsSchema,
  QuestionsSchema,
  RESERVED_LABELS,
  type QuestionAnswer,
  type QuestionData,
  type QuestionnaireResult,
  type QuestionParams,
} from "./types.js";
import {
  ERROR_DUPLICATE_OPTION_LABEL,
  ERROR_DUPLICATE_QUESTION,
  ERROR_RESERVED_LABEL,
  ERROR_TOO_FEW_OPTIONS,
  ERROR_TOO_MANY_QUESTIONS,
  ERROR_NO_QUESTIONS,
  validateQuestionnaire,
} from "./validate.js";
import extension, {
  ASK_USER_TOOL_NAME,
  DEFAULT_PROMPT_GUIDELINES,
  DEFAULT_PROMPT_SNIPPET,
  DEFAULT_TOOL_DESCRIPTION,
} from "./index.js";

function makeQuestion(override: Partial<QuestionData> = {}): QuestionData {
  return {
    question: override.question ?? "What's your name?",
    header: override.header ?? "Hdr",
    options: override.options ?? [
      { label: "A", description: "Choice A" },
      { label: "B", description: "Choice B" },
    ],
    multiSelect: override.multiSelect,
  };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

describe("QuestionsSchema — array constraints", () => {
  it("accepts a single question", () => {
    expect(Value.Check(QuestionsSchema, [makeQuestion()])).toBe(true);
  });
  it("accepts MAX_QUESTIONS (4) questions", () => {
    const four = [makeQuestion(), makeQuestion(), makeQuestion(), makeQuestion()];
    expect(Value.Check(QuestionsSchema, four)).toBe(true);
  });
  it("rejects empty array (minItems=1)", () => {
    expect(Value.Check(QuestionsSchema, [])).toBe(false);
  });
  it("rejects > MAX_QUESTIONS items (maxItems=4)", () => {
    const five = [makeQuestion(), makeQuestion(), makeQuestion(), makeQuestion(), makeQuestion()];
    expect(Value.Check(QuestionsSchema, five)).toBe(false);
    expect(MAX_QUESTIONS).toBe(4);
  });
});

describe("QuestionSchema — option/preview/multiSelect/header shape", () => {
  it("accepts options with optional preview field", () => {
    const q = makeQuestion({
      options: [
        { label: "A", description: "alpha", preview: "## A\n\nbody" },
        { label: "B", description: "beta" },
      ],
    });
    expect(Value.Check(QuestionsSchema, [q])).toBe(true);
  });
  it("accepts a question with all optional fields populated", () => {
    const q: QuestionData = {
      question: "Pick architecture",
      header: "Architecture",
      options: [
        { label: "Monolith", description: "Single deployable unit", preview: "## Monolith\n\nSimple" },
        { label: "Microservices", description: "Distributed services", preview: "## Micro\n\nScalable" },
      ],
      multiSelect: false,
    };
    expect(Value.Check(QuestionsSchema, [q])).toBe(true);
  });
  it("accepts multiSelect: true", () => {
    expect(Value.Check(QuestionsSchema, [makeQuestion({ multiSelect: true })])).toBe(true);
  });
  it("accepts a header up to MAX_HEADER_LENGTH chars", () => {
    expect(Value.Check(QuestionsSchema, [makeQuestion({ header: "Architecture" })])).toBe(true);
  });
  it("rejects a single-option question (minItems=2)", () => {
    expect(Value.Check(QuestionsSchema, [makeQuestion({ options: [{ label: "OK", description: "Only choice" }] })])).toBe(
      false,
    );
  });
  it("rejects empty options array (minItems=2)", () => {
    expect(Value.Check(QuestionsSchema, [makeQuestion({ options: [] })])).toBe(false);
  });
  it("rejects more than MAX_OPTIONS options (maxItems=4)", () => {
    const five = [
      { label: "A", description: "alpha" },
      { label: "B", description: "beta" },
      { label: "C", description: "gamma" },
      { label: "D", description: "delta" },
      { label: "E", description: "epsilon" },
    ];
    expect(Value.Check(QuestionsSchema, [makeQuestion({ options: five })])).toBe(false);
    expect(MAX_OPTIONS).toBe(4);
  });
  it("rejects an option missing the required description", () => {
    const broken = makeQuestion({ options: [{ label: "A" } as never, { label: "B", description: "ok" }] });
    expect(Value.Check(QuestionsSchema, [broken])).toBe(false);
  });
  it("rejects a question missing the required header", () => {
    const noHeader = { question: "Q?", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] };
    expect(Value.Check(QuestionsSchema, [noHeader])).toBe(false);
  });
  it("rejects a header longer than MAX_HEADER_LENGTH chars", () => {
    const tooLong = "x".repeat(MAX_HEADER_LENGTH + 1);
    expect(Value.Check(QuestionsSchema, [makeQuestion({ header: tooLong })])).toBe(false);
  });
  it("rejects a label longer than MAX_LABEL_LENGTH (60) chars", () => {
    const tooLong = "x".repeat(MAX_LABEL_LENGTH + 1);
    expect(
      Value.Check(QuestionsSchema, [
        makeQuestion({ options: [{ label: tooLong, description: "a" }, { label: "B", description: "b" }] }),
      ]),
    ).toBe(false);
  });
  it("rejects question with missing 'question' text", () => {
    const broken = { options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] } as unknown;
    expect(Value.Check(QuestionsSchema, [broken])).toBe(false);
  });
});

describe("QuestionParamsSchema — top-level shape", () => {
  it("accepts { questions: [...] }", () => {
    expect(Value.Check(QuestionParamsSchema, { questions: [makeQuestion()] })).toBe(true);
  });
  it("accepts full valid payload with preview + multiSelect", () => {
    const payload = {
      questions: [
        {
          question: "Choose",
          header: "Pick",
          multiSelect: true,
          options: [
            { label: "A", description: "First", preview: "# A" },
            { label: "B", description: "Second" },
          ],
        },
      ],
    };
    expect(Value.Check(QuestionParamsSchema, payload)).toBe(true);
  });
  it("rejects missing 'questions' field", () => {
    expect(Value.Check(QuestionParamsSchema, {})).toBe(false);
  });
  it("rejects non-array questions field", () => {
    expect(Value.Check(QuestionParamsSchema, { questions: "not array" })).toBe(false);
  });
});

describe("QuestionAnswer — field optionality + kind union", () => {
  it("supports all three variant kinds", () => {
    const optionA: QuestionAnswer = { questionIndex: 0, question: "Q?", kind: "option", answer: "A" };
    const customA: QuestionAnswer = { questionIndex: 0, question: "Q?", kind: "custom", answer: "free text" };
    const multiA: QuestionAnswer = { questionIndex: 0, question: "Q?", kind: "multi", answer: null, selected: ["A", "B"] };
    expect(optionA.kind).toBe("option");
    expect(customA.kind).toBe("custom");
    expect(multiA.kind).toBe("multi");
  });
  it("accepts an answer with notes + preview + selected", () => {
    const a: QuestionAnswer = {
      questionIndex: 0,
      question: "Q?",
      kind: "option",
      answer: "A",
      notes: "preview looked good",
      preview: "## H\n\nbody",
      selected: ["A"],
    };
    expect(a.notes).toBe("preview looked good");
    expect(a.preview).toContain("## H");
    expect(a.selected).toEqual(["A"]);
  });
});

describe("schema constants + RESERVED_LABELS", () => {
  it("exports the schema constants with expected values", () => {
    expect(MIN_OPTIONS).toBe(2);
    expect(MAX_OPTIONS).toBe(4);
    expect(MAX_HEADER_LENGTH).toBe(16);
    expect(MAX_LABEL_LENGTH).toBe(60);
  });
  it("RESERVED_LABELS includes the Pi sentinels + 'Other'", () => {
    expect(RESERVED_LABELS).toEqual(["Other", "Type something.", "Next"]);
  });
});

// ---------------------------------------------------------------------------
// Validate
// ---------------------------------------------------------------------------

describe("validateQuestionnaire", () => {
  const opts = [{ label: "A", description: "a" }, { label: "B", description: "b" }];
  it("accepts a valid questionnaire", () => {
    expect(validateQuestionnaire({ questions: [{ question: "Q?", header: "H", options: opts }] }).ok).toBe(true);
  });
  it("rejects zero questions", () => {
    const r = validateQuestionnaire({ questions: [] });
    expect(r).toEqual({ ok: false, error: "no_questions", message: ERROR_NO_QUESTIONS });
  });
  it("rejects more than 4 questions", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}?`, header: "H", options: opts }));
    const r = validateQuestionnaire({ questions: five });
    expect(r).toEqual({ ok: false, error: "too_many_questions", message: ERROR_TOO_MANY_QUESTIONS });
  });
  it("rejects duplicate question text", () => {
    const r = validateQuestionnaire({
      questions: [
        { question: "Same?", header: "H1", options: opts },
        { question: "Same?", header: "H2", options: opts },
      ],
    });
    expect(r).toEqual({ ok: false, error: "duplicate_question", message: ERROR_DUPLICATE_QUESTION });
  });
  it("rejects fewer than 2 options", () => {
    const r = validateQuestionnaire({ questions: [{ question: "Q?", header: "H", options: [{ label: "A", description: "a" }] }] });
    expect(r).toEqual({ ok: false, error: "empty_options", message: ERROR_TOO_FEW_OPTIONS });
  });
  it("rejects each reserved label", () => {
    for (const label of RESERVED_LABELS) {
      const r = validateQuestionnaire({
        questions: [{ question: "Q?", header: "H", options: [{ label, description: "d" }, { label: "B", description: "b" }] }],
      });
      expect(r).toEqual({ ok: false, error: "reserved_label", message: ERROR_RESERVED_LABEL });
    }
  });
  it("rejects duplicate option labels within a question", () => {
    const r = validateQuestionnaire({
      questions: [{ question: "Q?", header: "H", options: [{ label: "A", description: "a" }, { label: "A", description: "a2" }] }],
    });
    expect(r).toEqual({ ok: false, error: "duplicate_option_label", message: ERROR_DUPLICATE_OPTION_LABEL });
  });
  it("allows the same label across different questions", () => {
    const r = validateQuestionnaire({
      questions: [
        { question: "Q1?", header: "H1", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] },
        { question: "Q2?", header: "H2", options: [{ label: "A", description: "a" }, { label: "C", description: "c" }] },
      ],
    });
    expect(r.ok).toBe(true);
  });
  it("reserved_label short-circuits before duplicate_option_label", () => {
    const r = validateQuestionnaire({
      questions: [
        { question: "Q?", header: "H", options: [{ label: "Next", description: "d" }, { label: "Next", description: "d2" }] },
      ],
    });
    expect(r.ok ? undefined : r.error).toBe("reserved_label");
  });
});

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

describe("formatAnswerScalar", () => {
  it("multi joins selected + custom text, falls back to (no input)", () => {
    expect(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "multi", answer: "Docs", selected: ["FE", "BE"] })).toBe(
      "FE, BE, Docs",
    );
    expect(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "multi", answer: null, selected: [] })).toBe("(no input)");
  });
  it("custom returns text or (no input)", () => {
    expect(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "custom", answer: "my own" })).toBe("my own");
    expect(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "custom", answer: null })).toBe("(no input)");
  });
  it("option returns label or (no input)", () => {
    expect(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "option", answer: "A" })).toBe("A");
    expect(formatAnswerScalar({ questionIndex: 0, question: "Q", kind: "option", answer: null })).toBe("(no input)");
  });
});

describe("buildQuestionnaireResponse — cancelled", () => {
  const params: QuestionParams = {
    questions: [{ question: "Q?", header: "H", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }],
  };
  it("null result → decline envelope + empty answers + cancelled true", () => {
    const r = buildQuestionnaireResponse(null, params);
    expect(r.content[0]).toEqual({ type: "text", text: DECLINE_MESSAGE });
    expect(r.details.cancelled).toBe(true);
    expect(r.details.answers).toEqual([]);
  });
  it("cancelled result preserves partial answers in details", () => {
    const result: QuestionnaireResult = {
      cancelled: true,
      answers: [{ questionIndex: 0, question: "Q?", kind: "option", answer: "A" }],
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0]).toMatchObject({ text: DECLINE_MESSAGE });
    expect(r.details.cancelled).toBe(true);
    expect(r.details.answers).toEqual(result.answers);
  });
  it("cancelled + note: decline text, answers forwarded AND globalNote preserved", () => {
    const result: QuestionnaireResult = {
      cancelled: true,
      answers: [{ questionIndex: 0, question: "Q?", kind: "option", answer: "A" }],
      globalNote: "kept for replay",
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text).toBe(DECLINE_MESSAGE);
    expect(r.details.answers).toEqual(result.answers);
    expect(r.details.cancelled).toBe(true);
    expect(r.details.globalNote).toBe("kept for replay");
  });
  it("zero answers + no note still declines (fresh details carries no globalNote)", () => {
    const result: QuestionnaireResult = { cancelled: false, answers: [] };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text).toBe(DECLINE_MESSAGE);
    expect(r.details).toEqual({ answers: [], cancelled: true });
  });
});

describe("buildQuestionnaireResponse — completed", () => {
  const one = (question: string, answer: string): QuestionParams => ({
    questions: [{ question, header: "H", options: [{ label: answer, description: "a" }, { label: "B", description: "b" }] }],
  });
  it("single answered question → CC envelope wrapper", () => {
    const params = one("Pick one", "Option A");
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [{ questionIndex: 0, question: "Pick one", kind: "option", answer: "Option A" }],
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0]).toEqual({
      type: "text",
      text: "User has answered your questions: \"Pick one\"=\"Option A\". You can now continue with the user's answers in mind.",
    });
    expect(r.details).toBe(result);
  });
  it("two answered questions render inside one envelope", () => {
    const params: QuestionParams = {
      questions: [
        { question: "Q1?", header: "H1", options: [{ label: "Yes", description: "Y" }, { label: "No", description: "N" }] },
        { question: "Q2?", header: "H2", options: [{ label: "Yes", description: "Y" }, { label: "No", description: "N" }] },
      ],
    };
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [
        { questionIndex: 0, question: "Q1?", kind: "option", answer: "Yes" },
        { questionIndex: 1, question: "Q2?", kind: "option", answer: "No" },
      ],
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text.split("\n").length).toBe(1);
    expect(r.content[0].text).toContain('"Q1?"="Yes"');
    expect(r.content[0].text).toContain('"Q2?"="No"');
  });
  it("multiSelect joins selected labels + custom text", () => {
    const params: QuestionParams = {
      questions: [
        { question: "Areas", header: "Areas", multiSelect: true, options: [{ label: "FE", description: "F" }, { label: "BE", description: "B" }] },
      ],
    };
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [{ questionIndex: 0, question: "Areas", kind: "multi", answer: "Docs", selected: ["FE", "BE"] }],
    };
    expect(buildQuestionnaireResponse(result, params).content[0].text).toContain('"Areas"="FE, BE, Docs"');
  });
  it("custom typed answer renders raw text", () => {
    const params = one("Free?", "X");
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [{ questionIndex: 0, question: "Free?", kind: "custom", answer: "my custom" }],
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text).toContain('"Free?"="my custom"');
    expect(r.content[0].text).not.toContain("User answered:");
  });
  it("empty custom answer renders as (no input)", () => {
    const params = one("Free?", "X");
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [{ questionIndex: 0, question: "Free?", kind: "custom", answer: null }],
    };
    expect(buildQuestionnaireResponse(result, params).content[0].text).toContain('"Free?"="(no input)"');
  });
  it("notes are echoed as 'user notes: <text>' AND preserved in details", () => {
    const params = one("Pick", "Yes");
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [{ questionIndex: 0, question: "Pick", kind: "option", answer: "Yes", notes: "because of X" }],
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text).toContain("user notes: because of X");
    expect(r.details.answers[0].notes).toBe("because of X");
  });
  it("cancelled: false with no matching answers still returns DECLINE", () => {
    const params = one("Q?", "A");
    const r = buildQuestionnaireResponse({ cancelled: false, answers: [] }, params);
    expect(r.details.cancelled).toBe(true);
    expect(r.content[0]).toEqual({ type: "text", text: DECLINE_MESSAGE });
  });
});

describe("buildQuestionnaireResponse — global note", () => {
  const params: QuestionParams = {
    questions: [{ question: "Pick?", header: "H", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }],
  };
  it("success + note: exact envelope bytes with trailing 'global note:' segment", () => {
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [{ questionIndex: 0, question: "Pick?", kind: "option", answer: "A" }],
      globalNote: "ship it\nFriday",
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text).toBe(
      "User has answered your questions: \"Pick?\"=\"A\". global note: ship it\nFriday. You can now continue with the user's answers in mind.",
    );
    expect(r.details).toBe(result);
  });
  it("zero answers + note is NOT a decline", () => {
    const result: QuestionnaireResult = { cancelled: false, answers: [], globalNote: "note alone" };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text.startsWith("User has answered your questions:")).toBe(true);
    expect(r.content[0].text).toContain("global note:");
    expect(r.content[0].text).toContain("unanswered:");
    expect(r.details.cancelled).toBe(false);
    expect(r.details.globalNote).toBe("note alone");
    expect(r.details).toEqual({ ...result, unanswered: [0] });
  });
});

describe("buildQuestionnaireResponse — partial / unanswered (#291)", () => {
  const params: QuestionParams = {
    questions: [
      { question: "Q1?", header: "First", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] },
      { question: "Q2?", header: "Second", options: [{ label: "B", description: "b" }, { label: "C", description: "c" }] },
    ],
  };
  it("names blank questions in an unanswered: segment + details.unanswered", () => {
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [{ questionIndex: 1, question: "Q2?", kind: "option", answer: "B" }],
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text).toBe(
      "User has answered your questions: \"Q2?\"=\"B\". unanswered: \"Q1?\". You can now continue with the user's answers in mind.",
    );
    expect(r.details.unanswered).toEqual([0]);
  });
  it("leaves a fully answered result byte-identical: no unanswered, details by reference", () => {
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [
        { questionIndex: 0, question: "Q1?", kind: "option", answer: "A" },
        { questionIndex: 1, question: "Q2?", kind: "option", answer: "B" },
      ],
    };
    const r = buildQuestionnaireResponse(result, params);
    expect(r.content[0].text).not.toContain("unanswered");
    expect(r.details).toBe(result);
    expect("unanswered" in r.details).toBe(false);
  });
  it("orders segments: answers, then unanswered, then the global note", () => {
    const r = buildQuestionnaireResponse(
      {
        cancelled: false,
        answers: [{ questionIndex: 0, question: "Q1?", kind: "option", answer: "A" }],
        globalNote: "later",
      },
      params,
    );
    expect(r.content[0].text).toBe(
      "User has answered your questions: \"Q1?\"=\"A\". unanswered: \"Q2?\". global note: later. You can now continue with the user's answers in mind.",
    );
  });
  it("echoes a selected preview for single-select option answers", () => {
    const p: QuestionParams = {
      questions: [
        {
          question: "Layout?",
          header: "Layout",
          options: [
            { label: "Centered", description: "c", preview: "## Centered\n\nbody" },
            { label: "Left", description: "l" },
          ],
        },
      ],
    };
    const result: QuestionnaireResult = {
      cancelled: false,
      answers: [{ questionIndex: 0, question: "Layout?", kind: "option", answer: "Centered", preview: "## Centered\n\nbody" }],
    };
    const r = buildQuestionnaireResponse(result, p);
    expect(r.content[0].text).toContain('"Layout?"="Centered"');
    expect(r.content[0].text).toContain("selected preview: ## Centered");
  });
});

describe("buildToolResult", () => {
  it("locks the envelope shape", () => {
    const details: QuestionnaireResult = { answers: [], cancelled: false };
    expect(buildToolResult("msg", details)).toEqual({
      content: [{ type: "text", text: "msg" }],
      details: { answers: [], cancelled: false },
    });
  });
  it("passes details by reference", () => {
    const details: QuestionnaireResult = { answers: [], cancelled: true };
    expect(buildToolResult("msg", details).details).toBe(details);
  });
  it("accepts an error field in details", () => {
    const details: QuestionnaireResult = { answers: [], cancelled: true, error: "no_questions" };
    expect(buildToolResult("msg", details)).toEqual({
      content: [{ type: "text", text: "msg" }],
      details: { answers: [], cancelled: true, error: "no_questions" },
    });
  });
});

// ---------------------------------------------------------------------------
// Normalize
// ---------------------------------------------------------------------------

describe("normalizeLineTerminators", () => {
  it("deletes a lone CR without a phantom space", () => {
    expect(normalizeLineTerminators("GEMBA\r_LOG\r_FILE\r 的路径")).toBe("GEMBA_LOG_FILE 的路径");
  });
  it("deletes runs of CRs and keeps the real space", () => {
    expect(normalizeLineTerminators("在\r\r\r\r GptApi\r\r\r\r.\r")).toBe("在 GptApi.");
  });
  it("maps CRLF to LF", () => {
    expect(normalizeLineTerminators("line one\r\nline two\r\n")).toBe("line one\nline two\n");
  });
  it("leaves LF-only text byte-identical", () => {
    const text = "```ts\nconst a = 1;\n```";
    expect(normalizeLineTerminators(text)).toBe(text);
    expect(normalizeLineTerminators("")).toBe("");
  });
});

describe("normalizeQuestionParams", () => {
  const dirty: QuestionParams = {
    questions: [
      {
        question: "Which\r option\r is best?",
        header: "Pick\r",
        multiSelect: true,
        options: [
          { label: "Option\rA\r (Recommended)", description: "choice with\r\r stray CR" },
          { label: "B", description: "crlf\r\nline", preview: "```\r\nrow 1\r\nrow 2\r```" },
        ],
      },
    ],
  };
  it("normalizes question, header, label, description, and preview", () => {
    expect(normalizeQuestionParams(dirty)).toEqual({
      questions: [
        {
          question: "Which option is best?",
          header: "Pick",
          multiSelect: true,
          options: [
            { label: "OptionA (Recommended)", description: "choice with stray CR" },
            { label: "B", description: "crlf\nline", preview: "```\nrow 1\nrow 2```" },
          ],
        },
      ],
    });
  });
  it("does not mutate the input", () => {
    const snapshot = JSON.stringify(dirty);
    normalizeQuestionParams(dirty);
    expect(JSON.stringify(dirty)).toBe(snapshot);
  });
  it("keeps omitted optional fields omitted", () => {
    const out = normalizeQuestionParams({
      questions: [{ question: "Q?", header: "H", options: [{ label: "A", description: "a" }] }],
    });
    expect("multiSelect" in out.questions[0]).toBe(false);
    expect("preview" in out.questions[0].options[0]).toBe(false);
  });
  it("tolerates non-string values in string slots", () => {
    const malformed = { questions: [{ question: "Q?", options: [{ label: "A" }, { label: "B" }] }] } as unknown as QuestionParams;
    expect(normalizeQuestionParams(malformed)).toEqual(malformed);
  });
});

describe("prepareQuestionArguments — double-encoded tool arguments (#244)", () => {
  const question = {
    question: "Which format?",
    header: "Format",
    options: [{ label: "TOML", description: "toml" }, { label: "YAML", description: "yaml" }],
  };
  const wellFormed = { questions: [question] };
  it("returns well-formed arguments unchanged", () => {
    expect(prepareQuestionArguments(wellFormed)).toEqual(wellFormed);
    expect(Value.Check(QuestionParamsSchema, prepareQuestionArguments(wellFormed))).toBe(true);
  });
  it.each([
    ["questions as a JSON string", { questions: JSON.stringify([question]) }],
    ["each question as a JSON string", { questions: [JSON.stringify(question)] }],
    ["options as a JSON string", { questions: [{ ...question, options: JSON.stringify(question.options) }] }],
    ["each option as a JSON string", { questions: [{ ...question, options: question.options.map((o) => JSON.stringify(o)) }] }],
    ["both levels at once", { questions: JSON.stringify([JSON.stringify({ ...question, options: JSON.stringify(question.options) })]) }],
  ])("decodes %s so schema validation passes", (_name, raw) => {
    expect(Value.Check(QuestionParamsSchema, raw)).toBe(false);
    const prepared = prepareQuestionArguments(raw);
    expect(prepared).toEqual(wellFormed);
    expect(Value.Check(QuestionParamsSchema, prepared)).toBe(true);
  });
  it.each([
    ["malformed JSON", { questions: "[{not json" }],
    ["a JSON string of the wrong shape", { questions: JSON.stringify({ question: "not an array" }) }],
    ["a plain-text element", { questions: ["just some text"] }],
    ["a non-object argument", "questions"],
  ])("leaves %s untouched", (_name, raw) => {
    expect(prepareQuestionArguments(raw)).toEqual(raw);
  });
});

// ---------------------------------------------------------------------------
// External answer (inbound ask_user:answer resolution)
// ---------------------------------------------------------------------------

describe("resolveExternalAnswer", () => {
  const single: QuestionData = {
    question: "Which?",
    header: "Pick",
    options: [{ label: "A", description: "a" }, { label: "B", description: "b", preview: "```\nb\n```" }],
  };
  const multi: QuestionData = {
    question: "Which ones?",
    header: "Many",
    multiSelect: true,
    options: [{ label: "X", description: "x" }, { label: "Y", description: "y" }, { label: "Z", description: "z" }],
  };
  const questions = [single, multi];
  const resolve = (answers: unknown, extra: Record<string, unknown> = {}) => resolveExternalAnswer(questions, { answers, ...extra });
  const both = (first: Record<string, unknown>, second: Record<string, unknown> = { optionIndexes: [0] }) =>
    resolve([{ questionIndex: 0, ...first }, { questionIndex: 1, ...second }]);
  const codeOf = (o: ReturnType<typeof resolve>) => (o.ok ? "ok" : o.code);

  it("single-select option carries its preview; multi keeps authored order + custom text", () => {
    const out = both({ optionIndexes: [1] }, { text: "  my own  " });
    expect(out).toEqual({
      ok: true,
      result: {
        cancelled: false,
        answers: [
          { questionIndex: 0, question: "Which?", kind: "option", answer: "B", preview: "```\nb\n```" },
          { questionIndex: 1, question: "Which ones?", kind: "multi", answer: "  my own  ", selected: [] },
        ],
      },
    });
  });
  it("multi-select: labels in authored order + options + custom text in one answer", () => {
    const out = both({ text: "mine" }, { optionIndexes: [2, 0], text: "also this" });
    expect(out.ok && out.result.answers).toEqual([
      { questionIndex: 0, question: "Which?", kind: "custom", answer: "mine" },
      { questionIndex: 1, question: "Which ones?", kind: "multi", answer: "also this", selected: ["X", "Z"] },
    ]);
  });
  it("notes + global note are trimmed and dropped when blank", () => {
    const out = resolve(
      [
        { questionIndex: 0, optionIndexes: [0], notes: "  why  " },
        { questionIndex: 1, optionIndexes: [1], notes: "   " },
      ],
      { globalNote: " overall " },
    );
    expect(out.ok && out.result).toEqual({
      cancelled: false,
      globalNote: "overall",
      answers: [
        { questionIndex: 0, question: "Which?", kind: "option", answer: "A", notes: "why" },
        { questionIndex: 1, question: "Which ones?", kind: "multi", answer: null, selected: ["Y"] },
      ],
    });
  });
  it("entry order does not matter", () => {
    const out = resolve([{ questionIndex: 1, optionIndexes: [0] }, { questionIndex: 0, optionIndexes: [0] }]);
    expect(out.ok && out.result.answers.map((a) => a.questionIndex)).toEqual([0, 1]);
  });
  it("cancel declines, keeping a global note", () => {
    expect(resolveExternalAnswer(questions, { cancel: true, globalNote: "later" })).toEqual({
      ok: true,
      result: { answers: [], cancelled: true, globalNote: "later" },
    });
  });
  it("cancel takes no answers", () => {
    expect(codeOf(resolve([{ questionIndex: 0, optionIndexes: [0] }], { cancel: true }))).toBe("invalid_payload");
  });
  it.each([
    ["answers missing", resolveExternalAnswer(questions, {})],
    ["answers not an array", resolve({})],
    ["entry not an object", resolve([null])],
    ["questionIndex not an integer", resolve([{ questionIndex: "0" }])],
    ["optionIndexes not an array", both({ optionIndexes: 1 })],
    ["optionIndexes not integers", both({ optionIndexes: [0.5] })],
    ["text not a string", both({ text: 3 })],
    ["notes not a string", both({ optionIndexes: [0], notes: {} })],
    ["globalNote not a string", resolve([], { globalNote: 1 })],
    ["cancel not a boolean", resolveExternalAnswer(questions, { cancel: 1 })],
  ])("invalid_payload: %s", (_name, out) => {
    expect(codeOf(out)).toBe("invalid_payload");
  });
  it.each([
    ["a question unanswered", resolve([{ questionIndex: 0, optionIndexes: [0] }])],
    ["a question answered twice", resolve([{ questionIndex: 0, optionIndexes: [0] }, { questionIndex: 0, optionIndexes: [1] }, { questionIndex: 1, optionIndexes: [0] }])],
    ["questionIndex out of range", resolve([{ questionIndex: 2, optionIndexes: [0] }])],
    ["option index out of range", both({ optionIndexes: [2] })],
    ["option index repeated", both({ optionIndexes: [0] }, { optionIndexes: [1, 1] })],
    ["single-select with two options", both({ optionIndexes: [0, 1] })],
    ["single-select with an option and text", both({ optionIndexes: [0], text: "t" })],
    ["neither options nor text", both({ optionIndexes: [] })],
    ["blank text", both({ text: "   " })],
  ])("invalid_answer: %s", (_name, out) => {
    expect(codeOf(out)).toBe("invalid_answer");
  });
  it("ignores unknown fields", () => {
    expect(codeOf(resolve([{ questionIndex: 0, optionIndexes: [0], extra: 1 }, { questionIndex: 1, text: "t" }], { x: 1 }))).toBe("ok");
  });
});

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

describe("formatKeySpecForDisplay", () => {
  it("capitalizes each +-part", () => {
    expect(formatKeySpecForDisplay("ctrl+]")).toBe("Ctrl+]");
    expect(formatKeySpecForDisplay("alt+o")).toBe("Alt+O");
    expect(formatKeySpecForDisplay("ctrl+shift+h")).toBe("Ctrl+Shift+H");
  });
  it("handles named special keys and bare keys", () => {
    expect(formatKeySpecForDisplay("f9")).toBe("F9");
    expect(formatKeySpecForDisplay("alt+escape")).toBe("Alt+Escape");
    expect(formatKeySpecForDisplay("]")).toBe("]");
  });
  it("cases compound-word named keys conventionally", () => {
    expect(formatKeySpecForDisplay("ctrl+pagedown")).toBe("Ctrl+PageDown");
    expect(formatKeySpecForDisplay("pageup")).toBe("PageUp");
  });
  it("round-trips the default key to the historical hint casing", () => {
    expect(formatKeySpecForDisplay(DEFAULT_COLLAPSE_KEY)).toBe("Ctrl+]");
  });
});

describe("resolveCollapseKey", () => {
  it("returns the default when config has no collapseKey", () => {
    expect(resolveCollapseKey({})).toBe(DEFAULT_COLLAPSE_KEY);
    expect(resolveCollapseKey({ collapseKey: undefined })).toBe(DEFAULT_COLLAPSE_KEY);
  });
  it("returns the default when collapseKey is empty or whitespace", () => {
    expect(resolveCollapseKey({ collapseKey: "" })).toBe(DEFAULT_COLLAPSE_KEY);
    expect(resolveCollapseKey({ collapseKey: "   " })).toBe(DEFAULT_COLLAPSE_KEY);
  });
  it("normalizes the spec (trim + lowercase)", () => {
    expect(resolveCollapseKey({ collapseKey: "  Ctrl+}  " })).toBe("ctrl+}");
    expect(resolveCollapseKey({ collapseKey: "ALT+O" })).toBe("alt+o");
  });
  it("returns the off sentinel unchanged (case-insensitive)", () => {
    expect(resolveCollapseKey({ collapseKey: "off" })).toBe(COLLAPSE_KEY_OFF);
    expect(resolveCollapseKey({ collapseKey: "OFF" })).toBe(COLLAPSE_KEY_OFF);
    expect(resolveCollapseKey({ collapseKey: "  off  " })).toBe(COLLAPSE_KEY_OFF);
  });
  it("falls back to the default for malformed specs", () => {
    expect(resolveCollapseKey({ collapseKey: "+ctrl+]" })).toBe(DEFAULT_COLLAPSE_KEY);
    expect(resolveCollapseKey({ collapseKey: "ctrl++" })).toBe(DEFAULT_COLLAPSE_KEY);
    expect(resolveCollapseKey({ collapseKey: "ctrl+]" })).toBe("ctrl+]");
    expect(resolveCollapseKey({ collapseKey: "ctrl+shift+h" })).toBe("ctrl+shift+h");
  });
  it("falls back for typo'd modifiers and unknown key names", () => {
    expect(resolveCollapseKey({ collapseKey: "ctr+]" })).toBe(DEFAULT_COLLAPSE_KEY);
    expect(resolveCollapseKey({ collapseKey: "control+]" })).toBe(DEFAULT_COLLAPSE_KEY);
    expect(resolveCollapseKey({ collapseKey: "ctrl+nosuchkey" })).toBe(DEFAULT_COLLAPSE_KEY);
    expect(resolveCollapseKey({ collapseKey: "hello" })).toBe(DEFAULT_COLLAPSE_KEY);
    expect(resolveCollapseKey({ collapseKey: "ctrl+ctrl+]" })).toBe(DEFAULT_COLLAPSE_KEY);
  });
  it("accepts named special keys and bare base keys", () => {
    expect(resolveCollapseKey({ collapseKey: "ctrl+pageup" })).toBe("ctrl+pageup");
    expect(resolveCollapseKey({ collapseKey: "Ctrl+PageUp" })).toBe("ctrl+pageup");
    expect(resolveCollapseKey({ collapseKey: "f5" })).toBe("f5");
    expect(resolveCollapseKey({ collapseKey: "alt+escape" })).toBe("alt+escape");
  });
});

describe("validateGuidanceFields", () => {
  it("keeps well-formed guidance fields", () => {
    expect(validateGuidanceFields({ promptSnippet: "s", promptGuidelines: ["a", "b"], description: "d" })).toEqual({
      promptSnippet: "s",
      promptGuidelines: ["a", "b"],
      description: "d",
    });
  });
  it("drops empty / non-string / non-array fields", () => {
    expect(
      validateGuidanceFields({ promptSnippet: "", promptGuidelines: ["a", 1], description: 5, extra: true }),
    ).toEqual({});
  });
  it("returns {} for non-objects", () => {
    expect(validateGuidanceFields(null)).toEqual({});
    expect(validateGuidanceFields("x")).toEqual({});
  });
});

describe("configPath", () => {
  it("resolves under $AGENT_HOME/conf.d/ask-user.conf (ADR-0008)", () => {
    expect(configPath().split("/").slice(-2)).toEqual(["conf.d", "ask-user.conf"]);
    expect(configPath().endsWith("conf.d/ask-user.conf")).toBe(true);
  });
});

describe("loadConfig (malformed JSON)", () => {
  it("returns {} without throwing for a malformed/missing file", () => {
    expect(() => loadConfig()).not.toThrow();
    const c = loadConfig();
    expect(c).toEqual(expect.objectContaining({}));
    expect(typeof c).toBe("object");
  });
});

// ---------------------------------------------------------------------------
// Events + registration
// ---------------------------------------------------------------------------

describe("event channel constants", () => {
  it("outbound + inbound channels are stable strings", () => {
    expect(ASK_USER_PROMPT_EVENT).toBe("ask_user:prompt");
    expect(ASK_USER_BLOCKED_EVENT).toBe("ask_user:blocked");
    expect(ASK_USER_ANSWER_EVENT).toBe("ask_user:answer");
    expect(ASK_USER_ANSWER_RESULT_EVENT).toBe("ask_user:answer-result");
    expect(ASK_ANSWERED_EVENT).toBe("ask:answered");
    expect(ASK_CANCELLED_EVENT).toBe("ask:cancelled");
  });
});

function makePi() {
  const registered: any[] = [];
  const listeners: Record<string, ((data: unknown) => void)[]> = {};
  const emitted: { channel: string; data: unknown }[] = [];
  const events = {
    emitted,
    on(channel: string, fn: (data: unknown) => void) {
      (listeners[channel] ??= []).push(fn);
      return () => {
        listeners[channel] = listeners[channel].filter((f) => f !== fn);
      };
    },
    emit(channel: string, data: unknown) {
      emitted.push({ channel, data });
      for (const fn of listeners[channel] ?? []) fn(data);
    },
  };
  const pi: any = {
    events,
    on() {},
    registerTool(definition: any) {
      registered.push(definition);
      return { definition };
    },
  };
  extension(pi);
  return { pi, tool: registered[0], events };
}

function makeCtx(overrides: Record<string, unknown> = {}) {
  const calls = { select: [] as { title: string; options: string[] }[], input: [] as { title: string; placeholder?: string }[] };
  const selectQueue: (string | ((title: string, options: string[]) => string))[] = [];
  const inputQueue: (string | ((title: string, placeholder?: string) => string))[] = [];
  const ui = {
    select(title: string, options: string[]) {
      calls.select.push({ title, options });
      const next = selectQueue.length > 0 ? selectQueue.shift()! : "select";
      return Promise.resolve(typeof next === "function" ? next(title, options) : next);
    },
    input(title: string, placeholder?: string) {
      calls.input.push({ title, placeholder });
      const next = inputQueue.length > 0 ? inputQueue.shift()! : "input";
      return Promise.resolve(typeof next === "function" ? next(title, placeholder) : next);
    },
    notify() {},
  };
  return { calls, selectQueue, inputQueue, ctx: { mode: "rpc", hasUI: true, ui, signal: undefined, ...overrides } };
}

function execute(tool: any, params: unknown, ctx: Record<string, unknown>) {
  return tool.execute("call-1", params, undefined, undefined, ctx);
}

function text(result: { content: { type: string; text: string }[] }) {
  expect(result.content.length).toBe(1);
  expect(result.content[0].type).toBe("text");
  return result.content[0].text;
}

describe("tool registration", () => {
  it("registers the ask_user tool with the contract shape", () => {
    const { tool } = makePi();
    expect(tool.name).toBe(ASK_USER_TOOL_NAME);
    expect(tool.name).toBe("ask_user");
    expect(tool.label).toBe("Ask User");
    expect(typeof tool.execute).toBe("function");
    expect(tool.parameters).toBe(QuestionParamsSchema);
    expect(tool.parameters.properties.questions).toBeTruthy();
    expect(tool.prepareArguments).toBe(prepareQuestionArguments);
  });
  it("exposes defaults for description / promptSnippet / promptGuidelines", () => {
    const { tool } = makePi();
    expect(tool.description).toBe(DEFAULT_TOOL_DESCRIPTION);
    expect(tool.promptSnippet).toBe(DEFAULT_PROMPT_SNIPPET);
    expect(tool.promptGuidelines).toBe(DEFAULT_PROMPT_GUIDELINES);
  });
});

describe("execute — no UI", () => {
  it("rejects with no_ui when hasUI is false", async () => {
    const { tool } = makePi();
    const { ctx } = makeCtx({ hasUI: false });
    const r = await execute(tool, { questions: [makeQuestion()] }, ctx);
    expect(text(r)).toContain("Error: UI not available");
    expect(r.details).toEqual({ answers: [], cancelled: true, error: "no_ui" });
  });
});

describe("execute — validation errors surface via the envelope", () => {
  const { tool } = makePi();
  const good = makeCtx();
  it("too_many_questions", async () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}?`, header: "H", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }));
    const r = await execute(tool, { questions: five }, good.ctx);
    expect(r.details.error).toBe("too_many_questions");
    expect(text(r)).toBe(ERROR_TOO_MANY_QUESTIONS);
  });
  it("duplicate_question", async () => {
    const r = await execute(tool, {
      questions: [
        { question: "Same?", header: "H1", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] },
        { question: "Same?", header: "H2", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] },
      ],
    }, good.ctx);
    expect(r.details.error).toBe("duplicate_question");
    expect(text(r)).toBe(ERROR_DUPLICATE_QUESTION);
  });
  it("reserved_label", async () => {
    const r = await execute(tool, {
      questions: [{ question: "Q?", header: "H", options: [{ label: "Other", description: "a" }, { label: "B", description: "b" }] }],
    }, good.ctx);
    expect(r.details.error).toBe("reserved_label");
    expect(text(r)).toBe(ERROR_RESERVED_LABEL);
  });
});

describe("execute — event flow (RPC path)", () => {
  it("emits prompt before, blocked true/false around, and backward-compat answered after", async () => {
    const { tool, events } = makePi();
    const { ctx, selectQueue } = makeCtx();
    selectQueue.push("1. A — a");
    const channels: string[] = [];
    const origEmit = events.emit.bind(events);
    const spy = (channel: string, data: unknown) => {
      channels.push(channel);
      return origEmit(channel, data);
    };
    // record order relative to tool lifecycle by wrapping
    const originalEmit = events.emit;
    events.emit = (channel: string, data: unknown) => {
      channels.push(channel);
      return originalEmit(channel, data);
    };
    void spy;
    await execute(tool, { questions: [makeQuestion()] }, ctx);
    expect(channels).toContain(ASK_USER_PROMPT_EVENT);
    expect(channels.filter((c) => c === ASK_USER_BLOCKED_EVENT).length).toBe(2);
    expect(channels).toContain(ASK_ANSWERED_EVENT);
    const blockedEvents = events.emitted.filter((e) => e.channel === ASK_USER_BLOCKED_EVENT) as {
      channel: string;
      data: { active: boolean };
    }[];
    expect(blockedEvents[0].data.active).toBe(true);
    expect(blockedEvents[1].data.active).toBe(false);
    const prompt = events.emitted.find((e) => e.channel === ASK_USER_PROMPT_EVENT)?.data as {
      questions: { question: string; header: string; multiSelect: boolean; options: { label: string; hasPreview: boolean }[] }[];
      toolCallId?: string;
    };
    expect(prompt.questions).toHaveLength(1);
    expect(prompt.questions[0].header).toBe("Hdr");
    expect(prompt.questions[0].multiSelect).toBe(false);
    expect(prompt.questions[0].options[0].hasPreview).toBe(false);
  });
  it("inbound ask_user:answer to an open RPC host is refused as unsupported_host", async () => {
    const { tool, events } = makePi();
    const { ctx } = makeCtx();
    let open = false;
    (ctx as any).ui.select = () =>
      new Promise((res) => {
        const tick = () => (open ? res("1. A — Choice A") : setTimeout(tick, 1));
        tick();
      });
    const results: { ok: boolean; code?: string }[] = [];
    const off = events.on(ASK_USER_ANSWER_RESULT_EVENT, (d) => results.push(d as { ok: boolean; code?: string }));
    const promise = execute(tool, { questions: [makeQuestion()] }, ctx);
    // let execute open the questionnaire (host = rpc) and enter the select await
    await new Promise((r) => setTimeout(r, 5));
    try {
      events.emit(ASK_USER_ANSWER_EVENT, { toolCallId: "call-1", answers: [{ questionIndex: 0, optionIndexes: [1] }] });
    } finally {
      off();
    }
    open = true;
    await promise;
    // RPC dialogs are walked by select/input and cannot be answered from outside.
    expect(results).toEqual([{ ok: false, code: "unsupported_host", reason: "this host shows the questions in its own dialogs", toolCallId: "call-1" }]);
  });
  it("inbound ask_user:answer resolves an open TUI questionnaire (first-answer-wins) and replies ok", async () => {
    const { tool, events } = makePi();
    const { ctx } = makeCtx({ mode: "tui" });
    (ctx as any).ui.custom = async () => new Promise<QuestionnaireResult>(() => {});
    const promise = execute(tool, { questions: [makeQuestion()] }, ctx);
    // let execute reach the session load and register the questionnaire (host = tui)
    for (let i = 0; i < 10; i++) await Promise.resolve();
    const results: { ok: boolean; code?: string }[] = [];
    const off = events.on(ASK_USER_ANSWER_RESULT_EVENT, (d) => results.push(d as { ok: boolean; code?: string }));
    try {
      events.emit(ASK_USER_ANSWER_EVENT, { toolCallId: "call-1", answers: [{ questionIndex: 0, optionIndexes: [1] }] });
    } finally {
      off();
    }
    const r = await promise;
    expect(results.some((x) => x.ok)).toBe(true);
    expect(text(r)).toContain('"What\'s your name?"="B"');
  });
  it("inbound answer to an unknown tool call is refused with not_found", async () => {
    const { events } = makePi();
    const results: { ok: boolean; code?: string }[] = [];
    const off = events.on(ASK_USER_ANSWER_RESULT_EVENT, (d) => results.push(d as { ok: boolean; code?: string }));
    try {
      events.emit(ASK_USER_ANSWER_EVENT, { toolCallId: "ghost", answers: [] });
    } finally {
      off();
    }
    expect(results).toEqual([{ ok: false, code: "not_found", reason: "no open questionnaire for tool call ghost", toolCallId: "ghost" }]);
  });
});

describe("execute — RPC single/multi select", () => {
  it("single-select option pick", async () => {
    const { tool } = makePi();
    const { ctx, selectQueue } = makeCtx();
    selectQueue.push("1. A — Choice A");
    const r = await execute(tool, { questions: [makeQuestion()] }, ctx);
    expect(text(r)).toContain('"What\'s your name?"="A"');
    expect(r.details.cancelled).toBe(false);
  });
  it("single-select custom via Type something.", async () => {
    const { tool } = makePi();
    const { ctx, selectQueue, inputQueue } = makeCtx();
    selectQueue.push((title: string, options: string[]) => options.find((o) => o.includes("Type something."))!);
    inputQueue.push("my free text");
    const r = await execute(tool, { questions: [makeQuestion()] }, ctx);
    expect(text(r)).toContain('"What\'s your name?"="my free text"');
  });
  it("dismiss cancels the questionnaire (DECLINE)", async () => {
    const { tool } = makePi();
    const { ctx, selectQueue } = makeCtx();
    selectQueue.push(undefined as unknown as string);
    const r = await execute(tool, { questions: [makeQuestion()] }, ctx);
    expect(text(r)).toBe(DECLINE_MESSAGE);
    expect(r.details.cancelled).toBe(true);
  });
  it("multi-select numbers + custom", async () => {
    const { tool } = makePi();
    const { ctx, inputQueue } = makeCtx();
    const q = makeQuestion({ multiSelect: true, options: [{ label: "FE", description: "Frontend" }, { label: "BE", description: "Backend" }, { label: "Tests", description: "T" }] });
    inputQueue.push("1,3; Docs");
    const r = await execute(tool, { questions: [q] }, ctx);
    expect(text(r)).toContain(`"${q.question}"="FE, Tests, Docs"`);
  });
});

describe("execute — no custom UI (RPC host without select/input)", () => {
  it("falls back to no_custom_ui", async () => {
    const { tool } = makePi();
    const { ctx } = makeCtx();
    (ctx as any).ui.custom = () => Promise.resolve(undefined);
    delete (ctx as any).ui.select;
    delete (ctx as any).ui.input;
    const r = await execute(tool, { questions: [makeQuestion()] }, ctx);
    expect(r.details.error).toBe("no_custom_ui");
  });
});
