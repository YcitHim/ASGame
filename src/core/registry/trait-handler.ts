/**
 * core/registry/trait-handler · 职业特性机制逻辑（docs/58 · ADR-005 同构）
 *
 * 特性是「开局自带的隐藏遗物」：JSON 只声明 id / classId / handler / params，
 * 机制逻辑住在这里（纯 TS、可单测）。核心引擎只按**能力问询**调用，
 * 绝不出现 classId 字符串特判（docs/58 §二-3 / 铁律 6）。
 *
 * 能力问询设计原则：每个方法要么返回一个**谓词**（能不能），要么返回一个**派生值**（多少），
 * 要么返回 `CardEffect[]`（挂进现有结算管线）——不新造平行结算系统。
 */
import type { BuffInstance } from "../buffs";
import type { ModifierOp, ValueKind } from "../pipeline";
import type { CardEffect } from "./content";
import type { TraitHandlerId } from "./ids";

/**
 * 战斗开局快照（docs/58 §七.2）：畸变阈值**只在战斗开局判定**，
 * 局内跌破不失效、下一场开局重判。快照在 createBattleState 时写好，之后只读。
 */
export interface TraitSnapshot {
  /** 开局污染值 */
  readonly pollutionAtStart: number;
  /** ≥200 · 畸变触手（每回合第一张牌不耗能） */
  readonly tentacle: boolean;
  /** ≥300 · 畸变大鲨臂（每回合第一张牌结算两次） */
  readonly scythe: boolean;
  /** ≥400 · 畸变神眼（每回合一次从牌库选牌） */
  readonly eye: boolean;
}

export const EMPTY_TRAIT_SNAPSHOT: TraitSnapshot = {
  pollutionAtStart: 0,
  tentacle: false,
  scythe: false,
  eye: false,
};

/** 特性问询上下文（只读投影，不含 Draft 本体）。 */
export interface TraitContext {
  readonly hp: number;
  readonly maxHp: number;
  readonly pollution: number;
  readonly charge: number;
  readonly block: number;
  readonly buffs: readonly BuffInstance[];
  readonly cardsPlayedThisTurn: number;
  readonly attackCardsPlayedThisTurn: number;
  readonly handSize: number;
  readonly turn: number;
  /** 本回合累计造伤（玩家来源 hpLost>0，docs/58 §四） */
  readonly dealtDamageThisTurn: number;
  /** 本回合累计自伤（血契 / 血迹，docs/58 §四） */
  readonly selfHpSpentThisTurn: number;
  readonly snapshot: TraitSnapshot;
}

/** 特性注入的修饰：layer 由框架固定为 "buff"，可追溯（sourceId = trait:<id>）。 */
export interface TraitModifier {
  readonly kind: ValueKind;
  readonly op: ModifierOp;
  readonly value: number;
}

