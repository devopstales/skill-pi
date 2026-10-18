/**
 * Shapes and helpers shared by the measurement modules: the section/part
 * records measured before items are built, the uncounted-part rule that keeps
 * the token reconciliation exact, and the token estimates.
 */
import {
	type InjectionItem,
	type InjectionKind,
	type InjectionSection,
	type InjectionSource,
	type InjectedReference,
	type JsonSpan,
	type RequestChange,
} from "./model.ts";

/** Half-open [start, end) character range within the base prompt. */
export interface Span {
	start: number;
	end: number;
}

/** Same chars/4 heuristic pi's estimateTokens uses for text content. */
export function textTokens(text: string): number {
	return charTokens(text.length);
}

/** Token estimate for an already known character count. */
export function charTokens(chars: number): number {
	return Math.ceil(chars / 4);
}

/** A labeled section measured before its item is built; carries the fields a preview needs. */
export interface SectionDraft {
	readonly label: string;
	readonly text: string;
	/** True for text a `--system-prompt` replacement dropped: shown for reference, never counted. */
	readonly dropped?: boolean;
	/** True for a block an extension moved out of the region pi rendered it into. */
	readonly moved?: boolean;
	/** Request-only change; a deleted section is shown for reference, never counted. */
	readonly change?: RequestChange;
	/** Serialized JSON inside `text`; marked here rather than detected in the preview. */
	readonly jsonSpan?: JsonSpan;
	/** Extension lines inside `text`, annotated with their source in previews. */
	readonly injectedReferences?: readonly InjectedReference[];
}

/** A part that may carry text the request never sent. */
interface UncountablePart {
	readonly text: string;
	readonly dropped?: boolean;
	readonly change?: RequestChange;
}

/** Whether a part's text is shown for reference only: a replacement dropped it, or the request deleted it. */
export function isUncounted(part: UncountablePart): boolean {
	return part.dropped === true || part.change === "deleted";
}

/** `{ change }` when there is one, so unchanged parts carry no extra key. */
export function changeField(change: RequestChange | undefined): { readonly change?: RequestChange } {
	return change === undefined ? {} : { change };
}

/** The item with a request-only change, or unchanged when there is none. */
export function withChange(item: InjectionItem, change: RequestChange | undefined): InjectionItem {
	return change === undefined ? item : { ...item, change };
}

/** Build an InjectionItem with derived char/token sizes. */
export function createItem(
	id: string,
	kind: InjectionKind,
	source: InjectionSource,
	label: string,
	text: string,
): InjectionItem {
	return {
		id,
		kind,
		source,
		label,
		chars: text.length,
		tokens: textTokens(text),
		text,
	};
}

/** Text an item actually sends: everything but dropped and deleted parts. */
export function countedText(parts: readonly UncountablePart[]): string {
	return parts.filter((part) => !isUncounted(part)).map((part) => part.text).join("");
}

/**
 * Give each section its share of the item estimate. Shares are cumulative
 * differences rather than independently rounded counts, so they always sum to
 * the item total. A dropped or deleted section reads 0 tokens and leaves the
 * shares of the sections pi did send unchanged.
 */
export function allocateSectionTokens(sections: readonly SectionDraft[]): InjectionSection[] {
	let chars = 0;
	let allocated = 0;
	return sections.map((section) => {
		if (isUncounted(section)) return { ...section, tokens: 0 };
		chars += section.text.length;
		const cumulative = charTokens(chars);
		const tokens = cumulative - allocated;
		allocated = cumulative;
		return { ...section, tokens };
	});
}

/**
 * Build an aggregate whose totals exactly reconcile with its child items and
 * whose preview presents every child as its own labeled part, so each child
 * keeps its subheader, token share, and marked JSON run.
 */
export function createAggregateItem(
	id: string,
	kind: InjectionKind,
	source: InjectionSource,
	label: string,
	children: InjectionItem[],
): InjectionItem {
	return {
		...createItem(id, kind, source, label, children.map((child) => child.text).join(CHILD_SEPARATOR)),
		chars: children.reduce((sum, child) => sum + child.chars, 0),
		tokens: children.reduce((sum, child) => sum + child.tokens, 0),
		sections: children.map((child, index) =>
			childSection(child, index === 0 ? "" : CHILD_SEPARATOR)
		),
		children,
	};
}

/** Line break joining consecutive child texts inside an aggregate's raw text. */
const CHILD_SEPARATOR = "\n";

/**
 * One child as a labeled part of its aggregate, opening with the separator the
 * aggregate text joins on; the preview drops that separator again.
 */
function childSection(child: InjectionItem, separator: string): InjectionSection {
	const span = childJsonSpan(child);
	const text = child.change === "deleted" ? child.sections?.[0]?.text ?? child.text : child.text;
	return {
		label: child.label,
		text: `${separator}${text}`,
		tokens: child.tokens,
		...changeField(child.change),
		jsonSpan: span === undefined
			? undefined
			: { start: span.start + separator.length, end: span.end + separator.length },
	};
}

/**
 * The JSON run marked inside a child's whole text: its own span, or the span of
 * its single part. A child split into several parts marks each part separately,
 * so no one run covers its text and the aggregate part expands nothing.
 */
function childJsonSpan(child: InjectionItem): JsonSpan | undefined {
	const sections = child.sections;
	if (sections === undefined) return child.jsonSpan;
	return sections.length === 1 ? sections[0]?.jsonSpan : undefined;
}

/** Extension lines joined into the text of one System Prompt part, each annotated with its source. */
export interface AnnotatedLines {
	text: string;
	readonly injectedReferences: InjectedReference[];
}

/** Append one extension line and annotate its range with the line's source. */
export function appendAnnotatedLine(
	lines: AnnotatedLines,
	text: string,
	owner: Omit<InjectedReference, keyof Span>,
): void {
	lines.injectedReferences.push({ start: lines.text.length, end: lines.text.length + text.length, ...owner });
	lines.text += text;
}
