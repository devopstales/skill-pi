import { describe, expect, it } from "vitest";
import githubRedirect from "../src/webfetch/handlers/github-redirect.ts";
import googleDocsRedirect from "../src/webfetch/handlers/google-docs-redirect.ts";
import { createHookContext, type HookResult } from "../src/webfetch/types.ts";

function hookText(result: HookResult | void | undefined): string {
  return result?.content.find((block) => block.type === "text")?.text ?? "";
}

describe("github-redirect handler", () => {
  it("redirects github.com URLs to the gh CLI", async () => {
    const handler = githubRedirect();
    const ctx = createHookContext("https://github.com/org/repo/issues/123");
    const result = await handler.beforeFetch?.(ctx);
    expect(hookText(result)).toContain("gh issue view 123 --repo org/repo");
  });

  it("suggestions for plain repo URLs", async () => {
    const handler = githubRedirect();
    const ctx = createHookContext("https://github.com/org/repo");
    const result = await handler.beforeFetch?.(ctx);
    expect(hookText(result)).toContain("gh repo view org/repo");
  });

  it("only matches github.com URLs via its patterns", () => {
    const handler = githubRedirect();
    expect(handler.matches).toEqual(["github.com/**"]);
    expect(
      handler.matches.some((m) => m.includes("example.com")),
    ).toBe(false);
  });
});

describe("google-docs-redirect handler", () => {
  it("redirects docs.google.com URLs to workspace tools", async () => {
    const handler = googleDocsRedirect();
    const ctx = createHookContext("https://docs.google.com/document/d/abc");
    const result = await handler.beforeFetch?.(ctx);
    expect(hookText(result)).toContain("Google Docs");
  });

  it("detects spreadsheet product", async () => {
    const handler = googleDocsRedirect();
    const ctx = createHookContext("https://docs.google.com/spreadsheets/d/abc");
    const result = await handler.beforeFetch?.(ctx);
    expect(hookText(result)).toContain("Google Sheets");
  });
});
