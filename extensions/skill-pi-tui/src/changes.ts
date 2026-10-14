import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const CHANGE_STATUS = {
  MODIFIED: "modified",
  ADDED: "added",
  DELETED: "deleted",
  RENAMED: "renamed",
  UNTRACKED: "untracked",
} as const;

export type ChangeStatus = (typeof CHANGE_STATUS)[keyof typeof CHANGE_STATUS];

export interface ChangedFile {
  path: string;
  added: number;
  deleted: number;
  status: ChangeStatus;
}

export interface ChangesModel {
  files: ChangedFile[];
  added: number;
  deleted: number;
  notice?: string;
}

interface NumstatEntry {
  path: string;
  added: number;
  deleted: number;
}

const STATUS_BY_CODE: Record<string, ChangeStatus> = {
  A: CHANGE_STATUS.ADDED,
  D: CHANGE_STATUS.DELETED,
  R: CHANGE_STATUS.RENAMED,
  C: CHANGE_STATUS.ADDED,
  "?": CHANGE_STATUS.UNTRACKED,
  M: CHANGE_STATUS.MODIFIED,
};
const RENAME_BRACES = /\{([^{}]*) => ([^{}]*)\}/g;
const HAS_RENAME_BRACES = /\{[^{}]* => [^{}]*\}/;
const RENAME_ARROW = " => ";

export function emptyChanges(): ChangesModel {
  return { files: [], added: 0, deleted: 0 };
}

function renamedPath(path: string): string {
  if (HAS_RENAME_BRACES.test(path)) return path.replace(RENAME_BRACES, "$2").replace(/\/\//g, "/");
  const arrow = path.indexOf(RENAME_ARROW);
  return arrow === -1 ? path : path.slice(arrow + RENAME_ARROW.length);
}

function count(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseNumstat(text: string): NumstatEntry[] {
  const entries: NumstatEntry[] = [];
  for (const line of text.split("\n")) {
    const [added, deleted, ...rest] = line.split("\t");
    if (added === undefined || deleted === undefined || rest.length === 0) continue;
    entries.push({ path: renamedPath(rest.join("\t")), added: count(added), deleted: count(deleted) });
  }
  return entries;
}

export function parsePorcelain(text: string): Map<string, ChangeStatus> {
  const statuses = new Map<string, ChangeStatus>();
  const records = text.split("\0").filter((record) => record.length > 0);
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const code = record.slice(0, 2);
    const path = record.slice(3);
    if (!path.endsWith("/") && !path.startsWith(".skillgrid/")) statuses.set(path, STATUS_BY_CODE[code[0]] ?? STATUS_BY_CODE[code[1]] ?? CHANGE_STATUS.MODIFIED);
    if (code[0] === "R" || code[0] === "C") index += 1;
  }
  return statuses;
}

export function snapshotChanges(snapshot: { numstat: string; porcelain: string }): ChangedFile[] {
  const counts = new Map(parseNumstat(snapshot.numstat).map((entry) => [entry.path, entry]));
  const files: ChangedFile[] = [];
  for (const [path, status] of parsePorcelain(snapshot.porcelain)) {
    const entry = counts.get(path);
    files.push({ path, added: entry?.added ?? 0, deleted: entry?.deleted ?? 0, status });
  }
  return files;
}

export function changesModel(changed: ChangedFile[]): ChangesModel {
  const files = [...changed].sort((a, b) => a.path.localeCompare(b.path));
  return {
    files,
    added: files.reduce((total, file) => total + file.added, 0),
    deleted: files.reduce((total, file) => total + file.deleted, 0),
  };
}

function runGit(cwd: string, args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      { cwd, maxBuffer: 1024 * 1024, env: { ...process.env, GIT_TEMPLATE_DIR: "/nonexistent" } },
      (error, stdout) => {
        resolve({ stdout: error ? "" : String(stdout), code: error ? (error as { code?: number }).code ?? 1 : 0 });
      },
    );
  });
}

async function untrackedLines(cwd: string, path: string): Promise<number> {
  try {
    const text = await readFile(join(cwd, path), "utf8");
    return text.split("\n").filter((line) => line !== "" || text.length === 1).length;
  } catch {
    return 0;
  }
}

export async function captureChanges(cwd: string): Promise<ChangesModel> {
  let porcelain: { stdout: string; code: number };
  let numstat: { stdout: string; code: number };
  try {
    [porcelain, numstat] = await Promise.all([
      runGit(cwd, ["status", "--porcelain=v1", "--untracked-files=all", "-z"]),
      runGit(cwd, ["diff", "--numstat", "HEAD"]),
    ]);
  } catch {
    return emptyChanges();
  }
  if (porcelain.code !== 0) return { ...emptyChanges(), notice: "(not a git repo)" };
  const files = snapshotChanges({ numstat: numstat.stdout, porcelain: porcelain.stdout });
  await Promise.all(
    files
      .filter((file) => file.status === CHANGE_STATUS.UNTRACKED)
      .map(async (file) => {
        file.added = await untrackedLines(cwd, file.path);
      }),
  );
  return changesModel(files);
}
