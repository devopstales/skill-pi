/**
 * Pi's own adjustments to the message channel (see
 * doc/architecture/payload-guard.md). The captured request is rebuilt as the
 * monitor saw it, converted as Pi converts every request, and rendered as the
 * text units the selected API sends. Only adjustments that the model's
 * capabilities, its API, or the image-blocking setting decide are applied;
 * provider serializers are reproduced only as far as their text.
 */
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type {
	AssistantMessage, ImageContent, Message, SystemMessage, TextContent, Tool,
} from "@earendil-works/pi-ai";

import type { RequestMessage } from "../snapshot.ts";
import type { GuardModel } from "./guard.ts";
import type { MessageUnit } from "./messages.ts";
import { type BaselineMessage, type RequestCopy, type SystemText } from "./request.ts";
import { anthropicUnits } from "./serializers/anthropic.ts";
import {
	blockImages, closeToolCalls, completionsUnits, downgradeImages,
	replayAssistant, resolveSystemMessages,
} from "./serializers/completions.ts";
import { compatFlag } from "./serializers/helpers.ts";
import { responsesUnits } from "./serializers/responses.ts";

/** What conversion reads from a capture. */
export interface ConvertibleCapture
	extends Pick<RequestCopy, "system" | "systemTexts" | "declarations" | "conversation"> {
	readonly baseline: { readonly messages: readonly BaselineMessage[] };
	readonly forcedPrompt?: string;
}

/** Grammar input property per tool name, for tools Pi may send as OpenAI grammar tools. */
export interface GrammarInputs {
	/** Tools declared anywhere in the request, for models that keep later system messages. */
	readonly declared: ReadonlyMap<string, string>;
	/** Tools of the replayed system state, for models that collapse system messages. */
	readonly current: ReadonlyMap<string, string>;
}

/**
 * The captured request after Pi's model-independent conversion. Image data
 * and signature bytes are not kept; whether a signature is empty is.
 */
export interface ConvertedRequest {
	readonly messages: readonly Message[];
	readonly grammarInputs: GrammarInputs;
}

/**
 * Rebuild the request the monitor captured and apply the conversion every
 * model gets: the forced prompt projection, `convertToLlm()`, and image
 * blocking. Session baseline messages fill the ends the capture did not copy.
 */
export function convertCapturedRequest(
	capture: ConvertibleCapture,
	options: { readonly blockImages: boolean },
): ConvertedRequest {
	const converted = convertToLlm(rebuildRequest(capture));
	return {
		messages: (options.blockImages ? converted.map(blockImages) : converted).map(stripMessage),
		grammarInputs: collectGrammarInputs(capture),
	};
}

/**
 * Render the text units the model's API sends for a converted request: system
 * messages collapse unless the model keeps them, images become placeholders
 * without image input, cross-model replay and tool-call accounting follow
 * Pi's transform, and each serializer's text rules apply.
 */
export function renderExpectedUnits(request: ConvertedRequest, model: GuardModel): MessageUnit[] {
	const keepsSystem = compatFlag(model, "supportsMidConvoSystemMessages");
	const messages = closeToolCalls(downgradeImages(resolveSystemMessages(request.messages, keepsSystem), model)
		.map((message) => message.role === "assistant" ? replayAssistant(message, model) : message));
	const grammar = compatFlag(model, "supportsOpenAIGrammarTools")
		? keepsSystem ? request.grammarInputs.declared : request.grammarInputs.current
		: new Map<string, string>();
	switch (model.api) {
		case "openai-completions":
			return completionsUnits(messages, model, grammar);
		case "openai-responses":
			return responsesUnits(messages, model, grammar);
		case "anthropic-messages":
			return anthropicUnits(messages, model);
		default:
			throw new Error(`No message rules for the ${model.api} API.`);
	}
}

// ============================================================================
// Model-independent conversion
// ============================================================================

/**
 * The request at the monitor's handler: baseline ends around the copied
 * middle, with system messages at their positions, or the forced prompt as
 * the only system message, as Pi projects it after every context handler.
 */
function rebuildRequest(capture: ConvertibleCapture): RequestMessage[] {
	const baseline = capture.baseline.messages.map(({ message }) => message)
		.filter((message) => message.role !== "system");
	const { prefix, baseline: replaced, request } = capture.conversation;
	const conversation = [...baseline.slice(0, prefix), ...request, ...baseline.slice(prefix + replaced.length)];
	if (capture.forcedPrompt !== undefined) {
		return [{ role: "system", content: capture.forcedPrompt, timestamp: 0 }, ...conversation];
	}
	const messages: RequestMessage[] = [];
	let next = 0;
	for (let position = 0; position <= conversation.length; position++) {
		while (next < capture.systemTexts.length && capture.systemTexts[next].position === position) {
			messages.push(toSystemMessage(capture.systemTexts[next++]));
		}
		if (position < conversation.length) messages.push(conversation[position]);
	}
	return messages;
}

