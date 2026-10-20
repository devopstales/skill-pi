import { describe, it, expect } from "vitest";
import type { ChildProcess, ChildProcessWithoutNullStreams, SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChildInvocation, resolveSkillPiExe, SwarmChild, type SpawnFn } from "./child.ts";
import { ERROR_TEXT_BUDGET } from "./domain.ts";

const REAL_EXE = join(fileURLToPath(import.meta.url), "..", "..", "..", "..", "bin", "skill-pi.js");

interface FakeChild {
  child: ChildProcessWithoutNullStreams;
  spawn: SpawnFn & {
    capturedCwd?: string;
    capturedEnv?: NodeJS.ProcessEnv;
    stdin: PassThrough;
  };
}

const CLOSE_DELAY_MS = 5;

function makeFakeChild(
  lines: string[],
  closeCode?: number,
  kill?: (signal?: string) => void,
): FakeChild & { emitLine: (line: string) => void; emitClose: (code: number | null, signal: NodeJS.Signals | null) => void } {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const written: Buffer[] = [];
  fakeStdins.set(stdin, written);
  stdin.write = ((chunk: Buffer, cb?: () => void) => {
    written.push(Buffer.from(chunk));
    cb?.();
    return true;
  }) as PassThrough["write"];
  child.stdout = stdout;
  child.stdin = stdin;
  child.stderr = new PassThrough();
  let killed = false;
  const emitClose = (code: number | null, signal: NodeJS.Signals | null) => {
    if (!child.listenerCount("close")) {
      queueMicrotask(() => emitClose(code, signal));
      return;
    }
    child.emit("close", code, signal);
  };
  child.kill = ((signal?: string) => {
    if (killed) return true;
    killed = true;
    kill?.(signal);
    // A real killed process emits close with the signal.
    queueMicrotask(() => emitClose(null, (signal as NodeJS.Signals) ?? "SIGKILL"));
    return true;
  }) as ChildProcess["kill"];
  const emitLine = (line: string) => {
    stdout.emit("data", Buffer.from(line + "\n"));
  };
  for (const line of lines) {
    setTimeout(() => emitLine(line), 0);
  }
  if (closeCode !== undefined) {
    setTimeout(() => emitClose(closeCode, null), CLOSE_DELAY_MS);
  }
  let capturedCwd: string | undefined;
  let capturedEnv: NodeJS.ProcessEnv | undefined;
  const spawn = ((_command: string, _args: string[], options: SpawnOptions) => {
    capturedCwd = typeof options.cwd === "string" ? options.cwd : options.cwd?.toString();
    capturedEnv = options.env as NodeJS.ProcessEnv;
    return child;
  }) as FakeChild["spawn"];
  Object.defineProperty(spawn, "capturedCwd", { get: () => capturedCwd });
  Object.defineProperty(spawn, "capturedEnv", { get: () => capturedEnv });
  Object.defineProperty(spawn, "stdin", { get: () => stdin });
  return { child, spawn, emitLine, emitClose };
}

const fakeStdins = new WeakMap<PassThrough, Buffer[]>();
function stdinText(stdin: PassThrough): string {
  const chunks = fakeStdins.get(stdin) ?? [];
  return Buffer.concat(chunks).toString();
}

function settleOf(child: SwarmChild): Promise<void> {
  return new Promise((resolve) => {
    const isSettled = (status: string) => status === "done" || status === "error" || status === "interrupted";
    if (isSettled(child.snapshot.status)) {
      resolve();
      return;
    }
    const stop = child.onSnapshot((s) => {
      if (isSettled(s.status)) {
        stop();
        resolve();
      }
    });
  });
}

function invocation() {
  return buildChildInvocation("/proj", "/agent");
}

describe("buildChildInvocation", () => {
  it("argv is [skill-pi-exe, --mode, rpc, cwd] with the real resolved exe", () => {
    const exe = resolveSkillPiExe();
    const { argv } = buildChildInvocation("/proj", "/agent");
    expect(argv).toEqual([exe, "--mode", "rpc", "/proj"]);
    expect(argv[0]).toBe(REAL_EXE);
  });

  it("env has PI_CODING_AGENT_DIR set and no PI_PACKAGE_DIR key", () => {
    const { env } = buildChildInvocation("/proj", "/agent");
    expect(env.PI_CODING_AGENT_DIR).toBe("/agent");
    expect("PI_PACKAGE_DIR" in env).toBe(false);
  });

  it("spawn cwd equals buildChildInvocation cwd", async () => {
    const cwd = "/proj-same";
    const { spawn } = makeFakeChild(['{"type":"agent_start"}']);
    await SwarmChild.spawn(buildChildInvocation(cwd, "/agent"), cwd, spawn);
    expect(spawn.capturedCwd).toBe(cwd);
  });
});

