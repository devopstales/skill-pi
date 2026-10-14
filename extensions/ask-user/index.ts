import type {
  AgentToolResult,
  ExtensionAPI,
  ExtensionToolContext,
} from "@earendil-works/pi-coding-agent";
import { Text, parseKey } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { validateParams, type AskQuestion } from "./validate.ts";

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
    const full = `Ask (${params.questions.length} questions): ${params.questions
      .map(describe)
      .join(", ")}`;
    plain = full.length > 120 ? `${full.slice(0, 119)}…` : full;
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

export const FREEFORM_OPTION = "✎ Type something…";
export const DONE_OPTION = "Done";
export const UNAVAILABLE_TEXT = "ask_user is unavailable outside interactive modes";

interface EmitFn {
  (channel: string, data: unknown): void;
}

export async function askSingleViaRpc(q: AskQuestion, ctx: ExtensionToolContext) {
  const dialogOptions =
    q.allowFreeform === false ? q.options : [...q.options, FREEFORM_OPTION];
  const choice = await ctx.ui.select(q.question, dialogOptions);
  if (choice === undefined) return null;
  if (choice === FREEFORM_OPTION) {
    const text = await ctx.ui.input(q.question, "Type your answer…");
    return text ? ({ kind: "freeform", text } as AskFreeform) : null;
  }
  return { kind: "selection", selections: [choice] } as AskSelection;
}

function multiSelectTitle(q: AskQuestion, selected: Set<string>, round: number) {
  const marks = q.options
    .map((option) => `${selected.has(option) ? "[x]" : "[ ]"} ${option}`)
    .join("\n");
  return `${q.question}\n${marks}\n(Round ${round})`;
}

export async function askMultiSelectViaRpc(
  q: AskQuestion,
  ctx: ExtensionToolContext,
): Promise<AskSelection | null> {
  const selected = new Set<string>();
  const cap = Math.max(32, q.options.length + 2);
  const dialogOptions = [
    ...q.options,
    DONE_OPTION,
    ...(q.allowFreeform === false ? [] : [FREEFORM_OPTION]),
  ];
  for (let round = 1; round <= cap; round++) {
    const choice = await ctx.ui.select(
      multiSelectTitle(q, selected, round),
      dialogOptions,
    );
    if (choice === undefined) return null;
    if (choice === DONE_OPTION) {
      return { kind: "selection", selections: [...selected] } as AskSelection;
    }
    if (choice === FREEFORM_OPTION) {
      const text = await ctx.ui.input(q.question, "Type your answer…");
      return text ? ({ kind: "freeform", text } as AskFreeform) : null;
    }
    if (selected.has(choice)) selected.delete(choice);
    else selected.add(choice);
    if (selected.size === q.options.length) {
      return { kind: "selection", selections: [...selected] } as AskSelection;
    }
  }
  return null;
}

interface BatchOutcome {
  answers: (AskSelection | AskFreeform)[] | null;
  question: AskQuestion;
  answered: { question: AskQuestion; answer: AskSelection | AskFreeform }[];
}

export async function askBatchViaRpc(
  questions: AskQuestion[],
  ctx: ExtensionToolContext,
): Promise<BatchOutcome> {
  const answers: (AskSelection | AskFreeform)[] = [];
  const answered: { question: AskQuestion; answer: AskSelection | AskFreeform }[] = [];
  for (const q of questions) {
    const answer = q.multiSelect
      ? await askMultiSelectViaRpc(q, ctx)
      : await askSingleViaRpc(q, ctx);
    if (answer === null) return { answers: null, question: q, answered };
    answers.push(answer);
    answered.push({ question: q, answer });
  }
  return { answers, question: questions[questions.length - 1], answered };
}

export function batchPlaceholder(questions: AskQuestion[]): AskBatchDetails {
  return { kind: "batch", questions, answers: null, cancelled: true };
}

export function batchResult(questions: AskQuestion[], outcome: BatchOutcome): AgentToolResult<AskBatchDetails> {
  const details: AskBatchDetails = {
    kind: "batch",
    questions,
    answers: outcome.answers,
    cancelled: outcome.answers === null,
  };
  return {
    content: [
      {
        type: "text",
        text:
          outcome.answers === null
            ? `The user declined at "${outcome.question.question}"; the whole batch was cancelled, so proceed without these decisions.`
            : `Batch answered: ${outcome.answers
                .map((a) => (a.kind === "freeform" ? a.text : a.selections.join(", ")))
                .join("; ")}`,
      },
    ],
    details,
  };
}

