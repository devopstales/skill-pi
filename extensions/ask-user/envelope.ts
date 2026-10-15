import type { QuestionAnswer, QuestionParams, QuestionnaireResult } from "./types.js";

export const DECLINE_MESSAGE = "User declined to answer questions";
export const ENVELOPE_PREFIX = "User has answered your questions:";
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";
export const NO_INPUT_PLACEHOLDER = "(no input)";

export type FormatAnswerVariant = "summary" | "envelope";

export function formatAnswerScalar(a: QuestionAnswer, _variant: FormatAnswerVariant = "envelope"): string {
  switch (a.kind) {
    case "multi": {
      const values = [...(a.selected ?? [])];
      if (a.answer && a.answer.length > 0) values.push(a.answer);
      return values.length > 0 ? values.join(", ") : NO_INPUT_PLACEHOLDER;
    }
    case "custom":
      return a.answer && a.answer.length > 0 ? a.answer : NO_INPUT_PLACEHOLDER;
    case "option":
      return a.answer ?? NO_INPUT_PLACEHOLDER;
  }
}

export function buildToolResult(text: string, details: QuestionnaireResult) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function buildAnswerSegment(a: QuestionAnswer): string {
  const parts: string[] = [`"${a.question}"="${formatAnswerScalar(a)}"`];
  if (a.preview && a.preview.length > 0) parts.push(`selected preview: ${a.preview}`);
  if (a.notes && a.notes.length > 0) parts.push(`user notes: ${a.notes}`);
  return `${parts.join(". ")}.`;
}

function buildUnansweredSegment(indexes: readonly number[], params: QuestionParams): string {
  return `unanswered: ${indexes.map((i) => `"${params.questions[i]?.question}"`).join(", ")}.`;
}

export function buildQuestionnaireResponse(
  result: QuestionnaireResult | null | undefined,
  params: QuestionParams,
) {
  if (!result || result.cancelled) {
    return buildToolResult(DECLINE_MESSAGE, {
      answers: result?.answers ?? [],
      cancelled: true,
      ...(result?.globalNote && result.globalNote.length > 0 ? { globalNote: result.globalNote } : {}),
    });
  }
  const segments: string[] = [];
  const unanswered: number[] = [];
  for (let i = 0; i < params.questions.length; i++) {
    const a = result.answers.find((x) => x.questionIndex === i);
    if (a) segments.push(buildAnswerSegment(a));
    else unanswered.push(i);
  }
  const hasGlobalNote = result.globalNote !== undefined && result.globalNote.length > 0;
  if (segments.length === 0 && !hasGlobalNote) {
    return buildToolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
  }
  if (unanswered.length > 0) segments.push(buildUnansweredSegment(unanswered, params));
  if (hasGlobalNote) segments.push(`global note: ${result.globalNote}.`);
  const details = unanswered.length > 0 ? { ...result, unanswered } : result;
  return buildToolResult(`${ENVELOPE_PREFIX} ${segments.join(" ")} ${ENVELOPE_SUFFIX}`, details);
}
