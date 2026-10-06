/**
 * core/combat/resolve · 战斗结算原语
 *
 * 所有数值走修饰符管线；所有状态变更发事件；本文件不出现具体卡牌特判
 * （卡牌逻辑在 registry/handler 与 data JSON）。
 */
import { applyBuff, buffApplication, buffStacks, tickBuffs, type BuffInstance } from "../buffs";
import type { EventSink } from "../events/event-sink";
import { evaluateValue, type Modifier } from "../pipeline";
import { getEnhancementHandler } from "../registry/enhancement-handler";
import type { BuffId } from "../registry/ids";
import { DIFFICULTY_PARAMS, type CardEffect, type ConditionNode, type TargetRef } from "../registry/content";
import { evaluateCondition, type ConditionContext } from "../registry/condition";
import { getTarget } from "../registry/target";
import { findUnit, livingEnemies, type Draft, type MutableUnit } from "./draft";
import { resolveTriggers } from "./relics";
import type { EffectContext, EffectWork } from "./work";

export const POLLUTION_CRITICAL = 80;
export const POLLUTION_MAX = 100;
export const POLLUTION_BACKLASH = 10;
export const POLLUTION_CRITICAL_DAMAGE = 2;
export const CHARGE_LIMIT = 10;
export const CHARGE_BACKLASH = 5;
export const PLAYER_ID = "player";

export function conditionContext(draft: Draft): ConditionContext {
  return {
    hp: draft.player.hp,
    maxHp: draft.player.maxHp,
    pollution: draft.player.pollution,
    charge: draft.player.charge,
    buffs: draft.player.buffs,
    cardsPlayedThisTurn: draft.cardsPlayedThisTurn,
    handSize: draft.hand.length,
    tookDamageThisTurn: draft.tookDamageThisTurn,
    // 卡牌条件默认读玩家；意图表会用 enemyConditionContext 覆盖 self
    self: { hp: draft.player.hp, maxHp: draft.player.maxHp, buffs: draft.player.buffs },
  };
}

/** 意图生成用的条件上下文：self = 该敌人自己（策划 Q13 阶段切换）。 */
export function enemyConditionContext(draft: Draft, enemyId: string): ConditionContext {
  const base = conditionContext(draft);
  const enemy = draft.enemies.find((e) => e.id === enemyId);
  if (!enemy) return base;
  return { ...base, self: { hp: enemy.hp, maxHp: enemy.maxHp, buffs: enemy.buffs } };
}

export function unitBuffs(draft: Draft, id: string): readonly BuffInstance[] {
  return findUnit(draft, id)?.buffs ?? [];
}

/** 攻击修饰：加区先于乘区由管线保证；此处只负责收集。 */
export function attackModifiers(draft: Draft, actorId: string, targetId: string): Modifier[] {
  const mods: Modifier[] = [];
  const actor = unitBuffs(draft, actorId);
  const target = unitBuffs(draft, targetId);

  // 本场临时修饰（血锈光环等）：只作用于玩家自己
  if (actorId === PLAYER_ID) {
    for (const m of draft.modifiers) {
      if (m.kind === undefined || m.kind === "attackDamage") mods.push(m);
    }
  }

  const strength = buffStacks(actor, "strength");
  if (strength > 0) mods.push({ sourceId: "strength", layer: "buff", op: "add", value: strength });

  if (actorId === PLAYER_ID && draft.player.charge > 0) {
    mods.push({ sourceId: "charge", layer: "buff", op: "add", value: draft.player.charge });
  }

  if (buffStacks(actor, "weak") > 0) {
    mods.push({ sourceId: "weak", layer: "buff", op: "mul", value: 0.75 });
  }
  if (buffStacks(target, "vulnerable") > 0) {
    mods.push({ sourceId: "vulnerable", layer: "buff", op: "mul", value: 1.5 });
  }
  // 锈蚀难度：敌人打出的伤害上浮（docs/36 T2）。只作用于敌方攻击者，
  // 反伤 / 环境伤害的 actorId 不是敌人实例，自然不吃倍率。
  if (actorId !== PLAYER_ID) {
    const mul = DIFFICULTY_PARAMS[draft.difficulty].enemyDamageMul;
    if (mul !== 1) mods.push({ sourceId: "difficulty", layer: "buff", op: "mul", value: mul });
  }
  return mods;
}

