/**
 * core/combat/act-rules · 幕级战斗规则（docs/66 §三.1 / §4.2）
 *
 * 幕规则是「一整个幕的所有战斗都生效的额外规则层」——不同于敌人意图（各自 JSON）、
 * 也不同于遗物/特性（挂在玩家身上）。它只声明在 `data/acts/*.json` 的 `rules` 里，
 * 由本文件解析成**纯参数**，实际的状态变更由 `resolve.ts` 在既有汇点上派发：
 *
 *  - `mourning`（溺亡挽歌，act2）→ 敌人死亡时给玩家挂蚀锈（`resolve.killUnit`）
 *  - `forgeHeat`（锻炉高温，act3）→ 玩家回合开始给双方挂灼烧（`reducer` 的回合开始段）
 *
 * 为什么逻辑不写在这里：`applyBuffToTarget` 住在 `resolve.ts`，若本文件反过来 import 它会
 * 构成循环依赖（resolve → act-rules → resolve）。所以本文件只做**参数解析**（无副作用、可单测），
 * 副作用留在 resolve —— 与「数值在数据、逻辑在引擎」的分工一致。
 */
import type { ActRule, ActRuleId } from "../registry/content";

/** 溺亡挽歌：每死一名敌人给玩家挂几层蚀锈。 */
export const MOURNING_STACKS_PER_DEATH = 1;

/** 锻炉高温：默认从第几回合开始灼烧（docs/66 §七.4 的调节阀）。 */
export const FORGE_HEAT_DEFAULT_FROM_TURN = 5;
/** 锻炉高温：每回合给双方各挂几层灼烧。 */
export const FORGE_HEAT_STACKS_PER_TURN = 1;

/** 某规则是否在本幕启用。 */
export function hasActRule(rules: readonly ActRule[] | undefined, id: ActRuleId): boolean {
  return !!rules?.some((r) => r.id === id);
}

/** 取某规则的参数（未启用时返回 undefined）。 */
export function actRuleParams(
  rules: readonly ActRule[] | undefined,
  id: ActRuleId,
): Readonly<Record<string, number>> | undefined {
  return rules?.find((r) => r.id === id)?.params;
}

/**
 * 锻炉高温的起始回合：`params.fromTurn` 覆盖内置默认（非法值回落到默认）。
 * 单独抽成函数是为了「4/5/6 是调节阀」——真人实测后只改 JSON，不动代码。
 */
export function forgeHeatFromTurn(rules: readonly ActRule[] | undefined): number {
  const raw = actRuleParams(rules, "forgeHeat")?.["fromTurn"];
  if (raw === undefined || !Number.isFinite(raw) || raw < 1) return FORGE_HEAT_DEFAULT_FROM_TURN;
  return Math.trunc(raw);
}

/** 该回合是否到了灼烧起始点（`turn` 从 1 开始）。 */
export function forgeHeatActive(rules: readonly ActRule[] | undefined, turn: number): boolean {
  if (!hasActRule(rules, "forgeHeat")) return false;
  return turn >= forgeHeatFromTurn(rules);
}

/** 溺亡挽歌启用时，单次敌人死亡给玩家的蚀锈层数（未启用 = 0）。 */
export function mourningStacks(rules: readonly ActRule[] | undefined): number {
  return hasActRule(rules, "mourning") ? MOURNING_STACKS_PER_DEATH : 0;
}
