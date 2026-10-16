import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import webfetchExtension, { isWebfetchEnabled } from "../index.ts";

const ENABLE_ENV = "SKILL_PI_WEBFETCH";

function makeMockPi() {
  const registerTool = vi.fn();
  const on = vi.fn();
  const eventsOn = vi.fn();
  return {
    registerTool,
    on,
    events: { on: eventsOn },
  };
}

beforeEach(() => {
  delete process.env[ENABLE_ENV];
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("webfetch extension toggle", () => {
  it("returns true when SKILL_PI_WEBFETCH is unset", () => {
    expect(isWebfetchEnabled()).toBe(true);
  });

  it.each(["1", "true", "yes", "on", " TRUE ", "\tYeS\n"])(
    "returns true for truthy SKILL_PI_WEBFETCH value %s",
    (envValue) => {
      process.env[ENABLE_ENV] = envValue;
      expect(isWebfetchEnabled()).toBe(true);
    },
  );

  it.each(["0", "false", "no", "off", " OFF ", "\nNo\t"])(
    "returns false for falsy SKILL_PI_WEBFETCH value %s",
    (envValue) => {
      process.env[ENABLE_ENV] = envValue;
      expect(isWebfetchEnabled()).toBe(false);
    },
  );

  it("returns true for unknown SKILL_PI_WEBFETCH values", () => {
    process.env[ENABLE_ENV] = "definitely";
    expect(isWebfetchEnabled()).toBe(true);
  });

  it("is a no-op when SKILL_PI_WEBFETCH is disabled", () => {
    process.env[ENABLE_ENV] = "0";
    const pi = makeMockPi();
    webfetchExtension(pi as never);
    expect(pi.registerTool).not.toHaveBeenCalled();
    expect(pi.events.on).not.toHaveBeenCalled();
  });

  it("registers the webfetch tool and subscribes to webfetch:register", () => {
    const pi = makeMockPi();
    webfetchExtension(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    const registered = pi.registerTool.mock.calls[0][0] as {
      name: string;
      renderCall: unknown;
      renderResult: unknown;
    };
    expect(registered.name).toBe("webfetch");
    expect(typeof registered.renderCall).toBe("function");
    expect(typeof registered.renderResult).toBe("function");
    expect(pi.events.on).toHaveBeenCalledWith("webfetch:register", expect.any(Function));
  });
});
