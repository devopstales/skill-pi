/**
 * Parser of the OpenAI Responses API: tool declarations and message units
 * from `input` items, with function and grammar tools.
 */
import { type MessageUnit, UnitCollector } from "../messages.ts";
import { addDeclaration, argumentsText, blockText, isDeclaration, isItem, isItemList, optionalItems, type BlockTypes } from "./helpers.ts";
import { type Item, type PayloadDeclaration } from "./types.ts";

/** `input` items instead of messages, flat declarations. */
export function isResponsesPayload(payload: unknown): payload is Item & { readonly input: readonly Item[] } {
	return isResponsesInput(payload) && optionalItems(payload.tools)?.every(isResponsesTool) === true
		&& payload.input.every((item) => !isInlineResponsesTools(item) || isItemList(item.tools)
			&& item.tools.every(isResponsesTool));
}

/** Responses' input representation, independent of declaration support. */
export function isResponsesInput(payload: unknown): payload is Item & { readonly input: readonly Item[] } {
	return isItem(payload) && isItemList(payload.input) && !("messages" in payload)
		&& payload.input.every((item) => typeof item.role === "string" || typeof item.type === "string");
}

/** Function and grammar declarations; unknown provider-native tools make the channel incomplete. */
export function isResponsesTool(tool: Item): boolean {
	return (tool.type === "function" || tool.type === "custom") && isDeclaration(tool);
}

/** An item that declares later tools in place: `additional_tools` or a tool search output. */
function isInlineResponsesTools(item: Item): boolean {
	return item.type === "additional_tools" || item.type === "tool_search_output";
}

/** Request-level declarations, then inline additions in item order. */
export function responsesDeclarations(payload: Item & { readonly input: readonly Item[] }): PayloadDeclaration[] {
	const declared = new Map<string, PayloadDeclaration>();
	const declare = (tool: Item) => addDeclaration(declared, tool.name as string, tool.description);
	for (const tool of optionalItems(payload.tools) ?? []) declare(tool);
	for (const item of payload.input) {
		if (isInlineResponsesTools(item) && isItemList(item.tools)) item.tools.forEach(declare);
	}
	return [...declared.values()];
}

/** Items with no message text: reasoning replay and the inline tool changes of the tool channel. */
const RESPONSES_SKIPPED_ITEMS = new Set(["reasoning", "additional_tools", "tool_search_call", "tool_search_output"]);

/**
 * Units of each input item: role messages, function and grammar tool calls,
 * and their outputs. Reasoning items and inline tool changes are skipped.
 */
export function responsesUnits(payload: Item & { readonly input: readonly Item[] }): MessageUnit[] | undefined {
	const units = new UnitCollector();
	for (const item of payload.input) {
		units.boundary();
		if (typeof item.type === "string" && RESPONSES_SKIPPED_ITEMS.has(item.type)) continue;
		switch (item.type) {
			case undefined:
			case "message": {
				const part = responsesPart(item.role);
				const text = part === undefined ? undefined : blockText(item.content, RESPONSES_CONTENT[part]);
				if (part === undefined || text === undefined) return undefined;
				units.text(part, text);
				break;
			}
			case "function_call":
				if (typeof item.name !== "string") return undefined;
				units.toolCall(item.name, argumentsText(item.arguments));
				break;
			case "custom_tool_call":
				if (typeof item.name !== "string" || typeof item.input !== "string") return undefined;
				units.toolCall(item.name, item.input);
				break;
			case "function_call_output":
			case "custom_tool_call_output": {
				const text = blockText(item.output, { input_text: "text", input_image: "skip" });
				if (text === undefined) return undefined;
				units.toolResult(text);
				break;
			}
			default:
				return undefined;
		}
	}
	return units.result();
}

/** Content part types of each Responses message role. */
const RESPONSES_CONTENT: Readonly<Record<"system" | "user" | "assistant", BlockTypes>> = {
	system: { input_text: "text" },
	user: { input_text: "text", input_image: "skip" },
	assistant: { output_text: "text" },
};

/** The message part of a Responses role; undefined for unknown roles. */
export function responsesPart(role: unknown): "system" | "user" | "assistant" | undefined {
	if (role === "system" || role === "developer") return "system";
	return role === "user" || role === "assistant" ? role : undefined;
}
