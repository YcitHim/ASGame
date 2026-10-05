/**
 * core/registry/enhancement-handler · 强化机制逻辑（ADR-005 / docs/04 §3）
 *
 * 强化只通过两个挂载点生效：
 *   modifyCard —— 出牌前改形态（如低血沸腾把单段伤害改成三段）
 *   onHit      —— 命中计数（多段攻击每段独立触发）
 * JSON 只传参，机制逻辑在这里（纯 TS，可单测）。
 */
import { splitValues, type ModifierOp, type ValueKind } from "../pipeline";
import type { BuffInstance } from "../buffs";
import type { CardDefinition, CardEffect, CardPlayHandler } from "./content";
import { evaluateCondition, type ConditionContext } from "./condition";
import type { EnhancementHandlerId, KeywordId } from "./ids";

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

/** 强化注入的修饰：kind 对应修饰符管线的数值种类（layer 由框架固定为 enhancement）。 */
export interface EnhancementModifier {
  readonly kind: ValueKind;
  readonly op: ModifierOp;
  readonly value: number;
}

export interface ModifyCardResult {
  readonly effects?: readonly CardEffect[];
  readonly play?: CardPlayHandler;
  /** 关键词覆盖（如给某张卡追加「消耗」） */
  readonly keywords?: readonly KeywordId[];
  /** 数值修饰：走修饰符管线，DamageDealt.layers 里可追溯 */
  readonly modifiers?: readonly EnhancementModifier[];
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

/** T1「锋锐」：该牌伤害 +bonus（走 attackDamage 的 enhancement 层）。 */
registerEnhancementHandler({
  id: "empower",
  modifyCard(_input, params) {
    const bonus = Math.trunc(asNumber(params["bonus"], 1));
    if (bonus === 0) return undefined;
    return { modifiers: [{ kind: "attackDamage", op: "add", value: bonus }] };
  },
});

/** T1「加固」：该牌格挡 +bonus（走 block 的 enhancement 层）。 */
registerEnhancementHandler({
  id: "fortify",
  modifyCard(_input, params) {
    const bonus = Math.trunc(asNumber(params["bonus"], 1));
    if (bonus === 0) return undefined;
    return { modifiers: [{ kind: "block", op: "add", value: bonus }] };
  },
});

/** T1「节油血契」：该牌卖血代价 -discount（走 hpCost 的 enhancement 层）。 */
registerEnhancementHandler({
  id: "bloodpact_discount",
  modifyCard(_input, params) {
    const discount = Math.trunc(asNumber(params["discount"], 1));
    if (discount === 0) return undefined;
    return { modifiers: [{ kind: "hpCost", op: "add", value: -discount }] };
  },
});
