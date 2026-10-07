/**
 * core/map/pool · 卡池归类与「职业 : 中立」抽取（docs/56 §四）
 *
 * 分组重划后，卡池不再只有职业一条来源：中立池全职业共享、终身可见。
 * 「每槽 70% 职业 / 30% 中立」的口径收在这里，战斗奖励与事件抽卡共用一份，
 * 避免两处各写一遍比例、以后改一个漏一个。
 */
import type { RngStream } from "../rng";

/** 中立池的 class 名（docs/56 §三：cards/neutral/） */
export const NEUTRAL_CLASS = "neutral";

/** 每个槽位独立掷：70% 职业池 / 30% 中立池（docs/56 §四） */
export const CLASS_POOL_SHARE = 0.7;

/**
 * 这一槽从哪个池子抽：先按比例掷，掷到的池子空了就退到另一个。
 * 返回的是「已剔除本槽已选中项」之后的池子，调用方直接在里面挑。
 */
export function pickPoolSide(
  rng: RngStream,
  classPool: readonly string[],
  neutralPool: readonly string[],
): readonly string[] {
  const preferClass = rng.nextFloat() < CLASS_POOL_SHARE;
  const first = preferClass ? classPool : neutralPool;
  const second = preferClass ? neutralPool : classPool;
  return first.length > 0 ? first : second;
}

/** 本职业 + 中立的「职业可用性」判定（docs/56 §四.3 显式池语义修正）。 */
export function usableForClass(classId: string | undefined, cardClass: string): boolean {
  if (cardClass === NEUTRAL_CLASS) return true;
  return !classId || cardClass === classId;
}
