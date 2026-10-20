import { JSONL_BUFFER_MAX } from "./domain.ts";

export function decodeJsonlLine(line: string): unknown | undefined {
  const trimmed = line.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

export function decodeJsonlBuffer(buffer: string): { events: unknown[]; remainder: string } {
  const events: unknown[] = [];
  const nl = buffer.lastIndexOf("\n");
  let remainder = nl === -1 ? buffer : buffer.slice(nl + 1);
  if (remainder.length > JSONL_BUFFER_MAX) remainder = "";
  const head = nl === -1 ? "" : buffer.slice(0, nl + 1);
  for (const line of head.split("\n")) {
    const event = decodeJsonlLine(line);
    if (event !== undefined) events.push(event);
  }
  return { events, remainder };
}
