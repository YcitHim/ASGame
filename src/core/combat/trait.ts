/**
 * core/combat · 特性运行时（docs/58 §二）
 *
 * 把「本局挂了哪个特性」收敛成一处：引擎任何位置想问特性能不能 / 有多少，
 * 都走这里，而不是四处 `if (draft.traitId === "...")`（铁律 6）。
 * 特性本体（参数）在 data/traits/*.json，逻辑在 registry/trait-handler。
 */
import { buffStacks } from "../buffs";
import type { ContentDb, TraitDefinition } from "../registry/content";
import {
  getTraitHandler,
  type TraitContext,
  type TraitHandler,
} from "../registry/trait-handler";
import type { Draft, MutableUnit } from "./draft";

export interface ActiveTrait {
  readonly def: TraitDefinition;
  readonly handler: TraitHandler;
}

/** 本场生效的特性（无特性 / 未注册 → undefined）。 */
export function activeTrait(draft: Draft): ActiveTrait | undefined {
  if (!draft.traitId) return undefined;
  const def = draft.content.traits.get(draft.traitId);
  if (!def) return undefined;
  return { def, handler: getTraitHandler(def.handler) };
}

/** 只读问询上下文（handler 的入参）。 */
export function traitCtx(draft: Draft): TraitContext {
  return {
    hp: draft.player.hp,
    maxHp: draft.player.maxHp,
    pollution: draft.player.pollution,
    charge: draft.player.charge,
    block: draft.player.block,
    buffs: draft.player.buffs,
    cardsPlayedThisTurn: draft.cardsPlayedThisTurn,
    attackCardsPlayedThisTurn: draft.attackCardsPlayedThisTurn,
    handSize: draft.hand.length,
    turn: draft.turn,
    dealtDamageThisTurn: draft.dealtDamageThisTurn,
    selfHpSpentThisTurn: draft.selfHpSpentThisTurn,
    snapshot: draft.traitSnapshot,
  };
}

/** 充能注入哪条管线（缺省 attack；铁皮王八 = block）。 */
export function traitChargeTarget(draft: Draft): "attack" | "block" | "none" {
  const trait = activeTrait(draft);
  if (!trait) return "attack";
  return trait.handler.chargeTarget?.(trait.def.params) ?? "attack";
}

/** 荆棘层数上限（缺省 5；铁皮王八 10）。 */
export function brambleMaxStacks(draft: Draft): number {
  const trait = activeTrait(draft);
  const override = trait?.handler.brambleMaxStacks?.(trait.def.params);
  return override !== undefined ? Math.max(1, override) : 5;
}

/** 回合末按格挡折算荆棘的步长（铁皮王八 = 8）；null = 该特性无此机制。 */
export function traitBrambleFromBlockStep(draft: Draft): number | null {
  const trait = activeTrait(draft);
  return trait?.handler.brambleFromBlockStep?.(trait.def.params) ?? null;
}

/**
 * 回合末结算：读「**本回合**的格挡」，每 step 点折算 1 层荆棘（docs/58 §五，甲方 2026-10-07 修订）。
 *
 * 只做**求值**，施加由 reducer 以**覆盖式刷新**落成 `applyBuffToTarget("bramble", n, ...)`——
 * 荆棘必须是**真状态**（落在 buffs 数组里），否则 UI 没有图标、日志也对不上账。
 * 层数**覆盖**（甲方 2026-10-07 三次修订：每回合刷新，不是累加），上限由该特性覆盖（铁皮王八 10）。
 */
export function traitBrambleFromBlock(draft: Draft): number {
  const per = traitBrambleFromBlockStep(draft);
  if (!per || per <= 0) return 0;
  return Math.floor(Math.max(0, draft.player.block) / per);
}

/**
 * 「蓄势」（docs/58 §六.4，玻璃大炮）：本回合开始因充能未达阈值而附带的额外能量（无特性 → 0）。
 * 只在**回合开始**调用一次；返回值直接加到 player.energy 上（不改 maxEnergy）。
 */
export function traitLowChargeEnergy(draft: Draft): number {
  const trait = activeTrait(draft);
  if (!trait) return 0;
  return Math.max(0, trait.handler.lowChargeEnergy?.(trait.def.params, traitCtx(draft)) ?? 0);
}