/** A system message with the captured text and no tool changes. */
function toSystemMessage(text: SystemText): SystemMessage {
	return text.sections === undefined
		? { role: "system", content: text.content, timestamp: 0 }
		: { role: "system", content: text.content, sections: { ...text.sections }, timestamp: 0 };
}

/**
 * Keep only what text rendering reads. Image data and signature bytes are
 * released; a signature keeps only whether it is absent, empty, blank, or set.
 * Missing content becomes empty, as in Pi's transform.
 */
function stripMessage(message: Message): Message {
	switch (message.role) {
		case "user":
			if (typeof message.content === "string") return message;
			return { ...message, content: (message.content ?? []).map(stripImage) };
		case "toolResult":
			return { ...message, content: (message.content ?? []).map(stripImage) };
		case "assistant":
			return { ...message, content: (message.content ?? []).map(stripAssistantBlock) };
		default:
			return message;
	}
}

/** An image block without its data. */
function stripImage(block: TextContent | ImageContent): TextContent | ImageContent {
	return block.type === "image" ? { type: "image", data: "", mimeType: block.mimeType } : block;
}

/** An assistant block without signature bytes; tool-call arguments stay shared. */
function stripAssistantBlock(block: AssistantMessage["content"][number]): AssistantMessage["content"][number] {
	switch (block.type) {
		case "text":
			return { type: "text", text: block.text };
		case "thinking": {
			const signature = reduceSignature(block.thinkingSignature);
			return {
				type: "thinking",
				thinking: block.thinking,
				...(signature === undefined ? {} : { thinkingSignature: signature }),
				...(block.redacted === undefined ? {} : { redacted: block.redacted }),
			};
		}
		case "toolCall":
			return { type: "toolCall", id: block.id, name: block.name, arguments: block.arguments };
		default:
			return block;
	}
}

/**
 * A stand-in for a signature that the checks of Pi's transform and the
 * Anthropic serializer treat alike: absent, empty, blank, or set.
 */
function reduceSignature(signature: string | undefined): string | undefined {
	if (typeof signature !== "string") return undefined;
	if (signature.length === 0) return "";
	return signature.trim().length === 0 ? " " : "*";
}

/** Grammar inputs of every tool the request declares, and of its current tools. */
function collectGrammarInputs(capture: ConvertibleCapture): GrammarInputs {
	const current = grammarInputsOf(capture.system?.toolsAdded ?? []);
	// The forced prompt projection leaves one system message holding the current tools
	if (capture.forcedPrompt !== undefined) return { declared: current, current };
	return { declared: grammarInputsOf(capture.declarations), current };
}

/** Grammar input property per tool that declares a usable OpenAI grammar. */
function grammarInputsOf(tools: readonly Tool[]): Map<string, string> {
	const inputs = new Map<string, string>();
	for (const tool of tools) {
		const property = grammarInputProperty(tool);
		if (property !== undefined) inputs.set(tool.name, property);
	}
	return inputs;
}

/** The parameter schema fields Pi reads to find a grammar tool's input property. */
interface GrammarSchema {
	readonly type?: unknown;
	readonly required?: unknown;
	readonly properties?: Readonly<Record<string, { readonly type?: unknown } | undefined>>;
}

/**
 * The single required string property a grammar tool call carries as raw
 * input, as Pi infers it; undefined for other tools. Pi rejects a grammar
 * tool without one before sending, so no payload exists to compare.
 */
function grammarInputProperty(tool: Tool): string | undefined {
	const config = tool.constrainedSampling;
	if (config === undefined || config === false || config.type !== "grammar") return undefined;
	const hasVariant = [config.variants.openai_lark, config.variants.openai_regex]
		.some((variant) => typeof variant === "string" && variant.trim().length > 0);
	const schema = tool.parameters as GrammarSchema;
	if (!hasVariant || schema.type !== "object" || !Array.isArray(schema.required) || schema.required.length !== 1) {
		return undefined;
	}
	const property: unknown = schema.required[0];
	return typeof property === "string" && schema.properties?.[property]?.type === "string" ? property : undefined;
}
