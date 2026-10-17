/**
 * Shared helpers of the message serializers: text extraction from content
 * blocks, the OpenAI tool-result fillers, tool-call text, and model compat
 * flags.
 */
import { canonicalJson } from "../diff.ts";
import type { GuardModel } from "../guard.ts";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";

/** Tool-result texts the serializers send for a result with only images, or with nothing. */
const IMAGE_ONLY_RESULT_TEXT = "(see attached image)";
const EMPTY_RESULT_TEXT = "(no tool output)";

/** Text blocks joined by newlines; images carry no text. */
export function textOf(content: ReadonlyArray<TextContent | ImageContent>): string {
	return content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
}

/** Whether content holds an image. */
export function hasImages(content: ReadonlyArray<TextContent | ImageContent>): boolean {
	return content.some((block) => block.type === "image");
}

/**
 * OpenAI tool-result text. Without text, a result with images says so and an
 * empty one says it has no output; Responses sends images to an image model
 * as parts beside the text instead.
 */
export function openAiResultText(content: ReadonlyArray<TextContent | ImageContent>, imagesAsParts: boolean): string {
	const text = textOf(content);
	if (text.length > 0 || (imagesAsParts && hasImages(content))) return text;
	return hasImages(content) ? IMAGE_ONLY_RESULT_TEXT : EMPTY_RESULT_TEXT;
}

/** A tool call's text: the raw grammar input for a grammar tool, otherwise canonical JSON arguments. */
export function toolCallText(
	call: { readonly name: string; readonly arguments: unknown },
	grammar: ReadonlyMap<string, string>,
): string {
	const property = grammar.get(call.name);
	if (property !== undefined && typeof call.arguments === "object" && call.arguments !== null) {
		const input = (call.arguments as Record<string, unknown>)[property];
		if (typeof input === "string") return input;
	}
	return canonicalJson(call.arguments);
}

/** Whether a model's `compat` sets a boolean flag; unset flags are false for every compared API. */
export function compatFlag(model: GuardModel, name: string): boolean {
	return (model.compat as Readonly<Record<string, unknown>> | undefined)?.[name] === true;
}