export interface TraitHandler {
  readonly id: TraitHandlerId;
  /**
   * 充能注入哪一条修饰管线（docs/58 §五.1）：缺省 "attack"（现版每层 +1 伤害）；
   * 铁皮王八改为 "block"（每次获得格挡 +充能层数）；"none" = 不注入。
   */
  chargeTarget?: (params: Readonly<Record<string, unknown>>) => "attack" | "block" | "none";
  /** 攻击修饰附加项（玻璃大炮首牌爆发在出牌处处理，这里只放常驻项） */
  attackModifiers?: (
    params: Readonly<Record<string, unknown>>,
    ctx: TraitContext,
  ) => readonly TraitModifier[];
  /** 格挡修饰附加项（超负荷的「每张卡格挡 −N」走这里） */
  blockModifiers?: (
    params: Readonly<Record<string, unknown>>,
    ctx: TraitContext,
  ) => readonly TraitModifier[];
  /** 充能过载是否生效（缺省 true；玻璃大炮关闭） */
  chargeOverload?: (params: Readonly<Record<string, unknown>>) => boolean;
  /** 超额充能转「超负荷」层：每 step 点超额 1 层；null = 不转换 */
  overloadPerStep?: (params: Readonly<Record<string, unknown>>) => number | null;
  /**
   * 每层「超负荷」在**承载者回合开始**时的扣血（甲方 2026-10-07 修订，缺省 2）。
   * 玩家在 turnStart 结算、敌人在敌方回合开始结算——同一份口径作用于承载者本身。
   */
  overloadTickPerStack?: (params: Readonly<Record<string, unknown>>) => number;
  /** 每层「超负荷」让承载者**受到的伤害 +N**（加区，甲方 2026-10-07 修订，缺省 1） */
  overloadDamageTakenPerStack?: (params: Readonly<Record<string, unknown>>) => number;
  /**
   * 「一波打出去」时是否把自身超负荷**整体转嫁**给目标（甲方 2026-10-07 修订）。
   * true = 出牌后自身超负荷清零，层数搬到敌方（AoE → 全体敌人）。
   */
  spreadOverloadOnBurst?: (params: Readonly<Record<string, unknown>>) => boolean;
  /** 荆棘层数上限覆盖（缺省 5；铁皮王八 10） */
  brambleMaxStacks?: (params: Readonly<Record<string, unknown>>) => number;
  /**
   * 回合末按格挡折算荆棘：每 N 点**本回合的格挡**赋予 1 层（甲方 2026-10-07 修订）。
   * **覆盖式刷新**（甲方 2026-10-07 三次修订）：每次判定把荆棘层数**重设为**该折算值，
   * 不是累加——不打格挡的回合，下一次判定即把荆棘清零。null = 该特性无此机制。
   */
  brambleFromBlockStep?: (params: Readonly<Record<string, unknown>>) => number | null;
  /**
   * 充能低于阈值时的**每回合额外能量**（玻璃大炮 §六.4，甲方 2026-10-07 三次修订）。
   * 在**每个回合开始**（含战斗第 1 回合）判定一次：当前充能 < lowChargeBelow → 额外 +lowChargeEnergy。
   * 返回值 = 本次额外能量（0 = 不给）。充能一旦攒到阈值，当回合起断供。
   */
  lowChargeEnergy?: (params: Readonly<Record<string, unknown>>, ctx: TraitContext) => number;
  /** 污染是否无视 100 封顶（超级大畸变） */
  pollutionUncapped?: (params: Readonly<Record<string, unknown>>) => boolean;
  /** 每满 step 污染触发一次 backlash 反噬（不清零）；null = 不启用 */
  pollutionMilestone?: (
    params: Readonly<Record<string, unknown>>,
  ) => { step: number; backlash: number } | null;
  /** 战斗胜利结算（返回挂进管线的效果，如污染 −50） */
  onBattleWin?: (params: Readonly<Record<string, unknown>>, ctx: TraitContext) => readonly CardEffect[];
  /** 玩家回合结束结算（嗜血惩罚 + 奖励） */
  onTurnEnd?: (params: Readonly<Record<string, unknown>>, ctx: TraitContext) => readonly CardEffect[];
  /**
   * 玩家**回合开始**结算（含战斗第 1 回合）：返回挂进管线的效果
   * （嗜血满血奖励「每回合额外给一张血契牌」，甲方 2026-10-08 修订）。
   */
  onTurnStart?: (params: Readonly<Record<string, unknown>>, ctx: TraitContext) => readonly CardEffect[];
  /**
   * 每次**回血**的额外加成（甲方 2026-10-08 修订 · 嗜血低血段）。
   * 返回值走 `heal` 修饰管线（加区，sourceId = trait:<id>:heal），0 = 不加成。
   * 所有回血来源（再生 / 卡牌治疗 / 回血印记 / 遗物）都汇到 healUnit 这一个入口。
   */
  healBonus?: (params: Readonly<Record<string, unknown>>, ctx: TraitContext) => number;
  /** 每回合第一张牌免能（触手） */
  firstCardFree?: (params: Readonly<Record<string, unknown>>) => boolean;
  /** 每回合第一张牌结算两次（大鲨臂） */
  firstCardDouble?: (params: Readonly<Record<string, unknown>>) => boolean;
  /**
   * 每回合第一张**攻击**牌的附加伤害（玻璃大炮 §六.3）：返回 >0 时框架会把该值
   * 作为固定加伤注入，并把充能清零（消耗不经 changeCharge，不吃过载）。
   * 甲方 2026-10-07 二次修订：**只有身上已有超负荷时**才返回 >0，否则整段爆发不发生。
   */
  firstAttackChargeBonus?: (
    params: Readonly<Record<string, unknown>>,
    ctx: TraitContext,
  ) => number;
  /** 每回合一次从牌库选牌（神眼） */
  drawFromLibrary?: (params: Readonly<Record<string, unknown>>) => boolean;
}

