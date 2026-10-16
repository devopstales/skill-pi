/**
 * Shared types for the webfetch extension and its site handlers.
 *
 * The WebFetchExtension interface is a simplified hook contract: a single
 * `beforeFetch` hook can short-circuit the pipeline (e.g. "use the gh CLI
 * for GitHub URLs"). This replaces the four-stage hook system of
 * georgebashi/pi-web-fetch, which only made sense with a headless-Chrome
 * fetch stage that static HTTP fetch does not have.
 */

/** Content block in a tool result (matches pi's content types). */
export interface TextContent {
  type: "text";
  text: string;
}

export interface ImageContent {
  type: "image";
  data: string;
  mimeType: string;
}

export type ToolContent = TextContent | ImageContent;

/** Result returned by a hook to short-circuit the pipeline. */
export interface HookResult {
  content: ToolContent[];
  isError?: boolean;
}

/** Context passed to the beforeFetch hook. */
export interface HookContext {
  /** Normalized URL (always https://) */
  url: string;
  /** Parsed URL object */
  parsedUrl: URL;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /**
   * Helper to create a redirect/rejection result.
   * Returns a HookResult with the message as text content.
   */
  redirect(message: string): HookResult;
}

/**
 * A site handler that intercepts matching URLs before fetching.
 *
 * Handlers are modules whose default export is a factory function returning
 * a WebFetchExtension object. Built-in handlers live in
 * `src/webfetch/handlers/`; users can drop more there or register their own
 * via the `webfetch:register` event.
 *
 * @example
 * ```typescript
 * import type { WebFetchExtension } from "../webfetch/types.ts";
 *
 * export default function (): WebFetchExtension {
 *   return {
 *     name: "my-handler",
 *     matches: ["example.com/**"],
 *     async beforeFetch(ctx) {
 *       return ctx.redirect("Use a different tool for this site.");
 *     },
 *   };
 * }
 * ```
 */
export interface WebFetchExtension {
  /** Unique name for the extension */
  name: string;
  /** Human-readable description */
  description?: string;
  /**
   * URL glob patterns matched against the parsed hostname only (the path is
   * not part of the match). Use a hostname or hostname glob.
   * @example ["github.com", "docs.google.com"]
   */
  matches: string[];

  /**
   * Called after URL validation, before fetching.
   * Return a HookResult to short-circuit the entire pipeline.
   * Return void to continue with normal fetching.
   */
  beforeFetch?(ctx: HookContext): Promise<HookResult | void> | HookResult | void;
}

/**
 * Create a HookContext for the given URL.
 * Exported for testing.
 */
export function createHookContext(
  url: string,
  options?: { signal?: AbortSignal },
): HookContext {
  return {
    url,
    parsedUrl: new URL(url),
    signal: options?.signal,
    redirect(message: string): HookResult {
      return {
        content: [{ type: "text", text: message }],
      };
    },
  };
}
