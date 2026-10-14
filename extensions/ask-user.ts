import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

interface AskQuestion {
  question: string;
  options: string[];
  multiSelect?: boolean;
  allowFreeform?: boolean;
}

interface AskUserParams {
  question?: string;
  questions?: AskQuestion[];
  options?: string[];
  multiSelect?: boolean;
  allowFreeform?: boolean;
}

export interface AskSelection {
  kind: "selection";
  selections: string[];
}

export interface AskFreeform {
  kind: "freeform";
  text: string;
}

export interface AskSingleDetails {
  question: string;
  options: string[];
  answer: AskSelection | AskFreeform | null;
  cancelled: boolean;
}

export interface AskBatchDetails {
  kind: "batch";
  questions: AskQuestion[];
  answers: (AskSelection | AskFreeform)[] | null;
  cancelled: boolean;
}

export type AskDetails = AskSingleDetails | AskBatchDetails;

export const ASK_PROMPT_SNIPPET =
  "Use ask_user to ask the user a focused decision question with 2–5 options.";

export const ASK_PROMPT_GUIDELINES = [
  "Ask ONE focused decision question per ask_user call with 2–5 mutually exclusive options; never bundle independent decisions in one question.",
  "Use the `questions` batch (2–4 questions) only for independent decisions that can be answered in order; each batch question still needs 2–5 options.",
  "Set `multiSelect: true` when the user may pick more than one option; otherwise options are single-choice.",
  "Freeform answers are offered automatically unless `allowFreeform` is false.",
];

function askUserParams() {
  return Type.Object({
    question: Type.Optional(
      Type.String({
        description:
          "The single decision question to ask. Exactly one of `question` or `questions` must be provided.",
      }),
    ),
    options: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "2–5 mutually exclusive option labels for `question` (required when `question` is used).",
      }),
    ),
    multiSelect: Type.Optional(
      Type.Boolean({
        description:
          "When true the user may select several options; the selection commits only on an explicit Done.",
      }),
    ),
    allowFreeform: Type.Optional(
      Type.Boolean({
        description:
          "When false the user cannot type a custom answer (default: allowed).",
      }),
    ),
    questions: Type.Optional(
      Type.Array(
        Type.Object({
          question: Type.String({
            description: "The decision question to ask.",
          }),
          options: Type.Array(Type.String(), {
            description: "2–5 mutually exclusive option labels.",
          }),
          multiSelect: Type.Optional(Type.Boolean()),
          allowFreeform: Type.Optional(Type.Boolean()),
        }),
        {
          description:
            "A batch of 2–4 independent decision questions. Exactly one of `question` or `questions` must be provided.",
        },
      ),
    ),
  });
}

export type AskUserParamsSchema = ReturnType<typeof askUserParams>;

const MIN_OPTIONS = 2;
const MAX_OPTIONS = 5;
const MIN_BATCH = 2;
const MAX_BATCH = 4;

function validateParams(params: AskUserParams): string | undefined {
  const single = params.question !== undefined;
  const batch = params.questions !== undefined;
  if (single && batch) {
    return "ask_user: provide exactly one of `question` or `questions`, not both";
  }
  if (!single && !batch) {
    return "ask_user: provide `question` (single) or `questions` (batch), one of the two is required";
  }
  if (batch) {
    if (params.questions!.length < MIN_BATCH || params.questions!.length > MAX_BATCH) {
      return `ask_user: a batch needs ${MIN_BATCH}–${MAX_BATCH} questions, got ${params.questions!.length}`;
    }
    for (const q of params.questions!) {
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

function validationError(message: string): AgentToolResult<AskDetails> {
  return {
    content: [{ type: "text", text: message }],
    details: { cancelled: true, answer: null } as unknown as AskSingleDetails,
    isError: true,
  };
}

export function renderAskCall(
  params: AskUserParams,
  theme: { fg(color: string, text: string): string; bold(text: string): string },
) {
  const describe = (q: AskQuestion) =>
    `${q.question} (${q.options.join(", ")})`;
  let plain: string;
  if (params.questions) {
    plain = `Ask (${params.questions.length} questions): ${params.questions
      .map(describe)
      .join(", ")}`;
    if (plain.length > 120) plain = `${plain.slice(0, 117)}…`;
  } else {
    plain = `Ask: ${describe({ question: params.question ?? "", options: params.options ?? [] })}`;
  }
  return new Text(
    theme.fg("toolTitle", theme.bold("ask_user ")) +
      theme.fg("accent", plain),
    0,
    0,
  );
}

export function renderAskResult(
  result: AgentToolResult<AskDetails>,
  theme: { fg(color: string, text: string): string; bold(text: string): string },
) {
  const details = result.details;
  if (!details) return new Text("", 0, 0);
  if (details.kind === "batch") {
    const label = details.cancelled
      ? "✗ cancelled (batch)"
      : `✓ ${details.answers?.length ?? 0} answers collected`;
    return new Text(details.cancelled ? theme.fg("warning", label) : theme.fg("success", label), 0, 0);
  }
  if (details.cancelled) {
    return new Text(theme.fg("warning", "✗ cancelled"), 0, 0);
  }
  const answer = details.answer;
  if (!answer) return new Text(theme.fg("dim", "no answer"), 0, 0);
  if (answer.kind === "freeform") {
    return new Text(theme.fg("success", `✓ ${answer.text}`), 0, 0);
  }
  const first = answer.selections[0];
  const index = details.options.indexOf(first);
  const label =
    index >= 0 && answer.selections.length === 1
      ? `${index + 1}. ${first}`
      : answer.selections.join(", ");
  return new Text(theme.fg("success", `✓ ${label}`), 0, 0);
}

export default function askUserExtension(pi: ExtensionAPI) {
  pi.registerTool<AskUserParamsSchema, AskDetails>({
    name: "ask_user",
    label: "Ask User",
    description:
      "Pause and ask the user a focused decision question with 2–5 options (single choice or multi-select), optionally with a freeform answer, or a batch of 2–4 independent questions. The user's answer comes back as a structured result; a cancelled prompt returns cancelled=true.",
    promptSnippet: ASK_PROMPT_SNIPPET,
    promptGuidelines: ASK_PROMPT_GUIDELINES,
    parameters: askUserParams(),

    async execute(
      _toolCallId: string,
      params: AskUserParams,
      _signal: AbortSignal | undefined,
      _onUpdate: unknown,
      _ctx: ExtensionToolContext,
    ): Promise<AgentToolResult<AskDetails>> {
      const error = validateParams(params);
      if (error) return validationError(error);
      return validationError("not implemented yet");
    },

    renderCall(args, theme) {
      return renderAskCall(args as AskUserParams, theme);
    },

    renderResult(result, _options, theme) {
      return renderAskResult(result, theme);
    },
  });
}
