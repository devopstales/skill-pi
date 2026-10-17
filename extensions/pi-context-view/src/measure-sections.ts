/**
 * Section measurement: measure one XML section body of pi's prompt, including
 * the generated context-file and skills records, and the unwrapped text
 * extensions added around pi's sections.
 */
import {
	INSTRUCTION_FILES_LABEL,
	PI_SOURCE,
	SKILLS_LABEL,
	type InjectionItem,
	type InjectedReference,
	type RequestChange,
} from "./model.ts";
import { type PromptAdditionOptions, splitPromptAdditions } from "./prompt-additions.ts";
import { type PromptSection } from "./prompt-blocks.ts";
import {
	SECTION_PARTS,
	PREAMBLE_BLOCK,
	abbreviateHome,
	findContextFileContent,
	decodeXml,
	createItem,
	createAggregateItem,
	type PromptOptionsSlice,
	type PromptPart,
	type DeletedSection,
} from "./measure.ts";
import {
	type AnnotatedLines,
	appendAnnotatedLine,
} from "./measure-shared.ts";
import { type InjectedSpan } from "./measure-attribution.ts";

/** Measure one XML section body, annotating the extension tool lines pi rendered into it. */
export function measureSectionPart(
	prompt: string,
	section: PromptSection,
	lines: readonly InjectedSpan[],
	moved: boolean | undefined,
): PromptPart {
	const block = SECTION_PARTS[section.name] ?? { id: `base-prompt:section:${section.name}`, label: section.name };
	const toolSurface = section.name === "tools" || section.name === "rules";
	// A tool surface keeps the newline before its first bullet, so that bullet's span stays inside the part
	const start = toolSurface && prompt[section.body.start] === "\n" ? section.body.start : section.body.start + 1;
	const references = lines.filter((line) => line.partId === block.id && line.start >= start
		&& line.end <= section.body.end).sort((a, b) => a.start - b.start).map((line): InjectedReference => ({
			start: line.start - start, end: line.end - start, source: line.source, tool: line.tool,
		}));
	return {
		id: block.id, label: block.label, text: prompt.slice(start, section.body.end),
		kind: section.name === "addendum" ? "append-prompt" : "base-prompt", moved,
		injectedReferences: references.length > 0 ? references : undefined,
	};
}

/**
 * Uncounted part for a section the request deleted, keeping the session text
 * without its XML wrapper for the preview.
 */
export function deletedSectionPart(section: DeletedSection): PromptPart {
	const block = SECTION_PARTS[section.name] ??
		(section.name === "preamble" ? PREAMBLE_BLOCK : { id: `base-prompt:section:${section.name}`, label: section.name });
	const open = `<${section.name}>`;
	const close = `</${section.name}>`;
	const wrapped = section.text.startsWith(open) && section.text.endsWith(close);
	return {
		id: block.id,
		kind: section.name === "addendum" ? "append-prompt" : "base-prompt",
		label: block.label,
		text: wrapped ? section.text.slice(open.length, section.text.length - close.length).replace(/^\n|\n$/g, "") : section.text,
		change: "deleted",
	};
}

/** Split generated records only when present; overridden or unknown content stays visible. */
export function measureGeneratedSection(
	name: string,
	body: string,
	options: PromptOptionsSlice,
	items: InjectionItem[],
	change: RequestChange | undefined,
): boolean {
	if (options.sections?.[name]) return false;
	if (name === "project_context" && body.includes("<project_instructions path=")) {
		const before = items.length;
		measureContextFiles(body, options.homeDir, items);
		if (change !== undefined && items.length > before) items[items.length - 1] = { ...items[items.length - 1], change };
		return true;
	}
	if (name === "skills" && body.includes("<available_skills>")) {
		// Read the captured records, not today's loader metadata after resume or a patch.
		const record =
			/<skill>\s*<name>(.*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<location>(.*?)<\/location>/g;
		const skills = [...body.matchAll(record)].map((match) => ({
			name: decodeXml(match[1]), description: decodeXml(match[2]), filePath: decodeXml(match[3]),
		}));
		if (skills.length === 0) return false;
		const children = skills.map((skill) => createItem(`skill:${skill.name}`, "skills", PI_SOURCE, skill.name,
			[skill.name, skill.description, skill.filePath].join("\n"))).sort((a, b) => b.tokens - a.tokens);
		const aggregate = createAggregateItem("skills", "skills", PI_SOURCE, `${SKILLS_LABEL} (${children.length})`, children);
		items.push(change === undefined ? aggregate : { ...aggregate, change });
		return true;
	}
	return false;
}

/**
 * Expose each context file recorded in pi's project-context section body as a
 * child of one Instruction Files aggregate, without counting the XML transport
 * scaffolding. Paths come from the captured records, not today's loader.
 */
function measureContextFiles(body: string, homeDir: string | undefined, items: InjectionItem[]): void {
	const children: InjectionItem[] = [];
	for (const match of body.matchAll(/<project_instructions path="([^"]+)">/g)) {
		const filePath = match[1];
		const content = findContextFileContent(body, filePath);
		if (content === undefined) continue;
		children.push(createItem(
			`context-file:${filePath}`,
			"context-file",
			PI_SOURCE,
			abbreviateHome(filePath, homeDir),
			content,
		));
	}
	children.sort((a, b) => b.tokens - a.tokens);
	if (children.length === 0) return;

	const label = `${INSTRUCTION_FILES_LABEL} (${children.length})`;
	items.push(createAggregateItem("context-files", "context-file", PI_SOURCE, label, children));
}

/**
 * Join the unwrapped text extensions added around pi's sections into the text
 * of the Extension Additions part, which System Prompt counts. Each run is
 * annotated with the extension it was guessed to belong to, or with
 * unattributed. Undefined when there is no such text.
 */
export function measurePromptAdditions(
	systemPrompt: string,
	start: number,
	options: PromptAdditionOptions,
): AnnotatedLines | undefined {
	if (systemPrompt.slice(start).trim().length === 0) return undefined;
	const additions: AnnotatedLines = { text: "", injectedReferences: [] };
	for (const run of splitPromptAdditions(systemPrompt, start, options)) {
		appendAnnotatedLine(additions, run.text, { source: run.source, tool: run.tool, attribution: run.attribution });
	}
	return additions.injectedReferences.length > 0 ? additions : undefined;
}
