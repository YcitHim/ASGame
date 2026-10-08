/**
 * core/registry/relic-handler · 遗物机制逻辑（docs/64 §三 · 与 trait-handler 同构）
 *
 * 此前遗物是纯数据驱动（timing + effects），凡「改规则」的件都要单独改结算函数。
 * 本注册表把规则件也收敛成**能力问询**：引擎在结算点统一问「有没有这个能力」，
 * 绝不出现 relicId 字符串特判（docs/58 铁律 6 的同款护栏）。
 *
 * 数值全在 data/relics/*.json 的 params —— 调数值不改代码。
 *
 * 能力问询设计原则（同 trait-handler）：每个方法要么返回谓词（能不能），
 * 要么返回派生值（多少），要么返回 CardEffect[]（挂进现有结算管线）——不新造平行结算系统。
 */
import type { BuffInstance } from "../buffs";
import type { CardEffect } from "./content";
import type { BuffId, RelicHandlerId } from "./ids";

/** 遗物问询上下文（只读投影，不含 Draft 本体）。 */
export interface RelicHandlerContext {
  readonly hp: number;
  readonly maxHp: number;
  readonly pollution: number;
  readonly charge: number;
  readonly block: number;
  readonly buffs: readonly BuffInstance[];
  readonly cardsPlayedThisTurn: number;
  readonly attackCardsPlayedThisTurn: number;
  /** 本回合累计花费的能量（docs/64 商人算盘「能量回流」，甲方 2026-10-08 口述） */
  readonly energySpentThisTurn: number;
  readonly handSize: number;
  readonly turn: number;
  /** 本遗物本时机本回合已触发次数（perTurn 上限由 handler 自己判） */
  readonly firesThisTurn: number;
  /** 仅 onHeal：本次实际回血量 */
  readonly healAmount?: number;
}

/** 规则问询的返回值形状 */
export interface KeepBlockRule {
  /** 保留比例（0~1，向下取整） */
  readonly ratio: number;
  /** 保留上限 */
  readonly cap: number;
}

export interface CheatDeathRule {
  /** 复活后 HP */
  readonly hpLeft: number;
  /** 复活后抽牌数 */
  readonly draw: number;
  /** 是否清除自身全部减益（异常 + 诅咒，污染资源除外） */
  readonly cleanse: boolean;
}

export interface PollutionOverflowRule {
  /** 触顶反噬伤害乘区（0.5 = 减半） */
  readonly backlashMult: number;
  /** 触顶后污染回落到该值（而非 0） */
  readonly fallTo: number;
}

export interface RelicHandler {
  readonly id: RelicHandlerId;
  /** 每次玩家回血后触发（挂 healUnit 单一汇点，嗜血 healBonus 同点） */
  onHeal?: (params: Readonly<Record<string, unknown>>, ctx: RelicHandlerContext) => readonly CardEffect[];
  /** 每当一名敌人死亡时触发（死亡清理 + 亡语之后，与强化 onKill 同点） */
  onKill?: (params: Readonly<Record<string, unknown>>, ctx: RelicHandlerContext) => readonly CardEffect[];
  /** 每当你打出消耗牌（进消耗堆）时触发；回合末手牌被消耗不算「打出」 */
  onExhaust?: (params: Readonly<Record<string, unknown>>, ctx: RelicHandlerContext) => readonly CardEffect[];
  /** 你的攻击每次命中时触发（酸洗线圈；多段攻击每段独立，与强化 onHit 同构） */
  onHit?: (params: Readonly<Record<string, unknown>>, ctx: RelicHandlerContext) => readonly CardEffect[];
  /** 每当你打出一张牌时触发（商人算盘「每花费 N 能量回 M」；派发在出牌计数自增之后） */
  onPlay?: (params: Readonly<Record<string, unknown>>, ctx: RelicHandlerContext) => readonly CardEffect[];
  /** 每回合第一张牌结算两次（双重钟摆）；与大鲨臂特性 OR 合并，不会叠成三次 */
  firstCardDouble?: (params: Readonly<Record<string, unknown>>) => boolean;
  /**
   * 每场战斗第一张攻击牌的固定加伤（磨刀石）；每场一次——
   * 框架在施加后把遗物记入 triggeredThisBattle。
   */
  firstAttackBonus?: (params: Readonly<Record<string, unknown>>) => number;
  /** 回合开始清格挡点的改写（镜面装甲）：保留 floor(block×ratio)，上限 cap */
  keepBlock?: (params: Readonly<Record<string, unknown>>) => KeepBlockRule;
  /**
   * 战斗开始的「HP → 格挡」转化（夜春蛋苯，甲方 2026-10-08 口述）：
   * 开局把 HP 按 ratio 转为格挡、只留 hpLeft 点；格挡保留由同 handler 的 keepBlock 承担。
   */
  hpToBlockOnStart?: (params: Readonly<Record<string, unknown>>) => {
    readonly ratio: number;
    readonly hpLeft: number;
  };
  /**
   * HP 归零时改为剩 hpLeft（第二颗心脏），每场一次。
   * 卖血 / 污染反噬 / 受击致死一视同仁；触发后清减益 + 抽牌。
   */
  cheatDeath?: (params: Readonly<Record<string, unknown>>) => CheatDeathRule;
  /** 污染触顶反噬的参数化（泄压阀）：反噬乘区 + 回落值 */
  pollutionOverflow?: (params: Readonly<Record<string, unknown>>) => PollutionOverflowRule;
  /** 战斗胜利后的 run 层成长（朝圣者之铃）：maxHpDelta 与 heal 都在局外生效 */
  onBattleWinRun?: (
    params: Readonly<Record<string, unknown>>,
  ) => { readonly maxHpDelta?: number; readonly heal?: number };
  /** 获得遗物时的 run 层结算（寻锈杖；含获得自身这一刻） */
  onRelicGainRun?: (params: Readonly<Record<string, unknown>>) => { readonly heal?: number };
}

