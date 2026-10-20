import { mkdir, mkdtemp, copyFile, chmod, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { buildCompactReport } from "../../src/core/report";
import { loadSessionMessages } from "./load-session";

const SESSION_ROOT = join(getAgentDir(), "sessions");
const MAX_PROBE_CANDIDATES = 50;

const yieldsProbe = (file: string): boolean => {
  try {
    const { messages } = loadSessionMessages(file);
    return buildCompactReport({ messages }).recall.probes.length > 0;
  } catch {
    return false;
  }
};

export interface SessionSample {
  source: string;
  copy: string;
  size: number;
  mtimeMs: number;
}

const walk = async (dir: string): Promise<string[]> => {
  const names = await readdir(dir, { withFileTypes: true });
  const out: string[] = [];
  for (const name of names) {
    const path = join(dir, name.name);
    if (name.isDirectory()) out.push(...await walk(path));
    else if (name.isFile() && path.endsWith(".jsonl")) out.push(path);
  }
  return out;
};

export const prepareSessionSamples = async (limit = 2): Promise<SessionSample[]> => {
  const files = await walk(SESSION_ROOT);
  const sized = await Promise.all(
    files.map(async (file) => ({ file, size: (await stat(file)).size })),
  );
  // Largest-by-bytes is not the same as a large session: the biggest file can
  // be a tiny session inflated by one blob, yielding zero recall probes.
  // Keep the size order but skip candidates that would produce no probes.
  const ordered = sized
    .sort((a, b) => b.size - a.size)
    .slice(0, MAX_PROBE_CANDIDATES);
  const selected: string[] = [];
  for (const { file } of ordered) {
    if (yieldsProbe(file)) {
      selected.push(file);
      if (selected.length === limit) break;
    }
  }
  if (selected.length === 0) selected.push(...ordered.slice(0, limit).map((x) => x.file));
  const dir = await mkdtemp(join(tmpdir(), "pi-vcc-sessions-"));
  await mkdir(dir, { recursive: true });
  const samples: SessionSample[] = [];
  for (const source of selected) {
    const srcStat = await stat(source);
    const copy = join(dir, basename(source));
    await copyFile(source, copy);
    await chmod(copy, 0o444);
    samples.push({ source, copy, size: srcStat.size, mtimeMs: srcStat.mtimeMs });
  }
  return samples;
};

export const readSourceStat = async (sample: SessionSample) => {
  const s = await stat(sample.source);
  return { size: s.size, mtimeMs: s.mtimeMs };
};
