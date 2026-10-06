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
  // 蚀锈（docs/38 §二 B-2）：计时型 DoT，stacks = 每回合伤害、duration = 剩余回合。
  // decayAt 设为 none —— 它由 resolveCorroding 在【敌方回合结束】手动结算并递减，
  // 交给泛用 tick 会被玩家回合的 turnEnd/turnStart 双重扣时。
  corroding: {
    id: "corroding",
    stacking: "stackAndRefresh",
    decayAt: "none",
    applyAs: "stacksAndTurns",
    defaultDuration: 2,
  },
};

export function buffDefinition(id: BuffId): BuffDefinition {
  return BUFF_DEFINITIONS[id];
}
