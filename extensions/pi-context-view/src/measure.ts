/**
 * Pure measurement logic: split a captured system prompt into semantic items
 * and estimate token sizes. No pi API access — unit-testable.
 *
 * Pi renders independently replaceable XML sections. Their wrappers locate
 * content; custom sections remain System Prompt parts rather than additions.
 * Unwrapped text between or after sections is an extension addition. In the
 * `tools` and `rules` sections, pi renders each distinct bullet exactly once,
 * in active-tool order, so tool lines are annotated with their tools. System
 * Prompt counts all of its text, extension lines included.
 *
 * The measurement concerns live in the sibling modules:
 * `measure-sections.ts` (XML section bodies + extension additions),
 * `measure-tools.ts` (tool items + rendered/dropped prompt lines),
 * `measure-attribution.ts` (bullet attribution inside pi's blocks),
 * `measure-items.ts` (item construction + token allocation), and
 * `measure-shared.ts` (shared shapes, token heuristics, and the item builders
 * those concerns reuse). This module keeps the orchestration, the constants,
 * and the public re-exports.
 */
import {
	type ExtensionProvenance,
	type InjectionItem,
	type InjectionKind,
	type InjectedReference,
	PI_SOURCE,
	INSTRUCTION_FILES_LABEL,
	type RequestChange,
	SKILLS_LABEL,
	SYSTEM_PROMPT_LABEL,
} from "./model.ts";
import { type PromptAdditionOptions } from "./prompt-additions.ts";
import {
	AVAILABLE_TOOLS_BLOCK,
	BASE_PROMPT_BLOCKS,
	DOCUMENTATION_BLOCK,
	findPromptSections,
	findSectionToolBlocks,
	GUIDELINES_BLOCK,
	type LocatedPromptBlock,
	type PromptSection,
} from "./prompt-blocks.ts";
import {
	type AnnotatedLines,
	appendAnnotatedLine,
	charTokens,
	countedText,
	createAggregateItem,
	createItem,
	isUncounted,
	allocateSectionTokens,
	changeField,
	withChange,
	type Span,
	textTokens,
} from "./measure-shared.ts";
import { type InjectionSection } from "./model.ts";
import {
	deletedSectionPart,
	measureGeneratedSection,
	measurePromptAdditions,
	measureSectionPart,
} from "./measure-sections.ts";
import { createToolItem, measureTools } from "./measure-tools.ts";

/** System Prompt part holding the unwrapped text extensions added around pi's sections. */
const EXTENSION_ADDITIONS_BLOCK = { id: "base-prompt:additions", label: "Extension Additions" };

/** Leading part of pi's prompt, before its first XML section; exported for `measure-sections.ts`. */
export const PREAMBLE_BLOCK = { id: "base-prompt:preamble", label: "Preamble" };

/** Id of the System Prompt item, which holds pi's whole prompt. */
export const SYSTEM_PROMPT_ITEM_ID = "base-prompt";

/** `ToolSlice.source` of a recorded tool no extension registers now: its owner is unknown. */
export const UNREGISTERED_TOOL_SOURCE = "unattributed";

/**
 * Known XML section names retain the existing semantic ids and labels.
 * Exported for `measure-sections.ts`, the only other module that resolves
 * section names to their part ids.
 */
export const SECTION_PARTS: Readonly<Record<string, { id: string; label: string }>> = {
	tools: AVAILABLE_TOOLS_BLOCK,
	rules: GUIDELINES_BLOCK,
	docs: DOCUMENTATION_BLOCK,
	addendum: { id: "base-prompt:appended", label: "Appended Prompt" },
	cwd: { id: "base-prompt:current-dir", label: "Current Dir" },
	project_context: { id: "base-prompt:context-files", label: INSTRUCTION_FILES_LABEL },
	skills: { id: "base-prompt:skills", label: SKILLS_LABEL },
};

/** Ids of the System Prompt parts pi renders itself; custom sections and Extension Additions are not among them. */
const PI_PROMPT_PART_IDS: ReadonlySet<string> = new Set([
	PREAMBLE_BLOCK.id,
	...Object.values(SECTION_PARTS).map((part) => part.id),
]);

