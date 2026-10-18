import type {
  Api,
  Context,
  Model,
  TextContent,
  Tool,
} from "@earendil-works/pi-ai";
import { GeminiRole } from "../types/enums.js";
import { PROVIDER_ID } from "../models/models.js";
import type {
  ContentBlock,
  GeminiContent,
  GeminiFunctionDeclaration,
  GeminiFunctionResponsePart,
  GeminiInlineDataPart,
  GeminiPart,
  GeminiTextPart,
} from "../types/types.js";
import { isRecord, sanitizeText } from "../utils/util.js";

let toolCallCounter = 0;

function sanitizeToolCallId(id: string, fallbackName?: string): string {
	const cleaned = id.replace(/[^a-zA-Z0-9_-]/g, "_");
	const capped = cleaned.slice(0, 64);
	return capped || `${fallbackName || "tool"}_${Date.now()}_${++toolCallCounter}`;
}

function toolCallIdNeeded(modelId: string, runtimeModel: string): boolean {
	return (
		modelId.startsWith("claude-") ||
		modelId.startsWith("gpt-oss-") ||
		runtimeModel.startsWith("claude-") ||
		runtimeModel.startsWith("gpt-oss-")
	);
}

function parseImageData(raw: string, explicitMime?: string): { data: string; mimeType: string } {
	const match = raw.match(/^data:([^;]+);base64,(.+)$/s);
	if (match) {
		return {
			mimeType: explicitMime || match[1] || "image/png",
			data: match[2].trim(),
		};
	}
	return {
		mimeType: explicitMime || "image/png",
		data: raw.trim(),
	};
}

function asTextParts(content: unknown): Array<GeminiTextPart | GeminiInlineDataPart> {
	if (typeof content === "string") return [{ text: sanitizeText(content) }];
	if (!Array.isArray(content)) return [];
	return content.flatMap((item): Array<GeminiTextPart | GeminiInlineDataPart> => {
		if (!isRecord(item)) return [];
		const block = item as ContentBlock;
		if (block.type === "text") return [{ text: sanitizeText(block.text) }];
		if (block.type === "image") {
			const rawData = block.data || block.source?.data;
			if (!rawData) return [];
			const explicitMime = block.mimeType || block.mediaType || block.source?.mediaType;
			const { data, mimeType } = parseImageData(rawData, explicitMime);
			return data ? [{ inlineData: { mimeType, data } }] : [];
		}
		return [];
	});
}

function appendTurn(contents: GeminiContent[], role: GeminiRole, parts: GeminiPart[]): void {
	if (!parts.length) return;
	const last = contents[contents.length - 1];
	if (last && last.role === role) {
		last.parts.push(...parts);
	} else {
		contents.push({ role, parts });
	}
}

/** Exported for unit tests. */
export function convertMessages(
	model: Model<Api>,
	context: Context,
	runtimeModel: string,
): GeminiContent[] {
	const contents: GeminiContent[] = [];
	for (const msg of context.messages) {
		if (msg.role === "user") {
			const parts = asTextParts(msg.content);
			appendTurn(contents, GeminiRole.User, parts);
		} else if (msg.role === "assistant") {
			const parts: GeminiPart[] = [];
			for (const block of msg.content) {
				if (block.type === "text" && String(block.text || "").trim()) {
					parts.push({ text: sanitizeText(block.text) });
				} else if (block.type === "thinking" && String(block.thinking || "").trim()) {
					if (msg.provider === PROVIDER_ID && msg.model === model.id) {
						parts.push({
							thought: true,
							text: sanitizeText(block.thinking),
							...(block.thinkingSignature ? { thoughtSignature: block.thinkingSignature } : {}),
						});
					} else {
						parts.push({ text: sanitizeText(block.thinking) });
					}
				} else if (block.type === "toolCall") {
					parts.push({
						functionCall: {
							name: block.name,
							args: block.arguments ?? {},
							...(toolCallIdNeeded(model.id, runtimeModel)
								? { id: sanitizeToolCallId(block.id || "", block.name) }
								: {}),
						},
						...(block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
					});
				}
			}
			appendTurn(contents, GeminiRole.Model, parts);
		} else if (msg.role === "toolResult") {
			const text = msg.content
				.filter((c): c is TextContent => c.type === "text")
				.map((c) => sanitizeText(c.text))
				.join("\n");
			const responseText = text || (msg.isError ? "Tool failed" : "");
			const part: GeminiFunctionResponsePart = {
				functionResponse: {
					name: msg.toolName,
					response: msg.isError ? { error: responseText } : { output: responseText },
					...(toolCallIdNeeded(model.id, runtimeModel)
						? { id: sanitizeToolCallId(msg.toolCallId || "", msg.toolName) }
						: {}),
				},
			};
			appendTurn(contents, GeminiRole.User, [part]);
		}
	}

	// Google Antigravity / Gemini requires the first turn to be from 'user'.
	// If the conversation starts with 'model' (e.g. initial assistant greeting),
	// prepend a minimal user message to prevent backend 400 rejection.
	if (contents.length > 0 && contents[0]?.role === GeminiRole.Model) {
		contents.unshift({
			role: GeminiRole.User,
			parts: [{ text: "Hello" }],
		});
	}

	return contents;
}

function dereferenceSchema(
	schema: unknown,
	rootDefs: Record<string, unknown> = {},
	visited = new Set<unknown>(),
): unknown {
	if (!schema || typeof schema !== "object") return schema;
	if (Array.isArray(schema)) {
		return schema.map((item) => dereferenceSchema(item, rootDefs, visited));
	}

	const s = schema as Record<string, unknown>;
	if (visited.has(s)) return s;
	visited.add(s);

	const defs: Record<string, unknown> = { ...rootDefs };
	if (isRecord(s.$defs)) Object.assign(defs, s.$defs);
	if (isRecord(s.definitions)) Object.assign(defs, s.definitions);

	if (typeof s.$ref === "string") {
		const ref = s.$ref;
		const match = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/);
		if (match && match[1] && defs[match[1]] !== undefined) {
			const resolved = dereferenceSchema(defs[match[1]], defs, visited);
			if (isRecord(resolved)) {
				const { $ref: _, ...rest } = s;
				const restCleaned = dereferenceSchema(rest, defs, visited);
				return isRecord(restCleaned) ? { ...resolved, ...restCleaned } : resolved;
			}
			return resolved;
		}
	}

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(s)) {
		out[key] = dereferenceSchema(value, defs, visited);
	}
	return out;
}

