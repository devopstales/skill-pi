/**
 * Parser of the Anthropic Messages API: tool declarations and message units
 * from `messages` and a top-level `system` prompt, with the deferred tool
 * placeholder and the Claude Code identity block.
 */
import { canonicalJson } from "../diff.ts";
import { type MessageUnit, UnitCollector } from "../messages.ts";
import { addDeclaration, blockText, isDeclaration, isItem, isItemList, optionalItems } from "./helpers.ts";
import { ANTHROPIC_ROLES, CLAUDE_CODE_IDENTITY, DEFERRED_PLACEHOLDER_NAME } from "./constants.ts";
import { type Item, type PayloadDeclaration } from "./types.ts";

/**
 * Top-level `system`, declarations with a name and no `function`. With
 * `supportsMidConvoSystemMessages`, `messages` also holds system messages.
 */
export function isAnthropicPayload(payload: unknown): payload is Item & { readonly messages: readonly Item[] } {
	return isAnthropicMessages(payload)
		&& optionalItems(payload.tools)?.every((tool) => isDeclaration(tool) && !("function" in tool)) === true;
}

/** Anthropic's message representation, independent of declaration support. */
export function isAnthropicMessages(payload: unknown): payload is Item & { readonly messages: readonly Item[] } {
	return isItem(payload) && isItemList(payload.messages) && !("input" in payload)
		&& (payload.system === undefined || typeof payload.system === "string" || isItemList(payload.system))
		&& payload.messages.every((message) => ANTHROPIC_ROLES.has(String(message.role)));
}

/**
 * Request-level declarations without the deferred placeholder, then the
 * `tool_removal` and `tool_addition` blocks of system messages in order.
 * Undefined when an inline block is malformed.
 */
export function anthropicDeclarations(payload: Item & { readonly messages: readonly Item[] }): PayloadDeclaration[] | undefined {
	const declared = new Map<string, PayloadDeclaration>();
	for (const tool of optionalItems(payload.tools) ?? []) {
		if (tool.name !== DEFERRED_PLACEHOLDER_NAME) addDeclaration(declared, tool.name as string, tool.description);
	}
	for (const message of payload.messages) {
		if (message.role !== "system" || !Array.isArray(message.content)) continue;
		for (const block of message.content as unknown[]) {
			if (!applyAnthropicToolChange(declared, block)) return undefined;
		}
	}
	return [...declared.values()];
}

/**
 * Units of the top-level `system` prompt and each message. The Claude Code
 * identity block that Pi adds for an OAuth token is left out, and so are
 * thinking, inline tool changes, and image data.
 */
export function anthropicUnits(payload: Item & { readonly messages: readonly Item[] }): MessageUnit[] | undefined {
	const units = new UnitCollector();
	const system = Array.isArray(payload.system) && isItem(payload.system[0])
		&& payload.system[0].type === "text" && payload.system[0].text === CLAUDE_CODE_IDENTITY
		? payload.system.slice(1)
		: payload.system;
	if (system !== undefined) {
		const text = blockText(system, { text: "text" });
		if (text === undefined) return undefined;
		units.text("system", text);
	}
	for (const message of payload.messages) {
		units.boundary();
		const part = message.role as "system" | "user" | "assistant";
		if (typeof message.content === "string") {
			units.text(part, message.content);
			continue;
		}
		if (!Array.isArray(message.content)) return undefined;
		for (const block of message.content as unknown[]) {
			if (!isItem(block) || !addAnthropicBlock(units, part, block)) return undefined;
		}
	}
	return units.result();
}

/** Blocks with no message text: reasoning, and the inline tool changes of the tool channel. */
const ANTHROPIC_SKIPPED_BLOCKS: Readonly<Record<"system" | "user" | "assistant", ReadonlySet<string>>> = {
	system: new Set(["tool_addition", "tool_removal"]),
	user: new Set(["image"]),
	assistant: new Set(["thinking", "redacted_thinking"]),
};

/** Add one content block of a message with role `part`; false for an unknown or malformed block. */
export function addAnthropicBlock(units: UnitCollector, part: "system" | "user" | "assistant", block: Item): boolean {
	if (typeof block.type === "string" && ANTHROPIC_SKIPPED_BLOCKS[part].has(block.type)) return true;
	if (block.type === "text" && typeof block.text === "string") {
		units.text(part, block.text);
		return true;
	}
	if (part === "assistant" && block.type === "tool_use" && typeof block.name === "string") {
		units.toolCall(block.name, canonicalJson(block.input ?? {}));
		return true;
	}
	if (part === "user" && block.type === "tool_result") {
		const text = block.content === undefined ? "" : blockText(block.content, { text: "text", image: "skip" });
		if (text === undefined) return false;
		units.toolResult(text);
		return true;
	}
	return false;
}

/**
 * Apply one system-message block; other block types change no declaration.
 * False when a tool change block is malformed.
 */
export function applyAnthropicToolChange(declared: Map<string, PayloadDeclaration>, block: unknown): boolean {
	if (!isItem(block)) return true;
	if (block.type === "tool_removal") {
		const reference = block.tool;
		if (!isItem(reference) || reference.type !== "tool_reference" || typeof reference.name !== "string") return false;
		declared.delete(reference.name);
		return true;
	}
	if (block.type !== "tool_addition") return true;
	const definition = isItem(block.tool) && block.tool.type === "tool_definition" ? block.tool.definition : undefined;
	if (!isItem(definition) || !isDeclaration(definition)) return false;
	addDeclaration(declared, definition.name, definition.description);
	return true;
}
