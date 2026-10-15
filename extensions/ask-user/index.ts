import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, isKeyRepeat, matchesKey, type OverlayHandle, type TUI } from "@earendil-works/pi-tui";
import {
  COLLAPSE_KEY_OFF,
  formatKeySpecForDisplay,
  loadConfig,
  resolveCollapseKey,
  validateGuidanceFields,
} from "./config.js";
import {
  ASK_USER_BLOCKED_EVENT,
  ASK_USER_PROMPT_EVENT,
  ASK_ANSWERED_EVENT,
  ASK_CANCELLED_EVENT,
  type AskUserBlockedEventPayload,
  type AskUserPromptEventPayload,
} from "./events.js";
import { type OpenQuestionnaire, registerAnswerChannel } from "./answer-channel.js";
import { buildQuestionnaireResponse, buildToolResult } from "./envelope.js";
import { normalizeQuestionParams, prepareQuestionArguments } from "./normalize.js";
import {
  hasDialogUI,
  runRpcQuestionnaire,
  type DialogUI,
} from "./rpc-fallback.js";
import { QuestionParamsSchema, type QuestionData, type QuestionParams, type QuestionnaireResult } from "./types.js";
import { validateQuestionnaire } from "./validate.js";
import type { WrappingSelectItem } from "./view/components/wrapping-select.js";
import { displayLabel } from "./state/i18n-bridge.js";
import { sentinelsToAppend } from "./state/row-intent.js";

export const ASK_USER_TOOL_NAME = "ask_user";

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";

const ERROR_NO_CUSTOM_UI =
  "Error: this client cannot render the questionnaire (custom UI is unavailable, e.g. RPC/ACP hosts such as Zed or Paseo). The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, without using this tool.";

const ERROR_SESSION_LOAD_FAILED =
  "Error: the questionnaire UI failed to load — the host's installed dependencies were likely replaced or removed on disk while Pi was running. The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, and tell the user that restoring this tool requires restarting Pi.";

const ERROR_STALE_MODULE_CACHE =
  "Error: the questionnaire UI cannot load — the host's module cache went stale after an earlier failed load. This is unrecoverable within the current Pi process. The user never saw the questions — do NOT treat this as a decline. Ask the questions as plain chat text instead, and tell the user to restart Pi to restore this tool.";

export const BEL = "\x07";

export const DEFAULT_PROMPT_SNIPPET = "Ask the user up to 4 structured questions (2-4 options each) when requirements are ambiguous";
export const DEFAULT_PROMPT_GUIDELINES: string[] = [
  "Use ask_user whenever the user's request is underspecified and you cannot proceed without concrete decisions — you can ask up to 4 questions per invocation.",
  'Each question MUST have 2-4 options. Every option requires a concise label (1-5 words) and a description explaining what the choice means or its trade-offs. The user can additionally type a custom answer via the automatically appended "Type something." row on every question, or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.',
  'Set multiSelect: true when multiple answers are valid. Provide an options[].preview markdown string when an option benefits from richer side-by-side context (mockups, code snippets, diagrams, configs) — single-select only. If you recommend a specific option, make that the first option and append "(Recommended)" to its label.',
  "Do not stack multiple ask_user calls back-to-back — group all clarifying questions into one invocation.",
];

export const DEFAULT_TOOL_DESCRIPTION = `Ask the user one or more structured questions during execution. Use when you need to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take

Usage notes:
- Users can type a custom answer via the automatically appended "Type something." row on every question or press Esc to abandon the questionnaire. Do NOT author "Other" or "Type something." labels yourself — reserved labels are rejected at runtime.
- Use multiSelect: true when multiple answers are valid. The "Type something." row is available on every question, including when options carry a \`preview\`.
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. When any option has a preview, the UI switches to a side-by-side layout with a vertical option list on the left and preview on the right. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).`;

function emitAskUserPromptEvent(pi: ExtensionAPI, params: QuestionParams, toolCallId: string): void {
  const payload: AskUserPromptEventPayload = {
    toolCallId,
    questions: params.questions.map((q) => ({
      question: q.question,
      header: q.header,
      multiSelect: q.multiSelect ?? false,
      options: q.options.map((o) => ({
        label: o.label,
        description: o.description,
        hasPreview: typeof o.preview === "string" && o.preview.length > 0,
      })),
    })),
  };
  pi.events.emit(ASK_USER_PROMPT_EVENT, payload);
}

