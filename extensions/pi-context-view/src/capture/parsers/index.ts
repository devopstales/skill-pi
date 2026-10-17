/**
 * PayloadParser: copies a provider payload in `before_provider_request` and
 * extracts its tool-declaration and message channels. The API of the
 * request or dispatched model selects the parser, never the payload's shape:
 * the shape is only checked against that API, and a payload that does not
 * match it is not compared. Pure functions over process-local data.
 *
 * The per-API parsers live in their own modules:
 *   openai-completions.ts  OpenAI Completions
 *   openai-responses.ts    OpenAI Responses
 *   anthropic.ts           Anthropic Messages
 * Shared building blocks: helpers.ts, types.ts, constants.ts.
 */
import type { MessageUnit } from "../messages.ts";
import { anthropicDeclarations, anthropicUnits, isAnthropicMessages, isAnthropicPayload } from "./anthropic.ts";
import { SUPPORTED_APIS } from "./constants.ts";
import { messageMismatch, mismatch, parsed, unsupportedApiReason } from "./helpers.ts";
import { completionsDeclarations, completionsUnits, isCompletionsMessages, isCompletionsPayload } from "./openai-completions.ts";
import { isResponsesInput, isResponsesPayload, responsesDeclarations, responsesUnits } from "./openai-responses.ts";
import type { ParsedMessages, ParsedTools } from "./types.ts";

export {
	CLAUDE_CODE_IDENTITY, COMPLETIONS_ROLES, ANTHROPIC_ROLES, DEFERRED_PLACEHOLDER_NAME, SUPPORTED_APIS,
} from "./constants.ts";
export {
	addAnthropicBlock, anthropicDeclarations, anthropicUnits, isAnthropicMessages, isAnthropicPayload,
	applyAnthropicToolChange,
} from "./anthropic.ts";
export {
	addCompletionsToolCalls, completionsDeclarations, completionsUnits, completionsText, isCompletionsMessages,
	isCompletionsPayload,
} from "./openai-completions.ts";
export {
	isResponsesPayload, isResponsesInput, isResponsesTool, responsesDeclarations, responsesUnits, responsesPart,
} from "./openai-responses.ts";
export {
	addDeclaration, argumentsText, blockText, copyPayload, hasWarmOutputLimit, isDeclaration, isItem, isItemList,
	messageMismatch, mismatch, mismatchReason, optionalItems, parsed, unsupportedApiReason,
} from "./helpers.ts";
export { type BlockTypes } from "./helpers.ts";
export { type Item, type ParsedMessages, type ParsedTools, type PayloadCopy, type PayloadDeclaration } from "./types.ts";

/**
 * Parse the tool-declaration channel with the parser of `api`. Inline tool
 * changes are replayed on the request-level list in order: a later definition
 * with the same name replaces an earlier one.
 */
export function parsePayloadTools(api: string, payload: unknown): ParsedTools {
	switch (api) {
		case "openai-completions":
			return isCompletionsPayload(payload) ? parsed(completionsDeclarations(payload)) : mismatch(api);
		case "openai-responses":
			return isResponsesPayload(payload) ? parsed(responsesDeclarations(payload)) : mismatch(api);
		case "anthropic-messages": {
			if (!isAnthropicPayload(payload)) return mismatch(api);
			const declarations = anthropicDeclarations(payload);
			return declarations === undefined ? mismatch(api) : parsed(declarations);
		}
		default:
			return { status: "unsupported", reason: unsupportedApiReason(api) };
	}
}

/**
 * Parse the message channel with the parser of `api`: one unit per run of
 * system, user, or assistant text in a message, and one per tool call and
 * tool result. Image data, reasoning, and inline tool changes are left out.
 */
export function parsePayloadMessages(api: string, payload: unknown): ParsedMessages {
	let units: MessageUnit[] | undefined;
	switch (api) {
		case "openai-completions":
			if (!isCompletionsMessages(payload)) return messageMismatch(api);
			units = completionsUnits(payload);
			break;
		case "openai-responses":
			if (!isResponsesInput(payload)) return messageMismatch(api);
			units = responsesUnits(payload);
			break;
		case "anthropic-messages":
			if (!isAnthropicMessages(payload)) return messageMismatch(api);
			units = anthropicUnits(payload);
			break;
		default:
			return { status: "unsupported", reason: unsupportedApiReason(api) };
	}
	return units === undefined
		? { status: "unsupported", reason: `A payload message has a shape the ${api} parser does not know.` }
		: { status: "parsed", units };
}

/**
 * Representation checks. They only reject a payload that cannot be the
 * selected API's: a payload without a system prompt, tools, or tool history can
 * pass more than one.
 */
export const PAYLOAD_SHAPE_CHECKS: Readonly<Record<(typeof SUPPORTED_APIS)[number], (payload: unknown) => boolean>> = {
	"openai-completions": isCompletionsPayload,
	"openai-responses": isResponsesPayload,
	"anthropic-messages": isAnthropicPayload,
};
