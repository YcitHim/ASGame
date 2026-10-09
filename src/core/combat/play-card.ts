/**
 * core/combat/play-card · 出牌判定与结算（docs/02 §3）
 *
 * 费用 / 目标 / 血契 HP / 关键词条件全部在 core 内校验，非法操作被核心拒绝。
 * 简单效果走 JSON effects；复杂机制走注册 handler；强化走 modifyCard / onHit（ADR-005），
 * 且强化数值一律经 layer:"enhancement" 的 Modifier 注入修饰符管线（ADR-003，可追溯）。
 */
import type { CardDefinition, CardEffect, KeywordId } from "../registry";
import { buffStacks } from "../buffs";
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
import { resolveTriggers } from "./relics";
import { enqueueEffects, drainQueue, loseHp, resolveEffects } from "./resolve";
import {
  traitBurstHealPerStack,
  traitFirstAttackBonus,
  traitFirstCardDouble,
  traitFirstCardFree,
  traitEyeAvailable,
  traitSpreadsOverload,
} from "./trait";
import { fireRelicHandlers, relicFirstAttackBonus, relicFirstCardDouble } from "./relic-runtime";
import type { CardInstance, BattleState } from "./state";

export interface EffectiveCard {
  /** 合并升级 + 关键词覆盖后的基础费用（未过管线） */
  readonly cost: number;
  /** 过 cardCost 管线的最终能量费用 */
  readonly energyCost: number;
  /** 过 hpCost 管线的最终卖血代价 */
  readonly bloodCost: number;
  /** 打出前需支付的固定充能代价（docs/51 §二），不吃任何增幅 */
  readonly chargeCost: number;
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
  readonly chargeCost: number;
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
    chargeCost: Math.max(0, input.chargeCost),
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

/** 卡面效果是否打全体（决定「一波打出去」把超负荷转嫁给一个还是所有敌人）。 */
function isAoeCard(effects: readonly CardEffect[]): boolean {
  return effects.some(
    (e) => (e.target?.type ?? (e.kind === "damage" ? "chosenEnemy" : "self")) === "allEnemies",
  );
}

/** 合并「升级」后的卡面（不含强化）。 */
export function effectiveCard(def: CardDefinition, instance: CardInstance): EffectiveCard {
  const up = instance.upgraded ? def.upgraded : undefined;
  return withComputed({
    cost: up?.cost ?? def.cost,
    effects: up?.effects ?? def.effects ?? [],
    play: up?.play ?? def.play,
    keywords: up?.keywords ?? def.keywords ?? [],
    baseBloodCost: up?.bloodCost ?? def.bloodCost ?? 0,
    chargeCost: def.chargeCost ?? 0,
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
  const modifiers: Modifier[] = [];
  // 冰缓（docs/46 §3.7）：玩家侧手牌费用 +1，走 cardCost 的 buff 层（层数只决定持续回合）
  if (buffStacks(draft.player.buffs, "chill") > 0) {
    modifiers.push({ sourceId: "chill:buff:cardCost", layer: "buff", op: "add", value: 1 });
  }

  let effects = base.effects;
  let play = base.play;
  let keywords = base.keywords;
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
    // 颠倒（docs/46 §3.8）：本回合该牌的费用被随机覆盖为 0~3；没有颠倒时用卡面费用。
    // X 费（甲方 2026-10-08，红线运转）：费用 = 打牌前的当前能量——有多少花多少，
    // 因此 UI 预览与结算天然同源（两处都走这个函数）。
    cost:
      draft.reverseCosts[instance.instanceId] ??
      (def.costX === true ? Math.max(0, draft.player.energy) : base.cost),
    effects,
    play,
    keywords,
    baseBloodCost: base.bloodCost,
    chargeCost: base.chargeCost,
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
  // 触手（docs/58 §七.2）：本回合第一张牌不耗能——UI 与结算同源
  if (traitFirstCardFree(draft)) return 0;
  return effectiveCardWithEnhancements(draft, instance, def).energyCost;
}

/**
 * UI 预览：本回合神眼（docs/58 §七.2）是否可用。
 * 每回合一次 + 开局快照污染 ≥400（神眼档）才解锁；与 core 结算同源，避免 UI 与引擎口径漂移。
 */
export function eyeAvailable(state: BattleState): boolean {
  return traitEyeAvailable(toDraft(state));
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
  // 触手（docs/58 §七.2）：本回合第一张牌不耗能
  const cost = traitFirstCardFree(draft) ? 0 : effective.energyCost;
  if (cost > draft.player.energy) {
    return { ok: false, reason: `能量不足（需要 ${cost}，剩余 ${draft.player.energy}）` };
  }

  const bloodPaid = pactHpCost({ keywords: effective.keywords, bloodCost: effective.bloodCost });
  if (bloodPaid >= draft.player.hp) {
    return { ok: false, reason: `血契代价过高（需要 ${bloodPaid} HP，当前 ${draft.player.hp}）` };
  }
  // 充能代价（docs/51 §二）：不足就是打不出去，和能量/血量一个待遇
  if (effective.chargeCost > draft.player.charge) {
    return {
      ok: false,
      reason: `充能不足（需要 ${effective.chargeCost}，当前 ${draft.player.charge}）`,
    };
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
  const { instance, def, effective, cost, bloodPaid } = validation;

  // 红线运转要读「玩家眼里那个能量值」= 付掉本牌费用**之前**的能量
  const energyAtPlay = draft.player.energy;
  draft.player.energy -= cost;
  // 本回合累计花费（docs/64 商人算盘「每花费 5 能量回 1」）：免能（触手）与 0 费牌不计
  if (cost > 0) draft.energySpentThisTurn += cost;
  if (bloodPaid > 0) {
    loseHp(draft, sink, "player", bloodPaid, "bloodpact");
    resolveTriggers(draft, sink, "onSell");
  }
  // 充能代价：付了才继续（校验阶段已经确认付得起）
  if (effective.chargeCost > 0) {
    const before = draft.player.charge;
    draft.player.charge = before - effective.chargeCost;
    sink.emit("ChargeChanged", {
      targetId: "player",
      before,
      after: draft.player.charge,
      delta: -effective.chargeCost,
    });
  }

  const [removed] = draft.hand.splice(handIndex, 1);
  sink.emit("CardPlayed", {
    cardId: instance.cardId,
    handIndex,
    targetId: targetId,
    costPaid: cost,
    bloodPaid,
  });

  // —— 特性 / 遗物的出牌期结算（docs/58 §六/§七 + docs/64 §三）——
  // 未出牌计数仍停留在本张之前，正是"第一张"的判定窗口。
  const isAttack = def.type === "attack";
  const isFirstAttack = isAttack && draft.attackCardsPlayedThisTurn === 0;
  // 双结算：畸变大鲨臂（特性）与双重钟摆（遗物）OR 合并——同一回合只多结算一次，不叠成三次
  const doubleResolve = traitFirstCardDouble(draft) || relicFirstCardDouble(draft);
  const firstAttackBonus = isFirstAttack ? traitFirstAttackBonus(draft) : 0;
  // 磨刀石（docs/64 §四.2）：每场战斗第一张攻击牌 +N，每场一次（施加后记入 triggeredThisBattle）
  const relicFA = isFirstAttack ? relicFirstAttackBonus(draft) : null;
  if (firstAttackBonus > 0) {
    // 一波打出去（docs/58 §六.3）：附加等同当前充能的伤害，随后充能归零。
    // 消耗不经 changeCharge → 不触发过载、不派发 onGainCharge（沿用现有「消耗不过载」口径）。
    const before = draft.player.charge;
    draft.player.charge = 0;
    sink.emit("ChargeChanged", { targetId: "player", before, after: 0, delta: -before });
  }

  // 「本回合已出牌数」在触发 onPlay 之前递增：
  // 这样「当你打出本回合第 N 张牌时」类遗物/能力读到的是**含当前这张**的计数，
  // 而不是差一张。计数原本在结算末尾递增，数据侧当时无人引用它，故本次前移无观测差异
  // （golden 7 盘哈希已复核）。
  draft.cardsPlayedThisTurn += 1;
  if (isAttack) draft.attackCardsPlayedThisTurn += 1;
  resolveTriggers(draft, sink, "onPlay");
  // 遗物出牌钩子（docs/64 商人算盘「能量回流」）：与数据派发同点（计数自增之后）
  fireRelicHandlers(draft, sink, "onPlay");

  const effects = effective.play
    ? getCardHandler(effective.play.handler)(effective.play.params, { chosenTargetId: targetId })
    : effective.effects;

  // 玻璃大炮「一波打出去」的第二段（docs/58 §六.3，甲方 2026-10-07 三次修订）：
  // 本回合第一张攻击牌把自身的超负荷**整体转嫁**给目标（AoE → 全体敌人），自身清零。
  // **必须先转嫁、再结算伤害**——转嫁到手的「每层受伤 +1」要算进这一击；
  // 顺序反了（伤害在前）这一击就凭空少一截。用「挂进现有结算管线」的方式施加，不新造平行系统。
  const spreadEffects: CardEffect[] = [];
  if (isFirstAttack && traitSpreadsOverload(draft)) {
    const stacks = buffStacks(draft.player.buffs, "overload");
    if (stacks > 0) {
      draft.player.buffs = draft.player.buffs.filter((b) => b.id !== "overload");
      sink.emit("BuffExpired", { targetId: "player", buffId: "overload" });
      spreadEffects.push({
        kind: "applyBuff",
        target: { type: isAoeCard(effects) ? "allEnemies" : "chosenEnemy" },
        buff: "overload",
        stacks,
      });
      // A2（docs/67 §2.1）：爆发 = 泄压——按转嫁出去的层数回血。
      // 攒了一路的毒连本带利甩给对面，自己喘一口气；爽点与续航合一。
      const healPer = traitBurstHealPerStack(draft);
      if (healPer > 0) {
        spreadEffects.push({ kind: "heal", target: { type: "self" }, value: stacks * healPer });
      }
    }
  }

  /** 强化 onHit：多段攻击每段独立触发（低血沸腾三段 = 三次 onHit）。 */
  const onHit = (hitIndex: number, hitTargetId: string): void => {
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
    // 卡牌能力 onHit：与强化 onHit 同构，多段攻击每段独立触发。
    // 修复「飞锈」等 onHit 能力永不派发的问题（resolveTriggers 原本无 onHit 派发点）。
    resolveTriggers(draft, sink, "onHit", { inline: true, targetId: hitTargetId });
    // 遗物命中钩子（docs/64 酸洗线圈）：与卡牌能力 onHit 同点、同目标
    fireRelicHandlers(draft, sink, "onHit", { targetId: hitTargetId });
  };

  // 转嫁效果排在卡面效果**之前**入队（enqueueEffects 倒序压栈 → 弹出即书写顺序）：
  // 先给目标挂上超负荷，本牌的伤害再吃到「目标超负荷 → 受伤 +层数」。
  resolveEffects(draft, sink, spreadEffects.length > 0 ? [...spreadEffects, ...effects] : effects, {
    sourceId: instance.instanceId,
    actorId: "player",
    chosenTargetId: targetId,
    onHit,
    energyAtPlay,
    attackModifiers: (() => {
      const mods = [...effective.attackModifiers];
      if (firstAttackBonus > 0) {
        mods.push({
          sourceId: `trait:${draft.traitId ?? ""}:firstAttackCharge`,
          layer: "buff" as const,
          op: "add" as const,
          value: firstAttackBonus,
        });
      }
      if (relicFA) {
        mods.push({
          sourceId: `relic:${relicFA.relicId}:firstAttack`,
          layer: "buff" as const,
          op: "add" as const,
          value: relicFA.bonus,
        });
      }
      return mods;
    })(),
    blockModifiers: effective.blockModifiers,
  });

  // 畸变大鲨臂（docs/58 §七.2）：每回合第一张牌结算两次——第二次入队（免能、sourceId 同卡），
  // 复用栈式动作队列，**不加全局倍率上下文**。
  if (doubleResolve) {
    enqueueEffects(draft, effects, {
      sourceId: instance.instanceId,
      actorId: "player",
      chosenTargetId: targetId,
      energyAtPlay,
      attackModifiers: effective.attackModifiers,
      blockModifiers: effective.blockModifiers,
    });
    drainQueue(draft, sink);
  }
  // 常驻能力（power）：本场生效，按实例记录（升级版走 def.upgraded.power）
  if ((def.power ?? def.upgraded?.power) && !draft.player.powers.includes(instance.instanceId)) {
    draft.player.powers.push(instance.instanceId);
  }

  // 磨刀石每场一次：加伤已随本牌结算，记入整场触发册（docs/64 §三）
  if (relicFA) draft.player.triggeredThisBattle.push(relicFA.relicId);

  const destination = afterPlayDestination(effective);
  if (destination === "exhaust") {
    draft.exhaust.push(removed);
    sink.emit("CardExhausted", { cardId: instance.cardId });
    // 燔祭之书（docs/64 §四.4）：「打出」消耗牌才派发——回合末手牌被消耗不算打出
    fireRelicHandlers(draft, sink, "onExhaust");
    // 卡牌能力 / 强化注入的 onExhaust（docs/66 批 3 余烬引线）：与遗物同点、同口径
    resolveTriggers(draft, sink, "onExhaust");
  } else {
    draft.discard.push(removed);
  }

  return { ok: true };
}
