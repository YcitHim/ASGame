/**
 * core/combat · 遗物规则运行时（docs/64 §三）
 *
 * 把「玩家挂了哪些规则遗物」收敛成一处：引擎任何位置想问遗物能力，
 * 都走这里，而不是四处 `if (relics.includes("..."))`（docs/58 铁律 6 同款护栏）。
 * 遗物本体（参数）在 data/relics/*.json，逻辑在 registry/relic-handler。
 *
 * 数据驱动的 { timing, effects } 派发仍在 relics.ts（resolveTriggers）——
 * 这里只管 handler 问询与 handler 触发（onHeal / onKill / onExhaust）。
 */
import type { ContentDb, RelicDefinition } from "../registry/content";
import {
  getRelicHandler,
  type CheatDeathRule,
  type KeepBlockRule,
  type PollutionOverflowRule,
  type RelicHandler,
  type RelicHandlerContext,
} from "../registry/relic-handler";
import type { EventSink } from "../events/event-sink";
import { resolveEffectsInline, PLAYER_ID } from "./resolve";
import type { Draft } from "./draft";

export interface ActiveRelic {
  readonly def: RelicDefinition;
  readonly handler: RelicHandler;
}

/** 玩家持有的、挂了 handler 的全部遗物（无 handler 的纯数据件不在此列）。 */
export function activeRelics(draft: Draft): ActiveRelic[] {
  const out: ActiveRelic[] = [];
  for (const id of draft.player.relics) {
    const def = draft.content.relics.get(id);
    if (!def?.handler) continue;
    out.push({ def, handler: getRelicHandler(def.handler) });
  }
  return out;
}

function relicCtx(draft: Draft, firesThisTurn: number, healAmount?: number): RelicHandlerContext {
  return {
    hp: draft.player.hp,
    maxHp: draft.player.maxHp,
    pollution: draft.player.pollution,
    charge: draft.player.charge,
    block: draft.player.block,
    buffs: draft.player.buffs,
    cardsPlayedThisTurn: draft.cardsPlayedThisTurn,
    attackCardsPlayedThisTurn: draft.attackCardsPlayedThisTurn,
    energySpentThisTurn: draft.energySpentThisTurn,
    handSize: draft.hand.length,
    turn: draft.turn,
    firesThisTurn,
    healAmount,
  };
}

export type RelicHook = "onHeal" | "onKill" | "onExhaust" | "onHit" | "onPlay";

/**
 * 按钩子派发全部遗物 handler（onHeal / onKill / onExhaust / onHit）。
 * 每个 (遗物, 钩子) 的本回合触发计数住在 draft.relicFiresThisTurn，
 * 回合计数在 resetTurnRelics 一并清零；perTurn 上限由 handler 自己判（读 ctx.firesThisTurn）。
 * 效果走内联结算（与 onPollutionMax 同通道）——这些钩子都在结算中途触发，必须当帧生效。
 */
export function fireRelicHandlers(
  draft: Draft,
  sink: EventSink,
  hook: RelicHook,
  opts: { healAmount?: number; targetId?: string | null } = {},
): void {
  for (const { def, handler } of activeRelics(draft)) {
    const fn = handler[hook];
    if (!fn) continue;
    const key = `${def.id}:${hook}`;
    const fires = draft.relicFiresThisTurn[key] ?? 0;
    const effects = fn.call(handler, def.params ?? {}, relicCtx(draft, fires, opts.healAmount));
    if (effects.length === 0) continue;
    draft.relicFiresThisTurn[key] = fires + 1;
    resolveEffectsInline(draft, sink, effects, {
      sourceId: `relic:${def.id}`,
      actorId: PLAYER_ID,
      chosenTargetId: opts.targetId ?? null,
      fromTrigger: true,
      triggerTiming: hook,
    });
  }
}

/** 每回合第一张牌结算两次（双重钟摆）：与大鲨臂特性 OR 合并（不会叠成三次）。 */
export function relicFirstCardDouble(draft: Draft): boolean {
  if (draft.cardsPlayedThisTurn !== 0) return false;
  return activeRelics(draft).some(({ def, handler }) => handler.firstCardDouble?.(def.params ?? {}) === true);
}

