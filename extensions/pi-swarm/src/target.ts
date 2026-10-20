import type { AgentType } from "./agents.ts";

export type TargetId = "build" | "plan" | (string & {});

export interface TargetSelector {
  current(): TargetId;
  cycle(): TargetId;
  cycleList(): readonly TargetId[];
  matchesAgent(id: TargetId): AgentType | undefined;
  set(id: TargetId): TargetId;
}

export function createTargetSelector(opts: { agents: readonly AgentType[]; planAvailable: boolean }): TargetSelector {
  const list: TargetId[] = ["build"];
  if (opts.planAvailable) list.push("plan");
  for (const a of opts.agents) list.push(a.name);
  const byName = new Map(opts.agents.map((a) => [a.name, a]));
  let index = 0;
  return {
    current(): TargetId {
      return list[index];
    },
    cycle(): TargetId {
      index = (index + 1) % list.length;
      return list[index];
    },
    cycleList(): readonly TargetId[] {
      return list;
    },
    matchesAgent(id: TargetId): AgentType | undefined {
      if (id === "build" || id === "plan") return undefined;
      return byName.get(id);
    },
    set(id: TargetId): TargetId {
      const i = list.indexOf(id);
      if (i !== -1) index = i;
      return list[index];
    },
  };
}
