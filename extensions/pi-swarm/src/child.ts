import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeJsonlBuffer } from "./jsonl.ts";
import { ERROR_TEXT_BUDGET, type AgentSnapshot, type SwarmStatus, type TranscriptLine } from "./domain.ts";

export type SpawnFn = (command: string, args: string[], options: SpawnOptions) => ChildProcess;

function findSkillPiExe(fromDir: string): string | undefined {
  let dir = fromDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "bin", "skill-pi.js");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function skillPiExe(): string {
  const found = findSkillPiExe(dirname(fileURLToPath(import.meta.url)));
  if (found) return found;
  const argv1 = process.argv[1];
  if (argv1 && argv1.endsWith("skill-pi.js")) return resolve(argv1);
  throw new Error(
    `skill-pi executable not found walking up from ${fileURLToPath(import.meta.url)} (and process.argv[1] is not a skill-pi.js)`,
  );
}

export function buildChildInvocation(cwd: string, agentDir: string): { argv: string[]; env: NodeJS.ProcessEnv } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.PI_PACKAGE_DIR;
  env.PI_CODING_AGENT_DIR = agentDir;
  return { argv: [skillPiExe(), "--mode", "rpc", cwd], env };
}

interface ChildState {
  status: SwarmStatus;
  turns: number;
  finalText: string;
  latestText: string;
  errorText?: string;
  transcript: TranscriptLine[];
  settledAt?: number;
}

function textOf(message: unknown): string {
  const content = (message as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: string; text: string } => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text")
    .map((part) => part.text)
    .join("");
}


export class SwarmChild {
  readonly id: string;
  private readonly child: ChildProcess;
  private readonly listeners = new Set<(s: AgentSnapshot) => void>();
  private abortResolvers: Array<() => void> = [];
  private abortRequested = false;
  private settleResolve: (() => void) | undefined;
  readonly settled: Promise<void>;
  private buffer = "";
  private stderr = "";
  private state: ChildState;

  private constructor(child: ChildProcess, id: string, state: ChildState) {
    this.child = child;
    this.id = id;
    this.state = state;
    this.settled = new Promise((resolve) => {
      this.settleResolve = resolve;
    });
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.onData(chunk));
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      this.stderr += chunk;
      if (this.stderr.length > ERROR_TEXT_BUDGET * 2) this.stderr = this.stderr.slice(-ERROR_TEXT_BUDGET);
    });
    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => this.onClose(code, signal));
    child.on("error", (err: Error) => this.onProcessError(err));
    child.stdin?.on("error", () => {});
  }

  static spawn(
    invocation: { argv: string[]; env: NodeJS.ProcessEnv },
    cwd: string,
    spawnFn?: SpawnFn,
  ): Promise<SwarmChild> {
    const [command, ...args] = invocation.argv;
    const child = (spawnFn ?? nodeSpawn)(command, args, {
      cwd,
      env: invocation.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const childInstance = new SwarmChild(child, `sa-${child.pid ?? "unknown"}`, {
      status: "running",
      turns: 0,
      finalText: "",
      latestText: "",
      transcript: [],
    });
    return Promise.resolve(childInstance);
  }

  get snapshot(): AgentSnapshot {
    return {
      id: this.id,
      title: "",
      agentType: "",
      status: this.state.status,
      createdAt: 0,
      settledAt: this.state.settledAt,
      errorText: this.state.errorText,
      turns: this.state.turns,
      tokens: 0,
      finalText: this.state.finalText,
      latestText: this.state.latestText,
      consumed: false,
      transcript: this.state.transcript,
    };
  }

  send(text: string): void {
    const type = this.state.status === "running" ? "steer" : "follow_up";
    this.write({ type, message: text });
  }

  abort(): Promise<void> {
    this.abortRequested = true;
    if (this.state.status === "done" || this.state.status === "error" || this.state.status === "interrupted") {
      return Promise.resolve();
    }
    this.write({ type: "abort" });
    return this.settled;
  }

  kill(signal: NodeJS.Signals = "SIGKILL"): boolean {
    return this.child.kill(signal);
  }

  onSnapshot(listener: (s: AgentSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private write(command: Record<string, unknown>): void {
    if (this.child.stdin?.writable) {
      this.child.stdin.write(JSON.stringify(command) + "\n");
    }
  }

  private onData(chunk: string): void {
    const { events, remainder } = decodeJsonlBuffer(this.buffer + chunk);
    this.buffer = remainder;
    for (const raw of events) {
      if (typeof raw !== "object" || raw === null || !("type" in (raw as Record<string, unknown>))) continue;
      const event = raw as { type: string; [key: string]: unknown };
      this.fold(event);
    }
  }

  private fold(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case "agent_start":
        if (this.state.status === "running") this.notify();
        break;
      case "message_end": {
        const message = event.message as { role?: unknown; content?: unknown } | undefined;
        if (message?.role === "assistant") {
          const text = textOf(message);
          if (text !== "") {
            this.state.transcript.push({ kind: "assistant", text });
            this.state.latestText = text;
            this.state.finalText = text;
            this.state.turns += 1;
            this.notify();
          }
        }
        break;
      }
      case "tool_execution_start":
      case "tool_execution_update":
      case "tool_execution_end": {
        const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
        this.state.transcript.push({ kind: "tool", text: toolName });
        this.notify();
        break;
      }
      case "agent_settled":
        this.settle(event.aborted === true ? "interrupted" : "done");
        break;
      case "agent_end":
        // Non-terminal: pi emits agent_end at run end but stays alive in RPC
        // mode (aborts still follow it with agent_settled). settle() is
        // idempotent, so a later agent_settled can refine done -> interrupted.
        this.settle("done");
        this.state.status = "running";
        break;
      default:
        break;
    }
  }

  private onProcessError(err: Error): void {
    if (this.state.status === "done" || this.state.status === "error" || this.state.status === "interrupted") return;
    this.state.errorText = err.message;
    if (this.abortRequested) {
      this.settle("interrupted");
    } else {
      this.settle("error");
    }
  }

  private onClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.state.status === "done" || this.state.status === "error" || this.state.status === "interrupted") return;
    if (signal) {
      this.settle("interrupted");
      return;
    }
    if (this.abortRequested) {
      this.settle("interrupted");
      return;
    }
    if (code !== null && code !== 0) {
      this.state.errorText = this.collectErrorText(code);
      this.settle("error");
      return;
    }
    this.settle("done");
  }

  private collectErrorText(code: number): string {
    const parts: string[] = [];
    if (this.buffer.trim() !== "") parts.push(this.buffer.trim());
    if (this.stderr.trim() !== "") parts.push(this.stderr.trim());
    if (this.state.errorText) parts.push(this.state.errorText);
    parts.push(`process exited with code ${code}`);
    const joined = parts.join("\n");
    return joined.length > ERROR_TEXT_BUDGET ? joined.slice(0, ERROR_TEXT_BUDGET) : joined;
  }

  private settle(status: SwarmStatus): void {
    if (this.state.status === "done" || this.state.status === "error" || this.state.status === "interrupted") return;
    this.state.status = status;
    this.state.settledAt = Date.now();
    this.settleResolve?.();
    this.settleResolve = undefined;
    const resolvers = this.abortResolvers;
    this.abortResolvers = [];
    this.notify();
    for (const resolve of resolvers) resolve();
  }

  private notify(): void {
    const snapshot = this.snapshot;
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

export function resolveSkillPiExe(): string {
  return skillPiExe();
}
