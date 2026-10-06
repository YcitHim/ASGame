/**
 * core/registry/condition · 条件注册表（ADR-004）
 *
 * JSON 里只允许出现已注册 id + 参数对象；未注册 id 由 content-validator 构建期拦下。
 * and / or / not 由求值器内建组合，不需要注册。
 */
import type { BuffInstance } from "../buffs";
import { buffStacks } from "../buffs";
import type { BuffId, ConditionId } from "./ids";
import type { ConditionNode } from "./content";

/** 条件主体（D-5 / 策划 Q13）：意图表需要读「敌人自己」的 HP 来切阶段。 */
export interface SelfContext {
  readonly hp: number;
  readonly maxHp: number;
  readonly buffs: readonly BuffInstance[];
}

export interface ConditionContext {
  /** 玩家侧（卡牌条件默认读这里） */
  readonly hp: number;
  readonly maxHp: number;
  readonly pollution: number;
  readonly charge: number;
  readonly buffs: readonly BuffInstance[];
  readonly cardsPlayedThisTurn: number;
  readonly handSize: number;
  /** 本回合（含刚结束的敌方回合）是否受过攻击伤害；缺省 false */
  readonly tookDamageThisTurn?: boolean;
  /** 主体侧：敌人意图用；缺省时回落到玩家字段，卡牌条件不受影响 */
  readonly self?: SelfContext;
  /** 逐目标条件（docs/38 §二 B-3）：伤害效果按每个目标求值时注入 */
  readonly target?: SelfContext;
}

export type ConditionFn = (
  ctx: ConditionContext,
  params: Record<string, unknown>,
) => boolean;

const registry = new Map<ConditionId, ConditionFn>();

export function registerCondition(id: ConditionId, fn: ConditionFn): void {
  if (registry.has(id)) throw new Error(`condition "${id}" 重复注册`);
  registry.set(id, fn);
}

export function getCondition(id: string): ConditionFn {
  const fn = registry.get(id as ConditionId);
  if (!fn) throw new Error(`未注册的 condition "${id}"`);
  return fn;
}

export function hasCondition(id: string): boolean {
  return registry.has(id as ConditionId);
}

export function registeredConditions(): readonly string[] {
  return [...registry.keys()];
}

function num(params: Record<string, unknown>, key: string, fallback = 0): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

registerCondition("hpBelow", (ctx, p) => (ctx.hp / Math.max(1, ctx.maxHp)) * 100 < num(p, "percent", 100));
registerCondition("hpAtLeast", (ctx, p) => (ctx.hp / Math.max(1, ctx.maxHp)) * 100 >= num(p, "percent", 0));

const selfOf = (ctx: ConditionContext): SelfContext =>
  ctx.self ?? { hp: ctx.hp, maxHp: ctx.maxHp, buffs: ctx.buffs };

/** 主体自身 HP 条件（意图表阶段切换用） */
registerCondition("selfHpBelow", (ctx, p) => {
  const self = selfOf(ctx);
  return (self.hp / Math.max(1, self.maxHp)) * 100 < num(p, "percent", 100);
});
registerCondition("selfHpAtLeast", (ctx, p) => {
  const self = selfOf(ctx);
  return (self.hp / Math.max(1, self.maxHp)) * 100 >= num(p, "percent", 0);
});
registerCondition("pollutionAbove", (ctx, p) => ctx.pollution > num(p, "n"));
registerCondition("pollutionBelow", (ctx, p) => ctx.pollution < num(p, "n"));
registerCondition("pollutionAtLeast", (ctx, p) => ctx.pollution >= num(p, "n", 1));
registerCondition("chargeAtLeast", (ctx, p) => ctx.charge >= num(p, "n"));
registerCondition("hasBuff", (ctx, p) => {
  const id = p["buffId"];
  if (typeof id !== "string") return false;
  const min = num(p, "stacks", 1);
  return buffStacks(ctx.buffs, id as BuffId) >= min;
});
/** 目标敌人身上的 Buff（docs/38 §二 B-3「疫触」）：只在逐目标求值时有 ctx.target */
registerCondition("targetHasBuff", (ctx, p) => {
  if (!ctx.target) return false;
  const id = p["buffId"];
  if (typeof id !== "string") return false;
  return buffStacks(ctx.target.buffs, id as BuffId) >= num(p, "stacks", 1);
});
registerCondition("cardsPlayedThisTurn", (ctx, p) => ctx.cardsPlayedThisTurn >= num(p, "n", 1));
registerCondition("handIsEmpty", (ctx) => ctx.handSize === 0);
/** 本回合事件回看（docs/16 P2.3）：「以血还血」的额外伤害条件。 */
registerCondition("tookDamageThisTurn", (ctx) => ctx.tookDamageThisTurn === true);

/** 递归求值：and / or / not 内建。 */
export function evaluateCondition(node: ConditionNode | undefined, ctx: ConditionContext): boolean {
  if (!node) return true;
  switch (node.type) {
    case "and":
      return (node as unknown as { of: ConditionNode[] }).of.every((n) => evaluateCondition(n, ctx));
    case "or":
      return (node as unknown as { of: ConditionNode[] }).of.some((n) => evaluateCondition(n, ctx));
    case "not":
      return !evaluateCondition((node as unknown as { of: ConditionNode }).of, ctx);
    default: {
      const params = node as Record<string, unknown>;
      const key = node.type as string;
      if (key === "and" || key === "or" || key === "not") return true;
      return getCondition(key)(ctx, params);
    }
  }
}
