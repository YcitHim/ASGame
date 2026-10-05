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

export interface ConditionContext {
  readonly hp: number;
  readonly maxHp: number;
  readonly pollution: number;
  readonly charge: number;
  readonly buffs: readonly BuffInstance[];
  readonly cardsPlayedThisTurn: number;
  readonly handSize: number;
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
registerCondition("pollutionAbove", (ctx, p) => ctx.pollution > num(p, "n"));
registerCondition("pollutionBelow", (ctx, p) => ctx.pollution < num(p, "n"));
registerCondition("chargeAtLeast", (ctx, p) => ctx.charge >= num(p, "n"));
registerCondition("hasBuff", (ctx, p) => {
  const id = p["buffId"];
  if (typeof id !== "string") return false;
  const min = num(p, "stacks", 1);
  return buffStacks(ctx.buffs, id as BuffId) >= min;
});
registerCondition("cardsPlayedThisTurn", (ctx, p) => ctx.cardsPlayedThisTurn >= num(p, "n", 1));
registerCondition("handIsEmpty", (ctx) => ctx.handSize === 0);

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
