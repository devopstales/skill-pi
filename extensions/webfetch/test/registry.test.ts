import { describe, expect, it } from "vitest";
import { HandlerRegistry, matchExtension } from "../src/webfetch/registry.ts";
import type { WebFetchExtension } from "../src/webfetch/types.ts";

function handler(name: string, matches: string[]): WebFetchExtension {
  return { name, matches };
}

describe("matchExtension", () => {
  it("matches hostname + pathname globs", () => {
    const github = handler("github", ["github.com/**"]);
    expect(matchExtension("https://github.com/org/repo", [github])?.name).toBe("github");
    expect(matchExtension("https://github.com/org/repo/issues/123", [github])?.name).toBe("github");
    expect(matchExtension("https://gitlab.com/org/repo", [github])).toBeNull();
  });

  it("matches segment globs", () => {
    const docs = handler("docs", ["docs.example.com/**"]);
    expect(matchExtension("https://docs.example.com/guide", [docs])?.name).toBe("docs");
    expect(matchExtension("https://example.com/docs", [docs])).toBeNull();
  });

  it("returns null for unparseable URLs", () => {
    expect(matchExtension("not a url", [handler("x", ["*"])])).toBeNull();
  });

  it("returns the first matching handler", () => {
    const first = handler("first", ["example.com/**"]);
    const second = handler("second", ["example.com/**"]);
    expect(matchExtension("https://example.com", [first, second])?.name).toBe("first");
  });
});

describe("HandlerRegistry", () => {
  it("searches event-bus before built-in", () => {
    const registry = new HandlerRegistry();
    registry.addBuiltIn(handler("built-in", ["github.com/**"]));
    registry.addEventBus(handler("event-bus", ["github.com/**"]));
    expect(registry.match("https://github.com/a/b")?.name).toBe("event-bus");
    expect(registry.count).toBe(2);
  });

  it("falls through to built-in when no event-bus match", () => {
    const registry = new HandlerRegistry();
    registry.addBuiltIn(handler("built-in", ["github.com/**"]));
    registry.addEventBus(handler("event-bus", ["other.com/**"]));
    expect(registry.match("https://github.com/a")?.name).toBe("built-in");
  });

  it("returns null when nothing matches", () => {
    const registry = new HandlerRegistry();
    registry.addBuiltIn(handler("built-in", ["github.com/**"]));
    expect(registry.match("https://example.com/")).toBeNull();
  });
});
