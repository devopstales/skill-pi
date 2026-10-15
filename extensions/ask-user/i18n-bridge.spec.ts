import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadBridge(env: Record<string, string | undefined>) {
  vi.resetModules();
  const prev = { LC_ALL: process.env.LC_ALL, LC_MESSAGES: process.env.LC_MESSAGES, LANG: process.env.LANG };
  for (const k of ["LC_ALL", "LC_MESSAGES", "LANG"] as const) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await import("./state/i18n-bridge.js");
  } finally {
    for (const k of ["LC_ALL", "LC_MESSAGES", "LANG"] as const) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

describe("i18n-bridge — locale selection by LANG/LC_ALL", () => {
  afterEach(() => vi.resetModules());

  it("falls back to English when no locale env is set", async () => {
    const bridge = await loadBridge({ LC_ALL: undefined, LC_MESSAGES: undefined, LANG: undefined });
    expect(bridge.t("hint.cancel", "Esc to cancel")).toBe("Esc to cancel");
    expect(bridge.displayLabel("other")).toBe("Type something.");
  });

  it("selects a non-English locale via LANG", async () => {
    const bridge = await loadBridge({ LC_ALL: undefined, LC_MESSAGES: undefined, LANG: "de_DE.UTF-8" });
    // "Type something." is translated in the de locale; assert it differs from the English fallback.
    expect(bridge.displayLabel("other")).not.toBe("Type something.");
  });

  it("prefers LC_ALL over LANG", async () => {
    const bridge = await loadBridge({ LC_ALL: "de_DE.UTF-8", LC_MESSAGES: undefined, LANG: "en" });
    expect(bridge.displayLabel("other")).not.toBe("Type something.");
  });

  it("falls back to a language-only prefix when the full tag is unknown", async () => {
    // "pt-br" file exists as pt.json; a pt-br tag should still resolve (prefix match).
    const bridge = await loadBridge({ LC_ALL: undefined, LC_MESSAGES: undefined, LANG: "pt_BR.UTF-8" });
    expect(bridge.displayLabel("other")).not.toBe("Type something.");
  });

  it("an unknown locale falls back to the English string (never blank)", async () => {
    const bridge = await loadBridge({ LC_ALL: undefined, LC_MESSAGES: undefined, LANG: "xx_YY" });
    expect(bridge.displayLabel("other")).toBe("Type something.");
    expect(bridge.t("hint.cancel", "Esc to cancel")).toBe("Esc to cancel");
  });


  it("a key missing from the locale file falls back to the inline English", async () => {
    const bridge = await loadBridge({ LC_ALL: undefined, LC_MESSAGES: undefined, LANG: "de_DE.UTF-8" });
    // "sentinel.other" exists in de, but an unknown key must fall back.
    expect(bridge.t("no.such.key", "fallback text")).toBe("fallback text");
  });
});
