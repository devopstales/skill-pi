/**
 * Shared helpers of the payload parsers: the JSON-object checks, text
 * extraction from content parts, declaration recording, and the reason
 * builders of the unsupported results.
 */
import { canonicalJson } from "../diff.ts";
import { DEFERRED_PLACEHOLDER_NAME } from "./constants.ts";
import { type Item, type ParsedMessages, type ParsedTools, type PayloadCopy, type PayloadDeclaration } from "./types.ts";

/** Deepest nesting a payload copy follows; tool schemas are the deepest part of a payload. */
const MAX_COPY_DEPTH = 256;

/** Copy one value; throws on anything outside JSON-like data. */
function copyValue(value: unknown, depth: number): unknown {
	if (value === null || typeof value !== "object") {
		if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
			throw new Error(`The payload holds a ${typeof value} value.`);
		}
		return value;
	}
	if (depth >= MAX_COPY_DEPTH) throw new Error("The payload is nested too deeply.");
	if (Array.isArray(value)) return value.map((element) => copyValue(element, depth + 1));
	const prototype: unknown = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) throw new Error("The payload holds a non-JSON object.");
	return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, copyValue(nested, depth + 1)]));
}

/**
 * Copy a payload's arrays and plain objects and share its strings. Later
 * handlers can replace a string but cannot change it in place, so sharing is
 * safe; a full clone would cost the payload's whole size.
 */
export function copyPayload(payload: unknown): PayloadCopy {
	try {
		return { supported: true, payload: copyValue(payload, 0) };
	} catch {
		// A getter may throw with raw content in its error; never expose that message
		return { supported: false, reason: "The payload could not be copied as JSON data." };
	}
}

/** Whether a payload carries a one-token output limit, as a cache-warm refresh does. */
export function hasWarmOutputLimit(payload: unknown): boolean {
	if (!isItem(payload)) return false;
	// OpenAI Responses raises the limit to its minimum of 16 output tokens
	return payload.max_tokens === 1 || payload.max_completion_tokens === 1
		|| payload.max_output_tokens === 1 || payload.max_output_tokens === 16;
}

/** Record a declaration; a later one with the same name replaces it. */
export function addDeclaration(declared: Map<string, PayloadDeclaration>, name: string, description: unknown): void {
	if (name !== DEFERRED_PLACEHOLDER_NAME) declared.set(name, typeof description === "string" ? { name, description } : { name });
}

/** A declared name and an optional description; do not silently drop malformed descriptions. */
export function isDeclaration(item: Item): item is Item & { readonly name: string } {
	return typeof item.name === "string" && (item.description === undefined || typeof item.description === "string");
}

/**
 * How a content part type contributes text:
 *   text   its `text` field is part of the unit
 *   skip   it carries no text, such as image data
 */
export type BlockTypes = Readonly<Record<string, "text" | "skip">>;

/**
 * Text of string content or of a list of typed parts, joined by newlines.
 * Undefined for another shape or an unknown part type.
 */
export function blockText(content: unknown, types: BlockTypes): string | undefined {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return undefined;
	const texts: string[] = [];
	for (const block of content as unknown[]) {
		if (!isItem(block) || typeof block.type !== "string" || !Object.hasOwn(types, block.type)) return undefined;
		if (types[block.type] === "skip") continue;
		if (typeof block.text !== "string") return undefined;
		texts.push(block.text);
	}
	return texts.join("\n");
}

/** Tool-call arguments sent as a JSON string, in canonical form; text that is not JSON stays as sent. */
export function argumentsText(value: unknown): string {
	if (typeof value !== "string") return canonicalJson(value);
	try {
		return canonicalJson(JSON.parse(value));
	} catch {
		return value;
	}
}

/** A successful parse. */
export function parsed(declarations: readonly PayloadDeclaration[]): ParsedTools {
	return { status: "parsed", declarations };
}

/** A payload that does not match the selected API's representation. */
export function mismatch(api: string): ParsedTools {
	return { status: "unsupported", reason: mismatchReason(api) };
}

/** A payload that does not match the selected API's representation, for the message channel. */
export function messageMismatch(api: string): ParsedMessages {
	return { status: "unsupported", reason: mismatchReason(api) };
}

/** Reason of a payload that does not match its API's representation. */
export function mismatchReason(api: string): string {
	return `The payload does not match the ${api} request format.`;
}

/** Reason of an API without a parser. */
export function unsupportedApiReason(api: string): string {
	return `Payloads of the ${api} API are not compared.`;
}

/** Whether `value` is a plain JSON object. */
export function isItem(value: unknown): value is Item {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether `value` is an array of plain JSON objects. */
export function isItemList(value: unknown): value is readonly Item[] {
	return Array.isArray(value) && value.every(isItem);
}

/** The items of an optional list: empty when absent, undefined when not a list of objects. */
export function optionalItems(value: unknown): readonly Item[] | undefined {
	if (value === undefined) return [];
	return isItemList(value) ? value : undefined;
}
