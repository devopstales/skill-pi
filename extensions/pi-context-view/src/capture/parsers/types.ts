/**
 * Shared types of the payload parsers.
 */
import type { MessageUnit } from "../messages.ts";

/**
 * Result of copying a payload:
 *   supported     an owned copy of every array and plain object; strings are shared
 *   unsupported   the payload holds something else, such as bytes or a class instance
 */
export type PayloadCopy =
	| { readonly supported: true; readonly payload: unknown }
	| { readonly supported: false; readonly reason: string };

/** One tool declaration as the payload states it. */
export interface PayloadDeclaration {
	/** The payload's declared name; never inferred from a provider tool type. */
	readonly name: string;
	readonly description?: string;
}

/**
 * Result of parsing a payload's tool-declaration channel:
 *   parsed        declarations after replaying inline tool changes, in declaration order,
 *                 without Pi's deferred placeholder
 *   unsupported   the API has no parser, or the payload does not match its representation
 */
export type ParsedTools =
	| { readonly status: "parsed"; readonly declarations: readonly PayloadDeclaration[] }
	| { readonly status: "unsupported"; readonly reason: string };

/**
 * Result of parsing a payload's message channel:
 *   parsed        text units in payload order, without inline tool changes, reasoning, or image data
 *   unsupported   the API has no parser, or a message or block has an unknown shape
 */
export type ParsedMessages =
	| { readonly status: "parsed"; readonly units: readonly MessageUnit[] }
	| { readonly status: "unsupported"; readonly reason: string };

/** A JSON object in a payload. */
export type Item = Readonly<Record<string, unknown>>;