/**
 * 每场战斗第一张攻击牌的遗物加伤（磨刀石）：每场一次。
 * 返回 { relicId, bonus }；施加方负责把 relicId 记入 triggeredThisBattle。
 */
export function relicFirstAttackBonus(draft: Draft): { relicId: string; bonus: number } | null {
  if (draft.attackCardsPlayedThisTurn !== 0) return null;
  for (const { def, handler } of activeRelics(draft)) {
    if (!handler.firstAttackBonus) continue;
    if (draft.player.triggeredThisBattle.includes(def.id)) continue;
    const bonus = handler.firstAttackBonus(def.params ?? {});
    if (bonus > 0) return { relicId: def.id, bonus };
  }
  return null;
}

/** 回合开始清格挡点的改写（镜面装甲 / 夜春蛋苯）；无此遗物 → null（走 resolveTenacity 旧逻辑）。
 *  多件持有时取「保留比例最高」（平手取上限高者）——玩家直觉是「按最厚的那件算」。 */
export function relicKeepBlock(draft: Draft): KeepBlockRule | null {
  let best: KeepBlockRule | null = null;
  for (const { def, handler } of activeRelics(draft)) {
    const rule = handler.keepBlock?.(def.params ?? {});
    if (!rule) continue;
    if (!best || rule.ratio > best.ratio || (rule.ratio === best.ratio && rule.cap > best.cap)) best = rule;
  }
  return best;
}

/** 战斗开始的「HP → 格挡」转化问询（夜春蛋苯）；无此遗物 → null。 */
export function relicHpToBlockOnStart(draft: Draft): { relicId: string; ratio: number; hpLeft: number } | null {
  for (const { def, handler } of activeRelics(draft)) {
    const rule = handler.hpToBlockOnStart?.(def.params ?? {});
    if (rule) return { relicId: def.id, ratio: rule.ratio, hpLeft: rule.hpLeft };
  }
  return null;
}

/** HP 归零时的免死问询（第二颗心脏）：每场一次（已触发 → null）。 */
export function relicCheatDeath(draft: Draft): { relicId: string; rule: CheatDeathRule } | null {
  for (const { def, handler } of activeRelics(draft)) {
    if (!handler.cheatDeath) continue;
    if (draft.player.triggeredThisBattle.includes(def.id)) continue;
    return { relicId: def.id, rule: handler.cheatDeath(def.params ?? {}) };
  }
  return null;
}

/** 污染触顶反噬的参数化（泄压阀）；无此遗物 → null（走反噬 10 + 清零的旧逻辑）。 */
export function relicPollutionOverflow(draft: Draft): PollutionOverflowRule | null {
  for (const { def, handler } of activeRelics(draft)) {
    const rule = handler.pollutionOverflow?.(def.params ?? {});
    if (rule) return rule;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * run 层问询（stores/run.ts 调用；此处不依赖 Draft）
 * ------------------------------------------------------------------ */

/** 战斗胜利后的局外成长（朝圣者之铃）：聚合全部持有遗物的 maxHp / heal 增量。 */
export function relicBattleWinGrowth(
  content: ContentDb,
  relicIds: readonly string[],
): { maxHpDelta: number; heal: number } {
  let maxHpDelta = 0;
  let heal = 0;
  for (const id of relicIds) {
    const def = content.relics.get(id);
    if (!def?.handler) continue;
    const r = getRelicHandler(def.handler).onBattleWinRun?.(def.params ?? {});
    if (!r) continue;
    maxHpDelta += r.maxHpDelta ?? 0;
    heal += r.heal ?? 0;
  }
  return { maxHpDelta, heal };
}

/** 获得遗物时的局外结算（寻锈杖；含获得自身这一刻）：聚合回血量。 */
export function relicRelicGainHeal(content: ContentDb, relicIds: readonly string[]): number {
  let heal = 0;
  for (const id of relicIds) {
    const def = content.relics.get(id);
    if (!def?.handler) continue;
    const r = getRelicHandler(def.handler).onRelicGainRun?.(def.params ?? {});
    heal += r?.heal ?? 0;
  }
  return heal;
}
