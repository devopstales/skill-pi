import { StringEnum } from "@earendil-works/pi-ai";
import {
  defineTool,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  clampTimeout,
  fetchUrl,
  type WebfetchFormat,
} from "./fetcher.ts";
import { detectPythonRunner, extractMarkdown } from "./extract.ts";
import { HandlerRegistry } from "./registry.ts";
import { createHookContext, type HookResult } from "./types.ts";

const WEBFETCH_FORMATS = ["markdown", "text", "html"] as const;
const TRAFILATURA_FORMATS: readonly WebfetchFormat[] = ["markdown", "text"];

const toolDescription = [
  "Fetches content from a URL and returns it as markdown, plain text, or HTML.",
  "",
  "HTML responses are converted with trafilatura (ML-based boilerplate removal — nav, ads, footers stripped), which produces much cleaner markdown than a naive HTML-to-markdown conversion.",
  "",
  "Format selection:",
  "- markdown (default): trafilatura-extracted main content. Best for articles, docs, and most web pages.",
  "- text: plain text of the page, no markup.",
  "- html: the raw HTML document, unchanged. Use for inspecting structure or when trafilatura finds no content.",
  "",
  "Network use is bounded by timeout (30s default, 120s max) and a 5MB response-size limit.",
  "",
  "JavaScript-rendered pages: extraction works on the static document. If trafilatura finds no content, re-fetch with format \"html\" to inspect the raw document.",
].join("\n");

const promptGuidelines = [
  "Use webfetch when a specific URL must be retrieved.",
  "Prefer markdown format unless raw HTML or plain text is explicitly needed.",
  "If webfetch reports that trafilatura extracted no content, retry with format \"html\".",
  "The tool is read-only and does not modify files.",
];

const Params = Type.Object({
  url: Type.String({ description: "The URL to fetch content from" }),
  format: Type.Optional(
    StringEnum(["markdown", "text", "html"] as const, {
      description:
        "The format to return the content in. Defaults to markdown.",
    }),
  ),
  timeout: Type.Optional(
    Type.Number({ description: "Optional timeout in seconds. Maximum 120." }),
  ),
});

export interface WebfetchDetails {
  url: string;
  finalUrl: string;
  format: WebfetchFormat;
  status: number;
  statusText: string;
  contentType: string;
  bytes: number;
  timeoutSeconds: number;
  /** Whether the response went through trafilatura extraction. */
  extracted: boolean;
  /** The Python tool runner used for extraction, when extracted. */
  runner?: string;
  /** Whether the text handed to the model was capped below the raw content size. */
  outputTruncated: boolean;
  /** Byte length of the text handed to the model (excluding the truncation notice). */
  outputBytes: number;
  /** Byte length of the full converted text before the output cap. */
  outputTotalBytes: number;
}

export interface WebfetchProgressDetails {
  phase: "fetching" | "extracting";
  url: string;
  format: WebfetchFormat;
  timeoutSeconds: number;
}

export type WebfetchRenderDetails = WebfetchDetails | WebfetchProgressDetails;

export interface WebfetchToolOptions {
  /** Site-handler registry; handlers may short-circuit a fetch via beforeFetch. */
  handlers?: HandlerRegistry;
}

export function createWebfetchTool(options: WebfetchToolOptions = {}) {
  const registry = options.handlers ?? new HandlerRegistry();

  return defineTool<typeof Params, WebfetchRenderDetails>({
    name: "webfetch",
    label: "Web Fetch",
    description: toolDescription,
    promptSnippet:
      "webfetch: retrieve URL content as markdown (trafilatura-extracted), text, or html",
    promptGuidelines,
    parameters: Params,
    async execute(_toolCallId, params, signal, onUpdate, _ctx) {
      const format = parseWebfetchFormat(params.format);
      const timeoutSeconds = clampTimeout(params.timeout);

      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Fetching ${params.url} as ${format} (timeout ${timeoutSeconds}s)`,
          },
        ],
        details: { phase: "fetching", url: params.url, format, timeoutSeconds },
      });

      const handlerResult = await runBeforeFetchHook(
        params.url,
        format,
        signal,
        registry,
      );
      if (handlerResult) {
        return {
          content: handlerResult.content,
          details: {
            phase: "fetching",
            url: params.url,
            format,
            timeoutSeconds,
          },
          ...(handlerResult.isError ? { isError: true } : {}),
        };
      }

      const fetched = await fetchUrl({
        url: params.url,
        format,
        timeoutSeconds,
        ...(signal === undefined ? {} : { signal }),
      });
      const raw = new TextDecoder().decode(fetched.body);
      const contentType = fetched.contentType.toLowerCase();
      const isHtml =
        contentType.includes("text/html") ||
        contentType.includes("application/xhtml+xml");
      let text = raw;
      let extracted = false;
      let runnerLabel: string | undefined;

      if (isHtml && TRAFILATURA_FORMATS.includes(format)) {
        onUpdate?.({
          content: [{ type: "text", text: "Extracting content with trafilatura..." }],
          details: { phase: "extracting", url: params.url, format, timeoutSeconds },
        });
        const runner = detectPythonRunner();
        if (runner) {
          text = await extractMarkdown(raw, runner, signal);
          extracted = true;
          runnerLabel = runner.label;
        }
      }

      const capped = capWebfetchOutput(text);

      const details: WebfetchDetails = {
        url: params.url,
        finalUrl: fetched.url,
        format,
        status: fetched.status,
        statusText: fetched.statusText,
        contentType: fetched.contentType,
        bytes: fetched.bytes,
        timeoutSeconds,
        extracted,
        runner: runnerLabel,
        outputTruncated: capped.truncated,
        outputBytes: capped.outputBytes,
        outputTotalBytes: capped.totalBytes,
      };

      return {
        content: [{ type: "text", text: capped.text }],
        details,
      };
    },
  });
}

async function runBeforeFetchHook(
  url: string,
  format: WebfetchFormat,
  signal: AbortSignal | undefined,
  registry: HandlerRegistry,
): Promise<HookResult | undefined> {
  const normalized = normalizeUrl(url);
  const handler = registry.match(normalized);
  if (!handler?.beforeFetch) return undefined;
  const ctx = createHookContext(normalized, { signal });
  const result = await handler.beforeFetch(ctx);
  return result as HookResult | undefined;
}

function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "http:") {
      parsed.protocol = "https:";
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

export function parseWebfetchFormat(value: unknown): WebfetchFormat {
  if (value === undefined) return "markdown";
  for (const format of WEBFETCH_FORMATS) {
    if (value === format) return format;
  }
  return "markdown";
}

/**
 * Bound the text handed to the model so a single fetch cannot flood the
 * context window and force an unwanted compaction. Uses pi's shared head
 * truncation (whole lines, 2000-line / 50KB defaults).
 */
export function capWebfetchOutput(text: string) {
  const truncation = truncateHead(text, {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  if (!truncation.truncated) {
    return {
      text,
      truncated: false,
      outputBytes: truncation.outputBytes,
      totalBytes: truncation.totalBytes,
    };
  }
  const notice = `\n\n[Output truncated: ${truncation.outputLines} of ${truncation.totalLines} lines (${formatSize(truncation.outputBytes)} of ${formatSize(truncation.totalBytes)}). Re-fetch a more specific URL for targeted content.]`;
  return {
    text: truncation.content + notice,
    truncated: true,
    outputBytes: truncation.outputBytes,
    totalBytes: truncation.totalBytes,
  };
}
