/**
 * Parser of the OpenAI Completions API: tool declarations and message units
 * from `messages`, with function and grammar tools.
 */
import { type MessageUnit, UnitCollector } from "../messages.ts";
import { addDeclaration, argumentsText, blockText, isDeclaration, isItem, isItemList, optionalItems } from "./helpers.ts";
import { COMPLETIONS_ROLES } from "./constants.ts";
import { type Item, type PayloadDeclaration } from "./types.ts";

/**
 * System prompt in `messages`, `tool` results, declarations nested under
 * `function`, or `custom` for grammar tools.
 */
export function isCompletionsPayload(payload: unknown): payload is Item & { readonly messages: readonly Item[] } {
	return isCompletionsMessages(payload)
		&& payload.messages.every((message) => message.tools === undefined
			|| isItemList(message.tools) && message.tools.every(isCompletionsTool))
		&& optionalItems(payload.tools)?.every(isCompletionsTool) === true;
}

/** Completions' message representation, independent of declaration support. */
export function isCompletionsMessages(payload: unknown): payload is Item & { readonly messages: readonly Item[] } {
	return isItem(payload) && isItemList(payload.messages) && !("input" in payload) && !("system" in payload)
		&& payload.messages.every((message) => COMPLETIONS_ROLES.has(String(message.role)));
}

/** A function or grammar declaration with a nested name. */
function isCompletionsTool(tool: Item): boolean {
	const nested = tool.type === "custom" ? tool.custom : tool.function;
	return (tool.type === "function" || tool.type === "custom") && isItem(nested) && isDeclaration(nested);
}

/** Request-level declarations, then additions in system messages with a `tools` list. */
export function completionsDeclarations(payload: Item & { readonly messages: readonly Item[] }): PayloadDeclaration[] {
	const declared = new Map<string, PayloadDeclaration>();
	const declare = (tool: Item) => {
		const nested = (tool.type === "custom" ? tool.custom : tool.function) as Item;
		addDeclaration(declared, nested.name as string, nested.description);
	};
	for (const tool of optionalItems(payload.tools) ?? []) declare(tool);
	for (const message of payload.messages) {
		if (message.role === "system" && isItemList(message.tools)) message.tools.forEach(declare);
	}
	return [...declared.values()];
}

/**
 * Units of each message: `system` and `developer` text, user text without
 * images, assistant text and `tool_calls`, and `tool` results. Reasoning
 * fields and a system message's inline `tools` belong to other channels.
 */
export function completionsUnits(payload: Item & { readonly messages: readonly Item[] }): MessageUnit[] | undefined {
	const units = new UnitCollector();
	for (const message of payload.messages) {
		units.boundary();
		switch (message.role) {
			case "system":
			case "developer": {
				// A message with only inline tool additions has no content
				if (message.content === undefined && message.tools !== undefined) break;
				const text = completionsText(message.content);
				if (text === undefined) return undefined;
				units.text("system", text);
				break;
			}
			case "user":
			case "assistant": {
				const text = message.role === "assistant" && message.content === null ? "" : completionsText(message.content);
				if (text === undefined) return undefined;
				units.text(message.role, text);
				if (message.role === "assistant" && !addCompletionsToolCalls(units, message.tool_calls)) return undefined;
				break;
			}
			case "tool": {
				const text = completionsText(message.content);
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

/** Text of string content or of `text` parts; `image_url` parts carry no text. Undefined for other shapes. */
export function completionsText(content: unknown): string | undefined {
	return blockText(content, { text: "text", image_url: "skip" });
}

/** Add function and grammar tool calls; false for an unknown shape. */
export function addCompletionsToolCalls(units: UnitCollector, toolCalls: unknown): boolean {
	if (toolCalls === undefined || toolCalls === null) return true;
	if (!isItemList(toolCalls)) return false;
	for (const call of toolCalls) {
		const nested = call.type === "custom" ? call.custom : call.function;
		if (!isItem(nested) || typeof nested.name !== "string") return false;
		if (call.type === "custom" && typeof nested.input === "string") units.toolCall(nested.name, nested.input);
		else if (call.type === "function") units.toolCall(nested.name, argumentsText(nested.arguments));
		else return false;
	}
	return true;
}
