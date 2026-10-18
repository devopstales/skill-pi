/**
 * Bullet attribution: locate the prompt lines pi rendered for extension tools
 * inside its XML sections, and decide which distinct guideline bullets each
 * tool actually owns.
 */
import { type LocatedPromptBlock } from "./prompt-blocks.ts";
import { type InjectionSource, type RequestChange } from "./model.ts";
import { type Span } from "./measure-shared.ts";

/** The extension tool that produced a prompt line. */
interface InjectedOwner {
	readonly source: InjectionSource;
	/** Tool of `source` that produced the line, rendered as a label qualifier. */
	readonly tool?: string;
}

/** Prompt location, owner, and System Prompt part of a rendered extension tool line. */
interface InjectedSpan extends Span, InjectedOwner {
	readonly partId: string;
}

/** One active tool as it contributes to the initial context. */
interface ToolSlice {
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

/** One prompt line pi renders for a tool, and the System Prompt part it renders it into. */
interface ToolPromptLine {
	readonly partId: string;
	/** Line exactly as pi renders it, including its leading line break. */
	readonly text: string;
}

/**
 * Locate one extension tool's lines in the bullet regions of the blocks pi
 * renders them into. A line pi did not render there gets no annotation.
 */
function locateRenderedLines(
	prompt: string,
	blocks: readonly LocatedPromptBlock[],
	lines: readonly ToolPromptLine[],
	owner: InjectedOwner,
): InjectedSpan[] {
	return lines.flatMap((line) => {
		const span = findBlockLine(prompt, blocks.find((block) => block.id === line.partId)?.bullets, line.text);
		return span === undefined ? [] : [{ ...span, ...owner, partId: line.partId }];
	});
}

/** Find one complete prompt bullet inside its block, never a prefix of another bullet. */
function findBlockLine(prompt: string, block: Span | undefined, line: string): Span | undefined {
	if (block === undefined) return undefined;
	let start = prompt.indexOf(line, block.start);
	while (start !== -1 && start + line.length <= block.end) {
		const end = start + line.length;
		if (end === block.end || prompt[end] === "\n") return { start, end };
		start = prompt.indexOf(line, end);
	}
	return undefined;
}

/**
 * Bullets pi's Guidelines section carries on its own behalf, reserved before
 * any tool can claim one. Pi adds this file-exploration bullet ahead of tool
 * guidelines, so an identical tool bullet is deduplicated away. Pi's two
 * trailing bullets ("Be concise in your responses", "Show file paths clearly
 * when working with files") need no reservation: pi appends them after tool
 * guidelines, where a tool declaring one already owns the rendered line.
 */
function piOwnedGuidelines(tools: ToolSlice[]): string[] {
	const names = new Set(tools.map((tool) => tool.name));
	const shellOnly = (names.has("bash") || names.has("powershell")) &&
		!names.has("grep") && !names.has("find") && !names.has("ls");
	if (!shellOnly) return [];
	if (names.has("bash") && names.has("powershell")) {
		return ["Use bash or PowerShell for file operations like listing, searching, and finding files"];
	}
	if (names.has("powershell")) {
		return ["Use PowerShell for file operations like listing, searching, and finding files"];
	}
	return ["Use bash for file operations like ls, rg, find"];
}

/**
 * Guideline texts this tool is the first to declare, in pi's active-tool
 * order. Pi renders each distinct bullet once, so a later tool repeating one
 * contributes no prompt line and must not count its tokens again.
 */
function claimGuidelines(tool: ToolSlice, claimed: Set<string>): string[] {
	const owned: string[] = [];
	for (const guideline of tool.guidelines) {
		const text = guideline.trim();
		if (text.length === 0 || claimed.has(text)) continue;
		claimed.add(text);
		owned.push(text);
	}
	return owned;
}

export {
	type InjectedOwner,
	type InjectedSpan,
	locateRenderedLines,
	piOwnedGuidelines,
	claimGuidelines,
};
