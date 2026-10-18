/**
 * Tool measurement: turn each active tool into its InjectionItem (its
 * definition plus any prompt lines a replacement dropped) and locate the
 * snippet/guideline lines pi actually rendered for it.
 */
import {
	AGGREGATE_SOURCE,
	BUILT_IN_TOOLS_LABEL,
	extensionSource,
	type ExtensionProvenance,
	type InjectionItem,
	type InjectionSource,
	PI_SOURCE,
	type RequestChange,
} from "./model.ts";
import {
	AVAILABLE_TOOLS_BLOCK,
	GUIDELINES_BLOCK,
	type LocatedPromptBlock,
} from "./prompt-blocks.ts";
import {
	UNREGISTERED_TOOL_SOURCE,
	type ToolSlice,
} from "./measure.ts";
import {
	type AnnotatedLines,
	appendAnnotatedLine,
	countedText,
	createItem,
	createAggregateItem,
	allocateSectionTokens,
	changeField,
	withChange,
	type SectionDraft,
} from "./measure-shared.ts";
import {
	type InjectedOwner,
	type InjectedSpan,
	locateRenderedLines,
	piOwnedGuidelines,
	claimGuidelines,
} from "./measure-attribution.ts";

/** Part names shared by a tool's dropped prompt lines and pi's own prompt blocks. */
const AVAILABLE_TOOLS_LABEL = AVAILABLE_TOOLS_BLOCK.label;
const GUIDELINES_LABEL = GUIDELINES_BLOCK.label;

/** Where extension tools' prompt lines ended up: rendered into pi's blocks, or dropped with them. */
export interface ToolPromptLines {
	/** Rendered lines, annotated on the System Prompt part that counts them. */
	readonly rendered: InjectedSpan[];
	/** Extension lines a replacement suppressed, keyed by the part that would have carried them. */
	readonly dropped: Map<string, AnnotatedLines>;
}

/**
 * Measure active tool definitions and locate the prompt snippet/guideline lines
 * pi rendered for extension tools, which System Prompt counts. Built-in tools
 * collapse into one aggregate pi-native item. Lines a `--system-prompt`
 * replacement suppressed belong to the parts named by `droppedPartIds`; each
 * tool keeps those as dropped, uncounted sections. `roster` holds every
 * extension's provenance, so path extensions get distinct labels.
 */
export function measureTools(
	prompt: string,
	tools: ToolSlice[],
	items: InjectionItem[],
	droppedPartIds: readonly string[],
	blocks: readonly LocatedPromptBlock[],
	roster: readonly ExtensionProvenance[],
): ToolPromptLines {
	const claimedGuidelines = new Set(piOwnedGuidelines(tools.filter((tool) => tool.change !== "deleted")));
	const rendered: InjectedSpan[] = [];
	const dropped = new Map<string, AnnotatedLines>();
	const builtinChildren: InjectionItem[] = [];
	for (const tool of tools) {
		if (tool.change === "deleted") {
			const deleted = createDeletedToolItem(tool, toolSource(tool, roster));
			if (tool.source === "builtin") builtinChildren.push(deleted);
			else items.push(deleted);
			continue;
		}
		// Built-in tools claim their bullets without annotating them, so a later
		// extension tool repeating one cannot take a line pi already renders for
		// pi itself or for a built-in tool.
		const ownedGuidelines = claimGuidelines(tool, claimedGuidelines);
		const definition = { ...createDefinitionSection(tool), ...changeField(tool.change) };
		const lines = toolPromptLines(tool, ownedGuidelines);
		const droppedLines = lines.filter((line) => droppedPartIds.includes(line.partId));
		// A tool counts only its definition; its rendered lines count in System Prompt
		const sections = [...droppedSections(droppedLines), definition];
		if (tool.source === "builtin") {
			builtinChildren.push(withChange(createToolItem(`tool:builtin:${tool.name}`, PI_SOURCE, tool.name, sections),
				tool.change));
			continue;
		}
		const owner: InjectedOwner = { source: toolSource(tool, roster), tool: tool.name };
		collectDroppedLines(dropped, droppedLines, owner);
		rendered.push(...locateRenderedLines(prompt, blocks, lines, owner));
		items.push(withChange(createToolItem(`tool:${tool.source}:${tool.name}`, owner.source, tool.name, sections),
			tool.change));
	}
	if (builtinChildren.length > 0) {
		builtinChildren.sort((a, b) => b.tokens - a.tokens);
		// The count names the tools the request declared, not the deleted ones listed with them
		const declared = builtinChildren.filter((child) => child.change !== "deleted").length;
		const label = `${BUILT_IN_TOOLS_LABEL} (${declared})`;
		items.push(createAggregateItem("tool:builtin", "tool", PI_SOURCE, label, builtinChildren));
	}
	return { rendered, dropped };
}

