/**
 * core/combat/resolve · 战斗结算原语
 *
 * 所有数值走修饰符管线；所有状态变更发事件；本文件不出现具体卡牌特判
 * （卡牌逻辑在 registry/handler 与 data JSON）。
 */
import {
  applyBuff,
  buffApplication,
  buffStacks,
  isBoonBuff,
  tickBuffs,
  tickOwnerTurnEnd,
  type BuffInstance,
} from "../buffs";
import type { EventSink } from "../events/event-sink";
import { evaluateValue, type Modifier } from "../pipeline";
import { getEnhancementHandler } from "../registry/enhancement-handler";
import type { BuffId } from "../registry/ids";
import type { CardEffect, ConditionNode, TargetRef } from "../registry/content";
import { evaluateCondition, type ConditionContext } from "../registry/condition";
import { getTarget } from "../registry/target";
import { findUnit, livingEnemies, turnSerial, type Draft, type MutableUnit } from "./draft";
import type { DelayedEffect } from "./state";
import { resolveTriggers } from "./relics";
import { fireRelicHandlers, relicPollutionOverflow } from "./relic-runtime";
import { mourningStacks } from "./act-rules";
import {
  activeTrait,
  effectiveBrambleStacks,
  overloadDamageTakenPerStack,
  overloadTickPerStack,
  traitChargeTarget,
  traitCtx,
  traitEyeAvailable,
  traitHealBonus,
} from "./trait";
import type { EffectContext, EffectWork } from "./work";

export const POLLUTION_CRITICAL = 80;
export const POLLUTION_MAX = 100;
export const POLLUTION_BACKLASH = 10;
export const POLLUTION_CRITICAL_DAMAGE = 2;
export const CHARGE_LIMIT = 10;
export const CHARGE_BACKLASH = 5;
export const PLAYER_ID = "player";
/**
 * 不屈（docs/60 §八.3）：本回合累计受伤害上限 = 自身 maxHp × 15%（向上取整）。
 * 常量放这里而不是 data —— 目前无使用者（预留机制），数值一旦分配再迁到敌人 JSON。
 */
export const UNBREAKABLE_RATIO = 0.15;

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
    attackCardsPlayedThisTurn: draft.attackCardsPlayedThisTurn,
    handEmptyAtTurnEnd: draft.handEmptyAtTurnEnd,
    prevTurnCardsPlayed: draft.prevTurnCardsPlayed,
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

  // 充能加伤（docs/58 §五.1）：铁皮王八把这条注入改道到格挡管线，这里按特性问询。
  if (actorId === PLAYER_ID && draft.player.charge > 0) {
    const chargeTarget = traitChargeTarget(draft);
    if (chargeTarget === "attack") {
      mods.push({ sourceId: "charge", layer: "buff", op: "add", value: draft.player.charge });
    } else if (chargeTarget === "block") {
      // 混合充能（docs/67 §2.2 T1）：充能仍全量注格挡，但攻击牌分到 floor(充能 / N)。
      // 治的是「只防不打、等敌人撞死在荆棘上」——那是又强又墨迹的同一个根因。
      const hybridTrait = activeTrait(draft);
      const divisor = hybridTrait?.handler.hybridChargeAttackDivisor?.(hybridTrait.def.params) ?? null;
      if (divisor !== null && divisor > 0) {
        const bonus = Math.floor(draft.player.charge / divisor);
        if (bonus > 0) mods.push({ sourceId: "charge:hybrid", layer: "buff", op: "add", value: bonus });
      }
    }
  }

  // 特性攻击修饰（常驻项）：走 buff 层，DamageDealt.layers 里可追溯（sourceId = trait:<id>:<kind>）
  if (actorId === PLAYER_ID) {
    const trait = activeTrait(draft);
    for (const m of trait?.handler.attackModifiers?.(trait.def.params, traitCtx(draft)) ?? []) {
      mods.push({ sourceId: `trait:${trait!.def.id}:${m.kind}`, layer: "buff", op: m.op, value: m.value });
    }
  }

  // 虚弱（甲方 2026-10-09 双轴定稿，推翻 docs/46 §2.1 的层级化）：**固定 −20% 造伤**。
  // 强度不再随层数变化（上限 1 层），时长才是新的变量——见 definitions.ts / tickOwnerTurnEnd。
  if (buffStacks(actor, "weak") > 0) {
    mods.push({ sourceId: "weak", layer: "buff", op: "mul", value: 1 - WEAK_DAMAGE_PENALTY });
  }
  // 胆怯（甲方 2026-10-09）：**固定 +20% 承伤**。
  if (buffStacks(target, "timid") > 0) {
    mods.push({ sourceId: "timid", layer: "buff", op: "mul", value: 1 + TIMID_DAMAGE_BONUS });
  }
  // 超负荷（docs/58 §六.2，甲方 2026-10-07 修订）：承载者受到的伤害**每层 +N**（加区）。
  // 与「承载者是谁」无关——玩家扛超负荷时挨打更疼，敌人被转嫁后同样如此。
  const overloadTaken = buffStacks(target, "overload");
  if (overloadTaken > 0) {
    const per = overloadDamageTakenPerStack(draft);
    if (per > 0) mods.push({ sourceId: "overload", layer: "buff", op: "add", value: overloadTaken * per });
  }
  // 锈蚀难度：敌人打出的伤害上浮（docs/36 T2）。只作用于敌方攻击者，
  // 反伤 / 环境伤害的 actorId 不是敌人实例，自然不吃倍率。
  if (actorId !== PLAYER_ID) {
    // 冰缓（docs/46 §3.7 对敌映射）：敌人没有能量可冻，改为造伤 −20%（层数只决定持续回合）
    if (buffStacks(actor, "chill") > 0) {
      mods.push({ sourceId: "chill", layer: "buff", op: "mul", value: 0.8 });
    }
    // 最终倍率 = 难度 × 幕内 statMult（docs/66 §4.1）：在 createBattleState 里一次算好存在状态上，
    // 这里只读——「三幕比二幕更疼」因此可以被回放 / 单测直接断言。
    const mul = draft.enemyDamageMul;
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
  /**
   * 连续攻击里**充能增伤的段间倍率**（甲方 2026-10-09，玻璃大炮补丁）：
   * 只缩放「充能增伤」这一类修饰，其余加成不动。缺省 1 = 不衰减。
   */
  chargeFalloff?: number;
  /** 该次伤害是反伤：不触发二次反伤 */
  reflect?: boolean;
  /**
   * 无视格挡（蚀锈）：直扣生命，也不消耗目标的格挡。
   * 不是"先破盾再打血"——盾一点不动，伤害照落。
   */
  bypassBlock?: boolean;
  /**
   * 吸血比例（docs/60 §四，锈喉「狂噬」）：按**真实扣除的生命**回血给 `actorId`。
   * 只算 hpLost——打在格挡上的那部分不算（甲方口径）。
   */
  lifesteal?: number;
}

/**
 * 伤害来源卡的类型（虚化 / 魔免的分流依据，docs/60 §八.3）。
 * 来源不是玩家打出的卡（反伤 / 蚀锈 / 污染等环境伤害）→ undefined，
 * 虚化视为「非技能牌」挡下、魔免视为「非攻击牌」挡下。
 */
function sourceCardType(draft: Draft, sourceId: string): string | undefined {
  const instance = draft.cardInstances[sourceId];
  if (!instance) return undefined;
  return draft.content.cards.get(instance.cardId)?.type;
}

/**
 * 特殊防御状态（docs/60 §八.3）：虚化只吃技能牌、魔免只吃攻击牌，其余一律归零。
 * 状态住在目标的 `buffs` 正规字段里（不是影子副本），因此 UI 有图标、日志可记账。
 */
function wardBlocks(draft: Draft, target: MutableUnit, sourceId: string): boolean {
  const ethereal = buffStacks(target.buffs, "ethereal") > 0;
  const magicimmune = buffStacks(target.buffs, "magicimmune") > 0;
  if (!ethereal && !magicimmune) return false;
  const type = sourceCardType(draft, sourceId);
  if (ethereal) return type !== "skill";
  return type !== "attack";
}

