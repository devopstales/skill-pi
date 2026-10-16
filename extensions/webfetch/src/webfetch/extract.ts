/**
 * Content extraction via trafilatura.
 *
 * trafilatura's HTML-to-markdown conversion runs in an ephemeral Python
 * environment, no permanent install required. A Python tool runner is
 * auto-detected in priority order:
 *
 *   1. uvx           — fastest, ships with uv
 *   2. uv run --with — fallback if the uvx alias is missing but uv is installed
 *   3. pipx run      — widely available, especially on Debian/Ubuntu
 *   4. pip-run       — niche fallback
 *
 * The first extraction downloads the trafilatura package (~10MB) into the
 * runner's cache; subsequent runs reuse it.
 *
 * Adapted from georgebashi/pi-web-fetch (MIT), which runs trafilatura behind
 * a headless-Chrome fetch stage; here it consumes the static HTTP body
 * directly.
 */
import { spawn } from "node:child_process";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const EXTRACT_TIMEOUT_MS = 30_000;

export interface PythonRunner {
  command: string;
  /** Arguments to build the full trafilatura invocation. */
  args: string[];
  label: string;
  /** Where the runner caches the ephemeral environment (for existence checks). */
  cacheDir: () => string | undefined;
}

const TRAFILATURA_ARGS = ["trafilatura", "--markdown", "--formatting"];

const PYTHON_RUNNERS: PythonRunner[] = [
  {
    command: "uvx",
    args: TRAFILATURA_ARGS,
    label: "uvx (uv)",
    cacheDir: () => uvCacheDir(),
  },
  {
    command: "uv",
    args: ["run", "--with", "trafilatura", ...TRAFILATURA_ARGS],
    label: "uv run",
    cacheDir: () => uvCacheDir(),
  },
  {
    command: "pipx",
    args: ["run", "trafilatura", ...TRAFILATURA_ARGS],
    label: "pipx",
    cacheDir: () => pipxHome(),
  },
  {
    command: "pip-run",
    args: ["trafilatura", "--", "-m", "trafilatura", ...TRAFILATURA_ARGS.slice(1)],
    label: "pip-run",
    cacheDir: () => undefined,
  },
];

function uvCacheDir(): string | undefined {
  const dir = process.env.UV_CACHE_DIR;
  if (dir) return dir;
  const home = process.env.HOME || process.env.USERPROFILE;
  return home ? join(home, ".cache", "uv") : undefined;
}

function pipxHome(): string | undefined {
  const dir = process.env.PIPX_HOME;
  if (dir) return dir;
  const home = process.env.HOME || process.env.USERPROFILE;
  return home ? join(home, ".local", "pipx") : undefined;
}

function commandExists(command: string): boolean {
  try {
    execFileSync(command, ["--version"], {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Find a usable Python tool runner. A runner is "usable" when its binary
 * exists and, where applicable, its cache already holds the trafilatura
 * environment — in which case extraction is instant with zero network.
 * Falls back to the first binary that exists (extraction will download
 * trafilatura on first use).
 */
export function detectPythonRunner(): PythonRunner | null {
  const present = PYTHON_RUNNERS.filter(
    (runner) => commandExists(runner.command),
  );
  const ready = present.find((runner) => {
    const dir = runner.cacheDir();
    return dir !== undefined && existsSync(dir);
  });
  return ready ?? present[0] ?? null;
}

/**
 * Extract clean markdown from an HTML document via trafilatura.
 * The HTML is piped to the runner's stdin; stdout is the markdown.
 */
export function extractMarkdown(
  html: string,
  runner: PythonRunner,
  signal?: AbortSignal,
): Promise<string> {
  if (signal?.aborted) return Promise.resolve("");
  return new Promise((resolve, reject) => {
    const proc = spawn(runner.command, runner.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const settle = (fn: () => void): void => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        fn();
      }
    };

    const onAbort = (): void => settle(() => reject(new Error("Aborted")));
    signal?.addEventListener("abort", onAbort, { once: true });

    const timer = setTimeout(() => {
      settle(() =>
        reject(
          new Error(
            `Trafilatura extraction timed out after ${EXTRACT_TIMEOUT_MS / 1000}s`,
          ),
        ),
      );
    }, EXTRACT_TIMEOUT_MS);

    proc.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    proc.on("error", (err) =>
      settle(() =>
        reject(
          new Error(
            `Failed to run ${runner.command} trafilatura: ${err.message}`,
          ),
        ),
      ),
    );
    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      settle(() => {
        if (code !== 0) {
          reject(
            new Error(
              `Trafilatura extraction failed (exit code ${code}): ${
                stderr.trim() || "(no error output)"
              }`,
            ),
          );
          return;
        }
        const markdown = stdout.trim();
        if (!markdown) {
          reject(
            new Error(
              "Trafilatura extracted no content from the page. The page may be empty or JavaScript-rendered — a static fetch cannot extract it.",
            ),
          );
          return;
        }
        resolve(markdown);
      });
    });

    proc.stdin.on("error", () => {
      // Broken stdin pipe (e.g. runner exited early) is handled by close.
    });
    proc.stdin.write(html);
    proc.stdin.end();
  });
}