export function resolveTargets(
  draft: Draft,
  ref: TargetRef | undefined,
  actorId: string,
  chosenTargetId: string | null,
): string[] {
  const fn = getTarget(ref?.type ?? "chosenEnemy");
  return fn({
    actorId,
    chosenTargetId,
    enemies: livingEnemies(draft).map((e) => ({ id: e.id, hp: e.hp })),
    rng: draft.rng,
  });
}

export interface DamageArgs {
  sourceId: string;
  actorId: string;
  targetId: string;
  base: number;
  segment?: number;
  segments?: number;
  /** 显式覆盖修饰列表（一般不传，由攻击/目标 Buff 自动推导） */
  modifiers?: readonly Modifier[];
  /** 额外修饰（强化层等），追加在自动推导的修饰之后 */
  extraModifiers?: readonly Modifier[];
  /** 该次伤害是反伤：不触发二次反伤 */
  reflect?: boolean;
}

/** 单次伤害：基础值 → 修饰管线 → 格挡吸收 → HP → 死亡检查。 */
export function dealDamage(draft: Draft, sink: EventSink, args: DamageArgs): void {
  const target = findUnit(draft, args.targetId);
  if (!target || target.hp <= 0) return;

  const auto = args.modifiers ?? attackModifiers(draft, args.actorId, args.targetId);
  const modifiers = args.extraModifiers?.length ? [...auto, ...args.extraModifiers] : auto;
  const evaluated = evaluateValue("attackDamage", args.base, modifiers);
  const value = evaluated.value;
  const blocked = Math.min(target.block, value);
  const hpLost = value - blocked;
  target.block -= blocked;
  if (blocked > 0 && target.block === 0) {
    sink.emit("BlockBroken", { targetId: args.targetId, value: blocked });
  }
  target.hp = Math.max(0, target.hp - hpLost);

  sink.emit("DamageDealt", {
    sourceId: args.sourceId,
    targetId: args.targetId,
    base: args.base,
    layers: evaluated.layers,
    value,
    blocked,
    hpLost,
    segment: args.segment ?? 1,
    segments: args.segments ?? 1,
  });
  if (hpLost > 0) {
    sink.emit("HpLost", { targetId: args.targetId, value: hpLost, reason: "damage" });
    // 「本回合事件回看」：只记玩家被攻击掉血（血迹自伤 / 污染反噬不算，docs/16 P2.3）
    if (args.targetId === PLAYER_ID) draft.tookDamageThisTurn = true;
  }

  // 反伤（荆棘血痂）：受攻击即对攻击者造成固定伤害，逐段触发、走队列中途插入
  triggerThorns(draft, sink, args);

  if (target.hp === 0) {
    killUnit(draft, sink, args.targetId);
    // 击杀触发（docs/23 §1「血偿」）：死亡清理 + 亡语之后，再结算伤害来源牌上的 onKill
    triggerEnhancementOnKill(draft, sink, args);
  }
}

/**
 * 击杀触发：伤害来源是"装备了 onKill 强化的牌"时，结算该强化返回的附加动作。
 * 反伤 / 敌人攻击的 sourceId 不是卡牌实例，自然不命中。
 */
function triggerEnhancementOnKill(draft: Draft, sink: EventSink, args: DamageArgs): void {
  if (args.actorId !== PLAYER_ID) return;
  const instance = draft.cardInstances[args.sourceId];
  if (!instance || instance.enhancements.length === 0) return;

  for (const enhancementId of instance.enhancements) {
    const def = draft.content.enhancements.get(enhancementId);
    if (!def) continue;
    const handler = getEnhancementHandler(def.handler);
    if (!handler.onKill) continue;
    const extra = handler.onKill(def.params, { ...conditionContext(draft), hitIndex: 0 });
    if (extra.length > 0) {
      enqueueEffects(draft, extra, {
        sourceId: args.sourceId,
        actorId: PLAYER_ID,
        chosenTargetId: args.targetId,
      });
      drainQueue(draft, sink);
    }
  }
}

