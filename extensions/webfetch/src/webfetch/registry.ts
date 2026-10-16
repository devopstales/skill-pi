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
 * Matches on the parsed hostname alone. Matching hostname+pathname would let a
 * crafted path (e.g. `https://x.com/github.com/…`) claim a built-in pattern's
 * host and short-circuit the fetch, so the path is not part of the match.
 */
export function matchExtension(
  url: string,
  handlers: WebFetchExtension[],
): WebFetchExtension | null {
  let hostname: string;
  try {
    const parsed = new URL(url);
    hostname = parsed.hostname;
  } catch {
    return null;
  }

  for (const handler of handlers) {
    for (const pattern of handler.matches) {
      if (picomatch.isMatch(hostname, pattern)) {
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
