import type { BuffId } from "../registry/ids";
import type { BuffDefinition } from "./types";

/** 0.1 六个基础 Buff（docs/03 §2 / buffs README）。 */
export const BUFF_DEFINITIONS: Readonly<Record<BuffId, BuffDefinition>> = {
  strength: { id: "strength", stacking: "stack", decayAt: "none", applyAs: "stacks" },
  // docs/46 §2.1：虚弱的层数 = 强度（每层造伤 −10%），不再按回合衰减；上限 5 层。
  weak: { id: "weak", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 5 },
  // docs/46 §2.2：胆怯（旧「易伤」合并案）：每层承伤 +10%，上限 5 层。
  timid: { id: "timid", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 5 },
  // docs/46 §2.3：荆棘（旧「反伤」合并案）：每层反弹 3 点固定伤害，上限 5 层。
  bramble: { id: "bramble", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 5 },
  // docs/46 §3.4：坚韧：每层回合开始 +3 维续格挡（总上限 25，见 resolveTenacity）。
  tenacity: { id: "tenacity", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 3 },
  regeneration: {
    id: "regeneration",
    stacking: "stackAndRefresh",
    decayAt: "turnStart",
    applyAs: "stacksAndTurns",
    defaultDuration: 3,
  },
  pollution: { id: "pollution", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 100 },
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
  // 冰缓（docs/46 §3.7）：层数 = 剩余回合。手动结算（resolveCurses），不进泛用 tick。
  chill: { id: "chill", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 3 },
  // 颠倒（docs/46 §3.8）：同上，上限 2 层。
  reverse: { id: "reverse", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 2 },
  // 眩晕（docs/46 §3.5）：不可叠加、持续中重复施加无效（refreshOnly 取较大值 = 恒为 1）。
  stun: { id: "stun", stacking: "refreshOnly", decayAt: "none", applyAs: "stacks", maxStacks: 1 },
  // 灼烧（docs/46 §3.9）：层级型，每层每回合 −1 生命上限，战斗结束恢复。
  burn: { id: "burn", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 5 },
  // 回血印记（调血）：一次性延迟回血。stacks = 回血量。
  // decayAt 设为 none —— 由 resolveMending 在【玩家回合开始】结算并立即移除，
  // 交给泛用 tick 会在结算前就把 duration 扣到 0 而白掉。
  mending: {
    id: "mending",
    stacking: "refreshOnly",
    decayAt: "none",
    applyAs: "stacksAndTurns",
    defaultDuration: 1,
  },
};

export function buffDefinition(id: BuffId): BuffDefinition {
  return BUFF_DEFINITIONS[id];
}