/**
 * Whether a System Prompt part is one pi renders itself, so pi's default
 * prompt has it too. A custom section is an extension's own, and Extension
 * Additions hold only text extensions added.
 */
export function isPiPromptPart(id: string): boolean {
	return PI_PROMPT_PART_IDS.has(id);
}

/** Minimal slice of BuildSystemPromptOptions that measurement needs. */
export interface PromptOptionsSlice {
	/** Home directory used to abbreviate context-file paths; omitted disables it. */
	homeDir?: string;
	/** Replacement preamble; pi's native sections it leaves absent are marked dropped. */
	customPrompt?: string;
	/** Custom section bodies, including overrides of Pi's named sections. */
	sections?: Record<string, string>;
}

/** One active tool as it contributes to the initial context. */
export interface ToolSlice {
	name: string;
	/** Sent to the provider with every request. */
	description: string;
	/** JSON-serialized parameter schema; sent to the provider with every request. */
	parametersJson: string;
	/** One-line snippet rendered into the prompt's Available tools list. */
	snippet?: string;
	/** Guideline bullets rendered into the prompt's Guidelines section. */
	guidelines: string[];
	/** Provenance, e.g. "builtin", "npm:pi-web-providers", or `UNREGISTERED_TOOL_SOURCE`. */
	source: string;
	/** Entry path of the owning extension; tells path extensions (`cli`, `local`) apart. */
	sourcePath?: string;
	/** Request-only change of the declaration; a deleted tool keeps only its uncounted definition. */
	change?: RequestChange;
}

/** One section the request deleted, as the session recorded it. */
export interface DeletedSection {
	readonly name: string;
	/** Recorded section text, including its XML wrapper. */
	readonly text: string;
}

/** Request-only prompt changes and their replayed layout; a forced prompt ignores them. */
export interface PromptChanges {
	/** Added or changed sections by name; `preamble` also stands for changed plain content. */
	readonly sections?: ReadonlyMap<string, Exclude<RequestChange, "deleted" | "forced">>;
	/** Sections the request removed, in session order. */
	readonly deleted?: readonly DeletedSection[];
	/** Exact recorded layout, including sections without Pi's usual XML framing. */
	readonly replayed?: { readonly content: string; readonly sections: Readonly<Record<string, string | null>> };
}

/**
 * Split a captured system prompt into semantic items: pi base prompt,
 * appended prompt, context files, skills, and active tool definitions. The
 * unwrapped text extensions added around pi's sections is the System Prompt's
 * Extension Additions part. `changes` marks the parts a request-only change
 * touched.
 */
export function analyzeSystemPrompt(
	systemPrompt: string,
	options: PromptOptionsSlice,
	tools: ToolSlice[] = [],
	additions: PromptAdditionOptions = {},
	changes: PromptChanges = {},
): InjectionItem[] {
	const names = new Set<string>();
	const sections = (changes.replayed === undefined
		? findPromptSections(systemPrompt)
		: locateReplayedSections(changes.replayed)).filter((section) => {
		if (names.has(section.name)) return false;
		names.add(section.name);
		return true;
	});
	if (sections.length === 0 && changes.replayed === undefined) {
		return analyzeForcedPrompt(systemPrompt, tools, additions.sources ?? []);
	}
	return analyzePromptSections(systemPrompt, sections, options, tools, additions, changes);
}

/**
 * Locate sections from the replay's exact join order, not by searching their
 * text. Request patches may supply inline wrappers, unwrapped text, or empty
 * sections; identical text elsewhere in the prompt must not steal their marker.
 */
function locateReplayedSections(state: NonNullable<PromptChanges["replayed"]>): PromptSection[] {
	const located: PromptSection[] = [];
	let offset = state.content.length;
	for (const [name, text] of Object.entries(state.sections)) {
		if (text === null) continue;
		const start = offset + (offset > 0 && text.length > 0 ? 2 : 0);
		const end = start + text.length;
		offset = end;
		if (name === "preamble") continue;
		const open = `<${name}>`;
		const close = `</${name}>`;
		const wrapped = text.startsWith(open) && text.endsWith(close);
		let bodyStart = wrapped ? start + open.length : start;
		let bodyEnd = wrapped ? end - close.length : end;
		if (wrapped && text[open.length] === "\n") bodyStart++;
		if (wrapped && text[text.length - close.length - 1] === "\n") bodyEnd--;
		// PromptSection includes the character before its body for tool bullet attribution
		located.push({ name, start, end, body: { start: bodyStart - 1, end: Math.max(bodyStart, bodyEnd) } });
	}
	return located;
}

