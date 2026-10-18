/**
 * Shared constants of the payload parsers.
 */

/** Name of the deferred tool Pi declares for Anthropic's native tool changes; the model never sees it. */
export const DEFERRED_PLACEHOLDER_NAME = "__pi_deferred_placeholder__";

/** System block Pi puts before the prompt for an Anthropic OAuth token. */
export const CLAUDE_CODE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/** Message roles each API's serializer emits. */
export const COMPLETIONS_ROLES = new Set(["system", "developer", "user", "assistant", "tool"]);
export const ANTHROPIC_ROLES = new Set(["system", "user", "assistant"]);

/** APIs whose payloads the guard parses. */
export const SUPPORTED_APIS = ["openai-completions", "openai-responses", "anthropic-messages"] as const;