export function singleResult(q: AskQuestion, answer: AskSelection | AskFreeform | null): AgentToolResult<AskSingleDetails> {
  const details: AskSingleDetails = {
    question: q.question,
    options: q.options,
    answer,
    cancelled: answer === null,
  };
  return {
    content: [
      {
        type: "text",
        text:
          answer === null
            ? "The user declined to answer; proceed without this decision and do not assume one."
            : answer.kind === "freeform"
              ? `User answer: ${answer.text}`
              : `User selected: ${answer.selections.join(", ")}`,
      },
    ],
    details,
  };
}

export function singleUnavailable(q: AskQuestion): AgentToolResult<AskSingleDetails> {
  return {
    content: [{ type: "text", text: UNAVAILABLE_TEXT }],
    details: { question: q.question, options: q.options, answer: null, cancelled: true },
  };
}

export function batchUnavailable(questions: AskQuestion[]): AgentToolResult<AskBatchDetails> {
  return {
    content: [{ type: "text", text: UNAVAILABLE_TEXT }],
    details: { kind: "batch", questions, answers: null, cancelled: true },
  };
}

export interface AskPopupOutput {
  cancelled: boolean;
  answers: (AskSelection | AskFreeform | null)[];
}

type AskPopupMode = "options" | "freeform";

export class AskTuiPopup {
  private readonly questions: AskQuestion[];
  private page = 0;
  private mode: AskPopupMode = "options";
  private focus = 0;
  private text = "";
  private toggled = new Set<string>();
  private answered: (AskSelection | AskFreeform | null)[];
  private warned = false;
  private finished = false;

  constructor(questions: AskQuestion[]) {
    this.questions = questions;
    this.answered = questions.map(() => null);
  }

  render(width: number): string[] {
    const title =
      this.page === this.questions.length
        ? "Review"
        : `Ask ${this.page + 1}/${this.questions.length}`;
    const footer: string[] = [];
    if (this.mode === "freeform") {
      footer.push(`${this.text}█  Esc back  Enter submit`);
    } else if (this.page === this.questions.length) {
      const unanswered = this.answered.filter((a) => a === null).length;
      if (unanswered > 0) {
        footer.push(`⚠ ${unanswered} question${unanswered > 1 ? "s" : ""} unanswered`);
      }
      footer.push(`Page ${this.page}/${this.questions.length}  Tab →  Enter submit`);
      footer.push("Esc cancel");
    } else {
      const q = this.questions[this.page];
      footer.push(
        q.multiSelect
          ? `↑↓ navigate  1-${q.options.length} toggle  Enter toggle/Done  Esc cancel`
          : `↑↓ navigate  1-${q.options.length} select  Esc cancel`,
      );
    }
    const inner = Math.max(1, width - 4);
    const lines: string[] = [boxTitle(title, width)];
    const body: string[] = [];
    if (this.page === this.questions.length) {
      body.push(...this.reviewRows());
    } else {
      const q = this.questions[this.page];
      body.push(q.question, "");
      body.push(...this.questionRows(q));
    }
    for (const line of body) lines.push(boxRow(line, inner));
    lines.push(boxRow("", inner));
    for (const line of footer) lines.push(boxRow(line, inner));
    lines.push("└" + "─".repeat(Math.max(0, width - 2)) + "┘");
    return lines;
  }

  handleInput(key: string): void {
    if (this.finished) return;
    if (this.mode === "freeform") return this.handleEditorInput(key);
    if (key === "escape") {
      this.finished = true;
      return;
    }
    if (this.page === this.questions.length) return this.handleReviewInput(key);
    this.handleQuestionInput(key);
  }

  get finishedFlag(): boolean {
    return this.finished;
  }

  get editorMode(): boolean {
    return this.mode === "freeform";
  }

  output(): AskPopupOutput {
    return {
      cancelled: false,
      answers: [...this.answered],
    };
  }

  private questionRows(q: AskQuestion): string[] {
    if (q.multiSelect) {
      const rows = q.options.map((option, i) =>
        rowLine(`${this.toggled.has(option) ? "[x]" : "[ ]"} ${i + 1}. ${option}`, this.focus === i),
      );
      rows.push(rowLine(`✓ ${DONE_OPTION}`, this.focus === q.options.length));
      return rows;
    }
    const rows = q.options.map((option, i) => rowLine(`${i + 1}. ${option}`, this.focus === i));
    if (q.allowFreeform !== false) {
      rows.push(rowLine(FREEFORM_OPTION, this.focus === q.options.length));
    }
    return rows;
  }

  private reviewRows(): string[] {
    return this.questions.map((q, i) => {
      const a = this.answered[i];
      const value = a
        ? a.kind === "freeform"
          ? a.text
          : a.selections.join(", ")
        : "(skipped)";
      return rowLine(`${i + 1}. ${q.question}  →  ${value}`, this.focus === i);
    });
  }

