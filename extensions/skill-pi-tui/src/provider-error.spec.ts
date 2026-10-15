import { assert, it } from "vitest";
import { cleanProviderError, humanizeProviderError, isProviderError } from "./provider-error.ts";

const OLLAMA_404 =
  '404: {"message":"model \'qwen2.5-coder:7b\' not found","type":"not_found_error","param":null,"code":null}';

it("isProviderError: detects an assistant message with stopReason error", () => {
  assert.equal(
    isProviderError({
      role: "assistant",
      stopReason: "error",
      content: [{ type: "text", text: OLLAMA_404 }],
    }),
    true,
  );
});

it("isProviderError: ignores a normal assistant message", () => {
  assert.equal(
    isProviderError({
      role: "assistant",
      stopReason: "stop",
      content: [{ type: "text", text: "hello" }],
    }),
    false,
  );
});

it("isProviderError: ignores non-message values", () => {
  assert.equal(isProviderError(undefined), false);
  assert.equal(isProviderError({ role: "user", content: [] }), false);
  assert.equal(
    isProviderError({ role: "assistant", stopReason: "error", content: "not-an-array" }),
    false,
  );
});

it("humanizeProviderError: turns an Ollama 404 model-not-found payload into a friendly message", () => {
  const out = humanizeProviderError(OLLAMA_404);
  assert.ok(out, "expected a humanized message");
  assert.match(out, /qwen2\.5-coder:7b/);
  assert.match(out, /not found/);
  assert.match(out, /\/model/);
  assert.notMatch(out, /ollama/);
});

it("humanizeProviderError: triangulates with a different 404 model id", () => {
  const out = humanizeProviderError('404: {"message":"model \'llama3.2:3b\' not found","type":"not_found_error"}');
  assert.ok(out);
  assert.match(out, /llama3\.2:3b/);
  assert.match(out, /\/model/);
  assert.notMatch(out, /ollama/);
});

it("humanizeProviderError: maps 401 to an auth hint", () => {
  const out = humanizeProviderError("401: {\"message\":\"Invalid API key\"}");
  assert.ok(out);
  assert.match(out, /[Aa]uth/);
  assert.match(out, /\/login/);
});

it("humanizeProviderError: maps 429 to a rate-limit hint", () => {
  const out = humanizeProviderError('429: {"message":"rate limit exceeded"}');
  assert.ok(out);
  assert.match(out, /rate limit/i);
});

it("humanizeProviderError: falls back to a generic message with the payload excerpt", () => {
  const out = humanizeProviderError("500: {\"message\":\"upstream exploded badly, twice in a row\"}");
  assert.ok(out);
  assert.match(out, /Provider returned an error/);
  assert.match(out, /upstream exploded badly/);
});

it("humanizeProviderError: returns null for an unrecognized payload", () => {
  assert.equal(humanizeProviderError("all good"), null);
  assert.equal(humanizeProviderError(""), null);
});

it("isProviderError: detects an error message that only carries errorMessage", () => {
  assert.equal(
    isProviderError({
      role: "assistant",
      stopReason: "error",
      content: [],
      errorMessage: OLLAMA_404,
    }),
    true,
  );
});

it("cleanProviderError: replaces empty content + errorMessage with the friendly message", () => {
  const out = cleanProviderError({
    role: "assistant",
    stopReason: "error",
    content: [],
    errorMessage: OLLAMA_404,
  });
  assert.ok(out);
  assert.equal(out.content.length, 1);
  assert.match(out.content[0].text, /qwen2\.5-coder:7b/);
  assert.match(out.content[0].text, /not found/);
  assert.notMatch(out.content[0].text, /ollama/);
  assert.notMatch(out.content[0].text, /not_found_error/);
});

it("cleanProviderError: replaces raw payload content with the friendly message", () => {
  const out = cleanProviderError({
    role: "assistant",
    stopReason: "error",
    content: [{ type: "text", text: OLLAMA_404 }],
    errorMessage: OLLAMA_404,
  });
  assert.ok(out);
  assert.equal(out.content.length, 1);
  assert.match(out.content[0].text, /not found on the provider/);
  assert.notMatch(out.content[0].text, /404:/);
  assert.notMatch(out.content[0].text, /not_found_error/);
});

it("cleanProviderError: returns null when no humanized text is available", () => {
  assert.equal(cleanProviderError({ role: "assistant", stopReason: "error", content: [] }), null);
  assert.equal(cleanProviderError({ role: "assistant", stopReason: "error" }), null);
  assert.equal(cleanProviderError(undefined), null);
  assert.equal(
    cleanProviderError({ role: "assistant", stopReason: "stop", content: [] }),
    null,
  );
});