const registry = new Map<TraitHandlerId, TraitHandler>();

export function registerTraitHandler(handler: TraitHandler): void {
  if (registry.has(handler.id)) throw new Error(`traitHandler "${handler.id}" 重复注册`);
  registry.set(handler.id, handler);
}

export function getTraitHandler(id: string): TraitHandler {
  const handler = registry.get(id as TraitHandlerId);
  if (!handler) throw new Error(`未注册的 traitHandler "${id}"`);
  return handler;
}

export function hasTraitHandler(id: string): boolean {
  return registry.has(id as TraitHandlerId);
}

export function registeredTraitHandlers(): readonly string[] {
  return [...registry.keys()];
}

function num(params: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function bool(params: Readonly<Record<string, unknown>>, key: string, fallback: boolean): boolean {
  const v = params[key];
  return typeof v === "boolean" ? v : fallback;
}

/* ------------------------------------------------------------------ *
 * 血械侍僧 · 嗜血（docs/58 §四）
 * 惩罚段：本回合既未造伤、也未自伤 → 力量 −1；力量 ≤0 → 改为 1 层虚弱。
 * 奖励段：min(⌊造伤/5⌋, ⌊自伤/5⌋) × 2 层再生
 *   （甲方 2026-10-08 平衡补丁：门槛由 3/3 提到 **5/5**，其余不变）。
 * 甲方 2026-10-08 职业平衡修订（两条，均为新增段）：
 *   ① **低血段**：HP < lowHpPercent% 时，**每次回血 +lowHpHealBonus 点**
 *      （所有回血来源都汇到 healUnit，所以是「所有回血」而不是某一条）；
 *   ② **满血段**：HP 满时，**每个回合开始**凭空得 1 张血契牌（从全池带血契代价的牌里随机）。
 *      两条一进一出：满血白拿资源 → 卖血 → 低血回血更快，形成背水循环。
 * ------------------------------------------------------------------ */
registerTraitHandler({
  id: "bloodthirst",
  onTurnEnd(params, ctx) {
    const dealt = Math.max(0, ctx.dealtDamageThisTurn);
    const selfSpent = Math.max(0, ctx.selfHpSpentThisTurn);
    const out: CardEffect[] = [];

    if (dealt === 0 && selfSpent === 0) {
      const strength = ctx.buffs.find((b) => b.id === "strength")?.stacks ?? 0;
      if (strength > 0) {
        out.push({ kind: "applyBuff", target: { type: "self" }, buff: "strength", stacks: -1 });
      } else {
        const weakStacks = Math.max(1, Math.trunc(num(params, "punishWeak", 1)));
        out.push({ kind: "applyBuff", target: { type: "self" }, buff: "weak", stacks: weakStacks });
      }
    }

    const perDamage = Math.max(1, Math.trunc(num(params, "rewardDamage", 3)));
    const perSelf = Math.max(1, Math.trunc(num(params, "rewardSelf", 3)));
    const perRegen = Math.max(1, Math.trunc(num(params, "rewardRegen", 2)));
    const groups = Math.min(Math.floor(dealt / perDamage), Math.floor(selfSpent / perSelf));
    if (groups > 0) {
      out.push({ kind: "applyBuff", target: { type: "self" }, buff: "regeneration", stacks: groups * perRegen });
    }
    return out;
  },
  /** 满血段（甲方 2026-10-08）：回合开始白给一张血契牌；只要掉了一点血就停供。 */
  onTurnStart(params, ctx) {
    if (!bool(params, "fullHpGrantCard", true)) return [];
    if (ctx.hp < ctx.maxHp) return [];
    const count = Math.max(1, Math.trunc(num(params, "grantCardCount", 1)));
    const raw = params["grantCardPool"];
    const pool: "bloodCost" | readonly string[] =
      Array.isArray(raw) ? (raw as readonly string[]) : "bloodCost";
    return [{ kind: "gainCard", pool, count }];
  },
  /** 低血段（甲方 2026-10-08）：HP 百分比低于阈值时，每次回血 +N 点。 */
  healBonus(params, ctx) {
    const percent = num(params, "lowHpPercent", 30);
    const bonus = Math.max(0, Math.trunc(num(params, "lowHpHealBonus", 1)));
    if (percent <= 0 || bonus <= 0 || ctx.maxHp <= 0) return 0;
    return (ctx.hp / ctx.maxHp) * 100 < percent ? bonus : 0;
  },
});

/* ------------------------------------------------------------------ *
 * 炉心机士 · 铁皮王八（docs/58 §五，甲方 2026-10-07 修订 / 三次修订）
 * 充能改道格挡（每次获得格挡 +充能层数）；**回合结束时**判定**本回合**的格挡，
 * 每 8 点赋予 1 层荆棘，且**每回合刷新（覆盖上一回合的层数）**——
 * 「第一回合 10 格挡 → 得到 2 层；第二回合不打格挡 → 第三回合荆棘归零」。
 * 荆棘上限对该特性开放至 10。
 * ------------------------------------------------------------------ */
registerTraitHandler({
  id: "ironhide_turtle",
  chargeTarget: () => "block",
  brambleMaxStacks: (params) => Math.max(1, Math.trunc(num(params, "brambleMaxStacks", 10))),
  brambleFromBlockStep: (params) => {
    const per = Math.trunc(num(params, "bramblePerBlock", 8));
    return per > 0 ? per : null;
  },
});

/* ------------------------------------------------------------------ *
 * 炉心机士 · 玻璃大炮（docs/58 §六，甲方 2026-10-07 二次 / 三次修订）
 * 充能不设上限、不触发过载反噬；超 10 的部分**每 5 点** 1 层超负荷。
 * 超负荷 = 承载者每回合开始扣 2×层血、且每层受到伤害 +1（可叠加）。
 * 「一波打出去」：**只有在身上已有超负荷时**，每回合的第一张攻击牌才吃满当前充能并清零，
 * 同时把自身超负荷整体转嫁给目标（AoE → 每个敌人各一份）——
 * **先转嫁、再结算伤害**（甲方 2026-10-07 三次修订）：转嫁到手的那一层「受伤 +1」要算进这一击，
 * 否则爆发伤害会凭空少一截。
 * 没有超负荷 → 第一张攻击牌什么也不消耗，充能继续攒着。
 * 「蓄势」：每回合开始（含第 1 回合）充能 <10 时额外 +1 能量。
 * ------------------------------------------------------------------ */
registerTraitHandler({
  id: "glass_cannon",
  // 充能**不**注入普通攻击加伤：本特性下充能是「弹药」，只在爆发那张牌上兑现。
  chargeTarget: () => "none",
  chargeOverload: (params) => !bool(params, "overloadDisabled", true),
  overloadPerStep: (params) => {
    const step = Math.trunc(num(params, "overloadPerStep", 5));
    return step > 0 ? step : null;
  },
  overloadTickPerStack: (params) => Math.max(0, Math.trunc(num(params, "overloadTickPerStack", 2))),
  overloadDamageTakenPerStack: (params) =>
    Math.max(0, Math.trunc(num(params, "overloadDamageTakenPerStack", 1))),
  spreadOverloadOnBurst: (params) => bool(params, "spreadOverloadOnBurst", true),
  /**
   * 一波打出去（docs/58 §六.3）：返回「当前充能」作为该牌的固定加伤，框架据此刻归零充能。
   * **门槛 = 身上有超负荷**：没有超负荷时返回 0 —— 不消耗充能、不转嫁，充能继续累计。
   */
  firstAttackChargeBonus: (params, ctx) => {
    if (!bool(params, "firstAttackCharge", true)) return 0;
    const overload = ctx.buffs.find((b) => b.id === "overload")?.stacks ?? 0;
    if (overload <= 0) return 0;
    return Math.max(0, ctx.charge);
  },
  /**
   * 蓄势（docs/58 §六.4，甲方 2026-10-07 三次修订）：每个回合开始（含第 1 回合），
   * 只要充能还没攒到 10，就额外 +1 能量——帮玩家更快把充能堆过阈值；一旦过载即断供。
   */
  lowChargeEnergy: (params, ctx) => {
    const below = Math.max(0, Math.trunc(num(params, "lowChargeBelow", 10)));
    const energy = Math.max(0, Math.trunc(num(params, "lowChargeEnergy", 1)));
    if (energy <= 0) return 0;
    return ctx.charge < below ? energy : 0;
  },
});

/* ------------------------------------------------------------------ *
 * 锈语者 · 超级大畸变（docs/58 §七）
 * 污染无上限、每满 100 反噬一次不清零；开局阈值快照。
 * 胜利污染 −50 **带门槛**（甲方 2026-10-08 职业平衡修订）：只有**结算那一刻**的当前污染
 * ≥ winReliefThreshold（180）才扣——跌回线下就不给，堵住「靠胜利白嫖降压」的漏洞。
 * ------------------------------------------------------------------ */
registerTraitHandler({
  id: "super_mutation",
  pollutionUncapped: (params) => bool(params, "pollutionUncapped", true),
  pollutionMilestone: (params) => {
    const step = Math.trunc(num(params, "milestoneStep", 100));
    if (step <= 0) return null;
    return { step, backlash: Math.max(0, Math.trunc(num(params, "milestoneBacklash", 10))) };
  },
  onBattleWin(params, ctx) {
    const threshold = Math.max(0, Math.trunc(num(params, "winReliefThreshold", 180)));
    if (ctx.pollution < threshold) return [];
    const relief = Math.max(0, Math.trunc(num(params, "winPollutionRelief", 50)));
    if (relief <= 0) return [];
    return [{ kind: "gainPollution", value: -relief }];
  },
  firstCardFree: (params) => bool(params, "firstCardFree", true),
  firstCardDouble: (params) => bool(params, "firstCardDouble", true),
  drawFromLibrary: (params) => bool(params, "drawFromLibrary", true),
});

/** 由阈值算快照（createBattleState 调用，纯函数便于单测）。 */
export function computeTraitSnapshot(
  pollution: number,
  params: Readonly<Record<string, unknown>>,
): TraitSnapshot {
  const pollutionAtStart = Math.max(0, Math.trunc(pollution));
  return {
    pollutionAtStart,
    tentacle: pollutionAtStart >= Math.trunc(num(params, "tentacleThreshold", 200)),
    scythe: pollutionAtStart >= Math.trunc(num(params, "scytheThreshold", 300)),
    eye: pollutionAtStart >= Math.trunc(num(params, "eyeThreshold", 400)),
  };
}