/**
 * A tool the request deleted: its session definition only, for the preview, at
 * 0 tokens. Its prompt lines stay with whatever text still holds them.
 */
function createDeletedToolItem(tool: ToolSlice, source: InjectionSource): InjectionItem {
	const id = tool.source === "builtin" ? `tool:builtin:${tool.name}` : `tool:${tool.source}:${tool.name}`;
	const definition: SectionDraft = { ...createDefinitionSection(tool), change: "deleted" };
	return { ...createToolItem(id, source, tool.name, [definition]), change: "deleted" };
}

/**
 * Owner of a tool: pi for a built-in, `unattributed` for an unregistered
 * tool, otherwise its extension labelled against the roster.
 */
function toolSource(tool: ToolSlice, roster: readonly ExtensionProvenance[]): InjectionSource {
	if (tool.source === "builtin") return PI_SOURCE;
	if (tool.source === UNREGISTERED_TOOL_SOURCE) return AGGREGATE_SOURCE;
	return extensionSource({ source: tool.source, path: tool.sourcePath }, roster);
}

/** One prompt line pi renders for a tool, and the System Prompt part it renders it into. */
interface ToolPromptLine {
	readonly partId: string;
	/** Section name the line belongs to, shared by the part and the owning tool. */
	readonly label: string;
	/** Line exactly as pi renders it, including its leading line break. */
	readonly text: string;
}

/** Prompt lines pi renders for one tool: its snippet bullet, then the guidelines it owns. */
function toolPromptLines(tool: ToolSlice, ownedGuidelines: string[]): ToolPromptLine[] {
	const lines: ToolPromptLine[] = [];
	if (tool.snippet !== undefined) {
		lines.push({
			partId: AVAILABLE_TOOLS_BLOCK.id,
			label: AVAILABLE_TOOLS_LABEL,
			text: `\n- ${tool.name}: ${tool.snippet}`,
		});
	}
	for (const guideline of ownedGuidelines) {
		lines.push({ partId: GUIDELINES_BLOCK.id, label: GUIDELINES_LABEL, text: `\n- ${guideline}` });
	}
	return lines;
}

/**
 * Group one tool's dropped lines into a preview-only section per part, so its
 * preview shows what the replacement gave up without claiming tokens pi never
 * sent.
 */
function droppedSections(lines: readonly ToolPromptLine[]): SectionDraft[] {
	const sections: SectionDraft[] = [];
	for (const line of lines) {
		const last = sections.length - 1;
		const current = sections[last];
		if (current !== undefined && current.label === line.label) {
			sections[last] = { ...current, text: current.text + line.text };
			continue;
		}
		sections.push({ label: line.label, text: line.text, dropped: true });
	}
	return sections;
}

/**
 * Add one extension tool's dropped lines, annotated, to the uncounted text of
 * the parts pi would have rendered them into.
 */
function collectDroppedLines(
	dropped: Map<string, AnnotatedLines>,
	lines: readonly ToolPromptLine[],
	owner: InjectedOwner,
): void {
	for (const line of lines) {
		let part = dropped.get(line.partId);
		if (part === undefined) {
			part = { text: "", injectedReferences: [] };
			dropped.set(line.partId, part);
		}
		appendAnnotatedLine(part, line.text, owner);
	}
}

/** The payload one tool sends with every request: its name, description, and parameter schema. */
function createDefinitionSection(tool: ToolSlice): SectionDraft {
	const heading = `${tool.name}: ${tool.description}\n`;
	return {
		label: "Definition",
		text: `${heading}${tool.parametersJson}`,
		jsonSpan: { start: heading.length, end: heading.length + tool.parametersJson.length },
	};
}

/** Build a tool item whose raw text is exactly the concatenation of its sections. */
export function createToolItem(
	id: string,
	source: InjectionSource,
	label: string,
	sections: SectionDraft[],
): InjectionItem {
	const text = countedText(sections);
	return { ...createItem(id, "tool", source, label, text), sections: allocateSectionTokens(sections) };
}

export {
	type ToolPromptLine,
	createDeletedToolItem,
	toolSource,
	toolPromptLines,
	droppedSections,
	collectDroppedLines,
	createDefinitionSection,
};
