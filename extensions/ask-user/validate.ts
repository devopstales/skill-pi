export interface AskQuestion {
  question: string;
  options: string[];
  multiSelect?: boolean;
  allowFreeform?: boolean;
}

export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 5;
export const MIN_BATCH = 2;
export const MAX_BATCH = 4;

interface AskUserParams {
  question?: string;
  questions?: AskQuestion[];
  options?: string[];
  multiSelect?: boolean;
  allowFreeform?: boolean;
}

export function validateParams(params: AskUserParams): string | undefined {
  const single = params.question !== undefined;
  const batch = params.questions !== undefined;
  if (single && batch) {
    return "ask_user: provide exactly one of `question` or `questions`, not both";
  }
  if (!single && !batch) {
    return "ask_user: provide `question` (single) or `questions` (batch), one of the two is required";
  }
  if (batch) {
    const questions = params.questions!;
    if (questions.length < MIN_BATCH || questions.length > MAX_BATCH) {
      return `ask_user: a batch needs ${MIN_BATCH}–${MAX_BATCH} questions, got ${questions.length}`;
    }
    for (const q of questions) {
      const count = q.options?.length ?? 0;
      if (count < MIN_OPTIONS || count > MAX_OPTIONS) {
        return `ask_user: each question needs ${MIN_OPTIONS}–${MAX_OPTIONS} options, got ${count}`;
      }
    }
    return undefined;
  }
  const count = params.options?.length ?? 0;
  if (count < MIN_OPTIONS || count > MAX_OPTIONS) {
    return `ask_user: each question needs ${MIN_OPTIONS}–${MAX_OPTIONS} options, got ${count}`;
  }
  return undefined;
}