/**
 * 连续攻击的**段间衰减**（甲方 2026-10-09 新增设定）：
 * 「连续攻击」= 一次行动里连续结算的多段伤害（segment 1..segments）。
 * 第一段是原本的伤害，之后**每多一段再减半**：100% → 50% → 25% → …
 *
 * 只按**段号**判定，与目标数无关：AoE 是「同一段打多个目标」，段号相同，不吃衰减。
 * 敌我同构（铁律）：敌人的多段攻击（intent 的 hits）走同一条门，同样衰减。
 */
export const MULTI_HIT_FALLOFF = 0.5;

/** 第 segment 段的衰减倍率（第 1 段恒为 1）。 */
export function multiHitFalloff(segment: number, segments: number): number {
  if (segments <= 1 || segment <= 1) return 1;
  return MULTI_HIT_FALLOFF ** (segment - 1);
}

/**
 * 这一项修饰是不是「充能增伤」——连续攻击衰减**只砍它**（甲方 2026-10-09）。
 *
 * 覆盖：普通充能加伤（`charge`，chargeTarget=attack 的炉心）与
 * 玻璃大炮的「一波打出去」（`trait:<id>:firstAttackCharge`）。
 *
 * **明确排除**铁皮王八的混合充能（`charge:hybrid`）：那条是**防御向**的充能改道
 * （充能先全量进格挡，再分 `⌊充能÷2⌋` 给攻击），把它一起砍会让防御盘直接拖成
 * 107 回合的消耗战（golden-trait-turtle 实测：9 回合 → 107 回合），而玻璃大炮
 * 根本走不到这条路径——与「给玻璃大炮打的补丁」的原意不符。
 *
 * 力量 / 强化 / 超负荷折功都不在此列，所以**没有充能加伤的攻击完全不受影响**。
 */
export function isChargeBonusModifier(sourceId: string): boolean {
  return sourceId === "charge" || sourceId.endsWith(":firstAttackCharge");
}

