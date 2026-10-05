/**
 * core/registry/enhancement-handler · 强化机制逻辑（ADR-005 / docs/04 §3）
 *
 * 强化只通过两个挂载点生效：
 *   modifyCard —— 出牌前改形态（如低血沸腾把单段伤害改成三段）
 *   onHit      —— 命中计数（多段攻击每段独立触发）
 * JSON 只传参，机制逻辑在这里（纯 TS，可单测）。
 */
import { splitValues } from "../pipeline";
import type { BuffInstance } from "../buffs";
import type { CardDefinition, CardEffect, CardPlayHandler } from "./content";
import { evaluateCondition, type ConditionContext } from "./condition";
import type { EnhancementHandlerId } from "./ids";

export interface EnhancementContext {
  readonly hp: number;
  readonly maxHp: number;
  readonly pollution: number;
  readonly charge: number;
  readonly buffs: readonly BuffInstance[];
  readonly cardsPlayedThisTurn: number;
  readonly handSize: number;
  /** onHit 时的段号（从 1 开始） */
  readonly hitIndex: number;
}

export interface ModifyCardInput {
  readonly def: CardDefinition;
  readonly effects: readonly CardEffect[];
  readonly play?: CardPlayHandler;
}

export interface ModifyCardResult {
  readonly effects?: readonly CardEffect[];
  readonly play?: CardPlayHandler;
}

export interface EnhancementHandler {
  readonly id: EnhancementHandlerId;
  modifyCard?: (
    input: ModifyCardInput,
    params: Readonly<Record<string, unknown>>,
    ctx: EnhancementContext,
  ) => ModifyCardResult | undefined;
  onHit?: (
    params: Readonly<Record<string, unknown>>,
    ctx: EnhancementContext,
  ) => readonly CardEffect[];
}

const registry = new Map<EnhancementHandlerId, EnhancementHandler>();

export function registerEnhancementHandler(handler: EnhancementHandler): void {
  if (registry.has(handler.id)) throw new Error(`enhancementHandler "${handler.id}" 重复注册`);
  registry.set(handler.id, handler);
}

export function getEnhancementHandler(id: string): EnhancementHandler {
  const handler = registry.get(id as EnhancementHandlerId);
  if (!handler) throw new Error(`未注册的 enhancementHandler "${id}"`);
  return handler;
}

export function hasEnhancementHandler(id: string): boolean {
  return registry.has(id as EnhancementHandlerId);
}

export function registeredEnhancementHandlers(): readonly string[] {
  return [...registry.keys()];
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function conditionCtx(ctx: EnhancementContext): ConditionContext {
  return {
    hp: ctx.hp,
    maxHp: ctx.maxHp,
    pollution: ctx.pollution,
    charge: ctx.charge,
    buffs: ctx.buffs,
    cardsPlayedThisTurn: ctx.cardsPlayedThisTurn,
    handSize: ctx.handSize,
  };
}

/**
 * T2「低血沸腾」：满足条件时，把该牌的首个伤害效果改成 N 段（比例由 params.split 给出）。
 * 每段是独立伤害动作 → 独立 onHit、独立飘字。
 */
registerEnhancementHandler({
  id: "bloodboil",
  modifyCard(input, params, ctx) {
    const condition = params["condition"] as Parameters<typeof evaluateCondition>[0];
    if (!evaluateCondition(condition, conditionCtx(ctx))) return undefined;

    const damage = input.effects.find((e) => e.kind === "damage");
    if (!damage) return undefined;
    const total = damage.value ?? 0;
    const hits = Math.max(1, Math.trunc(asNumber(params["hits"], 1)));
    const rawSplit = params["split"];
    const split =
      Array.isArray(rawSplit) && rawSplit.every((x) => typeof x === "number")
        ? (rawSplit as number[])
        : Array.from({ length: hits }, () => 1 / hits);

    const target = damage.target ?? { type: "chosenEnemy" as const };
    const parts = splitValues(total, split);
    const rest = input.effects.filter((e) => e !== damage);
    return {
      effects: [...parts.map((value): CardEffect => ({ kind: "damage", target, value })), ...rest],
    };
  },
});

/** T1「锋锐」：该牌所有伤害 +bonus。 */
registerEnhancementHandler({
  id: "empower",
  modifyCard(input, params) {
    const bonus = Math.trunc(asNumber(params["bonus"], 1));
    if (bonus === 0) return undefined;
    return {
      effects: input.effects.map((e) =>
        e.kind === "damage" ? { ...e, value: (e.value ?? 0) + bonus } : e,
      ),
    };
  },
});

/** T1「加固」：该牌所有格挡 +bonus。 */
registerEnhancementHandler({
  id: "fortify",
  modifyCard(input, params) {
    const bonus = Math.trunc(asNumber(params["bonus"], 1));
    if (bonus === 0) return undefined;
    return {
      effects: input.effects.map((e) => (e.kind === "block" ? { ...e, value: (e.value ?? 0) + bonus } : e)),
    };
  },
});
