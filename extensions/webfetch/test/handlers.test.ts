import { describe, expect, it } from "vitest";
import githubRedirect from "../src/webfetch/handlers/github-redirect.ts";
import googleDocsRedirect from "../src/webfetch/handlers/google-docs-redirect.ts";
import { matchExtension } from "../src/webfetch/registry.ts";
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

  it("only matches the github.com hostname via its patterns", () => {
    const handler = githubRedirect();
    expect(handler.matches).toEqual(["github.com"]);
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

  it("does not name an unshipped package in its message", async () => {
    const handler = googleDocsRedirect();
    const ctx = createHookContext("https://docs.google.com/document/d/abc");
    const result = await handler.beforeFetch?.(ctx);
    expect(hookText(result)).not.toContain("google_workspace_mcp");
  });
});

describe("glob matching (SSRF-hider guard)", () => {
  it("matches a URL by its real hostname, not a hostname embedded in the path", () => {
    const handler = githubRedirect();
    // A percent-encoded slash in the path previously let the concatenated
    // hostname+pathname claim the github.com host while the effective host
    // was different; matching on hostname alone removes the ambiguity.
    const real = matchExtension("https://github.com/org/repo/issues/1", [handler]);
    expect(real?.name).toBe("github-redirect");
  });

  it("does not let a different host claim a built-in pattern via the path", () => {
    const handler = githubRedirect();
    const notGithub = matchExtension("https://evil.com/github.com/x", [handler]);
    expect(notGithub).toBeNull();
  });
});
