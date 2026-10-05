/**
 * core/registry/handler · 卡牌复杂逻辑 handler 注册表（ADR-005）
 *
 * 简单效果走 JSON 声明式；复杂机制走注册 handler（TS 函数，可单测、有类型）。
 * handler 只产出 CardEffect 列表，不自己结算——结算永远在 pipeline/combat。
 */
import { splitValues } from "../pipeline";
import type { CardEffect as Effect } from "./content";
import type { CardHandlerId } from "./ids";

export interface CardHandlerContext {
  readonly chosenTargetId: string | null;
}

export type CardHandlerFn = (
  params: Readonly<Record<string, unknown>>,
  ctx: CardHandlerContext,
) => readonly Effect[];

const registry = new Map<CardHandlerId, CardHandlerFn>();

export function registerCardHandler(id: CardHandlerId, fn: CardHandlerFn): void {
  if (registry.has(id)) throw new Error(`cardHandler "${id}" 重复注册`);
  registry.set(id, fn);
}

export function getCardHandler(id: string): CardHandlerFn {
  const fn = registry.get(id as CardHandlerId);
  if (!fn) throw new Error(`未注册的 cardHandler "${id}"`);
  return fn;
}

export function hasCardHandler(id: string): boolean {
  return registry.has(id as CardHandlerId);
}

export function registeredCardHandlers(): readonly string[] {
  return [...registry.keys()];
}

function num(params: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 多段攻击：params { hits, split[], value }，拆成 N 个独立伤害效果（各自 onHit）。 */
registerCardHandler("multihit", (params) => {
  const hits = num(params, "hits", 1);
  const value = num(params, "value", 0);
  const rawSplit = params["split"];
  const split =
    Array.isArray(rawSplit) && rawSplit.every((x) => typeof x === "number")
      ? (rawSplit as number[])
      : Array.from({ length: hits }, () => 1 / hits);
  const parts = splitValues(value, split);
  return parts.map((v): Effect => ({ kind: "damage", target: { type: "chosenEnemy" }, value: v }));
});

/** 同一目标连续攻击递增（S4 强化链会用），先注册结构避免 validator 报未注册。 */
registerCardHandler("rampageOnSameTarget", (params) => {
  const value = num(params, "value", 0);
  const bonus = num(params, "perHit", 0);
  return [
    { kind: "damage", target: { type: "chosenEnemy" }, value },
    { kind: "damage", target: { type: "chosenEnemy" }, value: value + bonus },
  ];
});
