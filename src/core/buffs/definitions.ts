import type { BuffId } from "../registry/ids";
import type { BuffDefinition } from "./types";

/** 0.1 六个基础 Buff（docs/03 §2 / buffs README）。 */
export const BUFF_DEFINITIONS: Readonly<Record<BuffId, BuffDefinition>> = {
  strength: { id: "strength", stacking: "stack", decayAt: "none", applyAs: "stacks" },
  // Q1：易伤 / 虚弱的层数 = 剩余回合数
  vulnerable: { id: "vulnerable", stacking: "refreshOnly", decayAt: "turnStart", applyAs: "turns" },
  weak: { id: "weak", stacking: "refreshOnly", decayAt: "turnStart", applyAs: "turns" },
  regeneration: {
    id: "regeneration",
    stacking: "stackAndRefresh",
    decayAt: "turnStart",
    applyAs: "stacksAndTurns",
    defaultDuration: 3,
  },
  pollution: { id: "pollution", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 100 },
  // 反伤：strength 型不便表达"伤害 + 剩余回合"，用 stacksAndTurns（参数=反伤值，默认 2 回合）
  thorns: { id: "thorns", stacking: "refreshOnly", decayAt: "turnStart", applyAs: "stacksAndTurns", defaultDuration: 2 },
  block: { id: "block", stacking: "stack", decayAt: "none", applyAs: "stacks", resource: true },
};

export function buffDefinition(id: BuffId): BuffDefinition {
  return BUFF_DEFINITIONS[id];
}
