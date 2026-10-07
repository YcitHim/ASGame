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

  // docs/46 §2.1：虚弱层级化——每层造伤 −10%，上限 5 层（不再 ×0.75 计时）
  const weak = Math.min(5, buffStacks(actor, "weak"));
  if (weak > 0) {
    mods.push({ sourceId: "weak", layer: "buff", op: "mul", value: 1 - 0.1 * weak });
  }
  // docs/46 §2.2：胆怯（旧易伤合并案）——每层承伤 +10%，上限 5 层（不再 ×1.5 计时）
  const timid = Math.min(5, buffStacks(target, "timid"));
  if (timid > 0) {
    mods.push({ sourceId: "timid", layer: "buff", op: "mul", value: 1 + 0.1 * timid });
  }
  // 锈蚀难度：敌人打出的伤害上浮（docs/36 T2）。只作用于敌方攻击者，
  // 反伤 / 环境伤害的 actorId 不是敌人实例，自然不吃倍率。
  if (actorId !== PLAYER_ID) {
    // 冰缓（docs/46 §3.7 对敌映射）：敌人没有能量可冻，改为造伤 −20%（层数只决定持续回合）
    if (buffStacks(actor, "chill") > 0) {
      mods.push({ sourceId: "chill", layer: "buff", op: "mul", value: 0.8 });
    }
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
  // docs/46 §2.3：荆棘层级化——每层反弹 3 点固定伤害，上限 5 层
  const stacks = Math.min(5, buffStacks(unitBuffs(draft, args.targetId), "bramble"));
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
  // 反噬伤害乘区（docs/38 §二 B-2「铁胃」）：只作用于过载与污染反噬
  const backlashMul =
    reason === "backlash" || reason === "pollution"
      ? evaluateValue(
          "backlashTaken",
          value,
          draft.modifiers.filter((m) => m.kind === undefined || m.kind === "backlashTaken"),
        ).value
      : value;
  const lost = Math.min(unit.hp, backlashMul);
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
  unit.buffs = applyBuff(unit.buffs, { id: buffId, ...application });
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
    // 触顶触发（docs/38 §二 B-3「九十九」）：在反噬判定前派发，
    // 效果可把污染压回上限之下（例如 99），从而改写这次反噬。
    resolveTriggers(draft, sink, "onPollutionMax", { inline: true });
    if (draft.player.pollution < POLLUTION_MAX) return;
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
): boolean {
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
    return true;
  }
  return false;
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

/**
 * 蚀锈结算（docs/38 §二 B-2）：**敌方回合结束**，每个带蚀锈的敌人受 stacks 点固定伤害
 * （不吃力量 / 充能 / 易伤），随后 duration −1，到期移除。
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
    });
    if (enemy.hp <= 0) continue;
    const nextDuration = buff.duration == null ? null : buff.duration - 1;
    if (nextDuration != null && nextDuration <= 0) {
      enemy.buffs = enemy.buffs.filter((b) => b.id !== "corroding");
      sink.emit("BuffExpired", { targetId: enemy.id, buffId: "corroding" });
    } else {
      enemy.buffs = enemy.buffs.map((b) =>
        b.id === "corroding" ? { id: b.id, stacks: b.stacks, duration: nextDuration } : b,
      );
    }
  }
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
 * 诅咒结算（docs/46 §3.7/§3.8/§3.9）——回合开始统一处理，两侧通用：
 * - **灼烧**：每层扣 1 点**生命上限**（战斗内），当前 HP 被顶到上限之上时按差额掉血。
 *   上限只在战斗结束时恢复（restoreMaxHp），已损失 HP 不补。
 * - **冰缓 / 颠倒**：层数 = 剩余回合，回合开始 −1 层，归零即移除（效果随即失效）。
 * 不进泛用 tick —— 灼烧要改 maxHp，冰缓/颠倒的「层」要当作回合数递减。
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

    for (const id of ["chill", "reverse"] as const) {
      const buff = unit.buffs.find((b) => b.id === id);
      if (!buff) continue;
      const next = buff.stacks - 1;
      if (next <= 0) {
        unit.buffs = unit.buffs.filter((b) => b.id !== id);
        sink.emit("BuffExpired", { targetId: unit.id, buffId: id });
      } else {
        unit.buffs = unit.buffs.map((b) => (b.id === id ? { id, stacks: next, duration: b.duration } : b));
      }
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
  const damageTotal = effects.filter((e) => e.kind === "damage").length;
  const pending: EffectWork[] = [];
  let damageIndex = 0;
  for (const effect of effects) {
    // 目标条件（targetHasBuff）必须逐目标求值，不能在这里快照（docs/38 §二 B-3）
    const targetCondition = hasTargetCondition(effect.condition);
    if (effect.kind === "damage") damageIndex += 1;
    const targetIds = resolveTargets(draft, defaultTarget(effect), ctx.actorId, ctx.chosenTargetId);
    pending.push({ effect, ctx, targetIds, damageIndex, damageTotal, ...(targetCondition ? { targetCondition } : {}) });
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
      for (const t of targetIds) {
        applyBuffToTarget(draft, sink, t, "corroding", real, effect.duration ?? undefined);
      }
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
    case "summon": {
      // 亡语召唤（docs/40 §五-6）：tide_swarm 死亡时生 1 只 tide_mite
      if (effect.enemyId) summonUnit(draft, sink, ctx.actorId, effect.enemyId, effect.count ?? 1);
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
  enqueueEffects(draft, effects, ctx);
  while (draft.queue.size > boundary) {
    const next = draft.queue.pop();
    if (!next) break;
    executeWork(draft, sink, next.payload);
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
