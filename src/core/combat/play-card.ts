/**
 * core/combat/play-card · 出牌判定与结算（docs/02 §3）
 *
 * 费用 / 目标 / 血契 HP / 关键词条件全部在 core 内校验，非法操作被核心拒绝。
 * 简单效果走 JSON effects；复杂机制走注册 handler；强化走 modifyCard / onHit（ADR-005），
 * 且强化数值一律经 layer:"enhancement" 的 Modifier 注入修饰符管线（ADR-003，可追溯）。
 */
import type { CardDefinition, CardEffect, KeywordId } from "../registry";
import { evaluateValue, type Modifier } from "../pipeline";
import { afterPlayDestination, pactHpCost } from "../keywords";
import { getCardHandler } from "../registry/handler";
import {
  getEnhancementHandler,
  type EnhancementContext,
  type EnhancementModifier,
} from "../registry/enhancement-handler";
import type { EventSink } from "../events/event-sink";
import { livingEnemies, toDraft, type Draft } from "./draft";
import { resolveRelics } from "./relics";
import { enqueueEffects, loseHp, resolveEffects } from "./resolve";
import type { CardInstance, BattleState } from "./state";

export interface EffectiveCard {
  /** 合并升级 + 关键词覆盖后的基础费用（未过管线） */
  readonly cost: number;
  /** 过 cardCost 管线的最终能量费用 */
  readonly energyCost: number;
  /** 过 hpCost 管线的最终卖血代价 */
  readonly bloodCost: number;
  readonly effects: readonly CardEffect[];
  readonly play: CardDefinition["play"];
  readonly keywords: readonly KeywordId[];
  /** 强化注入的全部修饰（含来源，便于日志追溯） */
  readonly modifiers: readonly Modifier[];
  readonly attackModifiers: readonly Modifier[];
  readonly blockModifiers: readonly Modifier[];
  readonly costModifiers: readonly Modifier[];
  readonly hpModifiers: readonly Modifier[];
}

interface EffectiveCardInput {
  readonly cost: number;
  readonly effects: readonly CardEffect[];
  readonly play: CardDefinition["play"];
  readonly keywords: readonly KeywordId[];
  /** 未过管线的卖血代价 */
  readonly baseBloodCost: number;
  readonly modifiers: readonly Modifier[];
}

function withComputed(input: EffectiveCardInput): EffectiveCard {
  const byKind = (kind: EnhancementModifier["kind"]): Modifier[] =>
    input.modifiers.filter((m) => m.value !== 0 && modifierKind(m) === kind);
  const costModifiers = byKind("cardCost");
  const hpModifiers = byKind("hpCost");
  return {
    cost: input.cost,
    effects: input.effects,
    play: input.play,
    keywords: input.keywords,
    modifiers: input.modifiers,
    energyCost: evaluateValue("cardCost", input.cost, costModifiers).value,
    bloodCost: Math.max(0, evaluateValue("hpCost", input.baseBloodCost, hpModifiers).value),
    attackModifiers: byKind("attackDamage"),
    blockModifiers: byKind("block"),
    costModifiers,
    hpModifiers,
  };
}

/** 修饰符的数值种类靠 sourceId 前缀携带（enh:<id>:<kind>），避免额外字段。 */
function modifierKind(modifier: Modifier): EnhancementModifier["kind"] {
  const parts = modifier.sourceId.split(":");
  return (parts[2] as EnhancementModifier["kind"]) ?? "attackDamage";
}

/** 合并「升级」后的卡面（不含强化）。 */
export function effectiveCard(def: CardDefinition, instance: CardInstance): EffectiveCard {
  const up = instance.upgraded ? def.upgraded : undefined;
  return withComputed({
    cost: up?.cost ?? def.cost,
    effects: up?.effects ?? def.effects ?? [],
    play: up?.play ?? def.play,
    keywords: up?.keywords ?? def.keywords ?? [],
    baseBloodCost: def.bloodCost ?? 0,
    modifiers: [],
  });
}

function enhancementContext(draft: Draft, hitIndex: number): EnhancementContext {
  return {
    hp: draft.player.hp,
    maxHp: draft.player.maxHp,
    pollution: draft.player.pollution,
    charge: draft.player.charge,
    buffs: draft.player.buffs,
    cardsPlayedThisTurn: draft.cardsPlayedThisTurn,
    handSize: draft.hand.length,
    hitIndex,
  };
}

