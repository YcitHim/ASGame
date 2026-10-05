/**
 * core/buffs · Buff 结构与层数规则（docs/03 §2，冻结规范）
 *
 * 结构 { id, stacks, duration }；同名默认 stacks 累加、duration 刷新，
 * 特例在 BuffDefinition 里显式声明。衰减时机固定在各相位 tick，Buff 不自己决定。
 *
 * 术语对齐：
 *  - 强度型（potency）：duration = null，stacks 即强度（力量 / 污染）
 *  - 计时型（timed）：duration 为剩余回合，逐 tick -1，到期发 BuffExpired
 *  - 再生 Regen：两者都有（stacks = 每回合回血量，duration = 持续回合）
 */
import type { BuffId } from "../registry/ids";

export type StackingPolicy = "stackAndRefresh" | "stack" | "refreshOnly";

export type BuffDecayTiming = "turnStart" | "turnEnd" | "none";

export interface BuffDefinition {
  readonly id: BuffId;
  /** 叠加策略（默认 stackAndRefresh = 层数累加 + 时长刷新） */
  readonly stacking: StackingPolicy;
  /** 衰减时机；none = 力量型永久 */
  readonly decayAt: BuffDecayTiming;
  /** 是否强度型（无 duration） */
  readonly potency: boolean;
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
