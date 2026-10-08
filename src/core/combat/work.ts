/**
 * core/combat/work · 栈上动作（ADR-002）
 *
 * 一个"待结算效果动作"：目标在入栈时解析并随动作保存，
 * 目的是让死亡清理（EffectQueue.removeByUnit）能按单位精确取消挂起动作。
 */
import type { Modifier } from "../pipeline";
import type { CardEffect } from "../registry/content";

export interface EffectContext {
  readonly sourceId: string;
  readonly actorId: string;
  readonly chosenTargetId: string | null;
  /** 每段伤害结算后回调（强化 onHit 钩子；多段攻击每段独立触发） */
  readonly onHit?: (hitIndex: number, targetId: string) => void;
  /** 强化层注入的修饰（layer: enhancement），走修饰符管线而非直接改值 */
  readonly attackModifiers?: readonly Modifier[];
  readonly blockModifiers?: readonly Modifier[];
  /** 该动作由触发器（遗物/卡牌能力）产生：其 gainCharge 不再派发 onGainCharge（防自触发） */
  readonly fromTrigger?: boolean;
  /**
   * 该动作来自哪个触发时机（docs/64）：onBlock 派发只在「来源不是 onBlock 自己」时进行——
   * 第三捧灰/空腹铃铛给的格挡照样触发隔热砖，但隔热砖自己的 +1 不会无限自循环。
   */
  readonly triggerTiming?: string;
  /**
   * 打出这张牌**之前**的能量（红线运转 chargeFromEnergy 读它）。
   * 玩家看到的是能量球上那个数，所以取付掉费用前的值；触发器场景缺省，回落到当前能量。
   */
  readonly energyAtPlay?: number;
}

/** 栈上的单个效果动作；targetIds 已解析，供死亡清理匹配。 */
export interface EffectWork {
  readonly effect: CardEffect;
  readonly ctx: EffectContext;
  readonly targetIds: readonly string[];
  /** 段号（1 起，仅 damage 有意义） */
  readonly damageIndex: number;
  readonly damageTotal: number;
  /** 反伤动作：固定伤害、不叠加攻击修饰，且不再二次触发反伤 */
  readonly reflect?: boolean;
  /** 条件含 targetHasBuff：入栈时不判定，改为逐目标求值（docs/38 §二 B-3） */
  readonly targetCondition?: boolean;
}
