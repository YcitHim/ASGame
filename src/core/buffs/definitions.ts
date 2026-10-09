import type { BuffId } from "../registry/ids";
import type { BuffDefinition } from "./types";

/** 0.1 六个基础 Buff（docs/03 §2 / buffs README）。 */
export const BUFF_DEFINITIONS: Readonly<Record<BuffId, BuffDefinition>> = {
  strength: { id: "strength", polarity: "boon", stacking: "stack", decayAt: "none", applyAs: "stacks" },
  // 虚弱（甲方 2026-10-09 双轴定稿，推翻 docs/46 §2.1 的层级化）：
  // **固定 −20% 造伤**，不走层数强度；时长型，重复施加 +1 回合（extend），上限 1 层。
  // decayAt ownerTurnEnd = 只在承载者自己回合结束 −1（谁挂上都能吃满自己的一整个回合）。
  weak: {
    id: "weak",
    polarity: "affliction",
    stacking: "refreshOnly",
    durationPolicy: "extend",
    decayAt: "ownerTurnEnd",
    applyAs: "turns",
    defaultDuration: 1,
    maxStacks: 1,
  },
  // 胆怯（甲方 2026-10-09 双轴定稿，推翻 docs/46 §2.2 的层级化）：**固定 +20% 承伤**，时长同上。
  timid: {
    id: "timid",
    polarity: "affliction",
    stacking: "refreshOnly",
    durationPolicy: "extend",
    decayAt: "ownerTurnEnd",
    applyAs: "turns",
    defaultDuration: 1,
    maxStacks: 1,
  },
  // 荆棘（甲方 2026-10-09）：层数仍是**强度**（每层反弹 3 点固定伤害，上限 5 层），
  // 但不再是永久加持——**基础 3 回合**，重复施加延长时间（甲方：「荆棘和坚韧改成三回合」）。
  bramble: {
    id: "bramble",
    polarity: "boon",
    stacking: "stack",
    durationPolicy: "extend",
    decayAt: "ownerTurnEnd",
    applyAs: "stacksAndTurns",
    defaultDuration: 3,
    maxStacks: 5,
  },
  // 坚韧（甲方 2026-10-09）：同上，层数仍是强度（回合开始每层 +3 维续格挡，总上限 25），**基础 3 回合**。
  tenacity: {
    id: "tenacity",
    polarity: "boon",
    stacking: "stack",
    durationPolicy: "extend",
    decayAt: "ownerTurnEnd",
    applyAs: "stacksAndTurns",
    defaultDuration: 3,
    maxStacks: 3,
  },
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
  // 冰缓（甲方 2026-10-09 双轴定稿）：效果是**有无**判定（该单位造伤 ×0.8），不随层数放大——
  // 因此「层」这个伪装的回合数正式换成 duration：基础 1 回合，重复施加累加。
  chill: {
    id: "chill",
    polarity: "curse",
    stacking: "refreshOnly",
    durationPolicy: "extend",
    decayAt: "ownerTurnEnd",
    applyAs: "turns",
    defaultDuration: 1,
    maxStacks: 1,
  },
  // 颠倒（甲方 2026-10-09）：同上，效果同样是**有无**判定（手牌费用打乱 + 摸牌造伤）。
  reverse: {
    id: "reverse",
    polarity: "curse",
    stacking: "refreshOnly",
    durationPolicy: "extend",
    decayAt: "ownerTurnEnd",
    applyAs: "turns",
    defaultDuration: 1,
    maxStacks: 1,
  },
  // 眩晕（甲方 2026-10-09）：1 回合 + 可延长。主链路由「轮到就吃掉」实现（reducer / enemy-turn），
  // ownerTurnEnd 只是兜底：万一某次眩晕挂上时该单位本回合已经行动过，也不会白挂一整场。
  stun: {
    id: "stun",
    polarity: "curse",
    stacking: "refreshOnly",
    durationPolicy: "extend",
    decayAt: "ownerTurnEnd",
    applyAs: "turns",
    defaultDuration: 1,
    maxStacks: 1,
  },
  // 灼烧（甲方 2026-10-09 双轴定稿）：层数仍是**强度**（每层每回合 −1 生命上限，上限 5 层），
  // 时长**基础 2 回合、重复施加刷新时间（不累加）**——这是与荆棘/坚韧的关键区别。
  // 另带「生命恢复 −50%」（甲方 2026-10-08 补丁，判定在 healUnit 唯一汇点）。
  burn: {
    id: "burn",
    polarity: "affliction",
    stacking: "stack",
    decayAt: "ownerTurnEnd",
    applyAs: "stacksAndTurns",
    defaultDuration: 2,
    maxStacks: 5,
  },
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
  // 特殊防御状态（docs/60 §八.3，甲方 2026-10-08）：**敌人自身**的减伤形态，
  // 不属于「异常 / 诅咒 / 加持」三分类（polarity 仅作占位，UI 不读它着色）。
  // 层数 = 剩余回合：`decayAt: "turnEnd"` 在**玩家回合结束**时 −1——
  // 敌方回合挂上之后正好撑过接下来 3 个完整的玩家回合（甲方口径的「3 回合虚化」）。
  // 三者都走 `dealDamage` 的同一道门（resolve.wardBlocks / unbreakableCap）。
  ethereal: {
    id: "ethereal",
    polarity: "affliction",
    stacking: "refreshOnly",
    decayAt: "turnEnd",
    applyAs: "turns",
    maxStacks: 3,
  },
  magicimmune: {
    id: "magicimmune",
    polarity: "affliction",
    stacking: "refreshOnly",
    decayAt: "turnEnd",
    applyAs: "turns",
    maxStacks: 3,
  },
  unbreakable: {
    id: "unbreakable",
    polarity: "affliction",
    stacking: "refreshOnly",
    decayAt: "turnEnd",
    applyAs: "turns",
    maxStacks: 3,
  },
  // 临界硬化（docs/60 §四 锈喉转阶段保护，甲方 2026-10-08 口述修订）：
  // 跨过 50% 血线后挂上的 99% 减伤，只活本回合——duration 1 + decayAt turnEnd，
  // 玩家结束回合时正好到期。同属 docs/60 §八.3 特殊防御状态（polarity 仅作占位）。
  phase_ward: {
    id: "phase_ward",
    polarity: "affliction",
    stacking: "refreshOnly",
    decayAt: "turnEnd",
    applyAs: "turns",
    maxStacks: 1,
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
