/**
 * webfetch (skill-pi) — URL retrieval for the pi coding agent.
 *
 * Registers one LLM-callable tool:
 *   - webfetch — fetch URL content as markdown, text, or html.
 *
 * The contract follows code-yeongyu/pi-webfetch (MIT): static undici fetch
 * with bounded timeout and response size. Content extraction is homogenized
 * from georgebashi/pi-web-fetch (MIT): trafilatura replaces
 * Readability+Turndown, and the built-in site handlers (GitHub → gh CLI,
 * Google Docs → workspace tools) run as a beforeFetch short-circuit.
 *
 * No headless Chrome: pages are fetched over plain HTTP, so
 * JavaScript-rendered content is not available. When trafilatura finds no
 * content the tool says so explicitly.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  renderWebfetchCall,
  renderWebfetchResult,
} from "./src/webfetch/renderers.ts";
import { createWebfetchTool } from "./src/webfetch/tool.ts";
import { HandlerRegistry } from "./src/webfetch/registry.ts";
import type { WebFetchExtension } from "./src/webfetch/types.ts";
import githubRedirect from "./src/webfetch/handlers/github-redirect.ts";
import googleDocsRedirect from "./src/webfetch/handlers/google-docs-redirect.ts";

const ENABLE_ENV = "SKILL_PI_WEBFETCH";

function parseEnableEnv(envVar: string): boolean {
  const envValue = process.env[envVar];
  if (!envValue) {
    return true;
  }
  const normalized = envValue.trim().toLowerCase();
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  // Unknown values fall back to default-on behavior.
  return true;
}

export function isWebfetchEnabled(): boolean {
  return parseEnableEnv(ENABLE_ENV);
}

function buildRegistry(pi: ExtensionAPI): HandlerRegistry {
  const registry = new HandlerRegistry();
  registry.addBuiltIn(githubRedirect());
  registry.addBuiltIn(googleDocsRedirect());

  pi.events.on("webfetch:register", (data: unknown) => {
    const handler = data as WebFetchExtension;
    if (!handler || typeof handler !== "object") return;
    if (!handler.name || !handler.matches || !Array.isArray(handler.matches)) {
      console.error(
        "webfetch: received registration missing required fields (name, matches)",
      );
      return;
    }
    registry.addEventBus(handler);
  });

  return registry;
}

export default function (pi: ExtensionAPI): void {
  // When SKILL_PI_WEBFETCH disables the extension, keep the factory callable
  // but skip all registration side effects.
  if (!isWebfetchEnabled()) {
    return;
  }

  const registry = buildRegistry(pi);
  const webfetch = createWebfetchTool({ handlers: registry });

  pi.registerTool({
    ...webfetch,
    renderCall: renderWebfetchCall,
    renderResult: renderWebfetchResult,
  });
}