/**
 * Pi always renders a `cwd` section, so only a forced prompt has none. It is
 * one undivided System Prompt part: no text in it is evidence of a block, an
 * addition, or a tool line.
 */
function analyzeForcedPrompt(
	prompt: string,
	tools: ToolSlice[],
	roster: readonly ExtensionProvenance[],
): InjectionItem[] {
	const items: InjectionItem[] = [];
	measureTools(prompt, tools, items, [], [], roster);
	items.unshift(createSystemPromptItem([{ ...PREAMBLE_BLOCK, kind: "base-prompt", text: prompt }]));
	return items;
}

/** Record one pi-authored part, skipping a block pi rendered no text into. */
function appendPromptPart(
	parts: PromptPart[],
	block: Pick<PromptPart, "id" | "label" | "moved" | "change">,
	text: string,
): void {
	if (text.length === 0 && block.change === undefined) return;
	parts.push({ id: block.id, kind: "base-prompt", label: block.label, text, moved: block.moved,
		...changeField(block.change) });
}

/** Measure XML section bodies once, keeping arbitrary sections out of extension attribution. */
function analyzePromptSections(
	prompt: string,
	sections: readonly PromptSection[],
	options: PromptOptionsSlice,
	tools: ToolSlice[],
	additions: PromptAdditionOptions,
	changes: PromptChanges,
): InjectionItem[] {
	const items: InjectionItem[] = [];
	const parts: PromptPart[] = [];
	const blocks = findSectionToolBlocks(prompt, sections);
	const replaced = Boolean(options.customPrompt);
	const droppedIds = replaced ? BASE_PROMPT_BLOCKS
		.filter((block) => !sections.some((section) => SECTION_PARTS[section.name]?.id === block.id)
			&& !changes.deleted?.some((section) => SECTION_PARTS[section.name]?.id === block.id))
		.map((block) => block.id) : [];
	const lines = measureTools(prompt, tools, items, droppedIds, blocks, additions.sources ?? []);
	const preambleEnd = sections[0]?.start ?? prompt.length;
	appendPromptPart(parts, { ...PREAMBLE_BLOCK, change: changes.sections?.get("preamble") },
		prompt.slice(0, preambleEnd).trimEnd());
	for (const block of BASE_PROMPT_BLOCKS) {
		if (droppedIds.includes(block.id)) {
			const dropped = lines.dropped.get(block.id);
			parts.push({ ...block, kind: "base-prompt", text: dropped?.text ?? "", dropped: true,
				injectedReferences: dropped?.injectedReferences });
		}
	}
	for (const section of sections) {
		const body = prompt.slice(section.body.start + 1, section.body.end);
		const change = changes.sections?.get(section.name);
		if (measureGeneratedSection(section.name, body, options, items, change)) continue;
		parts.push({
			...measureSectionPart(prompt, section, lines.rendered,
				blocks.find((candidate) => candidate.start === section.body.start)?.moved),
			...changeField(change),
		});
	}
	for (const deleted of changes.deleted ?? []) {
		const part = deletedSectionPart(deleted);
		// A dropped part already stands for a block the request lacks
		if (!parts.some((existing) => existing.id === part.id)) parts.push(part);
	}
	// Only unwrapped gaps are additions. Sections after cwd still belong to the
	// prompt, even when an earlier handler never saw them or cwd was removed.
	const extensionAdditions = measurePromptAdditions(prompt, preambleEnd, { ...additions, excluded: sections });
	if (extensionAdditions !== undefined) {
		parts.push({ ...EXTENSION_ADDITIONS_BLOCK, kind: "prompt-addition", ...extensionAdditions });
	}
	items.unshift(createSystemPromptItem(parts));
	return items;
}

/** Decode the five XML entities Pi escapes when rendering skill metadata; exported for `measure-sections.ts`. */
export function decodeXml(text: string): string {
	const entities: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
	return text.replace(/&(amp|lt|gt|quot|apos);/g, (_match, name: string) => entities[name]);
}

