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
  const remainder = nl === -1 ? buffer : buffer.slice(nl + 1);
  const head = nl === -1 ? "" : buffer.slice(0, nl + 1);
  for (const line of head.split("\n")) {
    const event = decodeJsonlLine(line);
    if (event !== undefined) events.push(event);
  }
  return { events, remainder };
}