/**
 * 直接入栈一个已解析目标的伤害动作。
 * 反伤这类"目标由上下文决定（就是攻击者）"的触发走这里——目标选择器无法表达"攻击者"。
 */
function enqueueDamageWork(
  draft: Draft,
  effect: CardEffect,
  ctx: EffectContext,
  targetIds: readonly string[],
  reflect: boolean,
): void {
  draft.queue.push({
    id: nextWorkId(),
    sourceId: ctx.actorId,
    targetIds,
    payload: { effect, ctx, targetIds, damageIndex: 1, damageTotal: 1, reflect },
  });
}

function triggerThorns(draft: Draft, sink: EventSink, args: DamageArgs): void {
  if (args.reflect) return;
  if (args.actorId === args.targetId) return;
  const stacks = buffStacks(unitBuffs(draft, args.targetId), "thorns");
  if (stacks <= 0) return;
  const attacker = findUnit(draft, args.actorId);
  if (!attacker || attacker.hp <= 0) return;

  sink.emit("BuffTriggered", { targetId: args.targetId, buffId: "thorns", stacks });
  enqueueDamageWork(
    draft,
    { kind: "damage", value: stacks },
    { sourceId: args.targetId, actorId: args.targetId, chosenTargetId: null },
    [args.actorId],
    true,
  );
  // 连锁结算中（draining）只入栈，由当前循环 LIFO 弹出，保证"每段之后立即结算"；
  // 敌人回合的直接调用不在排空循环里，这里会立即结算。
  drainQueue(draft, sink);
}

export function gainBlock(
  draft: Draft,
  sink: EventSink,
  targetId: string,
  base: number,
  extraModifiers?: readonly Modifier[],
): void {
  const unit = findUnit(draft, targetId);
  if (!unit || unit.hp <= 0) return;
  const evaluated = evaluateValue("block", base, extraModifiers ?? []);
  unit.block += evaluated.value;
  sink.emit("BlockGained", { targetId, value: evaluated.value, total: unit.block });
}

export function healUnit(
  draft: Draft,
  sink: EventSink,
  targetId: string,
  base: number,
  reason: "regen" | "card" | "relic",
): void {
  const unit = findUnit(draft, targetId);
  if (!unit || unit.hp <= 0) return;
  const evaluated = evaluateValue("heal", base, []);
  const healed = Math.min(evaluated.value, unit.maxHp - unit.hp);
  if (healed <= 0) return;
  unit.hp += healed;
  sink.emit("HpHealed", { targetId, value: healed, total: unit.hp, reason });
}

export function loseHp(
  draft: Draft,
  sink: EventSink,
  targetId: string,
  value: number,
  reason: "bloodpact" | "pollution" | "backlash",
): void {
  const unit = findUnit(draft, targetId);
  if (!unit || value <= 0) return;
  const lost = Math.min(unit.hp, value);
  unit.hp -= lost;
  sink.emit("HpLost", { targetId, value: lost, reason });
  if (unit.hp === 0) killUnit(draft, sink, targetId);
}

/** amount 是"卡面参数"：强度型=层数，计时型=回合数（策划 Q1）。 */
export function applyBuffToTarget(
  draft: Draft,
  sink: EventSink,
  targetId: string,
  buffId: BuffId,
  amount: number,
  explicitDuration?: number | null,
): void {
  if (buffId === "pollution" && targetId === PLAYER_ID) {
    changePollution(draft, sink, amount);
    return;
  }
  const unit = findUnit(draft, targetId);
  if (!unit || unit.hp <= 0) return;
  const application = buffApplication(buffId, amount, explicitDuration);
  unit.buffs = applyBuff(unit.buffs, { id: buffId, ...application });
  const applied = unit.buffs.find((b) => b.id === buffId);
  sink.emit("BuffApplied", {
    targetId,
    buffId,
    stacks: applied?.stacks ?? application.stacks,
    duration: applied?.duration ?? application.duration,
  });
}