/** Replace a leading home-directory prefix with `~` for compact path labels; exported for `measure-sections.ts`. */
export function abbreviateHome(path: string, homeDir: string | undefined): string {
	if (homeDir === undefined || homeDir.length === 0) return path;
	if (path === homeDir) return "~";
	if (path.startsWith(`${homeDir}/`)) return `~${path.slice(homeDir.length)}`;
	return path;
}

/** Extract one context file's final content without its project-instructions wrapper; exported for `measure-sections.ts`. */
export function findContextFileContent(systemPrompt: string, filePath: string): string | undefined {
	const open = `<project_instructions path="${filePath}">`;
	const close = "</project_instructions>";
	const wrapper = findDelimitedSpan(systemPrompt, open, close);
	if (wrapper === undefined) return undefined;
	let start = wrapper.start + open.length;
	let end = wrapper.end - close.length;
	if (systemPrompt.startsWith("\r\n", start)) start += 2;
	else if (systemPrompt[start] === "\n") start++;
	if (systemPrompt.slice(Math.max(start, end - 2), end) === "\r\n") end -= 2;
	else if (systemPrompt[end - 1] === "\n") end--;
	return systemPrompt.slice(start, end);
}

/** Locate a complete delimited transport wrapper. */
function findDelimitedSpan(text: string, open: string, close: string): Span | undefined {
	const start = text.indexOf(open);
	if (start === -1) return undefined;
	const closeStart = text.indexOf(close, start + open.length);
	return closeStart === -1 ? undefined : { start, end: closeStart + close.length };
}

/** One labeled part of the System Prompt item, before it receives its token share; exported for `measure-sections.ts`. */
export interface PromptPart {
	readonly id: string;
	readonly kind: InjectionKind;
	readonly label: string;
	readonly text: string;
	/**
	 * True for a block a `--system-prompt` replacement dropped: no pi text, no
	 * tokens. Its text holds only the extension lines pi would have rendered.
	 */
	readonly dropped?: boolean;
	/** True for a block an extension moved out of the region pi rendered it into. */
	readonly moved?: boolean;
	/** Request-only change; a deleted part keeps its session text but no tokens. */
	readonly change?: RequestChange;
	/** Extension lines inside `text`, annotated with their source in previews. */
	readonly injectedReferences?: readonly InjectedReference[];
}

/**
 * Build the System Prompt item from its labeled parts. Parts concatenate back to
 * the item text and take cumulative shares of its estimate, so children break the
 * item down without adding tokens. A prompt with one part stays undivided.
 */
function createSystemPromptItem(parts: readonly PromptPart[]): InjectionItem {
	const text = countedText(parts);
	const item = createItem(SYSTEM_PROMPT_ITEM_ID, "base-prompt", PI_SOURCE, SYSTEM_PROMPT_LABEL, text);
	if (parts.length === 0) return item;
	if (parts.length === 1 && parts[0].id === PREAMBLE_BLOCK.id && parts[0].change !== "deleted") {
		return withChange(item, parts[0].change);
	}
	const sections = allocateSectionTokens(parts.map((part) => ({
		label: part.label,
		text: part.text,
		dropped: part.dropped,
		moved: part.moved,
		...changeField(part.change),
		injectedReferences: part.injectedReferences,
	})));
	return {
		...item,
		sections,
		children: parts.map((part, index) => ({
			...createItem(part.id, part.kind, PI_SOURCE, part.label, part.text),
			chars: isUncounted(part) ? 0 : part.text.length,
			tokens: sections[index]?.tokens ?? 0,
			dropped: part.dropped,
			moved: part.moved,
			...changeField(part.change),
			injectedReferences: part.injectedReferences,
		})),
	};
}

export {
	type AnnotatedLines,
	appendAnnotatedLine,
	charTokens,
	textTokens,
	countedText,
	createAggregateItem,
	createItem,
	isUncounted,
	allocateSectionTokens,
	changeField,
	withChange,
	type Span,
	createToolItem,
	measureTools,
} from "./measure-items.ts";
export {
	measureSectionPart,
	deletedSectionPart,
	measureGeneratedSection,
	measurePromptAdditions,
} from "./measure-sections.ts";
export { type InjectedSpan } from "./measure-attribution.ts";
