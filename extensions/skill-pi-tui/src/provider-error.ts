const MODEL_NOT_FOUND = /model '([^']+)' not found/;
const AUTH_ERROR = /401|403|unauthorized|invalid api key/i;
const RATE_LIMIT = /429|rate limit/i;

export interface ProviderErrorLike {
  role?: unknown;
  stopReason?: unknown;
  content?: unknown;
  errorMessage?: unknown;
}

function asErrorMessage(message: unknown): string {
  const raw = (message as { errorMessage?: unknown } | undefined)?.errorMessage;
  return typeof raw === "string" ? raw : "";
}

export function isProviderError(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const m = message as ProviderErrorLike;
  if (m.role !== "assistant" || m.stopReason !== "error") return false;
  return Array.isArray(m.content) || asErrorMessage(m).length > 0;
}

function modelText(message: unknown): string {
  const content = (message as { content?: unknown[] }).content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const p = part as { type?: unknown; text?: unknown };
      return p.type === "text" && typeof p.text === "string" ? p.text : "";
    })
    .join("\n");
}

function firstSentence(text: string, max = 120): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const end = cleaned.search(/[.!?]\s/);
  const sentence = end >= 0 ? cleaned.slice(0, end + 1) : cleaned;
  return sentence.length > max ? `${sentence.slice(0, max - 1)}…` : sentence;
}

export function humanizeProviderError(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const modelMatch = trimmed.match(MODEL_NOT_FOUND);
  if (modelMatch) {
    const model = modelMatch[1];
    return (
      `Model "${model}" not found on the provider.` +
      `\nPull it or pick another: /model (e.g. ollama pull ${model})`
    );
  }
  if (AUTH_ERROR.test(trimmed)) {
    return "Authentication failed for the provider.\nCheck credentials: /login";
  }
  if (RATE_LIMIT.test(trimmed)) {
    return "Rate limited by the provider.\nWait a moment and retry, or switch models: /model";
  }
  if (/\b\d{3}\b/.test(trimmed)) {
    const excerpt = firstSentence(trimmed.replace(/^[0-9]{3}:\s*/, ""));
    return `Provider returned an error.\n${excerpt}`;
  }
  return null;
}

export function cleanProviderError(
  message: unknown,
): { content: { type: "text"; text: string }[] } | null {
  if (!isProviderError(message)) return null;
  const source = modelText(message) || asErrorMessage(message);
  if (!source) return null;
  const humanized = humanizeProviderError(source);
  if (!humanized) return null;
  return { content: [{ type: "text", text: humanized }] };
}

export { modelText };