function ensureRootObjectSchema(schema: unknown): Record<string, unknown> {
	if (!isRecord(schema)) {
		return { type: "object", properties: {} };
	}
	if (!schema.type) {
		return { ...schema, type: "object", properties: schema.properties || {} };
	}
	return schema;
}

function stripMetaSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== "object" || Array.isArray(schema)) return schema;
	const omit = new Set([
		"$schema",
		"$id",
		"$anchor",
		"$dynamicAnchor",
		"$vocabulary",
		"$comment",
		"$defs",
		"definitions",
	]);
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (!omit.has(key)) out[key] = stripMetaSchema(value);
	}
	return out;
}

/**
 * Protobuf `Schema` fields accepted by Cloud Code Assist's Claude/GPT custom-tool
 * bridge (`parameters` field). Anything else — `nullable`, `anyOf`, `format`,
 * `$ref`, etc. — returns `Unknown name "..."` / Invalid JSON payload (400).
 * Allowlist rather than denylist so new JSON Schema keywords cannot 400 the request.
 * Pi still validates tool args after the model calls them.
 */
const CUSTOM_TOOL_SCHEMA_ALLOW = new Set([
	"type",
	"description",
	"properties",
	"required",
	"items",
	"enum",
]);

function normalizeCustomToolType(value: unknown): unknown {
	if (typeof value === "string") return value;
	if (!Array.isArray(value)) return undefined;
	// JSON Schema union types like ["string","null"] → first non-null scalar type.
	const entries = value as unknown[];
	const scalar = entries.find(
		(entry): entry is string => typeof entry === "string" && entry !== "null",
	);
	return scalar;
}

function normalizeCustomToolSchema(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return schema;
	if (Array.isArray(schema)) return schema.map(normalizeCustomToolSchema);

	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (!CUSTOM_TOOL_SCHEMA_ALLOW.has(key)) continue;
		if (key === "type") {
			const normalizedType = normalizeCustomToolType(value);
			if (normalizedType !== undefined) out.type = normalizedType;
			continue;
		}
		if (key === "properties" && value && typeof value === "object" && !Array.isArray(value)) {
			// Property names are user-defined, not Schema keywords — never allowlist-filter them.
			const props: Record<string, unknown> = {};
			for (const [propName, propSchema] of Object.entries(value as Record<string, unknown>)) {
				props[propName] = normalizeCustomToolSchema(propSchema);
			}
			out.properties = props;
			continue;
		}
		if (
			key === "enum" &&
			Array.isArray(value) &&
			!value.every((entry) => typeof entry === "string")
		) {
			continue;
		}
		out[key] = normalizeCustomToolSchema(value);
	}
	return out;
}

/**
 * Gemini accepts JSON Schema through parametersJsonSchema. Claude and GPT-OSS
 * use Cloud Code Assist's custom-tool bridge, which requires a compatible
 * Draft 2020-12 subset in the legacy parameters field.
 */
export function convertTools(
	tools: Tool[] | undefined,
	useLegacyParameters = false,
): { functionDeclarations: GeminiFunctionDeclaration[] }[] | undefined {
	if (!tools?.length) return undefined;
	return [
		{
			functionDeclarations: tools.map((tool) => {
				const dereferenced = dereferenceSchema(tool.parameters);
				const rootObject = ensureRootObjectSchema(dereferenced);
				const schema = stripMetaSchema(rootObject);
				return {
					name: tool.name,
					description: tool.description,
					...(useLegacyParameters
						? { parameters: normalizeCustomToolSchema(schema) }
						: { parametersJsonSchema: schema }),
				};
			}),
		},
	];
}

export { sanitizeToolCallId };
