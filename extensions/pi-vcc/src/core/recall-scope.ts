export type RecallScope = "lineage" | "all";

const SCOPE_RE = /\bscope:(lineage|all)\b/i;

export const normalizeRecallScope = (scope?: unknown): RecallScope =>
  typeof scope === "string" && scope.toLowerCase() === "all" ? "all" : "lineage";

const EXPAND_REFS_RE = /\bexpandrefs\b/i;

export const parseRecallScope = (text: string): { scope: RecallScope; text: string; expandRefs: boolean } => {
  const match = text.match(SCOPE_RE);
  return {
    scope: normalizeRecallScope(match?.[1]),
    text: text.replace(SCOPE_RE, "").replace(EXPAND_REFS_RE, "").replace(/\s+/g, " ").trim(),
    expandRefs: EXPAND_REFS_RE.test(text),
  };
};