/**
 * 荆棘的**有效层数**（docs/58 §五）：读真 buff 的层数，按特性上限 clamp（铁皮王八 10、其余 5）。
 * 荆棘本体是真 buff（覆盖式刷新由 reducer 落成），这里只是「读 + 封顶」，没有第二份影子状态。
 */
export function effectiveBrambleStacks(draft: Draft, unit: MutableUnit): number {
  const stacks = buffStacks(unit.buffs, "bramble");
  // 护栏：荆棘一旦是 NaN，反弹伤害会把目标 HP 打成 NaN，livingEnemies 立即判空 → 整场「秒杀」。
  // 数值来源不可靠时宁可当 0 层（无荆棘），也不能让一场战斗凭空蒸发。
  if (!Number.isFinite(stacks) || stacks <= 0) return 0;
  return Math.min(brambleMaxStacks(draft), stacks);
}

/** 「超负荷」每层在承载者回合开始的扣血（无特性 → 0）。 */
export function overloadTickPerStack(draft: Draft): number {
  const trait = activeTrait(draft);
  return Math.max(0, trait?.handler.overloadTickPerStack?.(trait.def.params) ?? 0);
}

/** 「超负荷」每层给承载者带来的**受伤加成**（加区，无特性 → 0）。 */
export function overloadDamageTakenPerStack(draft: Draft): number {
  const trait = activeTrait(draft);
  return Math.max(0, trait?.handler.overloadDamageTakenPerStack?.(trait.def.params) ?? 0);
}

/** 「一波打出去」是否把自身超负荷整体转嫁给目标（玻璃大炮）。 */
export function traitSpreadsOverload(draft: Draft): boolean {
  const trait = activeTrait(draft);
  return !!(trait && (trait.handler.spreadOverloadOnBurst?.(trait.def.params) ?? false));
}

/** 污染上限（docs/58 §七.1）：超级大畸变 = 无上限（Number.POSITIVE_INFINITY）。 */
export function pollutionCapFor(content: ContentDb, traitId: string | null | undefined): number {
  if (!traitId) return 100;
  const def = content.traits.get(traitId);
  if (!def) return 100;
  const uncapped = getTraitHandler(def.handler).pollutionUncapped?.(def.params) ?? false;
  return uncapped ? Number.POSITIVE_INFINITY : 100;
}

/**
 * 本回合第一张牌免能（触手）：判定时读「已出牌数 = 0」。
 * 解锁与否看**开局快照**（docs/58 §七.2：≥200）——局内污染跌落不回收，下一场开局重判。
 */
export function traitFirstCardFree(draft: Draft): boolean {
  if (!draft.traitSnapshot.tentacle) return false;
  const trait = activeTrait(draft);
  if (!trait) return false;
  if (!(trait.handler.firstCardFree?.(trait.def.params) ?? false)) return false;
  return draft.cardsPlayedThisTurn === 0;
}

/**
 * 本回合第一张牌结算两次（大鲨臂）：必须在出牌计数自增**之前**判定。
 * 解锁与否看**开局快照**（docs/58 §七.2：≥300）。
 */
export function traitFirstCardDouble(draft: Draft): boolean {
  if (!draft.traitSnapshot.scythe) return false;
  const trait = activeTrait(draft);
  if (!trait) return false;
  if (!(trait.handler.firstCardDouble?.(trait.def.params) ?? false)) return false;
  return draft.cardsPlayedThisTurn === 0;
}

/** 本回合神眼是否可用（每回合一次，且开局快照已达 ≥400）。 */
export function traitEyeAvailable(draft: Draft): boolean {
  if (draft.eyeUsedThisTurn) return false;
  if (!draft.traitSnapshot.eye) return false;
  const trait = activeTrait(draft);
  return !!(trait && (trait.handler.drawFromLibrary?.(trait.def.params) ?? false));
}

/** 本回合第一张攻击牌的充能加伤（玻璃大炮）；非首张 / 无特性 = 0。 */
export function traitFirstAttackBonus(draft: Draft): number {
  const trait = activeTrait(draft);
  if (!trait) return 0;
  return Math.max(0, trait.handler.firstAttackChargeBonus?.(trait.def.params, traitCtx(draft)) ?? 0);
}