/** 合并「升级 + 强化 modifyCard」后的卡面（出牌判定的真实依据）。 */
export function effectiveCardWithEnhancements(
  draft: Draft,
  instance: CardInstance,
  def: CardDefinition,
): EffectiveCard {
  const base = effectiveCard(def, instance);
  if (instance.enhancements.length === 0) return base;

  let effects = base.effects;
  let play = base.play;
  let keywords = base.keywords;
  const modifiers: Modifier[] = [];
  const ctx = enhancementContext(draft, 0);

  for (const enhancementId of instance.enhancements) {
    const enhancement = draft.content.enhancements.get(enhancementId);
    if (!enhancement) continue;
    const result = getEnhancementHandler(enhancement.handler).modifyCard?.(
      { def, effects, play },
      enhancement.params,
      ctx,
    );
    if (!result) continue;
    if (result.effects) effects = result.effects;
    if (result.play) play = result.play;
    if (result.keywords) keywords = result.keywords;
    for (const modifier of result.modifiers ?? []) {
      modifiers.push({
        sourceId: `enh:${enhancementId}:${modifier.kind}`,
        layer: "enhancement",
        op: modifier.op,
        value: modifier.value,
      });
    }
  }

  return withComputed({
    cost: base.cost,
    effects,
    play,
    keywords,
    baseBloodCost: base.bloodCost,
    modifiers,
  });
}

/** 仅按卡面（不含强化）估算费用——供模拟器 AI 等无 Draft 场景使用。 */
export function cardEnergyCost(def: CardDefinition, instance: CardInstance): number {
  return effectiveCard(def, instance).energyCost;
}

/** UI 预览：手牌索引 → 真实能量费用（含强化）。 */
export function previewEnergyCost(state: BattleState, handIndex: number): number {
  const draft = toDraft(state);
  const instanceId = draft.hand[handIndex];
  const instance = draft.cardInstances[instanceId];
  if (!instance) return 99;
  const def = draft.content.cards.get(instance.cardId);
  if (!def) return 99;
  return effectiveCardWithEnhancements(draft, instance, def).energyCost;
}

export type PlayValidation =
  | {
      readonly ok: true;
      readonly instance: CardInstance;
      readonly def: CardDefinition;
      readonly effective: EffectiveCard;
      readonly cost: number;
      readonly bloodPaid: number;
    }
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

  const effective = effectiveCardWithEnhancements(draft, instance, def);
  const cost = effective.energyCost;
  if (cost > draft.player.energy) {
    return { ok: false, reason: `能量不足（需要 ${cost}，剩余 ${draft.player.energy}）` };
  }

  const bloodPaid = pactHpCost({ keywords: effective.keywords, bloodCost: effective.bloodCost });
  if (bloodPaid >= draft.player.hp) {
    return { ok: false, reason: `血契代价过高（需要 ${bloodPaid} HP，当前 ${draft.player.hp}）` };
  }

  const effects = effective.play
    ? getCardHandler(effective.play.handler)(effective.play.params, { chosenTargetId: targetId })
    : effective.effects;
  const needsChosen = effects.some(
    (e) => (e.target?.type ?? (e.kind === "damage" ? "chosenEnemy" : "self")) === "chosenEnemy",
  );
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
  const { instance, effective, cost, bloodPaid } = validation;

  draft.player.energy -= cost;
  if (bloodPaid > 0) {
    loseHp(draft, sink, "player", bloodPaid, "bloodpact");
    resolveRelics(draft, sink, "onSell");
  }

  const [removed] = draft.hand.splice(handIndex, 1);
  sink.emit("CardPlayed", {
    cardId: instance.cardId,
    handIndex,
    targetId: targetId,
    costPaid: cost,
    bloodPaid,
  });
  resolveRelics(draft, sink, "onPlay");

  const effects = effective.play
    ? getCardHandler(effective.play.handler)(effective.play.params, { chosenTargetId: targetId })
    : effective.effects;

  /** 强化 onHit：多段攻击每段独立触发（低血沸腾三段 = 三次 onHit）。 */
  const onHit = (hitIndex: number): void => {
    for (const enhancementId of instance.enhancements) {
      const enhancement = draft.content.enhancements.get(enhancementId);
      if (!enhancement) continue;
      const handler = getEnhancementHandler(enhancement.handler);
      if (!handler.onHit) continue;
      const extra = handler.onHit(enhancement.params, enhancementContext(draft, hitIndex));
      if (extra.length > 0) {
        // 附加伤害不再叠加本卡的强化伤害修饰，避免重复计算；
        // 连锁动作只入栈，由当前结算循环 LIFO 弹出（ADR-002），不递归排空。
        enqueueEffects(draft, extra, {
          sourceId: instance.instanceId,
          actorId: "player",
          chosenTargetId: targetId,
        });
      }
    }
  };

  resolveEffects(draft, sink, effects, {
    sourceId: instance.instanceId,
    actorId: "player",
    chosenTargetId: targetId,
    onHit,
    attackModifiers: effective.attackModifiers,
    blockModifiers: effective.blockModifiers,
  });
  draft.cardsPlayedThisTurn += 1;

  const destination = afterPlayDestination(effective);
  if (destination === "exhaust") {
    draft.exhaust.push(removed);
    sink.emit("CardExhausted", { cardId: instance.cardId });
  } else {
    draft.discard.push(removed);
  }

  return { ok: true };
}
