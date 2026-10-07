/**
 * core/buffs · Buff 结构与层数规则（docs/03 §2）
 *
 * 策划拍板（Q1）：计时型减益的「层数」= 剩余回合数。
 * 因此每个 Buff 定义声明 applyAs 语义，由 buffApplication() 统一折算为 { stacks, duration }。
 */
import type { BuffId } from "../registry/ids";

export type StackingPolicy = "stackAndRefresh" | "stack" | "refreshOnly";

export type BuffDecayTiming = "turnStart" | "turnEnd" | "none";

/**
 * 施加语义：
 *  - stacks：强度型，参数即层数（力量 / 污染 / 格挡）
 *  - turns：计时型，参数即回合数（再生 / 蚀锈 / 眩晕）
 *  - stacksAndTurns：参数即层数，另给默认持续回合（再生）
 *  - 层级型（docs/46）：stacks 即强度、decayAt=none，战斗结束清零（虚弱 / 胆怯 / 荆棘 / 坚韧）
 */
export type ApplySemantics = "stacks" | "turns" | "stacksAndTurns";

export interface BuffDefinition {
  readonly id: BuffId;
  /** 叠加策略（默认 stackAndRefresh = 层数累加 + 时长刷新） */
  readonly stacking: StackingPolicy;
  /** 衰减时机；none = 永久 */
  readonly decayAt: BuffDecayTiming;
  /** 参数如何折算为 stacks / duration */
  readonly applyAs: ApplySemantics;
  /** stacksAndTurns 型的默认持续回合 */
  readonly defaultDuration?: number;
  readonly maxStacks?: number;
  /** 数值型资源（格挡）：非 Buff 本体，但走同一结构 */
  readonly resource?: boolean;
}

export interface BuffInstance {
  readonly id: BuffId;
  readonly stacks: number;
  readonly duration: number | null;
}

export interface ApplyBuffInput {
  readonly id: BuffId;
  readonly stacks: number;
  readonly duration?: number | null;
}

export interface BuffTickResult {
  readonly buffs: readonly BuffInstance[];
  /** 本次 tick 到期被移除的 Buff */
  readonly expired: readonly BuffInstance[];
}
