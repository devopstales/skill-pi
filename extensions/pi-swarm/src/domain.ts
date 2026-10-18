export const MAX_RUNNING = 4;
export const MAX_TRACKED = 64;
export const ABORT_TIMEOUT_MS = 5000;
export const RESULT_BUDGET = 24 * 1024;
export const WAIT_BUDGET_TOTAL = 48 * 1024;
export const WAIT_BUDGET_PER_AGENT = 16 * 1024;
export const CHECK_BUDGET = 2 * 1024;
export const CHECK_MAX_LINES = 20;
export const ERROR_TEXT_BUDGET = 4 * 1024;
export const PROTOCOL_VERSION = 1;
export const RESULT_CUSTOM_TYPE = "swarm-result";

export type SwarmStatus = "queued" | "running" | "done" | "error" | "interrupted";

export interface AgentSnapshot {
  id: string;
  title: string;
  agentType: string;
  status: SwarmStatus;
  createdAt: number;
  settledAt?: number;
  errorText?: string;
  modelLabel?: string;
  turns: number;
  tokens: number;
  finalText: string;
  latestText: string;
  consumed: boolean;
  transcript: readonly TranscriptLine[];
}

export interface TranscriptLine {
  kind: "user" | "assistant" | "tool" | "error";
  text: string;
}

export interface SpawnRequest {
  prompt: string;
  title?: string;
  agentType?: string;
  model?: string;
  inheritContext?: boolean;
}

export interface SwarmChildHandle {
  readonly id: string;
  readonly snapshot: AgentSnapshot;
  send(text: string): void;
  abort(): Promise<void>;
  onSnapshot(listener: (s: AgentSnapshot) => void): () => void;
}
