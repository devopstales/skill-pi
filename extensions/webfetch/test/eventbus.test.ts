import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webfetchExtension from "../index.ts";
import { createWebfetchTool } from "../src/webfetch/tool.ts";
import { HandlerRegistry } from "../src/webfetch/registry.ts";
import type { WebFetchExtension } from "../src/webfetch/types.ts";

const ENABLE_ENV = "SKILL_PI_WEBFETCH";

beforeEach(() => {
  delete process.env[ENABLE_ENV];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webfetch:register event bus", () => {
  it("subscribes to webfetch:register on the pi event bus", () => {
    const eventsOn = vi.fn();
    webfetchExtension({
      registerTool: vi.fn(),
      on: vi.fn(),
      events: { on: eventsOn },
    } as never);
    expect(eventsOn).toHaveBeenCalledWith("webfetch:register", expect.any(Function));
  });

  it("a registered handler short-circuits a matching URL", async () => {
    const registerHandler = vi.fn();
    const pi = {
      registerTool: vi.fn(),
      on: vi.fn(),
      events: {
        on: (event: string, handler: unknown) => {
          if (event === "webfetch:register") registerHandler(handler);
        },
      },
    };
    webfetchExtension(pi as never);
    expect(registerHandler).toHaveBeenCalledTimes(1);

    const registry = new HandlerRegistry();
    registry.addEventBus({
      name: "test-domain",
      matches: ["test.example/**"],
      async beforeFetch(ctx) {
        return ctx.redirect("handled by event bus");
      },
    } satisfies WebFetchExtension);
    const tool = createWebfetchTool({ handlers: registry });
    const result = await tool.execute(
      "e1",
      { url: "https://test.example/page" },
      undefined,
      () => {},
      {} as never,
    );
    expect(
      result.content.find((block) => block.type === "text")?.text,
    ).toBe("handled by event bus");
  });

  it("ignores malformed registrations", () => {
    const eventsOn = vi.fn();
    const originalError = console.error;
    console.error = vi.fn();
    webfetchExtension({
      registerTool: vi.fn(),
      on: vi.fn(),
      events: { on: eventsOn },
    } as never);
    const handler = eventsOn.mock.calls[0][1] as (data: unknown) => void;
    handler("not-an-object");
    handler({ name: "incomplete" });
    handler({ name: "x", matches: "not-an-array" });
    expect(console.error).toHaveBeenCalledTimes(2);
    console.error = originalError;
  });
});