function emitAskUserBlockedEvent(pi: ExtensionAPI, active: boolean, toolCallId: string): void {
  const payload: AskUserBlockedEventPayload = { active, toolCallId };
  pi.events.emit(ASK_USER_BLOCKED_EVENT, payload);
}

function emitBackwardCompatEvents(pi: ExtensionAPI, params: QuestionParams, result: QuestionnaireResult): void {
  for (const a of result.answers) {
    pi.events.emit(ASK_ANSWERED_EVENT, { question: a.question, kind: a.kind });
  }
  if (result.cancelled && result.answers.length === 0) {
    pi.events.emit(ASK_CANCELLED_EVENT, { question: params.questions[params.questions.length - 1]?.question });
  }
}

function rejectWithoutUi() {
  return buildToolResult(ERROR_NO_UI, { answers: [], cancelled: true, error: "no_ui" });
}

function emitTerminalAttention(): void {
  try {
    if (process.stdout.isTTY) process.stdout.write(BEL);
  } catch {
    // Terminal attention is best effort.
  }
}

async function runRpcPath(pi: ExtensionAPI, ui: DialogUI, typed: QuestionParams, toolCallId: string) {
  emitAskUserBlockedEvent(pi, true, toolCallId);
  try {
    emitTerminalAttention();
    const result = await runRpcQuestionnaire(ui, typed);
    emitBackwardCompatEvents(pi, typed, result);
    return buildQuestionnaireResponse(result, typed);
  } finally {
    emitAskUserBlockedEvent(pi, false, toolCallId);
  }
}

type SessionModule = typeof import("./state/questionnaire-session.js");

type SessionLoad =
  | { ok: true; module: SessionModule }
  | { ok: false; error: "session_load_failed" | "stale_module_cache"; message: string };

export async function loadQuestionnaireSession(): Promise<SessionLoad> {
  let mod: SessionModule;
  try {
    mod = await import("./state/questionnaire-session.js");
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e);
    return { ok: false, error: "session_load_failed", message: `${ERROR_SESSION_LOAD_FAILED} (cause: ${cause})` };
  }
  if (typeof mod.QuestionnaireSession !== "function") {
    const keys = JSON.stringify(Object.keys(mod));
    return {
      ok: false,
      error: "stale_module_cache",
      message: `${ERROR_STALE_MODULE_CACHE} (resolved namespace keys: ${keys})`,
    };
  }
  return { ok: true, module: mod };
}

function registerCollapseKeyListener(
  ctx: ExtensionContext,
  collapseKey: string,
  sessionRef: { current: InstanceType<SessionModule["QuestionnaireSession"]> | null },
  overlayHandleRef: { current: OverlayHandle | undefined },
): (() => void) | undefined {
  if (collapseKey === COLLAPSE_KEY_OFF || typeof ctx.ui.onTerminalInput !== "function") return undefined;
  let hasAnnouncedHide = false;
  return ctx.ui.onTerminalInput((data) => {
    const handle = overlayHandleRef.current;
    if (!handle) return undefined;
    if (!handle.isHidden() && !handle.isFocused()) return undefined;
    if (!matchesKey(data, collapseKey as Parameters<typeof matchesKey>[1])) return undefined;
    if (isKeyRelease(data) || isKeyRepeat(data)) return { consume: true };
    sessionRef.current?.toggleCollapsedExternal();
    if (handle.isHidden() && !hasAnnouncedHide) {
      hasAnnouncedHide = true;
      ctx.ui.notify?.(`ask_user hidden — press ${formatKeySpecForDisplay(collapseKey)} to reopen`, "info");
    }
    return { consume: true };
  });
}

function buildItemsForQuestion(question: QuestionData): WrappingSelectItem[] {
  const items: WrappingSelectItem[] = question.options.map((o) => ({
    kind: "option",
    label: o.label,
    description: o.description,
  }));
  for (const kind of sentinelsToAppend(question)) {
    items.push({ kind, label: displayLabel(kind) });
  }
  return items;
}

