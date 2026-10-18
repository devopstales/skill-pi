/**
 * PayloadParser entry point: re-exports the parsers of
 * `src/capture/parsers/`, split by API (OpenAI Completions, OpenAI Responses,
 * Anthropic Messages) with shared helpers. `payload.ts` stays a re-export of
 * this facade for the existing import sites.
 */
export {
	CLAUDE_CODE_IDENTITY, COMPLETIONS_ROLES, ANTHROPIC_ROLES, DEFERRED_PLACEHOLDER_NAME, SUPPORTED_APIS,
	addAnthropicBlock, applyAnthropicToolChange, anthropicDeclarations, anthropicUnits, isAnthropicMessages,
	isAnthropicPayload, addCompletionsToolCalls, completionsDeclarations, completionsUnits, completionsText,
	isCompletionsMessages, isCompletionsPayload, isResponsesInput, isResponsesPayload, isResponsesTool,
	responsesDeclarations, responsesPart, responsesUnits, addDeclaration, argumentsText, blockText, copyPayload,
	hasWarmOutputLimit, isDeclaration, isItem, isItemList, messageMismatch, mismatch, mismatchReason,
	optionalItems, parsed, parsePayloadMessages, parsePayloadTools, PAYLOAD_SHAPE_CHECKS, unsupportedApiReason,
} from "./parsers/index.ts";
export { type BlockTypes } from "./parsers/helpers.ts";
export { type Item, type ParsedMessages, type ParsedTools, type PayloadCopy, type PayloadDeclaration } from "./parsers/types.ts";
