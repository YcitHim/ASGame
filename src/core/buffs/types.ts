/**
 * core/buffs · Buff 结构与层数规则（docs/03 §2）
 *
 * 策划拍板（Q1）：计时型减益的「层数」= 剩余回合数。
 * 因此每个 Buff 定义声明 applyAs 语义，由 buffApplication() 统一折算为 { stacks, duration }。
 */
import type { BuffId } from "../registry/ids";

export type StackingPolicy = "stackAndRefresh" | "stack" | "refreshOnly";

/**
 * 衰减时机（甲方 2026-10-09 状态双轴定稿）：
 * - `turnStart`：泛用 tick 在**玩家回合开始**扣时长（再生）
 * - `turnEnd`：泛用 tick 在**玩家回合结束**扣时长（敌人自身的减伤形态，docs/60 §八.3）
 * - `ownerTurnEnd`：**承载者自己的回合结束**扣时长——把「1 回合」的判定点钉在承载体身上，
 *   于是敌人给你的 1 回合诅咒必定在你下一个回合开头生效（甲方口径：起码吃到一次）
 * - `none`：不衰减（战斗结束统一清零）
 */
export type BuffDecayTiming = "turnStart" | "turnEnd" | "ownerTurnEnd" | "none";

/**
 * 重复施加时**时长**怎么合并（甲方 2026-10-09）：
 * - `refresh`（缺省）：取较大值——「刷新时间」（灼烧：再来一次仍是 2 回合，不会越堆越长）
 * - `extend`：**累加**——「延长时间」（虚弱/胆怯/冰缓/颠倒/眩晕/荆棘/坚韧：再来一次 +1 回合）
 */
export type DurationPolicy = "refresh" | "extend";

/**
 * 施加语义：
 *  - stacks：强度型，参数即层数（力量 / 污染 / 格挡）
 *  - turns：计时型，参数即回合数（再生 / 蚀锈 / 眩晕）
 *  - stacksAndTurns：参数即层数，另给默认持续回合（再生）
 *  - 层级型（docs/46）：stacks 即强度、decayAt=none，战斗结束清零（虚弱 / 胆怯 / 荆棘 / 坚韧）
 */
export type ApplySemantics = "stacks" | "turns" | "stacksAndTurns";

/**
 * 状态极性（docs/46 的三色口径）：加持金 / 异常红 / 诅咒紫。
 * 需要「哪些是我的筹码」的地方（血链）只认 boon，别的地方不用猜。
 */
export type BuffPolarity = "boon" | "affliction" | "curse";

export interface BuffDefinition {
  readonly id: BuffId;
  /** 极性（docs/46 §一）：加持 / 异常 / 诅咒 */
  readonly polarity: BuffPolarity;
  /** 叠加策略（默认 stackAndRefresh = 层数累加 + 时长刷新） */
  readonly stacking: StackingPolicy;
  /** 衰减时机；none = 永久 */
  readonly decayAt: BuffDecayTiming;
  /** 重复施加时时长怎么合并；缺省 refresh（取较大值） */
  readonly durationPolicy?: DurationPolicy;
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
  /**
   * 本状态**是在第几回合被施加/刷新的**（甲方 2026-10-09 新鲜度护栏）。
   *
   * 用途：`ownerTurnEnd` 衰减时，若是**本回合刚挂上**的就跳过这次递减——
   * 把「任何状态至少完整活过一次承载者的回合开始」从约定升级为引擎保证。
   * 缺省 undefined = 旧数据/不受护栏管（照常递减）。
   */
  readonly appliedTurn?: number;
}

export interface ApplyBuffInput {
  readonly id: BuffId;
  readonly stacks: number;
  readonly duration?: number | null;
  /**
   * 层数上限覆盖（缺省用 BuffDefinition.maxStacks）。
   * 用途：职业特性对某个状态开上限口子（docs/58 §五 铁皮王八把荆棘上限抬到 10），
   * 覆盖只作用于**这一次施加**，不改变该状态对其他单位的全局上限。
   */
  readonly maxStacks?: number;
  /**
   * 施加时所在的**回合数**（draft.turn），用于盖新鲜度戳 appliedTurn。
   * 只有 `decayAt: "ownerTurnEnd"` 的状态依赖它；其余可省略。
   */
  readonly turn?: number;
}

export interface BuffTickResult {
  readonly buffs: readonly BuffInstance[];
  /** 本次 tick 到期被移除的 Buff */
  readonly expired: readonly BuffInstance[];
}