function setPollutionMirror(buffs: readonly BuffInstance[], value: number): BuffInstance[] {
  const others = buffs.filter((b) => b.id !== "pollution");
  return value > 0 ? [...others, { id: "pollution", stacks: value, duration: null }] : others;
}

/** 污染变化：满值立即反噬（docs/03 §4 决策），不延迟到回合开始。 */
export function changePollution(draft: Draft, sink: EventSink, delta: number): void {
  const before = draft.player.pollution;
  const after = Math.max(0, Math.min(POLLUTION_MAX, before + delta));
  draft.player.pollution = after;
  draft.player.buffs = setPollutionMirror(draft.player.buffs, after);
  sink.emit("PollutionChanged", {
    targetId: PLAYER_ID,
    before,
    after,
    delta: after - before,
    critical: after >= POLLUTION_CRITICAL,
  });

  if (after >= POLLUTION_MAX && before < POLLUTION_MAX) {
    draft.player.pollution = 0;
    draft.player.buffs = setPollutionMirror(draft.player.buffs, 0);
    sink.emit("PollutionChanged", {
      targetId: PLAYER_ID,
      before: after,
      after: 0,
      delta: -after,
      critical: false,
    });
    loseHp(draft, sink, PLAYER_ID, POLLUTION_BACKLASH, "pollution");
  }
}

export function changeCharge(
  draft: Draft,
  sink: EventSink,
  delta: number,
  /** 触发器自身造成的充能变化（docs/29 §二⑥ 飞升齿轮）：不再派发 onGainCharge，防自触发死循环 */
  suppressTriggers = false,
): void {
  const before = draft.player.charge;
  const after = Math.max(0, before + delta);
  draft.player.charge = after;
  sink.emit("ChargeChanged", { targetId: PLAYER_ID, before, after, delta: after - before });

  // 获得充能触发（docs/29 §二⑥ 飞升齿轮）：仅在真的加充能、且来源不是触发器本身时派发
  if (after > before && !suppressTriggers) resolveTriggers(draft, sink, "onGainCharge");

  if (after > CHARGE_LIMIT) {
    sink.emit("Overloaded", { targetId: PLAYER_ID, charge: after, backlash: CHARGE_BACKLASH });
    loseHp(draft, sink, PLAYER_ID, CHARGE_BACKLASH, "backlash");
    draft.player.charge = 0;
    sink.emit("ChargeChanged", { targetId: PLAYER_ID, before: after, after: 0, delta: -after });
  }
}

/** 相位 tick：计时型衰减 + 汇总到期事件。 */
export function tickAllBuffs(draft: Draft, sink: EventSink, timing: "turnStart" | "turnEnd"): void {
  const playerTick = tickBuffs(draft.player.buffs, timing);
  draft.player.buffs = [...playerTick.buffs];
  for (const b of playerTick.expired) sink.emit("BuffExpired", { targetId: PLAYER_ID, buffId: b.id });

  for (const enemy of draft.enemies) {
    if (enemy.hp <= 0) continue;
    const tick = tickBuffs(enemy.buffs, timing);
    enemy.buffs = [...tick.buffs];
    for (const b of tick.expired) sink.emit("BuffExpired", { targetId: enemy.id, buffId: b.id });
  }
}

/** 再生：回合开始按层数回血。 */
export function resolveRegeneration(draft: Draft, sink: EventSink): void {
  for (const enemy of [draft.player, ...draft.enemies]) {
    if (enemy.hp <= 0) continue;
    const stacks = buffStacks(enemy.buffs, "regeneration");
    if (stacks > 0) healUnit(draft, sink, enemy.id, stacks, "regen");
  }
}

/** 污染临界：回合开始按临界惩罚掉血。 */
export function resolvePollutionCritical(draft: Draft, sink: EventSink): void {
  if (draft.player.pollution >= POLLUTION_CRITICAL) {
    loseHp(draft, sink, PLAYER_ID, POLLUTION_CRITICAL_DAMAGE, "pollution");
  }
}