  private focusCount(): number {
    if (this.page === this.questions.length) return this.questions.length;
    const q = this.questions[this.page];
    if (q.multiSelect) return q.options.length + 1;
    return q.options.length + (q.allowFreeform === false ? 0 : 1);
  }

  private moveFocus(delta: number): void {
    const count = this.focusCount();
    this.focus = (this.focus + delta + count) % count;
  }

  private handleQuestionInput(key: string): void {
    const q = this.questions[this.page];
    const rows = this.questionRows(q);
    const freeformIndex = rows.length - 1;
    if (key === "up") return this.moveFocus(-1);
    if (key === "down") return this.moveFocus(1);
    if (key === "tab") {
      this.page = this.questions.length;
      this.focus = 0;
      this.mode = "options";
      this.warned = false;
      return;
    }
    if (/^[1-9]$/.test(key)) {
      const n = Number(key);
      if (n > rows.length) return;
      if (q.multiSelect) {
        if (n <= q.options.length) this.toggleOption(n - 1);
      } else if (n - 1 === freeformIndex) {
        this.openFreeform();
      } else {
        this.answerPage({ kind: "selection", selections: [q.options[n - 1]] });
      }
      return;
    }
    if (key === "enter") {
      if (this.focus >= rows.length) return;
      if (q.multiSelect) {
        if (this.focus === q.options.length) this.commitMulti();
        else this.toggleOption(this.focus);
        return;
      }
      if (this.focus === freeformIndex) {
        this.openFreeform();
      } else {
        this.answerPage({ kind: "selection", selections: [q.options[this.focus]] });
      }
      return;
    }
    if (q.allowFreeform === false) return;
    if (this.focus === freeformIndex) {
      this.openFreeform();
      return;
    }
    if (!q.multiSelect && key.length === 1) {
      this.openFreeform();
      this.text = key;
    }
  }

  private openFreeform(): void {
    this.mode = "freeform";
  }

  private toggleOption(index: number): void {
    const q = this.questions[this.page];
    const option = q.options[index];
    if (this.toggled.has(option)) this.toggled.delete(option);
    else this.toggled.add(option);
    if (this.toggled.size === q.options.length) this.commitMulti();
  }

  private commitMulti(): void {
    this.answerPage({ kind: "selection", selections: [...this.toggled] });
    this.toggled = new Set();
  }

  private answerPage(answer: AskSelection | AskFreeform): void {
    this.answered[this.page] = answer;
    if (this.questions.length === 1) {
      this.finished = true;
      return;
    }
    this.page += 1;
    this.focus = 0;
  }

  private handleEditorInput(key: string): void {
    if (key === "escape") {
      this.mode = "options";
      this.text = "";
      return;
    }
    if (key === "backspace") {
      this.text = this.text.slice(0, -1);
      return;
    }
    if (key === "enter") {
      if (this.text.length === 0) {
        this.mode = "options";
        return;
      }
      this.answerPage({ kind: "freeform", text: this.text });
      this.text = "";
      this.mode = "options";
      return;
    }
    if (key === "space") this.text += " ";
    else if (key.length === 1) this.text += key;
  }

  private handleReviewInput(key: string): void {
    if (key === "up") return this.moveFocus(-1);
    if (key === "down") return this.moveFocus(1);
    if (key === "tab" || key === "shift+tab") {
      this.page = 0;
      this.focus = 0;
      this.mode = "options";
      this.warned = false;
      return;
    }
    if (/^[1-9]$/.test(key) && Number(key) <= this.questions.length) {
      this.page = Number(key) - 1;
      this.focus = 0;
      this.mode = "options";
      this.warned = false;
      return;
    }
    if (key === "enter") {
      if (this.answered.some((a) => a === null)) {
        if (!this.warned) {
          this.warned = true;
          return;
        }
      }
      this.finished = true;
    }
  }
}

function rowLine(label: string, focused: boolean): string {
  return `${focused ? "▶" : " "} ${label}`;
}

function boxTitle(title: string, width: number): string {
  const label = `─ ${title} `;
  const fill = Math.max(0, width - label.length - 1);
  return `┌${label}${"─".repeat(fill)}┐`;
}

function boxRow(line: string, inner: number): string {
  const clipped = line.slice(0, inner);
  return `│ ${clipped.padEnd(inner, " ")} │`;
}

interface AskTuiComponent {
  render(width: number): string[];
  handleInput(data: string): void;
  invalidate(): void;
  dispose(): void;
  cancel(): void;
}

