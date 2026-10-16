import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Message } from "@earendil-works/pi-ai";

// Resolve the hoisted pi-coding-agent dist (root node_modules) by walking up,
// so the test layout does not depend on a hard-coded relative depth.
const requireFromHere = createRequire(import.meta.url);
const walkUpForDist = (start: string): string | undefined => {
  let dir = start;
  for (let i = 0; i < 12; i++) {
    const candidate = join(
      dir,
      "node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js",
    );
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
};

const distPath =
  walkUpForDist(dirname(new URL(import.meta.url).pathname)) ??
  requireFromHere.resolve(
    "@earendil-works/pi-coding-agent/dist/core/session-manager.js",
  );

const { buildSessionContext, loadEntriesFromFile } = await import(distPath);

export interface LoadedSession {
  messageCount: number;
  skippedCount: number;
  messages: Message[];
}

export const loadSessionMessages = (file: string): LoadedSession => {
  const entries = loadEntriesFromFile(file);
  const sessionEntries = (entries as any[]).filter((entry: any) => entry.type !== "header");
  const context = buildSessionContext(sessionEntries as any);
  const messages = (context.messages as any[]).filter(
    (msg): msg is Message =>
      msg && typeof msg.role === "string" && "content" in msg,
  );
  return {
    messageCount: messages.length,
    skippedCount: context.messages.length - messages.length,
    messages,
  };
};