/** 抽牌；堆空时把弃牌堆洗入（唯一合法洗牌入口）。 */
export function drawCards(draft: Draft, sink: EventSink, count: number): string[] {
  const drawn: string[] = [];
  for (let i = 0; i < count; i += 1) {
    if (draft.draw.length === 0) {
      if (draft.discard.length === 0) break;
      draft.draw = draft.rng.stream("combat").shuffle(draft.discard);
      sink.emit("DeckShuffled", { from: "discard", count: draft.draw.length });
      draft.discard = [];
    }
    const card = draft.draw.shift();
    if (card === undefined) break;
    draft.hand.push(card);
    drawn.push(card);
  }
  sink.emit("CardsDrawn", { cardIds: drawn });
  return drawn;
}

export type { EffectContext } from "./work";

function defaultTarget(effect: CardEffect): TargetRef {
  if (effect.target) return effect.target;
  if (effect.kind === "damage") return { type: "chosenEnemy" };
  return { type: "self" };
}

let workSeq = 0;
function nextWorkId(): string {
  workSeq += 1;
  return `w${workSeq}`;
}

/**
 * 死亡处理：先做死亡清理（取消该单位挂起的动作，计数写进 UnitDied），
 * 再结算亡语（onDeath，docs/16 P2.2）——顺序不可颠倒。
 */
export function killUnit(draft: Draft, sink: EventSink, unitId: string): number {
  const cleared = draft.queue.removeByUnit(unitId).length;
  sink.emit("UnitDied", { unitId, clearedEffects: cleared });

  const enemy = draft.enemies.find((e) => e.id === unitId);
  const deathEffects = enemy ? draft.content.enemies.get(enemy.defId)?.onDeath : undefined;
  if (deathEffects && deathEffects.length > 0) {
    enqueueEffects(draft, deathEffects, { sourceId: unitId, actorId: unitId, chosenTargetId: null });
    drainQueue(draft, sink);
  }
  return cleared;
}

/**
 * 把效果列表解析成栈上的动作（ADR-002）。
 * 条件与目标在此刻快照；倒序压栈，弹出时仍是卡面书写顺序。
 */
export function enqueueEffects(
  draft: Draft,
  effects: readonly CardEffect[],
  ctx: EffectContext,
): void {
  const damageTotal = effects.filter((e) => e.kind === "damage").length;
  const pending: EffectWork[] = [];
  let damageIndex = 0;
  for (const effect of effects) {
    if (!evaluateCondition(effect.condition, conditionContext(draft))) continue;
    if (effect.kind === "damage") damageIndex += 1;
    const targetIds = resolveTargets(draft, defaultTarget(effect), ctx.actorId, ctx.chosenTargetId);
    pending.push({ effect, ctx, targetIds, damageIndex, damageTotal });
  }
  for (let i = pending.length - 1; i >= 0; i -= 1) {
    const work = pending[i];
    draft.queue.push({
      id: nextWorkId(),
      sourceId: ctx.actorId,
      targetIds: work.targetIds,
      payload: work,
    });
  }
}