function makeTuiPopup(
  questions: AskQuestion[],
  onSettled: (output: AskPopupOutput) => void,
): AskTuiComponent {
  const popup = new AskTuiPopup(questions);
  let settled = false;
  const settle = (output: AskPopupOutput) => {
    if (settled) return;
    settled = true;
    onSettled(output);
  };
  return {
    render: (width: number) => popup.render(width),
    handleInput: (data: string) => {
      const key = parseKey(data);
      if (!key) return;
      if (key === "escape" && !popup.editorMode) {
        settle({ cancelled: true, answers: [] });
        return;
      }
      popup.handleInput(key);
      if (popup.finishedFlag) settle(popup.output());
    },
    invalidate: () => undefined,
    dispose: () => undefined,
    cancel: () => settle({ cancelled: true, answers: [] }),
  };
}

export function askTuiOutcome(
  questions: AskQuestion[],
  ctx: ExtensionToolContext,
): Promise<AskPopupOutput> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (output: AskPopupOutput) => {
      if (settled) return;
      settled = true;
      ctx.signal?.removeEventListener("abort", onAbort);
      resolve(output);
    };
    const onAbort = () => finish({ cancelled: true, answers: [] });
    if (ctx.signal) {
      if (ctx.signal.aborted) {
        finish({ cancelled: true, answers: [] });
        return;
      }
      ctx.signal.addEventListener("abort", onAbort, { once: true });
    }
    void ctx.ui.custom((_tui, _theme, _keybindings, customDone) => {
      const component = makeTuiPopup(questions, (output) => {
        customDone(output);
        finish(output);
      });
      if (ctx.signal) {
        ctx.signal.addEventListener("abort", () => component.cancel(), { once: true });
      }
      return component;
    });
  });
}

export default function askUserExtension(pi: ExtensionAPI) {
  const emit: EmitFn = (channel, data) => pi.events.emit(channel, data);
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
      if (params.questions) {
        if (_ctx.mode === "tui" && _ctx.hasUI) {
          const output = await askTuiOutcome(params.questions, _ctx);
          if (output.cancelled) {
            emit("ask:cancelled", { question: params.questions[params.questions.length - 1].question });
            return batchResult(params.questions, {
              answers: null,
              question: params.questions[params.questions.length - 1],
              answered: [],
            });
          }
          for (let i = 0; i < params.questions.length; i++) {
            const answer = output.answers[i];
            if (answer !== null) {
              emit("ask:answered", {
                question: params.questions[i].question,
                kind: answer.kind,
              });
            }
          }
          return batchResult(params.questions, {
            answers: output.answers.map((a) => a ?? ({ kind: "freeform", text: "(skipped)" })),
            question: params.questions[params.questions.length - 1],
            answered: output.answers.map((answer, i) =>
              answer === null ? null : { question: params.questions[i], answer },
            ).filter((a): a is { question: AskQuestion; answer: AskSelection | AskFreeform } => a !== null),
          });
        }
        if (!_ctx.hasUI || _ctx.mode === "json" || _ctx.mode === "print") {
          return batchUnavailable(params.questions);
        }
        const outcome = await askBatchViaRpc(params.questions, _ctx);
        for (const { question, answer } of outcome.answered) {
          emit("ask:answered", { question: question.question, kind: answer.kind });
        }
        if (outcome.answers === null) {
          emit("ask:cancelled", { question: outcome.question.question });
        }
        return batchResult(params.questions, outcome);
      }
      const q: AskQuestion = {
        question: params.question!,
        options: params.options!,
        multiSelect: params.multiSelect,
        allowFreeform: params.allowFreeform,
      };
      if (_ctx.mode === "tui" && _ctx.hasUI) {
        const output = await askTuiOutcome([q], _ctx);
        const answer = output.cancelled ? null : output.answers[0] ?? null;
        if (answer === null) {
          emit("ask:cancelled", { question: q.question });
        } else {
          emit("ask:answered", { question: q.question, kind: answer.kind });
        }
        return singleResult(q, answer);
      }
      if (!_ctx.hasUI || _ctx.mode === "json" || _ctx.mode === "print") {
        return singleUnavailable(q);
      }
      const answer = q.multiSelect
        ? await askMultiSelectViaRpc(q, _ctx)
        : await askSingleViaRpc(q, _ctx);
      if (answer === null) {
        emit("ask:cancelled", { question: q.question });
      } else {
        emit("ask:answered", { question: q.question, kind: answer.kind });
      }
      return singleResult(q, answer);
    },

    renderCall(args, theme) {
      return renderAskCall(args as AskUserParams, theme);
    },

    renderResult(result, _options, theme) {
      return renderAskResult(result, theme);
    },
  });
}