const registry = new Map<RelicHandlerId, RelicHandler>();

export function registerRelicHandler(handler: RelicHandler): void {
  if (registry.has(handler.id)) throw new Error(`relicHandler "${handler.id}" 重复注册`);
  registry.set(handler.id, handler);
}

export function getRelicHandler(id: string): RelicHandler {
  const handler = registry.get(id as RelicHandlerId);
  if (!handler) throw new Error(`未注册的 relicHandler "${id}"`);
  return handler;
}

export function hasRelicHandler(id: string): boolean {
  return registry.has(id as RelicHandlerId);
}

export function registeredRelicHandlers(): readonly string[] {
  return [...registry.keys()];
}

function num(params: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/* ------------------------------------------------------------------ *
 * 触发互动件（docs/64 §四）
 * ------------------------------------------------------------------ */

/** 脏绷带：每当你回血，+N 格挡（每回合上限 perTurn 次）。 */
registerRelicHandler({
  id: "heal_grants_block",
  onHeal(params, ctx) {
    const perTurn = Math.max(1, Math.trunc(num(params, "perTurn", 3)));
    if (ctx.firesThisTurn >= perTurn) return [];
    const block = Math.max(0, Math.trunc(num(params, "block", 2)));
    if (block <= 0) return [];
    return [{ kind: "block", target: { type: "self" }, value: block }];
  },
});

/** 死亡面具：每当一名敌人死亡，回 N HP。 */
registerRelicHandler({
  id: "kill_heal",
  onKill(params) {
    const heal = Math.max(0, Math.trunc(num(params, "heal", 3)));
    if (heal <= 0) return [];
    return [{ kind: "heal", target: { type: "self" }, value: heal }];
  },
});

/** 燔祭之书：每当你打出消耗牌，抽 1（每回合上限 perTurn 次）。 */
registerRelicHandler({
  id: "exhaust_draw",
  onExhaust(params, ctx) {
    const perTurn = Math.max(1, Math.trunc(num(params, "perTurn", 2)));
    if (ctx.firesThisTurn >= perTurn) return [];
    const draw = Math.max(0, Math.trunc(num(params, "draw", 1)));
    if (draw <= 0) return [];
    return [{ kind: "draw", value: draw }];
  },
});

/* ------------------------------------------------------------------ *
 * 通用件
 * ------------------------------------------------------------------ */

/**
 * 命中挂 buff（酸洗线圈 onHit 用）：你的攻击每次命中，对目标施加 stacks 层 buff，
 * 每回合上限 perTurn 次。通用件——以后「命中施加 X」类遗物都走这一条。
 * 注意：handler 派发的是攻击命中钩子（fireRelicHandlers 的 "onHit"），
 * 目标由派发点的 chosenTargetId 决定（单体 → 该目标；AoE → 每段各目标）。
 */
registerRelicHandler({
  id: "on_hit_apply_buff",
  onHit(params, ctx) {
    const perTurn = Math.max(1, Math.trunc(num(params, "perTurn", 3)));
    if (ctx.firesThisTurn >= perTurn) return [];
    const buffId = typeof params["buff"] === "string" ? (params["buff"] as BuffId) : undefined;
    if (!buffId) return [];
    const stacks = Math.max(1, Math.trunc(num(params, "stacks", 1)));
    return [{ kind: "applyBuff", target: { type: "chosenEnemy" }, buff: buffId, stacks }];
  },
});

/**
 * 能量回流（商人算盘，甲方 2026-10-08 口述改版：本作没有商店，改为节奏件）：
 * 本回合累计花费的能量每满 spend 点，获得 gain 点能量。
 * 已发次数 = ctx.firesThisTurn（跨档自动追发：一回合花 12 点、spend=5 → 发 2 次）。
 */
registerRelicHandler({
  id: "energy_spent_refund",
  onPlay(params, ctx) {
    const spend = Math.max(1, Math.trunc(num(params, "spend", 5)));
    const gain = Math.max(0, Math.trunc(num(params, "gain", 1)));
    if (gain <= 0) return [];
    const due = Math.floor(Math.max(0, ctx.energySpentThisTurn) / spend);
    if (due <= ctx.firesThisTurn) return [];
    return [{ kind: "gainEnergy", value: gain }];
  },
});

/**
 * 命换壳（夜春蛋苯，甲方 2026-10-08 口述 · T3 规则件）：
 * 战斗开始把 HP 按 ratio 转化为格挡、只留 hpLeft 点；
 * 格挡跨回合不消失（keepBlock ratio 1 = 全保留，cap 走 params）。
 */
registerRelicHandler({
  id: "hp_to_block",
  hpToBlockOnStart: (params) => ({
    ratio: Math.max(0, num(params, "ratio", 1.2)),
    hpLeft: Math.max(1, Math.trunc(num(params, "hpLeft", 1))),
  }),
  keepBlock: (params) => ({
    ratio: 1,
    cap: Math.max(1, Math.trunc(num(params, "keepCap", 999))),
  }),
});

/* ------------------------------------------------------------------ *
 * 规则件（docs/64 §四.4）
 * ------------------------------------------------------------------ */

/** 双重钟摆：每回合你打出的第一张牌，结算两次。 */
registerRelicHandler({
  id: "first_card_double",
  firstCardDouble: () => true,
});

/** 磨刀石：每场战斗你打出的第一张攻击牌伤害 +N。 */
registerRelicHandler({
  id: "first_attack_bonus",
  firstAttackBonus: (params) => Math.max(0, Math.trunc(num(params, "bonus", 4))),
});

/** 镜面装甲：回合开始清格挡时改为保留 floor(block×ratio)，上限 cap。 */
registerRelicHandler({
  id: "keep_block",
  keepBlock: (params) => ({
    ratio: Math.min(1, Math.max(0, num(params, "ratio", 0.5))),
    cap: Math.max(0, Math.trunc(num(params, "cap", 8))),
  }),
});

/** 第二颗心脏：每场战斗第一次 HP 归零 → 剩 1、清减益、抽 2。 */
registerRelicHandler({
  id: "cheat_death",
  cheatDeath: (params) => ({
    hpLeft: Math.max(1, Math.trunc(num(params, "hpLeft", 1))),
    draw: Math.max(0, Math.trunc(num(params, "draw", 2))),
    cleanse: params["cleanse"] !== false,
  }),
});

/** 泄压阀：污染触顶时反噬减半，且污染回落到 50 而非 0。 */
registerRelicHandler({
  id: "pollution_overflow_relief",
  pollutionOverflow: (params) => ({
    backlashMult: Math.min(1, Math.max(0, num(params, "backlashMult", 0.5))),
    fallTo: Math.max(0, Math.trunc(num(params, "fallTo", 50))),
  }),
});

/* ------------------------------------------------------------------ *
 * 局外成长件（run 层）
 * ------------------------------------------------------------------ */

/** 朝圣者之铃：每场战斗胜利后，最大 HP +N 并回 N HP。 */
registerRelicHandler({
  id: "battle_win_growth",
  onBattleWinRun: (params) => ({
    maxHpDelta: Math.max(0, Math.trunc(num(params, "maxHpDelta", 3))),
    heal: Math.max(0, Math.trunc(num(params, "heal", 3))),
  }),
});

/** 寻锈杖：每当你获得一件遗物，回 N HP（含获得自身这一刻）。 */
registerRelicHandler({
  id: "relic_gain_heal",
  onRelicGainRun: (params) => ({ heal: Math.max(0, Math.trunc(num(params, "heal", 4))) }),
});