async function runTuiPath(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  typed: QuestionParams,
  open: OpenQuestionnaire,
): Promise<{ content: { type: "text"; text: string }[]; details: QuestionnaireResult }> {
  const itemsByTab: WrappingSelectItem[][] = typed.questions.map((q) => buildItemsForQuestion(q));
  emitAskUserBlockedEvent(pi, true, open.toolCallId);
  try {
    const sessionLoad = await loadQuestionnaireSession();
    if (open.settled) return buildQuestionnaireResponse(open.settled, typed);
    if (!sessionLoad.ok) {
      return buildToolResult(sessionLoad.message, { answers: [], cancelled: true, error: sessionLoad.error });
    }
    const { QuestionnaireSession } = sessionLoad.module;
    const collapseKey = resolveCollapseKey(loadConfig());
    const sessionRef: { current: InstanceType<SessionModule["QuestionnaireSession"]> | null } = { current: null };
    const overlayHandleRef: { current: OverlayHandle | undefined } = { current: undefined };
    const removeOverlayInputListener = registerCollapseKeyListener(ctx, collapseKey, sessionRef, overlayHandleRef);
    const canReopenWhileHidden = removeOverlayInputListener !== undefined;
    try {
      const result = await ctx.ui.custom<QuestionnaireResult>(
        (tui: TUI, theme, keybindings, done) => {
          if (open.settled) {
            done(open.settled);
            return { render: () => [], invalidate: () => {}, handleInput: () => {} };
          }
          open.attach(done);
          const session = new QuestionnaireSession({
            tui,
            theme,
            params: typed,
            itemsByTab,
            done: (r: QuestionnaireResult) => open.settle(r),
            keybindings,
            editInput: async (value: string) => {
              try {
                const [{ SettingsManager }, { editWithExternalEditor }] = await Promise.all([
                  import("@earendil-works/pi-coding-agent"),
                  import("./state/external-editor.js"),
                ]);
                const editorCommand = SettingsManager.create(ctx.cwd, undefined, {
                  projectTrusted: ctx.isProjectTrusted(),
                }).getExternalEditorCommand();
                if (!editorCommand) throw new Error("No external editor command is configured");
                return await editWithExternalEditor(tui, editorCommand, value);
              } catch {
                return undefined;
              }
            },
            collapseKey,
            canReopenWhileHidden,
            rowBudget: (rows: number) => rows,
          });
          sessionRef.current = session;
          return session.component;
        },
        {
          overlay: false,
        },
      );
      if (result === undefined) {
        open.host = "rpc";
        if (hasDialogUI(ctx.ui)) {
          const rpcResult = await runRpcQuestionnaire(ctx.ui, typed);
          emitBackwardCompatEvents(pi, typed, rpcResult);
          return buildQuestionnaireResponse(rpcResult, typed);
        }
        return buildToolResult(ERROR_NO_CUSTOM_UI, { answers: [], cancelled: true, error: "no_custom_ui" });
      }
      emitBackwardCompatEvents(pi, typed, result);
      return buildQuestionnaireResponse(result, typed);
    } finally {
      removeOverlayInputListener?.();
    }
  } finally {
    emitAskUserBlockedEvent(pi, false, open.toolCallId);
  }
}

export default function askUserExtension(pi: ExtensionAPI) {
  const guidance = validateGuidanceFields(loadConfig().guidance);
  const answers = registerAnswerChannel(pi);
  pi.registerTool({
    name: ASK_USER_TOOL_NAME,
    label: "Ask User",
    description: guidance.description ?? DEFAULT_TOOL_DESCRIPTION,
    promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
    promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
    parameters: QuestionParamsSchema,
    prepareArguments: prepareQuestionArguments,

    async execute(toolCallId: string, params: unknown, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: ExtensionContext) {
      const typed = normalizeQuestionParams(params as QuestionParams);
      if (!ctx.hasUI) return rejectWithoutUi();

      const validation = validateQuestionnaire(typed);
      if (!validation.ok) {
        return buildToolResult(validation.message, {
          answers: [],
          cancelled: true,
          error: validation.error,
        });
      }

      const viaRpc = (ctx as { mode?: string }).mode === "rpc" && hasDialogUI(ctx.ui);
      const open = answers.open(toolCallId, typed.questions, viaRpc ? "rpc" : "tui");
      try {
        emitAskUserPromptEvent(pi, typed, toolCallId);
        if (viaRpc) return await runRpcPath(pi, ctx.ui, typed, toolCallId);
        return await runTuiPath(pi, ctx, typed, open);
      } finally {
        answers.close(open);
      }
    },
  });
}
