import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectPythonRunner,
  extractMarkdown,
  resetPythonRunnerDetection,
  type PythonRunner,
} from "../src/webfetch/extract.ts";
import { mkdtempSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface FakeRunnerFixture {
  runner: PythonRunner;
  dir: string;
  cleanup: () => void;
}

/**
 * A controlled PATH dir that holds the fake binaries plus the real `cat` and
 * `sleep` utilities the fake scripts use. `runWithDir` sets PATH to exactly
 * this dir — replacing the system PATH — so the real uv/uvx/pipx/pip-run are
 * hidden and detection sees only the fakes.
 */
let sharedControlDir: string | null = null;

function controlDir(): string {
  if (sharedControlDir) return sharedControlDir;
  const dir = mkdtempSync(join(tmpdir(), "webfetch-control-"));
  for (const util of ["cat", "sleep"]) {
    const real = execFileSync("/bin/sh", ["-c", `command -v ${util}`], {
      encoding: "utf8",
    }).trim();
    cpSync(real, join(dir, util));
  }
  sharedControlDir = dir;
  return dir;
}

/** Create a bare-named executable in the control dir (for `commandExists`). */
function controlExecutable(name: string, scriptBody = "exit 0"): string {
  const dir = controlDir();
  const scriptPath = join(dir, name);
  writeFileSync(scriptPath, `#!/bin/sh\n${scriptBody}\n`, { mode: 0o755 });
  return scriptPath;
}

function makeFakeRunner(name: string, scriptBody: string): FakeRunnerFixture {
  const dir = controlDir();
  const scriptPath = join(dir, name);
  writeFileSync(scriptPath, `#!/bin/sh\n${scriptBody}\n`, { mode: 0o755 });
  // command is the absolute script path (how a detected runner is used);
  // spawn uses it directly so PATH doesn't matter at extraction time.
  return {
    runner: {
      command: scriptPath,
      args: ["--markdown", "--formatting"],
      label: `fake-${name}`,
      cacheDir: () => dir,
    },
    dir,
    cleanup: () => rmSync(scriptPath, { force: true }),
  };
}

function runWithDir(
  dir: string,
  fn: () => void | Promise<unknown>,
): Promise<void> {
  const previous = process.env.PATH;
  process.env.PATH = dir;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      process.env.PATH = previous;
    }) as Promise<void>;
}

beforeEach(() => {
  resetPythonRunnerDetection();
});

afterEach(() => {
  if (sharedControlDir) {
    rmSync(sharedControlDir, { recursive: true, force: true });
    sharedControlDir = null;
  }
});

describe("detectPythonRunner", () => {
  it("prefers a runner whose cache already exists", async () => {
    // given: bare uvx + pipx executables in the control dir; uvx has a cache
    const dir = controlDir();
    controlExecutable("uvx");
    controlExecutable("pipx");
    const cacheDir = mkdtempSync(join(dir, "uvx-cache-"));
    const uvx: PythonRunner = {
      command: "uvx",
      args: ["--markdown"],
      label: "uvx (uv)",
      cacheDir: () => cacheDir,
    };
    const pipx: PythonRunner = {
      command: "pipx",
      args: ["run", "trafilatura"],
      label: "pipx",
      cacheDir: () => undefined,
    };

    // when: PATH points only at the control dir so only the fakes resolve
    let detected: PythonRunner | null = null;
    await runWithDir(dir, () => {
      resetPythonRunnerDetection();
      detected = detectPythonRunner([uvx, pipx]);
    });

    // then: the cached uvx wins over the uncached pipx
    expect((detected as PythonRunner | null)?.command).toBe("uvx");

    rmSync(cacheDir, { recursive: true, force: true });
  });

  it("returns the first present binary when no cache exists", async () => {
    // given: bare uvx + pipx executables, neither with a cache
    const dir = controlDir();
    controlExecutable("uvx");
    controlExecutable("pipx");
    const uvx: PythonRunner = {
      command: "uvx",
      args: ["--markdown"],
      label: "uvx (uv)",
      cacheDir: () => undefined,
    };
    const pipx: PythonRunner = {
      command: "pipx",
      args: ["run", "trafilatura"],
      label: "pipx",
      cacheDir: () => undefined,
    };

    // when
    let detected: PythonRunner | null = null;
    await runWithDir(dir, () => {
      resetPythonRunnerDetection();
      detected = detectPythonRunner([uvx, pipx]);
    });

    // then: uvx comes first in priority order
    expect((detected as PythonRunner | null)?.command).toBe("uvx");
  });
});

describe("extractMarkdown", () => {
  it("resolves with the runner stdout", async () => {
    // given: a runner that echoes the markdown it would produce
    const fixture = makeFakeRunner("uvx", "echo 'extracted markdown'");

    // when
    let markdown = "";
    await runWithDir(fixture.dir, () => {
      return extractMarkdown("<p>hello world</p>", fixture.runner).then((md) => {
        markdown = md;
      });
    });

    // then
    expect(markdown).toBe("extracted markdown");

    fixture.cleanup();
  });

  it("rejects when trafilatura extracts no content", async () => {
    // given: runner exits 0 with empty stdout
    const fixture = makeFakeRunner("uvx", "exit 0");

    // when
    let error: Error | undefined;
    await runWithDir(fixture.dir, () => {
      return extractMarkdown("<html></html>", fixture.runner).catch((e: Error) => {
        error = e;
      });
    });

    // then
    expect(error?.message).toMatch(/no content/i);

    fixture.cleanup();
  });

  it("rejects with the exit code and stderr when the runner fails", async () => {
    // given: runner exits 3 with a stderr message
    const fixture = makeFakeRunner("uvx", "echo 'boom' >&2; exit 3");

    // when
    let error: Error | undefined;
    await runWithDir(fixture.dir, () => {
      return extractMarkdown("<p>x</p>", fixture.runner).catch((e: Error) => {
        error = e;
      });
    });

    // then
    expect(error?.message).toMatch(/exit code 3/);
    expect(error?.message).toMatch(/boom/);

    fixture.cleanup();
  });

  it("rejects when the runner binary does not exist", async () => {
    // given: a runner command that does not exist
    const missing: PythonRunner = {
      command: join(tmpdir(), "webfetch-does-not-exist-uvgate"),
      args: [],
      label: "missing",
      cacheDir: () => undefined,
    };

    // when/then
    await expect(extractMarkdown("<p>x</p>", missing)).rejects.toThrow(
      /Failed to run/,
    );
  });
});

describe("extraction timeout", () => {
  it("rejects when the runner hangs past the 30s extraction timeout", async () => {
    // given: a runner that consumes stdin (blocking, like a real runner) then
    // sleeps 35s — past the 30s EXTRACT_TIMEOUT_MS. Runs under the system PATH
    // so `cat`/`sleep` resolve normally; the runner is passed by absolute path
    // so PATH is irrelevant to extraction.
    const fixture = makeFakeRunner("uvx", "cat > /dev/null; sleep 35");

    // when
    const started = Date.now();
    let error: Error | undefined;
    await extractMarkdown("<p>x</p>", fixture.runner).catch((e: Error) => {
      error = e;
    });

    // then: rejected within the 30s window, not at 35s
    expect(error?.message).toMatch(/timed out after 30s/);
    expect(Date.now() - started).toBeLessThan(32_000);

    fixture.cleanup();
  }, 40_000);
});