describe("SwarmChild event fold", () => {
  it("settles done: finalText, turns >= 1, latestText, assistant transcript", async () => {
    const { spawn } = makeFakeChild([
      '{"type":"agent_start"}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"hello"}]}}',
      '{"type":"agent_settled","aborted":false}',
    ]);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    await settleOf(child);
    expect(child.snapshot.status).toBe("done");
    expect(child.snapshot.finalText).toBe("hello");
    expect(child.snapshot.turns).toBeGreaterThanOrEqual(1);
    expect(child.snapshot.latestText).toBe("hello");
    expect(child.snapshot.transcript).toEqual([{ kind: "assistant", text: "hello" }]);
  });

  it("treats agent_end as non-terminal in rpc mode: running resumes until agent_settled, then done", async () => {
    const { spawn, emitLine } = makeFakeChild(['{"type":"agent_start"}']);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    await new Promise((r) => setTimeout(r, 10));
    emitLine('{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"x"}]}}');
    emitLine('{"type":"agent_end"}');
    await new Promise((r) => setTimeout(r, 10));
    expect(child.snapshot.status).toBe("running");
    emitLine('{"type":"agent_settled","aborted":false}');
    await settleOf(child);
    expect(child.snapshot.status).toBe("done");
  });

  it("agent_settled interrupted refines an agent_end settle into interrupted", async () => {
    const { spawn, emitLine } = makeFakeChild(['{"type":"agent_start"}']);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    await new Promise((r) => setTimeout(r, 10));
    emitLine('{"type":"agent_end"}');
    await new Promise((r) => setTimeout(r, 10));
    emitLine('{"type":"agent_settled","aborted":true}');
    await settleOf(child);
    expect(child.snapshot.status).toBe("interrupted");
  });

  it("observes running state before settling done", async () => {
    const { spawn } = makeFakeChild([
      '{"type":"agent_start"}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"x"}]}}',
      '{"type":"agent_settled","aborted":false}',
    ]);
    const seen: string[] = [];
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    const stop = child.onSnapshot((s) => {
      seen.push(s.status);
      if (s.status === "done") stop();
    });
    await settleOf(child);
    expect(seen).toContain("running");
    expect(seen[seen.length - 1]).toBe("done");
    expect(seen.indexOf("running")).toBeLessThan(seen.indexOf("done"));
  });

  it("tool execution events append tool transcript lines", async () => {
    const { spawn } = makeFakeChild([
      '{"type":"agent_start"}',
      '{"type":"tool_execution_start","toolName":"bash","toolCallId":"t1","args":{"command":"ls"}}',
      '{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}',
      '{"type":"agent_settled","aborted":false}',
    ]);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    await settleOf(child);
    const toolLines = child.snapshot.transcript.filter((l) => l.kind === "tool");
    expect(toolLines.length).toBeGreaterThanOrEqual(1);
    expect(child.snapshot.transcript.some((l) => l.kind === "assistant")).toBe(true);
    expect(child.snapshot.status).toBe("done");
  });

  it("unknown event types are ignored without settling", async () => {
    const { spawn } = makeFakeChild(['{"type":"something_else","data":42}', '{"type":"agent_start"}']);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(child.snapshot.status).toBe("running");
  });

  it("garbage lines then exit 1 settle error with errorText bounded to ERROR_TEXT_BUDGET", async () => {
    const big = "x".repeat(ERROR_TEXT_BUDGET * 2);
    const { spawn } = makeFakeChild([`not json at all`, `{"broken":`, big], 1);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    await settleOf(child);
    expect(child.snapshot.status).toBe("error");
    expect(child.snapshot.errorText).toBeDefined();
    expect((child.snapshot.errorText ?? "").length).toBeLessThanOrEqual(ERROR_TEXT_BUDGET);
  });

  it("exit 0 without a terminal event settles done", async () => {
    const { spawn } = makeFakeChild(['{"type":"agent_start"}'], 0);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    await settleOf(child);
    expect(child.snapshot.status).toBe("done");
  });
});

describe("SwarmChild send/abort", () => {
  it("send while running writes a steer line to stdin", async () => {
    const { spawn } = makeFakeChild(['{"type":"agent_start"}']);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    child.send("turn left");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const written = stdinText(spawn.stdin);
    expect(written).toContain('"steer"');
    expect(written).toContain("turn left");
  });

  it("send after settle writes a follow_up line to stdin", async () => {
    const { spawn } = makeFakeChild(['{"type":"agent_start"}', '{"type":"agent_settled","aborted":false}']);
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    await settleOf(child);
    child.send("again");
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    const written = stdinText(spawn.stdin);
    expect(written).toContain('"follow_up"');
    expect(written).toContain("again");
  });

  it("abort writes an abort line and resolves via the kill path when the child ignores abort", async () => {
    let killSignal: string | undefined;
    const { spawn } = makeFakeChild(['{"type":"agent_start"}'], undefined, (signal) => {
      killSignal = signal;
    });
    const child = await SwarmChild.spawn(invocation(), "/proj", spawn);
    const abortPromise = child.abort();
    await new Promise<void>((resolve) => setTimeout(resolve, 20));
    expect(killSignal).toBeUndefined();
    expect(stdinText(spawn.stdin)).toContain('"abort"');
    child.kill("SIGKILL");
    await abortPromise;
    expect(killSignal).toBe("SIGKILL");
    expect(child.snapshot.status).toBe("interrupted");
  });
});
