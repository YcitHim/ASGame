import type { BuffId } from "../registry/ids";
import type { BuffDefinition } from "./types";

/** 0.1 六个基础 Buff（docs/03 §2 / buffs README）。 */
export const BUFF_DEFINITIONS: Readonly<Record<BuffId, BuffDefinition>> = {
  strength: { id: "strength", polarity: "boon", stacking: "stack", decayAt: "none", applyAs: "stacks" },
  // docs/46 §2.1：虚弱的层数 = 强度（每层造伤 −10%），不再按回合衰减；上限 5 层。
  weak: { id: "weak", polarity: "affliction", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 5 },
  // docs/46 §2.2：胆怯（旧「易伤」合并案）：每层承伤 +10%，上限 5 层。
  timid: { id: "timid", polarity: "affliction", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 5 },
  // docs/46 §2.3：荆棘（旧「反伤」合并案）：每层反弹 3 点固定伤害，上限 5 层。
  bramble: { id: "bramble", polarity: "boon", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 5 },
  // docs/46 §3.4：坚韧：每层回合开始 +3 维续格挡（总上限 25，见 resolveTenacity）。
  tenacity: { id: "tenacity", polarity: "boon", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 3 },
  regeneration: {
    id: "regeneration",
    polarity: "boon",
    stacking: "stackAndRefresh",
    decayAt: "turnStart",
    applyAs: "stacksAndTurns",
    defaultDuration: 3,
  },
  pollution: { id: "pollution", polarity: "affliction", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 100 },
  block: { id: "block", polarity: "boon", stacking: "stack", decayAt: "none", applyAs: "stacks", resource: true },
  // 蚀锈（甲方 2026-10-07 改版）：**纯层数 DoT**，不再有 duration。
  // 敌方回合开始时按当前层数造成伤害（无视格挡），结算后层数 −5，归零即移除。
  // decayAt 设为 none —— 由 resolveCorroding 手动结算，交给泛用 tick 会被
  // 玩家回合的 turnEnd/turnStart 双重扣时。
  corroding: {
    id: "corroding",
    polarity: "affliction",
    stacking: "stack",
    decayAt: "none",
    applyAs: "stacks",
  },
  // 冰缓（docs/46 §3.7）：层数 = 剩余回合。手动结算（resolveCurses），不进泛用 tick。
  chill: { id: "chill", polarity: "curse", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 3 },
  // 颠倒（docs/46 §3.8）：同上，上限 2 层。
  reverse: { id: "reverse", polarity: "curse", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 2 },
  // 眩晕（docs/46 §3.5）：不可叠加、持续中重复施加无效（refreshOnly 取较大值 = 恒为 1）。
  stun: { id: "stun", polarity: "curse", stacking: "refreshOnly", decayAt: "none", applyAs: "stacks", maxStacks: 1 },
  // 灼烧（docs/46 §3.9）：层级型，每层每回合 −1 生命上限，战斗结束恢复。
  burn: { id: "burn", polarity: "affliction", stacking: "stack", decayAt: "none", applyAs: "stacks", maxStacks: 5 },
  // 超负荷（docs/58 §六 玻璃大炮，甲方 2026-10-07 修订）：层级型减益，**战斗结束清零、不衰减**。
  // 每层：承载者自己回合开始扣 2 点生命（resolve.tickOverload）+ 受到伤害 +1（attackModifiers 加区）。
  // 玩家侧由玻璃大炮的「一波打出去」整体转嫁给敌方，自身清零。
  // docs/46 原裁定「层级型为九相专用」，本条是甲方拍板的开口子（docs/58 §六-2 回写事项）。
  overload: {
    id: "overload",
    polarity: "affliction",
    stacking: "stack",
    decayAt: "none",
    applyAs: "stacks",
  },
  // 回血印记（调血）：一次性延迟回血。stacks = 回血量。
  // decayAt 设为 none —— 由 resolveMending 在【玩家回合开始】结算并立即移除，
  // 交给泛用 tick 会在结算前就把 duration 扣到 0 而白掉。
  mending: {
    id: "mending",
    polarity: "boon",
    stacking: "refreshOnly",
    decayAt: "none",
    applyAs: "stacksAndTurns",
    defaultDuration: 1,
  },
};

export function buffDefinition(id: BuffId): BuffDefinition {
  return BUFF_DEFINITIONS[id];
}

/**
 * 是不是「我的筹码」（docs/46 加持金）。
 * 格挡是资源不是状态（resource: true），血链不吃它——它已经在替玩家挡刀了。
 */
export function isBoonBuff(id: BuffId): boolean {
  const def = BUFF_DEFINITIONS[id];
  return !!def && def.polarity === "boon" && !def.resource;
}
