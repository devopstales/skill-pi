/**
 * Site-handler registry and URL pattern matching.
 *
 * Holds handlers from two sources in priority order: event-bus (registered
 * by other pi extensions) → built-in. match() searches in this priority
 * order and returns the first match.
 */
import picomatch from "picomatch";
import type { WebFetchExtension } from "./types.ts";

/**
 * Match a URL against a list of handlers, returning the first match.
 * Extracts hostname + pathname from the URL and matches against handler
 * glob patterns.
 */
export function matchExtension(
  url: string,
  handlers: WebFetchExtension[],
): WebFetchExtension | null {
  let hostAndPath: string;
  try {
    const parsed = new URL(url);
    hostAndPath = parsed.hostname + parsed.pathname;
  } catch {
    return null;
  }

  for (const handler of handlers) {
    for (const pattern of handler.matches) {
      if (picomatch.isMatch(hostAndPath, pattern)) {
        return handler;
      }
    }
  }
  return null;
}

export class HandlerRegistry {
  private eventBus: WebFetchExtension[] = [];
  private builtIn: WebFetchExtension[] = [];

  addEventBus(handler: WebFetchExtension): void {
    this.eventBus.push(handler);
  }

  addBuiltIn(handler: WebFetchExtension): void {
    this.builtIn.push(handler);
  }

  /**
   * Find the first handler matching the given URL.
   * Searches in priority order: event-bus → built-in.
   */
  match(url: string): WebFetchExtension | null {
    return matchExtension(url, this.eventBus) || matchExtension(url, this.builtIn);
  }

  /** Total number of registered handlers across all sources. */
  get count(): number {
    return this.eventBus.length + this.builtIn.length;
  }
}
