/**
 * core/combat/play-card · 出牌判定与结算（docs/02 §3 / S3.2）
 *
 * 费用 / 目标 / 血契 HP / 关键词条件全部在 core 内校验，非法操作被核心拒绝。
 * 简单效果走 JSON effects；复杂机制走注册 handler（ADR-005）。
 */
import type { CardDefinition, CardEffect, KeywordId } from "../registry";
import { evaluateValue } from "../pipeline";
import { afterPlayDestination, pactHpCost } from "../keywords";
import { getCardHandler } from "../registry/handler";
import type { EventSink } from "../events/event-sink";
import { findUnit, livingEnemies, toDraft, type Draft } from "./draft";
import { loseHp, resolveEffects } from "./resolve";
import type { CardInstance, BattleState } from "./state";

export interface EffectiveCard {
  readonly cost: number;
  readonly effects: readonly CardEffect[];
  readonly play: CardDefinition["play"];
  readonly keywords: readonly KeywordId[];
  readonly bloodCost: number;
}

export function effectiveCard(def: CardDefinition, instance: CardInstance): EffectiveCard {
  const up = instance.upgraded ? def.upgraded : undefined;
  return {
    cost: up?.cost ?? def.cost,
    effects: up?.effects ?? def.effects ?? [],
    play: up?.play ?? def.play,
    keywords: up?.keywords ?? def.keywords ?? [],
    bloodCost: def.bloodCost ?? 0,
  };
}

export function cardEnergyCost(def: CardDefinition, instance: CardInstance): number {
  const effective = effectiveCard(def, instance);
  return evaluateValue("cardCost", effective.cost, []).value;
}

export type PlayValidation =
  | { readonly ok: true; readonly instance: CardInstance; readonly def: CardDefinition; readonly effective: EffectiveCard; readonly cost: number; readonly bloodPaid: number }
  | { readonly ok: false; readonly reason: string };

/** 出牌合法性校验：相位 / 手牌索引 / 费用 / 血契 HP / 目标。 */
export function validatePlayCard(draft: Draft, handIndex: number, targetId: string | null): PlayValidation {
  if (draft.phase !== "playerAction") return { ok: false, reason: `当前相位 ${draft.phase} 不能出牌` };
  if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= draft.hand.length) {
    return { ok: false, reason: "手牌索引非法" };
  }
  const instanceId = draft.hand[handIndex];
  const instance = draft.cardInstances[instanceId];
  if (!instance) return { ok: false, reason: "手牌实例不存在" };
  const def = draft.content.cards.get(instance.cardId);
  if (!def) return { ok: false, reason: `卡牌定义缺失：${instance.cardId}` };

  const effective = effectiveCard(def, instance);
  const cost = cardEnergyCost(def, instance);
  if (cost > draft.player.energy) return { ok: false, reason: `能量不足（需要 ${cost}，剩余 ${draft.player.energy}）` };

  const bloodPaid = pactHpCost(effective);
  if (bloodPaid >= draft.player.hp) {
    return { ok: false, reason: `血契代价过高（需要 ${bloodPaid} HP，当前 ${draft.player.hp}）` };
  }

  const effects = effective.play ? getCardHandler(effective.play.handler)(effective.play.params, { chosenTargetId: targetId }) : effective.effects;
  const needsChosen = effects.some((e) => (e.target?.type ?? (e.kind === "damage" ? "chosenEnemy" : "self")) === "chosenEnemy");
  if (needsChosen && targetId === null && livingEnemies(draft).length > 1) {
    return { ok: false, reason: "需要指定目标" };
  }

  return { ok: true, instance, def, effective, cost, bloodPaid };
}

/** UI 侧预检（不改状态），用于给出可读的拒绝理由。 */
export function validatePlayCardState(state: BattleState, handIndex: number, targetId: string | null): PlayValidation {
  return validatePlayCard(toDraft(state), handIndex, targetId);
}

export interface PlayCardOutcome {
  readonly ok: boolean;
  readonly reason?: string;
}

/** 结算一次出牌；校验失败时状态零改动。 */
export function playCard(draft: Draft, sink: EventSink, handIndex: number, targetId: string | null): PlayCardOutcome {
  const validation = validatePlayCard(draft, handIndex, targetId);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const { instance, def, effective, cost, bloodPaid } = validation;

  draft.player.energy -= cost;
  if (bloodPaid > 0) loseHp(draft, sink, "player", bloodPaid, "bloodpact");

  const [removed] = draft.hand.splice(handIndex, 1);
  sink.emit("CardPlayed", {
    cardId: instance.cardId,
    handIndex,
    targetId: targetId,
    costPaid: cost,
    bloodPaid,
  });

  const effects = effective.play
    ? getCardHandler(effective.play.handler)(effective.play.params, { chosenTargetId: targetId })
    : effective.effects;
  resolveEffects(draft, sink, effects, {
    sourceId: instance.instanceId,
    actorId: "player",
    chosenTargetId: targetId,
  });
  draft.cardsPlayedThisTurn += 1;

  const destination = afterPlayDestination(effective);
  if (destination === "exhaust") {
    draft.exhaust.push(removed);
    sink.emit("CardExhausted", { cardId: instance.cardId });
  } else {
    draft.discard.push(removed);
  }

  void def;
  void findUnit;
  return { ok: true };
}