function executeWork(draft: Draft, sink: EventSink, work: EffectWork): void {
  const { effect, ctx, targetIds, damageIndex, damageTotal } = work;
  const value = effect.value ?? 0;

  switch (effect.kind) {
    case "damage":
      for (const t of targetIds) {
        dealDamage(draft, sink, {
          sourceId: ctx.sourceId,
          actorId: ctx.actorId,
          targetId: t,
          base: value,
          segment: damageIndex,
          segments: damageTotal,
          extraModifiers: ctx.attackModifiers,
          // 反伤是固定伤害：不走攻击修饰（力量/充能/易伤都不该放大它）
          ...(work.reflect ? { reflect: true, modifiers: [] } : {}),
        });
        ctx.onHit?.(damageIndex, t);
      }
      break;
    case "block":
      for (const t of targetIds) {
        const before = findUnit(draft, t)?.block ?? 0;
        gainBlock(draft, sink, t, value, ctx.blockModifiers);
        const after = findUnit(draft, t)?.block ?? 0;
        // 获得格挡触发（docs/29 §一②）：只在真的拿到格挡时派发，避免 0 值刷触发
        if (t === PLAYER_ID && after > before) resolveTriggers(draft, sink, "onBlock");
      }
      break;
    case "draw":
      drawCards(draft, sink, value);
      break;
    case "heal":
      for (const t of targetIds) healUnit(draft, sink, t, value, "card");
      break;
    case "applyBuff":
      if (effect.buff) {
        for (const t of targetIds) {
          applyBuffToTarget(draft, sink, t, effect.buff as BuffId, effect.stacks ?? 1, effect.duration);
        }
      }
      break;
    case "gainEnergy":
      draft.player.energy += value;
      break;
    case "gainPollution":
      changePollution(draft, sink, value);
      break;
    case "gainCharge":
      changeCharge(draft, sink, value, ctx.fromTrigger === true);
      break;
    case "spendCharge": {
      // 「泄能重锤 / 泄压阀 / 紧急泄压」：先让本牌的基础效果吃到充能固定加伤（attackModifiers），
      // 再消耗全部充能，按每点 value 结算一笔固定量（mode 决定是伤害 / 格挡 / 抽牌）。
      // 消耗部分为固定值、不吃任何增幅（docs/29 §四 T2 同口径）。
      const charge = draft.player.charge;
      if (charge <= 0) break;
      if (value > 0) {
        const mode = effect.mode ?? "damage";
        if (mode === "damage") {
          for (const t of targetIds) {
            dealDamage(draft, sink, {
              sourceId: ctx.sourceId,
              actorId: ctx.actorId,
              targetId: t,
              base: charge * value,
              segment: 1,
              segments: 1,
              modifiers: [],
            });
          }
        } else if (mode === "block") {
          for (const t of targetIds) gainBlock(draft, sink, t, charge * value);
        } else {
          drawCards(draft, sink, charge * value);
        }
      }
      draft.player.charge = 0;
      sink.emit("ChargeChanged", { targetId: PLAYER_ID, before: charge, after: 0, delta: -charge });
      break;
    }
    case "clampCharge": {
      // 充能封顶（玩家指定）：高于 value 时平衡回 value，不触发 onGainCharge
      const before = draft.player.charge;
      if (value > 0 && before > value) {
        draft.player.charge = value;
        sink.emit("ChargeChanged", { targetId: PLAYER_ID, before, after: value, delta: value - before });
      }
      break;
    }
    case "gainModifier":
      // 本场临时修饰（血锈光环）：写入 BattleState.modifiers，随战斗结束消失
      if (effect.valueKind && effect.op) {
        draft.modifiers.push({
          sourceId: ctx.sourceId,
          layer: "temporary",
          op: effect.op,
          value,
          kind: effect.valueKind,
        });
      }
      break;
    default:
      break;
  }
}

/**
 * 逐项结算队列直到清空。
 * LIFO：执行过程中压入的动作下一次优先结算（"中途插入"）；
 * 重入时只入栈不排空，避免内层提前消费外层挂起动作。
 */
export function drainQueue(draft: Draft, sink: EventSink): void {
  if (draft.draining) return;
  draft.draining = true;
  try {
    let next = draft.queue.pop();
    while (next) {
      executeWork(draft, sink, next.payload);
      next = draft.queue.pop();
    }
  } finally {
    draft.draining = false;
  }
}

/** 依次结算一张卡/一个意图的效果列表（入栈 → 排空）。 */
export function resolveEffects(
  draft: Draft,
  sink: EventSink,
  effects: readonly CardEffect[],
  ctx: EffectContext,
): void {
  enqueueEffects(draft, effects, ctx);
  drainQueue(draft, sink);
}

/** 供外部（如 Buff 触发）判断条件用。 */
export function checkCondition(node: ConditionNode | undefined, draft: Draft): boolean {
  return evaluateCondition(node, conditionContext(draft));
}

export function unitOf(draft: Draft, id: string): MutableUnit | undefined {
  return findUnit(draft, id);
}