/** 单次伤害：基础值 → 修饰管线 → 格挡吸收 → HP → 死亡检查。 */
export function dealDamage(draft: Draft, sink: EventSink, args: DamageArgs): void {
  const target = findUnit(draft, args.targetId);
  if (!target || target.hp <= 0) return;

  // 虚化 / 魔免（docs/60 §八.3）：被挡下的攻击不消耗格挡、不诱发荆棘，只留一条 0 伤记录
  // （给 UI 一个「打不动」的反馈，不然玩家会以为卡住了）。
  if (wardBlocks(draft, target, args.sourceId)) {
    sink.emit("DamageDealt", {
      sourceId: args.sourceId,
      targetId: args.targetId,
      base: args.base,
      layers: [],
      value: 0,
      blocked: 0,
      hpLost: 0,
      segment: args.segment ?? 1,
      segments: args.segments ?? 1,
    });
    return;
  }

  const auto = args.modifiers ?? attackModifiers(draft, args.actorId, args.targetId);
  const scale = args.chargeFalloff ?? 1;
  const tune = (m: Modifier): Modifier =>
    scale === 1 || !isChargeBonusModifier(m.sourceId) ? m : { ...m, value: m.value * scale };
  const appended = args.extraModifiers?.length ? [...auto, ...args.extraModifiers] : auto;
  const modifiers = scale === 1 ? appended : appended.map(tune);
  const evaluated = evaluateValue("attackDamage", args.base, modifiers);
  const value = evaluated.value;
  const blocked = args.bypassBlock ? 0 : Math.min(target.block, value);
  let hpLost = value - blocked;
  // 教学安全网（docs/42 §四）：本该放倒玩家的这一下被截断在 safetyFloor 之上。
  // 只在教学战斗启用（safetyFloor !== undefined），正常局与 golden 回放完全不受影响。
  if (args.targetId === PLAYER_ID && draft.safetyFloor !== undefined) {
    const floor = draft.safetyFloor;
    if (target.hp - hpLost < floor) {
      const capped = Math.max(0, target.hp - floor);
      if (capped < hpLost) {
        draft.safetySaves += 1;
        sink.emit("SafetyNet", {
          targetId: args.targetId,
          wouldLose: hpLost,
          saved: draft.safetySaves,
          hpLeft: floor,
        });
        hpLost = capped;
      }
    }
  }
  const enemy = draft.enemies.find((e) => e.id === args.targetId);
  if (enemy) {
    // 临界硬化（docs/60 §四，甲方 2026-10-08 口述修订）：持续中的每一击都减伤 99%。
    if (buffStacks(target.buffs, "phase_ward") > 0) {
      const kept = Math.max(1, Math.round(hpLost * 0.01));
      sink.emit("BuffTriggered", { targetId: enemy.id, buffId: "phase_ward", stacks: 1 });
      hpLost = kept;
    }
    // 不屈（docs/60 §八.3）：本回合累计受伤害上限 = ceil(自身 maxHp × 15%)，超出部分直接不算。
    if (buffStacks(target.buffs, "unbreakable") > 0) {
      const cap = Math.ceil(target.maxHp * UNBREAKABLE_RATIO);
      const room = Math.max(0, cap - enemy.damageTakenThisTurn);
      if (hpLost > room) {
        sink.emit("BuffTriggered", { targetId: enemy.id, buffId: "unbreakable", stacks: 1 });
        hpLost = room;
      }
    }
  }
  // 转阶段保护的判定基准：本击落下**之前**的血线。
  const hpBeforeHit = target.hp;
  target.block -= blocked;
  if (blocked > 0 && target.block === 0) {
    sink.emit("BlockBroken", { targetId: args.targetId, value: blocked });
  }
  target.hp = Math.max(0, target.hp - hpLost);
  if (enemy) enemy.damageTakenThisTurn += hpLost;

  // 转阶段保护（docs/60 §四，甲方 2026-10-08 口述修订）：
  // 跨过 50% 的那一击**照常吃满**，随后挂上「临界硬化」（phase_ward，99% 减伤），
  // 玩家回合结束时 buff 消失；每场一次。严格大于/小于：正落 50% 不触发，被直接打死也不挂。
  if (enemy && target.hp > 0) {
    const def = draft.content.enemies.get(enemy.defId);
    if (def?.phaseGuard && !enemy.phaseGuardUsed) {
      const half = target.maxHp * 0.5;
      if (hpBeforeHit > half && target.hp < half) {
        enemy.phaseGuardUsed = true;
        applyBuffToTarget(draft, sink, enemy.id, "phase_ward", 1);
        sink.emit("PhaseGuarded", { enemyId: enemy.id });
      }
    }
  }

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
    // 「本回合事件回看」：记玩家掉血。受击在这里记；卖血（血契自伤）在 loseHp 里记；
    // 污染反噬不算（docs/16 P2.3 修订，甲方 2026-10-08）
    if (args.targetId === PLAYER_ID) {
      draft.tookDamageThisTurn = true;
      // 淬火怀表（docs/64 §九.4）：玩家**真的掉 HP** 才算受击（被格挡挡下的不算），
      // 每场一次的保证由遗物数据里的 once: "battle" 承担。
      fireRelicHandlers(draft, sink, "onDamaged");
    }
    // 嗜血「造伤」口径（docs/58 §四）：玩家来源且真的掉血（未击穿格挡的攻击不算）
    if (args.actorId === PLAYER_ID) draft.dealtDamageThisTurn += hpLost;
  }

  // 吸血（docs/60 §四，狂噬）：只按真实掉血回血，打在格挡上的不算
  const lifesteal = args.lifesteal ?? 0;
  if (lifesteal > 0 && hpLost > 0) {
    healUnit(draft, sink, args.actorId, Math.floor(hpLost * lifesteal), "card");
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
  const target = findUnit(draft, args.targetId);
  if (!target) return;
  // docs/46 §2.3：荆棘层级化——每层反弹 3 点固定伤害，上限 5 层。
  // docs/58 §五.2：铁皮王八用「格挡派生光环 + 上限 10」覆盖（加算在卡牌荆棘之上）。
  const stacks = effectiveBrambleStacks(draft, target);
  if (stacks <= 0) return;
  const attacker = findUnit(draft, args.actorId);
  if (!attacker || attacker.hp <= 0) return;

  sink.emit("BuffTriggered", { targetId: args.targetId, buffId: "bramble", stacks });
  enqueueDamageWork(
    draft,
    { kind: "damage", value: 3 * stacks },
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
  const modifiers: Modifier[] = [...(extraModifiers ?? [])];
  if (targetId === PLAYER_ID) {
    const trait = activeTrait(draft);
    // 铁皮王八（docs/58 §五.1）：充能不再加伤，改为「每次获得格挡 +充能层数」
    if (traitChargeTarget(draft) === "block" && draft.player.charge > 0) {
      modifiers.push({ sourceId: "charge", layer: "buff", op: "add", value: draft.player.charge });
    }
    // 特性格挡修饰（玻璃大炮超负荷：每张卡格挡 −N）
    for (const m of trait?.handler.blockModifiers?.(trait.def.params, traitCtx(draft)) ?? []) {
      modifiers.push({ sourceId: `trait:${trait!.def.id}:${m.kind}`, layer: "buff", op: m.op, value: m.value });
    }
  }
  const evaluated = evaluateValue("block", base, modifiers);
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
  const modifiers: Modifier[] = [];
  // 嗜血低血段（docs/58 §四，甲方 2026-10-08 修订）：玩家处于低血时每次回血 +N。
  // 这是所有回血来源的**唯一汇点**（再生 / 卡牌治疗 / 回血印记 / 遗物），所以判定放这里就够。
  if (targetId === PLAYER_ID) {
    const bonus = traitHealBonus(draft);
    if (bonus > 0) {
      const trait = activeTrait(draft);
      modifiers.push({
        sourceId: `trait:${trait?.def.id ?? "heal"}:heal`,
        layer: "buff",
        op: "add",
        value: bonus,
      });
    }
  }
  const evaluated = evaluateValue("heal", base, modifiers);
  // 灼烧（甲方 2026-10-08 平衡补丁）：**带有灼烧时生命恢复 −50%**（向下取整）。
  // 判定放在 healUnit 这个唯一汇点，所以「先判灼烧、再回血」——再生 / 卡牌治疗 /
  // 回血印记 / 遗物一视同仁，不会漏掉某条来源。
  const burnStacks = buffStacks(unit.buffs, "burn");
  const afterBurn = burnStacks > 0 ? Math.floor(evaluated.value * 0.5) : evaluated.value;
  const healed = Math.min(afterBurn, unit.maxHp - unit.hp);
  if (healed <= 0) return;
  unit.hp += healed;
  sink.emit("HpHealed", { targetId, value: healed, total: unit.hp, reason });
  // 遗物「每当你回血」（docs/64 脏绷带）：挂在 healUnit 这个唯一汇点上，
  // 再生 / 卡牌治疗 / 回血印记 / 遗物回血一视同仁。handler 给的是格挡等不回血的效果，
  // 不会自我递归（若未来出现回血 handler，须先加重入护栏再上线）。
  if (targetId === PLAYER_ID) fireRelicHandlers(draft, sink, "onHeal", { healAmount: healed });
}

export function loseHp(
  draft: Draft,
  sink: EventSink,
  targetId: string,
  value: number,
  reason: "bloodpact" | "pollution" | "backlash" | "overload",
): void {
  const unit = findUnit(draft, targetId);
  if (!unit || value <= 0) return;
  // 反噬伤害乘区（docs/38 §二 B-2「铁胃」）：只作用于过载与污染反噬
  const backlashMul =
    reason === "backlash" || reason === "pollution"
      ? evaluateValue(
          "backlashTaken",
          value,
          draft.modifiers.filter((m) => m.kind === undefined || m.kind === "backlashTaken"),
        ).value
      : value;
  const lost0 = Math.min(unit.hp, backlashMul);
  // 教学安全网（docs/42 §四）同样罩住直接扣血（污染反噬 / 血契 / 过载）——
  // state.ts 的承诺是「任何伤害都不会把玩家打到 safetyFloor 以下」，不是只罩 dealDamage。
  let lost = lost0;
  if (targetId === PLAYER_ID && draft.safetyFloor !== undefined) {
    const floor = draft.safetyFloor;
    if (unit.hp - lost < floor) {
      const capped = Math.max(0, unit.hp - floor);
      if (capped < lost) {
        draft.safetySaves += 1;
        sink.emit("SafetyNet", {
          targetId,
          wouldLose: lost,
          saved: draft.safetySaves,
          hpLeft: floor,
        });
        lost = capped;
      }
    }
  }
  unit.hp -= lost;
  // 嗜血「自伤」口径（docs/58 §四）：只认血契 / 血迹自伤。受击掉血与反噬掉血都不算。
  if (targetId === PLAYER_ID && reason === "bloodpact") draft.selfHpSpentThisTurn += lost;
  // 但「本回合受过伤害」把卖血也算进去（甲方 2026-10-08 反馈）：
  // 以前只认受击掉血，导致「先卖血 → 再打以血还血」第二段不触发。
  // 反噬（污染 / 过载）依旧不算——那是惩罚不是「受伤」。
  if (targetId === PLAYER_ID && reason === "bloodpact") draft.tookDamageThisTurn = true;
  sink.emit("HpLost", { targetId, value: lost, reason });
  if (unit.hp === 0) killUnit(draft, sink, targetId);
}

/** amount 是"卡面参数"：强度型=层数，计时型=回合数（策划 Q1）。 */
/**
 * 虚弱 / 胆怯的固定幅度（甲方 2026-10-09 双轴定稿）。
 * 这两个状态**不再按层数放缩强度**：层数恒为 1，变量只有「还剩几回合」。
 * 改数值只需改这里，攻防两侧（玩家与敌人）共用同一道门。
 */
export const WEAK_DAMAGE_PENALTY = 0.2;
export const TIMID_DAMAGE_BONUS = 0.2;

export function applyBuffToTarget(
  draft: Draft,
  sink: EventSink,
  targetId: string,
  buffId: BuffId,
  amount: number,
  explicitDuration?: number | null,
  /** 层数上限覆盖（缺省用状态定义；铁皮王八把荆棘上限抬到 10，docs/58 §五） */
  maxStacks?: number,
): void {
  if (buffId === "pollution" && targetId === PLAYER_ID) {
    changePollution(draft, sink, amount);
    return;
  }
  const unit = findUnit(draft, targetId);
  if (!unit || unit.hp <= 0) return;
  // 眩晕抗性（docs/46 §3.5）：精英 / Boss 首次被眩晕后，本场战斗免疫后续眩晕
  if (buffId === "stun" && targetId !== PLAYER_ID) {
    const enemy = draft.enemies.find((e) => e.id === targetId);
    if (enemy && draft.content.enemies.get(enemy.defId)?.stunResistant) {
      if (enemy.stunResisted) {
        sink.emit("StunResisted", { targetId });
        return;
      }
      enemy.stunResisted = true;
    }
  }
  const application = buffApplication(buffId, amount, explicitDuration);
  unit.buffs = applyBuff(unit.buffs, {
    id: buffId,
    ...application,
    ...(maxStacks !== undefined ? { maxStacks } : {}),
    // 新鲜度戳：ownerTurnEnd 衰减时用它保证「承载者本回合刚挂上的」不在同一回合就掉时长
    ...(turnSerial(draft) != null ? { turn: turnSerial(draft)! } : {}),
  });
  const applied = unit.buffs.find((b) => b.id === buffId);
  sink.emit("BuffApplied", {
    targetId,
    buffId,
    stacks: applied?.stacks ?? application.stacks,
    duration: applied?.duration ?? application.duration,
  });
  maybeInterruptCharge(draft, sink, targetId, buffId);
}

/** 每只敌人每场最多被断链次数（docs/38 §三 C-1 护栏：防无限白嫖）。 */
export const MAX_CHARGE_INTERRUPTS = 2;

/**
 * 断链（docs/38 §三 C-1 / docs/46 §2.1 / §3.5）：蓄力链中的敌人被施加虚弱 / 胆怯 / 眩晕即断链——
 * 剩余链取消（蓄力层清零）、本回合空转。Boss 由数据 interruptImmune 免疫。
 * 眩晕是更硬的中断：除了断链，行动权也在 runEnemyTurn 里被跳过。
 */
function maybeInterruptCharge(
  draft: Draft,
  sink: EventSink,
  targetId: string,
  buffId: BuffId,
): void {
  if (targetId === PLAYER_ID) return;
  if (buffId !== "weak" && buffId !== "timid" && buffId !== "stun") return;
  const enemy = draft.enemies.find((e) => e.id === targetId);
  if (!enemy || enemy.hp <= 0) return;
  if (enemy.intent?.kind !== "charge") return;
  if (draft.content.enemies.get(enemy.defId)?.interruptImmune) return;
  if (enemy.interruptsTaken >= MAX_CHARGE_INTERRUPTS) return;
  enemy.forcedChain = [];
  enemy.intent = { kind: "unknown" };
  enemy.interruptsTaken += 1;
  sink.emit("ChargeInterrupted", { enemyId: enemy.id, buffId, times: enemy.interruptsTaken });
}

function setPollutionMirror(buffs: readonly BuffInstance[], value: number): BuffInstance[] {
  const others = buffs.filter((b) => b.id !== "pollution");
  return value > 0 ? [...others, { id: "pollution", stacks: value, duration: null }] : others;
}

/** 污染变化：满值立即反噬（docs/03 §4 决策），不延迟到回合开始。 */
export function changePollution(draft: Draft, sink: EventSink, delta: number): void {
  const trait = activeTrait(draft);
  const uncapped = trait?.handler.pollutionUncapped?.(trait.def.params) ?? false;
  const cap = uncapped ? Number.POSITIVE_INFINITY : POLLUTION_MAX;
  const before = draft.player.pollution;
  const after = Math.max(0, Math.min(cap, before + delta));
  draft.player.pollution = after;
  draft.player.buffs = setPollutionMirror(draft.player.buffs, after);
  sink.emit("PollutionChanged", {
    targetId: PLAYER_ID,
    before,
    after,
    delta: after - before,
    critical: after >= POLLUTION_CRITICAL,
  });

  // 超级大畸变（docs/58 §七.1）：污染无上限；每累计满 step（100 / 200 / 300…）立即反噬一次，
  // 反噬**不清零**，可继续突破。反噬前仍派发 onPollutionMax（「九十九」等遗物互动不变）。
  if (uncapped) {
    const milestone = trait?.handler.pollutionMilestone?.(trait.def.params) ?? null;
    if (milestone) {
      const crossed =
        Math.floor(after / milestone.step) - Math.floor(before / milestone.step);
      if (crossed > 0 && milestone.backlash > 0) {
        resolveTriggers(draft, sink, "onPollutionMax", { inline: true });
        loseHp(draft, sink, PLAYER_ID, milestone.backlash * crossed, "pollution");
      }
    }
    return;
  }

  if (after >= POLLUTION_MAX && before < POLLUTION_MAX) {
    // 触顶触发（docs/38 §二 B-3「九十九」）：在反噬判定前派发，
    // 效果可把污染压回上限之下（例如 99），从而改写这次反噬。
    resolveTriggers(draft, sink, "onPollutionMax", { inline: true });
    if (draft.player.pollution < POLLUTION_MAX) return;
    // 泄压阀（docs/64 §四.3）：触顶反噬参数化——反噬减半，污染回落到 50 而非清零，
    // 把污染从「躲着走」的资源变成「可以踩着红线跳舞」的资源。
    const overflow = relicPollutionOverflow(draft);
    const fallTo = overflow ? Math.min(POLLUTION_MAX - 1, Math.max(0, overflow.fallTo)) : 0;
    const backlash = overflow ? Math.round(POLLUTION_BACKLASH * overflow.backlashMult) : POLLUTION_BACKLASH;
    draft.player.pollution = fallTo;
    draft.player.buffs = setPollutionMirror(draft.player.buffs, fallTo);
    sink.emit("PollutionChanged", {
      targetId: PLAYER_ID,
      before: after,
      after: fallTo,
      delta: fallTo - after,
      critical: fallTo >= POLLUTION_CRITICAL,
    });
    if (backlash > 0) loseHp(draft, sink, PLAYER_ID, backlash, "pollution");
  }
}

export function changeCharge(
  draft: Draft,
  sink: EventSink,
  delta: number,
  /** 触发器自身造成的充能变化（docs/29 §二⑥ 飞升齿轮）：不再派发 onGainCharge，防自触发死循环 */
  suppressTriggers = false,
): boolean {
  const before = draft.player.charge;
  const after = Math.max(0, before + delta);
  draft.player.charge = after;
  sink.emit("ChargeChanged", { targetId: PLAYER_ID, before, after, delta: after - before });

  // 获得充能触发（docs/29 §二⑥ 飞升齿轮）：仅在真的加充能、且来源不是触发器本身时派发
  if (after > before && !suppressTriggers) resolveTriggers(draft, sink, "onGainCharge");

  if (after > CHARGE_LIMIT) {
    const trait = activeTrait(draft);
    // 玻璃大炮（docs/58 §六.1）：本特性下充能不触发超限反噬清零，改为转「超负荷」层。
    if (trait && !(trait.handler.chargeOverload?.(trait.def.params) ?? true)) {
      // 超负荷（docs/58 §六.2）：超出 10 的部分每 step 点施加 1 层，只结算**新跨过的**层数。
      // 惩罚不再在获得时结算，而是落在承载者自己的回合开始（tickOverload）。
      const step = trait.handler.overloadPerStep?.(trait.def.params) ?? null;
      if (step) {
        const gained =
          Math.floor(Math.max(0, after - CHARGE_LIMIT) / step) -
          Math.floor(Math.max(0, before - CHARGE_LIMIT) / step);
        if (gained > 0) applyBuffToTarget(draft, sink, PLAYER_ID, "overload", gained);
      }
      return false;
    }
    sink.emit("Overloaded", { targetId: PLAYER_ID, charge: after, backlash: CHARGE_BACKLASH });
    loseHp(draft, sink, PLAYER_ID, CHARGE_BACKLASH, "backlash");
    draft.player.charge = 0;
    sink.emit("ChargeChanged", { targetId: PLAYER_ID, before: after, after: 0, delta: -after });
    return true;
  }
  return false;
}

/**
 * 超负荷的持续惩罚（docs/58 §六.2，甲方 2026-10-07 修订）：
 * 承载者**在自己回合开始**时，每层扣 `overloadTickPerStack` 点生命（走 loseHp，可致死）。
 *
 * 玩家在 turnStart 调用、敌人在敌方回合开始调用——一张状态表，两侧同构。
 */
export function tickOverload(draft: Draft, sink: EventSink, ids?: readonly string[]): void {
  const per = overloadTickPerStack(draft);
  if (per <= 0) return;
  const targets = ids ?? [PLAYER_ID, ...draft.enemies.map((e) => e.id)];
  for (const id of targets) {
    const unit = findUnit(draft, id);
    if (!unit || unit.hp <= 0) continue;
    const stacks = buffStacks(unit.buffs, "overload");
    if (stacks <= 0) continue;
    const damage = stacks * per;
    sink.emit("BuffTicked", { targetId: id, buffId: "overload", stacks, damage });
    loseHp(draft, sink, id, damage, "overload");
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

/** 蚀锈每次结算的层数衰减（甲方 2026-10-07 改版）。 */
export const CORRODING_DECAY = 5;

/**
 * 蚀锈结算（甲方 2026-10-07 改版）：**敌方回合开始**时，
 * 每个带蚀锈的敌人受「当前层数」点伤害 —— **无视格挡**直扣生命
 * （不吃力量 / 充能 / 胆怯，也不被格挡吸收），随后层数 **−5**，归零即移除。
 *
 * 旧版是"敌方回合结束、按 duration 扣回合"的计时 DoT；现在衰减由层数承担：
 * 不继续叠锈，伤害就会 5 层/回合地掉下去，最后自己蒸发。
 * 不走泛用 tick，避免被玩家回合的 turnEnd / turnStart 双重扣时。
 */
export function resolveCorroding(draft: Draft, sink: EventSink): void {
  for (const enemy of draft.enemies) {
    if (enemy.hp <= 0) continue;
    const buff = enemy.buffs.find((b) => b.id === "corroding");
    if (!buff || buff.stacks <= 0) continue;
    sink.emit("BuffTicked", {
      targetId: enemy.id,
      buffId: "corroding",
      stacks: buff.stacks,
      damage: buff.stacks,
    });
    dealDamage(draft, sink, {
      sourceId: "corroding",
      actorId: enemy.id,
      targetId: enemy.id,
      base: buff.stacks,
      segment: 1,
      segments: 1,
      modifiers: [],
      bypassBlock: true,
    });
    if (enemy.hp <= 0) continue;
    const next = buff.stacks - CORRODING_DECAY;
    if (next <= 0) {
      enemy.buffs = enemy.buffs.filter((b) => b.id !== "corroding");
      sink.emit("BuffExpired", { targetId: enemy.id, buffId: "corroding" });
    } else {
      enemy.buffs = enemy.buffs.map((b) => (b.id === "corroding" ? { id: b.id, stacks: next, duration: null } : b));
    }
  }
}

/**
 * 神眼选牌（docs/58 §七.2）：从**牌库**任选一张加入手牌，每回合一次。
 * 只做「搬运」，不消耗能量；颠倒诅咒下新入手的牌同样吃到随机费用。
 */
/**
 * 祭血狂热「销毁」（甲方 2026-10-08）：从**手牌**选一张，本场战斗移出牌组（进消耗堆），
 * 战斗结束随牌组归还。合法性由 core 兜底（必须有待选额度、牌必须在手牌里）。
 */
export function destroyFromHand(draft: Draft, sink: EventSink, instanceId: string): boolean {
  if (draft.destroyPending <= 0) return false;
  const index = draft.hand.indexOf(instanceId);
  if (index < 0) return false;
  draft.hand.splice(index, 1);
  draft.exhaust.push(instanceId);
  draft.destroyPending -= 1;
  const instance = draft.cardInstances[instanceId];
  if (instance) sink.emit("CardDestroyed", { cardId: instance.cardId });
  return true;
}

export function pickFromDraw(draft: Draft, sink: EventSink, instanceId: string): boolean {
  if (!traitEyeAvailable(draft)) return false;
  const index = draft.draw.indexOf(instanceId);
  if (index < 0) return false;
  draft.draw.splice(index, 1);
  draft.hand.push(instanceId);
  draft.eyeUsedThisTurn = true;
  rollReverseCostsForNewCards(draft);
  sink.emit("CardsDrawn", { cardIds: [instanceId] });
  return true;
}

/**
 * 坚韧（docs/46 §3.4）：回合开始时把「维续格挡」池抬高 3×层（总量上限 25），
 * 并把当前格挡置回池子——即"上一回合剩的格挡不清零"。
 * 没有坚韧的单位池恒为 0，行为与旧的"回合开始格挡清零"完全一致。
 */
export function resolveTenacity(unit: MutableUnit): void {
  const stacks = Math.min(3, buffStacks(unit.buffs, "tenacity"));
  if (stacks > 0) unit.enduringBlock = Math.min(25, unit.enduringBlock + 3 * stacks);
  unit.block = unit.enduringBlock;
}

/**
 * 回血印记（调血）：玩家回合开始时，按印记层数回一次血，然后印记消失。
 * 与蚀锈同构——特殊 buff 走专门结算，不进泛用 tick（否则 duration 会先被扣掉）。
 */
export function resolveMending(draft: Draft, sink: EventSink): void {
  const buff = draft.player.buffs.find((b) => b.id === "mending");
  if (!buff || buff.stacks <= 0) return;
  healUnit(draft, sink, PLAYER_ID, buff.stacks, "card");
  draft.player.buffs = draft.player.buffs.filter((b) => b.id !== "mending");
  sink.emit("BuffExpired", { targetId: PLAYER_ID, buffId: "mending" });
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

/**
 * 灼烧结算（docs/46 §3.9）——玩家回合开始统一处理，两侧通用：
 * 每层扣 1 点**生命上限**（战斗内），当前 HP 被顶到上限之上时按差额掉血；
 * 上限只在战斗结束时恢复（restoreMaxHp），已损失 HP 不补。
 *
 * 冰缓 / 颠倒不在这里：它们的「层」是**剩余回合**，必须在**受影响单位自己的回合结束**时 −1
 * （见 decayTimedCurses）——写在玩家回合开始会有一个致命差一：敌人刚在我方回合挂上的诅咒，
 * 会在玩家还没轮到出手时就被扣掉，等于完全没生效（甲方报的「颠倒对角色不生效 + 状态栏也没有」）。
 */
export function resolveCurses(draft: Draft, sink: EventSink): void {
  for (const unit of [draft.player, ...draft.enemies]) {
    if (unit.hp <= 0) continue;

    const burn = Math.min(5, buffStacks(unit.buffs, "burn"));
    if (burn > 0) {
      unit.maxHp = Math.max(1, unit.maxHp - burn);
      let lost = 0;
      if (unit.hp > unit.maxHp) {
        lost = unit.hp - unit.maxHp;
        unit.hp = unit.maxHp;
      }
      sink.emit("BuffTicked", { targetId: unit.id, buffId: "burn", stacks: burn, damage: lost });
      if (lost > 0) sink.emit("HpLost", { targetId: unit.id, value: lost, reason: "burn" });
      if (unit.hp <= 0) killUnit(draft, sink, unit.id);
    }
  }
}

/**
 * **承载者自己回合结束**的状态衰减（甲方 2026-10-09 双轴定稿，唯一口径）。
 *
 * 覆盖：虚弱 / 胆怯 / 冰缓 / 颠倒 / 眩晕 / 灼烧 / 荆棘 / 坚韧——凡是 `decayAt: "ownerTurnEnd"` 的状态。
 *
 * 为什么必须是「承载者自己的回合结束」：状态是**挂在谁身上、谁自己数回合**。
 * 敌人趁我方回合的间隙给你挂上 1 回合诅咒，减速就得从**你下一个回合结束**才动第一次——
 * 写在玩家回合开始（旧版）会有一个致命差一：你还没轮到出手就已经被扣掉，等于完全没生效
 * （甲方报的「颠倒对角色不生效 + 状态栏也没有」）。
 *
 * 再叠一道**新鲜度护栏**（见 tickOwnerTurnEnd）：本回合刚挂上的跳过这次递减，
 * 于是「任何状态至少完整活过一次承载者的回合开始」是引擎保证，而不是各调用点约定。
 */
export function decayOwnerTurnEnd(sink: EventSink, units: readonly MutableUnit[], serial: number): void {
  for (const unit of units) {
    if (unit.hp <= 0) continue;
    const tick = tickOwnerTurnEnd(unit.buffs, serial);
    unit.buffs = [...tick.buffs];
    for (const b of tick.expired) {
      sink.emit("BuffExpired", { targetId: unit.id, buffId: b.id });
    }
  }
}

/** 灼烧只在本场扣上限：战斗结束时全线恢复（docs/46 §3.9，已损失的当前 HP 不补）。 */
export function restoreMaxHp(draft: Draft): void {
  for (const unit of [draft.player, ...draft.enemies]) unit.maxHp = unit.baseMaxHp;
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
  // 颠倒（docs/46 §3.8）：本回合内抽到的牌也要吃到随机费用——
  // 否则「抽牌流的构筑」会顺手把诅咒绕过去，等于诅咒只罚了一半的手牌。
  rollReverseCostsForNewCards(draft);
  sink.emit("CardsDrawn", { cardIds: drawn });
  return drawn;
}

/**
 * gainCard 的卡池解析：`"bloodCost"`（缺省）= 全池带血契代价的牌；数组则原样使用。
 * 结果按 id 排序——卡池遍历顺序被固定，随机结果才随种子稳定复现。
 */
function resolveCardPool(draft: Draft, pool: CardEffect["pool"]): readonly string[] {
  if (Array.isArray(pool)) return pool as readonly string[];
  const out: string[] = [];
  for (const def of draft.content.cards.values()) {
    if ((def.bloodCost ?? 0) > 0) out.push(def.id);
  }
  return out.sort();
}

/**
 * 凭空建一张卡实例并塞进手牌（嗜血满血奖励 / 超械铁拳的「铁拳」），返回 instanceId。
 * `upgraded` = true 时直接以升级面入场（超械铁拳升级版给升级「铁拳」，甲方 2026-10-08）。
 */
function addCardToHand(draft: Draft, cardId: string, upgraded = false): string {
  let n = Object.keys(draft.cardInstances).length + 1;
  let instanceId = `${cardId}#trait${n}`;
  while (draft.cardInstances[instanceId]) {
    n += 1;
    instanceId = `${cardId}#trait${n}`;
  }
  draft.cardInstances[instanceId] = { instanceId, cardId, upgraded, enhancements: [] };
  draft.hand.push(instanceId);
  return instanceId;
}

/**
 * 给手上还没有随机费用的牌补掷一个 0~3（颠倒专用）。
 * 回合开始由 reducer 全量重掷，回合内抽牌走这里增量补齐；没有颠倒时什么都不做。
 */
export function rollReverseCostsForNewCards(draft: Draft): void {
  if (buffStacks(draft.player.buffs, "reverse") <= 0) return;
  const missing = draft.hand.filter((id) => draft.reverseCosts[id] === undefined);
  if (missing.length === 0) return;
  const rng = draft.rng.stream("curse");
  const costs = { ...draft.reverseCosts };
  for (const instanceId of missing) costs[instanceId] = rng.nextInt(0, 3);
  draft.reverseCosts = costs;
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
export const MAX_FIELD_ENEMIES = 4;

/**
 * 召唤单位（docs/40 §五）：满员不再召唤；新单位入场当回合不行动。
 * 既是 summon 意图的执行体，也是亡语 summon 效果的执行体。
 */
export function summonUnit(
  draft: Draft,
  sink: EventSink,
  summonerId: string,
  defId: string,
  count = 1,
): void {
  const def = draft.content.enemies.get(defId);
  if (!def) return;
  for (let i = 0; i < count; i += 1) {
    if (draft.enemies.filter((e) => e.hp > 0).length >= MAX_FIELD_ENEMIES) break;
    const seen = draft.enemies.filter((e) => e.defId === defId).length;
    const id = seen === 0 ? defId : `${defId}#${seen + 1}`;
    draft.enemies.push({
      id,
      defId,
      name: def.name,
      hp: def.maxHp,
      maxHp: def.maxHp,
      baseMaxHp: def.maxHp,
      block: 0,
      enduringBlock: 0,
      buffs: [],
      intent: null,
      intentHistory: [],
      forcedChain: [],
      interruptsTaken: 0,
      stunResisted: false,
      damageTakenThisTurn: 0,
      phaseGuardUsed: false,
      summonerId,
      spawnedTurn: draft.turn,
    });
    sink.emit("UnitSummoned", { summonerId, enemyId: id, defId });
  }
}

export function killUnit(draft: Draft, sink: EventSink, unitId: string): number {
  const cleared = draft.queue.removeByUnit(unitId).length;
  sink.emit("UnitDied", { unitId, clearedEffects: cleared });

  // 召唤物殉爆（docs/40 §五-5）：**先于亡语**——召唤者死亡时其既有召唤物立即消失，
  // 不触发召唤物自身 onDeath；随后结算的亡语若再生出召唤物（tide_swarm），新单位保留。
  for (const minion of draft.enemies) {
    if (minion.hp <= 0 || minion.summonerId !== unitId) continue;
    const minionCleared = draft.queue.removeByUnit(minion.id).length;
    minion.hp = 0;
    sink.emit("UnitDied", { unitId: minion.id, clearedEffects: minionCleared });
  }

  const enemy = draft.enemies.find((e) => e.id === unitId);
  const def = enemy ? draft.content.enemies.get(enemy.defId) : undefined;
  const deathEffects = def?.onDeath;
  if (deathEffects && deathEffects.length > 0) {
    enqueueEffects(draft, deathEffects, { sourceId: unitId, actorId: unitId, chosenTargetId: null });
    drainQueue(draft, sink);
  }
  // 分裂亡语（docs/47 §三.4，M3）：死亡原地召唤 enemyId × count。
  // 沿用召唤规则——入场当回合不行动（spawnedTurn）、召唤物不为己方殉爆；
  // 分裂物自身不带 onDeathSplit，所以不会再分裂（validator 也拦链式分裂）。
  const split = def?.onDeathSplit;
  if (split && enemy) summonUnit(draft, sink, unitId, split.enemyId, split.count);
  // 遗物「每当一名敌人死亡」（docs/64 死亡面具）：与强化 onKill 同点——
  // 死亡清理 + 亡语之后。玩家死亡不派发（那不是「敌人死亡」）。
  if (enemy) fireRelicHandlers(draft, sink, "onKill");
  // 幕规则「溺亡挽歌」（docs/66 §三.1，act2）：敌人死亡给玩家挂蚀锈。
  // 位置在**亡语 / 遗物之后**——先让「杀死它带来的收益」结算完，再让代价落地；
  // 召唤物死亡也挂（enemy 存在即在册，含分裂物与 summonUnit 生成的单位）。
  if (enemy) {
    const mourning = mourningStacks(draft.actRules);
    if (mourning > 0) applyBuffToTarget(draft, sink, PLAYER_ID, "corroding", mourning);
  }
  return cleared;
}

/**
 * 把效果列表解析成栈上的动作（ADR-002）。
 * 目标在此刻快照；**条件推迟到执行时求值**（见 executeWork）；倒序压栈，弹出时仍是卡面书写顺序。
 *
 * 为什么条件不能在入栈时快照：同一张牌的前序效果会改状态，后面的条件必须看得见。
 * 「红线运转」= 先 +4 充能、再判「充能 ≥8 时抽 2 张」——入栈时充能还是 4，快照就会把抽牌整条丢掉，
 * 玩家拿着 4 充能打出这张牌永远拿不到那两张牌（玩家反馈实锤）。
 */
export function enqueueEffects(
  draft: Draft,
  effects: readonly CardEffect[],
  ctx: EffectContext,
): void {
  // 「段」= **会同时结算**的伤害效果（甲方 2026-10-09 连续攻击衰减的口径）。
  // 互为否定的条件（X 与 not X）不可能同时命中，所以它们是**同一段**：
  // 「蚀心之刃」写作 `7 @not(污染≥50)` + `14 @污染≥50`，是「要么 7 要么 14」，
  // 不是两连击——段号算成 2 会让它凭空吃一次衰减。
  // 只有真正会连着打出去的伤害才递增段号，也因此吃 dealDamage 的段间衰减。
  const slots: Array<{ key: string; negated: boolean }> = [];
  const slotIndex = new Map<number, number>();
  effects.forEach((effect, i) => {
    if (effect.kind !== "damage") return;
    const polarity = conditionPolarity(effect.condition);
    const twin = slots.findIndex((s) => s.key === polarity.key && s.negated !== polarity.negated);
    if (twin >= 0) {
      slotIndex.set(i, twin + 1);
      return;
    }
    slots.push(polarity);
    slotIndex.set(i, slots.length);
  });
  const damageTotal = slots.length;

  const pending: EffectWork[] = [];
  let damageIndex = 0;
  effects.forEach((effect, i) => {
    // 目标条件（targetHasBuff）必须逐目标求值，不能在这里快照（docs/38 §二 B-3）
    const targetCondition = hasTargetCondition(effect.condition);
    if (effect.kind === "damage") damageIndex = slotIndex.get(i) ?? damageIndex;
    const targetIds = resolveTargets(draft, defaultTarget(effect), ctx.actorId, ctx.chosenTargetId);
    pending.push({ effect, ctx, targetIds, damageIndex, damageTotal, ...(targetCondition ? { targetCondition } : {}) });
  });
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

/** 条件的稳定规范化（键序无关），用来判断两个条件是否**互为否定**。 */
function canonicalCondition(node: unknown): string {
  if (node === null || typeof node !== "object") return JSON.stringify(node ?? null);
  if (Array.isArray(node)) return "[" + node.map(canonicalCondition).join(",") + "]";
  const obj = node as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => k + ":" + canonicalCondition(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * 条件的「极性」：把 `not(X)` 归一成「以 X 为键、极性为反」。
 * 两个条件互为否定 ⟺ 同一个 key 且极性相反 ⟺ **永远不会同时命中**。
 */
function conditionPolarity(node: ConditionNode | undefined): { key: string; negated: boolean } {
  if (node && node.type === "not") {
    return { key: canonicalCondition((node as unknown as { of: ConditionNode }).of), negated: true };
  }
  return { key: canonicalCondition(node), negated: false };
}

/** 条件树里是否含"目标侧"条件（需要逐目标求值）。 */
function hasTargetCondition(node: ConditionNode | undefined): boolean {
  if (!node) return false;
  if (node.type === "and" || node.type === "or") {
    return (node as unknown as { of: ConditionNode[] }).of.some((n) => hasTargetCondition(n));
  }
  if (node.type === "not") {
    return hasTargetCondition((node as unknown as { of: ConditionNode }).of);
  }
  return node.type === "targetHasBuff";
}

function executeWork(draft: Draft, sink: EventSink, work: EffectWork): void {
  const { effect, ctx, damageIndex, damageTotal } = work;
  // 延迟结算（甲方 2026-10-08）：带 delayTurns 的效果不立刻生效，改入延迟队列，
  // 到期后由 tickDelayed 在玩家回合开始重新走一遍完整结算（条件与目标都在那时才求值）。
  const delayTurns = Math.trunc(effect.delayTurns ?? 0);
  if (delayTurns > 0) {
    draft.delayed.push({
      turnsLeft: delayTurns,
      effect: { ...effect, delayTurns: 0 },
      actorId: ctx.actorId,
      chosenTargetId: ctx.chosenTargetId,
    });
    return;
  }
  // 非目标条件：在这里（执行时）求值——同一张牌的前序效果可能刚刚改过它要读的状态
  if (!work.targetCondition && !evaluateCondition(effect.condition, conditionContext(draft))) return;
  // 目标条件：按每个目标现场求值（docs/38 §二 B-3「疫触」）
  const targetIds = work.targetCondition
    ? work.targetIds.filter((t) => {
        const unit = findUnit(draft, t);
        if (!unit) return false;
        return evaluateCondition(effect.condition, {
          ...conditionContext(draft),
          target: { hp: unit.hp, maxHp: unit.maxHp, buffs: unit.buffs },
        });
      })
    : work.targetIds;
  const value = effect.value ?? 0;

  switch (effect.kind) {
    case "damage": {
      // 连续攻击衰减（甲方 2026-10-09）：**这是给玻璃大炮打的补丁，只砍「充能增伤」这一项**。
      // 充能在多段攻击里按 100% / 50% / 25% … 计入各段（三段 = 300% → 175%）；
      // 卡牌自身的基础伤害、力量、强化、超负荷折功等其他加成一概不动 ——
      // 没有充能增伤的卡**完全不受影响**（所以这一刀只对「充能流 + 多段」生效）。
      // 写在 executeWork 而不是 dealDamage —— 敌人的多段普攻不走这条管线，天然不受影响。
      const falloff = multiHitFalloff(damageIndex, damageTotal);
      for (const t of targetIds) {
        dealDamage(draft, sink, {
          sourceId: ctx.sourceId,
          actorId: ctx.actorId,
          targetId: t,
          base: value,
          segment: damageIndex,
          segments: damageTotal,
          ...(falloff !== 1 ? { chargeFalloff: falloff } : {}),
          extraModifiers: ctx.attackModifiers,
          // 反伤是固定伤害：不走攻击修饰（力量/充能/易伤都不该放大它）
          ...(work.reflect ? { reflect: true, modifiers: [] } : {}),
        });
        ctx.onHit?.(damageIndex, t);
      }
      break;
    }
    case "block":
      for (const t of targetIds) {
        const before = findUnit(draft, t)?.block ?? 0;
        gainBlock(draft, sink, t, value, ctx.blockModifiers);
        const after = findUnit(draft, t)?.block ?? 0;
        // 获得格挡触发（docs/29 §一②）：只在真的拿到格挡时派发，避免 0 值刷触发。
        // 防自循环口径（docs/64 隔热砖）：来源是 onBlock 自己的格挡不再派发（与飞升齿轮同款护栏），
        // 但其他时机（第三捧灰/空腹铃铛/卡牌）给的格挡照样触发——化学保留、循环切断。
        if (t === PLAYER_ID && after > before && ctx.triggerTiming !== "onBlock") resolveTriggers(draft, sink, "onBlock");
      }
      break;
    case "draw":
      drawCards(draft, sink, value);
      break;
    case "discard": {
      // 铁口粮（docs/64 §四.3）：从手牌随机弃 value 张进弃牌堆。
      // 走独立的 relic 流，不扰动战斗主序列；程序侧实现口径 = 随机弃
      // （自选弃牌需要 UI 待选机制，留作后续升级项，见 docs/64 §八 批 2 备注）。
      const count = Math.max(0, Math.trunc(value || 1));
      const rng = draft.rng.stream("relic");
      for (let i = 0; i < count && draft.hand.length > 0; i += 1) {
        const index = rng.nextInt(0, draft.hand.length - 1);
        const [removed] = draft.hand.splice(index, 1);
        if (removed === undefined) break;
        draft.discard.push(removed);
        sink.emit("CardDiscarded", { cardId: draft.cardInstances[removed]?.cardId ?? removed });
      }
      break;
    }
    case "gainCard": {
      // 嗜血满血奖励（docs/58 §四，甲方 2026-10-08 修订）：从卡池随机抽牌**凭空**加入手牌。
      // 走独立的 trait 流，不扰动战斗主序列；颠倒诅咒下新入手的牌同样吃随机费用。
      const pool = resolveCardPool(draft, effect.pool);
      const count = Math.max(0, Math.trunc(effect.count ?? value));
      if (pool.length === 0 || count <= 0) break;
      const rng = draft.rng.stream("trait");
      const gained: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const cardId = pool[rng.nextInt(0, pool.length - 1)];
        if (cardId === undefined) break;
        gained.push(addCardToHand(draft, cardId, effect.upgraded === true));
      }
      if (gained.length > 0) {
        rollReverseCostsForNewCards(draft);
        sink.emit("CardsDrawn", { cardIds: gained });
      }
      break;
    }
    case "halveCharge": {
      // 熔炉之心（docs/64 §四.4）：充能向下取整减半——「憋爆 vs 留伤」的泄压阀。
      // 直接赋值（不经 changeCharge）：这不是「消耗充能结算」，不触发过载 / onGainCharge。
      const before = draft.player.charge;
      const halved = Math.floor(before / 2);
      if (halved !== before) {
        draft.player.charge = halved;
        sink.emit("ChargeChanged", {
          targetId: PLAYER_ID,
          before,
          after: halved,
          delta: halved - before,
        });
      }
      break;
    }
    case "bankCharge": {
      // 上发条改版（甲方 2026-10-08）：扣掉当前充能，**下回合开始**一次性还回「扣掉的层数 + value」。
      // 扣减不经 changeCharge → 不触发过载、不派发 onGainCharge；还回时才走 changeCharge（正常派发）。
      const stored = Math.max(0, draft.player.charge);
      if (stored > 0) {
        draft.player.charge = 0;
        sink.emit("ChargeChanged", {
          targetId: PLAYER_ID,
          before: stored,
          after: 0,
          delta: -stored,
        });
      }
      draft.delayed.push({
        turnsLeft: 1,
        effect: { kind: "gainCharge", value: stored + Math.max(0, value) },
        actorId: PLAYER_ID,
        chosenTargetId: null,
      });
      break;
    }
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
    case "chance": {
      // 赌徒齿轮（docs/64 §九.4 备选池）：按权重掷一次，把命中分支的效果照常入栈。
      // 独立 relic 流：同种子同结果，且不扰动战斗主序列。
      const branches = effect.options ?? [];
      const total = branches.reduce((sum, b) => sum + Math.max(0, b.weight), 0);
      if (branches.length === 0 || total <= 0) break;
      const rng = draft.rng.stream("relic");
      let roll = rng.nextFloat() * total;
      let picked = branches[branches.length - 1]!;
      for (const b of branches) {
        roll -= Math.max(0, b.weight);
        if (roll < 0) {
          picked = b;
          break;
        }
      }
      if (picked.effects.length > 0) enqueueEffects(draft, picked.effects, work.ctx);
      break;
    }
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
    case "chargeFromEnergy": {
      // 红线运转（玩家反馈）：把「出牌前的能量」换成等量充能（+value）；
      // 若这一步把充能推过上限（过载反噬清零），再抽 overloadDraw 张牌。
      const base = Math.max(0, ctx.energyAtPlay ?? draft.player.energy);
      const amount = base + Math.max(0, value);
      // 过载与否**由 changeCharge 自己判**（不再在卡里复刻一遍上限规则）
      const overloaded = amount > 0 ? changeCharge(draft, sink, amount) : false;
      const extra = effect.overloadDraw ?? 0;
      if (overloaded && extra > 0) drawCards(draft, sink, extra);
      break;
    }
    case "clampCharge": {
      // 充能封顶（压力表）：高于 value 时平衡回 value，不触发 onGainCharge
      const before = draft.player.charge;
      if (value > 0 && before > value) {
        draft.player.charge = value;
        sink.emit("ChargeChanged", { targetId: PLAYER_ID, before, after: value, delta: value - before });
      }
      break;
    }
    case "spendPollution": {
      // 「溅毒 / 泄毒」：消耗全部污染，按每点 value 结算（固定值，不吃增幅，同 spendCharge 口径）
      const pollution = draft.player.pollution;
      if (pollution <= 0) break;
      if (value > 0) {
        const mode = effect.mode ?? "damage";
        if (mode === "damage") {
          for (const t of targetIds) {
            dealDamage(draft, sink, {
              sourceId: ctx.sourceId,
              actorId: ctx.actorId,
              targetId: t,
              base: pollution * value,
              segment: 1,
              segments: 1,
              modifiers: [],
            });
          }
        } else if (mode === "block") {
          for (const t of targetIds) gainBlock(draft, sink, t, pollution * value);
        } else {
          drawCards(draft, sink, pollution * value);
        }
      }
      changePollution(draft, sink, -pollution);
      break;
    }
    case "transferPollution": {
      // 「黑色输血」：自身污染 −2N，目标敌人 +N 蚀锈（2:1 亏比，防白嫖）
      const n = Math.max(0, value);
      if (n <= 0) break;
      const pay = Math.min(draft.player.pollution, n * 2);
      const real = Math.floor(pay / 2);
      if (real <= 0) break;
      if (pay > 0) changePollution(draft, sink, -pay);
      // 蚀锈已是纯层数状态，没有"持续几回合"这回事（甲方 2026-10-07）
      for (const t of targetIds) applyBuffToTarget(draft, sink, t, "corroding", real);
      break;
    }
    case "consumeCorroding": {
      // 「终点站」：消耗目标全部蚀锈，每层追加 value 伤害（固定值）
      for (const t of targetIds) {
        const unit = findUnit(draft, t);
        if (!unit) continue;
        const stacks = buffStacks(unit.buffs, "corroding");
        if (stacks <= 0) continue;
        unit.buffs = unit.buffs.filter((b) => b.id !== "corroding");
        sink.emit("BuffExpired", { targetId: t, buffId: "corroding" });
        if (value > 0) {
          dealDamage(draft, sink, {
            sourceId: ctx.sourceId,
            actorId: ctx.actorId,
            targetId: t,
            base: stacks * value,
            segment: 1,
            segments: 1,
            modifiers: [],
          });
        }
      }
      break;
    }
    /**
     * 血链（玩家反馈重做）：兑现自己身上的「有利状态」。
     * 筹码 = 全部加持层数 + 充能（甲方点名要把充能算进去）；负面状态不算也不消耗。
     * 顺序上**先扣筹码再结算伤害**：不然力量会给自己这一击再加一次，同一批筹码记两遍。
     */
    case "consumeBoons": {
      const boons = draft.player.buffs.filter((b) => isBoonBuff(b.id));
      const stacks = boons.reduce((sum, b) => sum + Math.max(0, b.stacks), 0) + Math.max(0, draft.player.charge);
      // 先清算筹码
      if (boons.length > 0) {
        draft.player.buffs = draft.player.buffs.filter((b) => !isBoonBuff(b.id));
        for (const b of boons) sink.emit("BuffExpired", { targetId: PLAYER_ID, buffId: b.id });
      }
      const charge = draft.player.charge;
      if (charge > 0) {
        // 消耗不经 changeCharge：这不是「获得充能」，不该触发过载反噬
        draft.player.charge = 0;
        sink.emit("ChargeChanged", { targetId: PLAYER_ID, before: charge, after: 0, delta: -charge });
      }
      if (stacks > 0 && value > 0) {
        for (const t of targetIds) {
          dealDamage(draft, sink, {
            sourceId: ctx.sourceId,
            actorId: ctx.actorId,
            targetId: t,
            base: stacks * value,
            segment: 1,
            segments: 1,
            modifiers: [],
          });
        }
      }
      break;
    }
    case "summon": {
      // 亡语召唤（docs/40 §五-6）：tide_swarm 死亡时生 1 只 tide_mite
      if (effect.enemyId) summonUnit(draft, sink, ctx.actorId, effect.enemyId, effect.count ?? 1);
      break;
    }
    case "destroyHandAll": {
      // 电表倒转（甲方 2026-10-09）：打出即销毁手上全部牌，每张换 chargePer 充能 / blockPer 格挡。
      // 与 destroyHand 的区别：那个是「玩家选 N 张」（挂起 destroyPending），这个是「全清」，
      // 所以在这里直接结算——不挂起、不让玩家选，牌少了收益就少，是这张牌的代价本身。
      const count = draft.hand.length;
      if (count > 0) {
        for (const id of [...draft.hand]) {
          draft.hand.splice(draft.hand.indexOf(id), 1);
          draft.exhaust.push(id);
          const instance = draft.cardInstances[id];
          if (instance) sink.emit("CardDestroyed", { cardId: instance.cardId });
        }
      }
      const chargePer = Math.max(0, Math.trunc(effect.chargePer ?? 0));
      const blockPer = Math.max(0, Math.trunc(effect.blockPer ?? 0));
      if (count > 0 && chargePer > 0) changeCharge(draft, sink, count * chargePer);
      if (count > 0 && blockPer > 0) gainBlock(draft, sink, PLAYER_ID, count * blockPer, work.ctx.blockModifiers);
      break;
    }
    case "destroyHand": {
      // 祭血狂热「销毁」（甲方 2026-10-08）：从手牌选 value 张，本场战斗移出牌组（进消耗堆），
      // 战斗结束随牌组归还。需要玩家选择 → 先挂起，由 DestroyFromHand 动作逐张兑现；
      // 手牌为空则无事发生（不挂起）。回合结束时仍未选则由 endTurn 自动补结算。
      const want = Math.max(1, Math.trunc(effect.value ?? 1));
      draft.destroyPending += Math.min(want, draft.hand.length);
      break;
    }
    case "gainModifier":
      // 本场临时修饰（血锈光环 / 铁胃 / 红区栖者）：写入 BattleState.modifiers，随战斗结束消失
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
/**
 * 延迟队列结算（甲方 2026-10-08）：玩家回合开始时把每项 `turnsLeft` −1，归零的当场结算。
 * 延迟效果目前全部由玩家打出的牌产生（超械铁拳的「铁拳」、上发条的充能储蓄），
 * 所以只在玩家回合开始 tick 一次。
 */
export function tickDelayed(draft: Draft, sink: EventSink): void {
  if (draft.delayed.length === 0) return;
  const due: DelayedEffect[] = [];
  const rest: DelayedEffect[] = [];
  for (const item of draft.delayed) {
    if (item.turnsLeft <= 1) due.push(item);
    else rest.push({ ...item, turnsLeft: item.turnsLeft - 1 });
  }
  draft.delayed = rest;
  for (const item of due) {
    resolveEffects(draft, sink, [item.effect], {
      sourceId: `delayed:${item.effect.kind}`,
      actorId: item.actorId,
      chosenTargetId: item.chosenTargetId,
    });
  }
}

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

/**
 * 同步结算一段效果：只处理本次新入栈的动作（以入栈前的栈深为界），
 * 用于"必须在当前函数返回前生效"的触发（docs/38 §二 B-3「九十九」污染触顶改写反噬）。
 * 外层挂起的动作留在栈上，由外层循环继续处理。
 */
export function resolveEffectsInline(
  draft: Draft,
  sink: EventSink,
  effects: readonly CardEffect[],
  ctx: EffectContext,
): void {
  const boundary = draft.queue.size;
  // 与 drainQueue 同构的护栏：内联结算中若触发 killUnit（其内部无条件调 drainQueue），
  // draining 已在位会让那次 drain 空转——否则外层挂起的动作（boundary 之下）会被
  // 提前消费，「外层挂起的动作留在栈上」的契约就破了。保存/恢复而不直接置 false，
  // 是因为调用方本身可能就处在某次 drain 里。
  const wasDraining = draft.draining;
  draft.draining = true;
  try {
    enqueueEffects(draft, effects, ctx);
    while (draft.queue.size > boundary) {
      const next = draft.queue.pop();
      if (!next) break;
      executeWork(draft, sink, next.payload);
    }
  } finally {
    draft.draining = wasDraining;
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
