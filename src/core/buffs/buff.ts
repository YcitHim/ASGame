import { buffDefinition } from "./definitions";
import type { ApplyBuffInput, BuffDefinition, BuffInstance, BuffTickResult, BuffDecayTiming } from "./types";

/** 缺省时长：turns 型以参数为回合数；stacksAndTurns 型取定义默认值。 */
function resolveDuration(def: BuffDefinition, input: ApplyBuffInput): number | null {
  if (def.applyAs === "stacks") return null;
  if (input.duration != null) return Math.max(1, input.duration);
  if (def.applyAs === "turns") return Math.max(1, input.stacks);
  return Math.max(1, def.defaultDuration ?? 2);
}

/** 刷新时长取较大值（后上的短时长不会缩短已有效果）。 */
function refreshDuration(current: number | null, incoming: number | null | undefined): number | null {
  if (current == null && incoming == null) return null;
  return Math.max(current ?? 0, incoming ?? 0);
}

/**
 * 重复施加时长合并（甲方 2026-10-09 双轴定稿）：
 * - `refresh`（缺省）：取较大值 = 「刷新时间」（灼烧再来一次仍是 2 回合）
 * - `extend`：**累加** = 「延长时间」（虚弱/胆怯/冰缓/颠倒/眩晕/荆棘/坚韧 再来一次 +1 回合）
 */
function mergeDuration(
  def: BuffDefinition,
  current: number | null,
  incoming: number | null | undefined,
): number | null {
  if (def.durationPolicy === "extend" && current != null && incoming != null) {
    return current + incoming;
  }
  return refreshDuration(current, incoming);
}

function clampStacks(id: BuffInstance["id"], stacks: number, override?: number): number {
  const def = buffDefinition(id);
  const cap = override ?? def.maxStacks;
  const capped = cap == null ? stacks : Math.min(stacks, cap);
  return capped < 0 ? 0 : capped;
}

/**
 * 把「卡面参数」折算成 { stacks, duration }（策划 Q1：计时型层数 = 回合数）。
 */
export function buffApplication(
  id: BuffInstance["id"],
  amount: number,
  explicitDuration?: number | null,
): { stacks: number; duration: number | null } {
  const def = buffDefinition(id);
  switch (def.applyAs) {
    case "stacks":
      return { stacks: amount, duration: null };
    case "turns":
      return { stacks: 1, duration: Math.max(1, explicitDuration ?? amount) };
    default:
      return { stacks: amount, duration: Math.max(1, explicitDuration ?? def.defaultDuration ?? 2) };
  }
}

export function findBuff(buffs: readonly BuffInstance[], id: BuffInstance["id"]): BuffInstance | undefined {
  return buffs.find((b) => b.id === id);
}

export function buffStacks(buffs: readonly BuffInstance[], id: BuffInstance["id"]): number {
  return findBuff(buffs, id)?.stacks ?? 0;
}

export function hasBuff(buffs: readonly BuffInstance[], id: BuffInstance["id"]): boolean {
  return findBuff(buffs, id) !== undefined;
}

/**
 * 施加 Buff：纯函数，返回新数组，绝不修改入参（ADR-001）。
 * 同名按 definition.stacking 合并；duration 按 refreshDuration 刷新。
 */
export function applyBuff(buffs: readonly BuffInstance[], input: ApplyBuffInput): BuffInstance[] {
  const def = buffDefinition(input.id);
  const existing = findBuff(buffs, input.id);
  const incomingDuration = resolveDuration(def, input);
  const cap = input.maxStacks;

  if (!existing) {
    const fresh: BuffInstance = {
      id: input.id,
      stacks: clampStacks(input.id, input.stacks, cap),
      duration: def.applyAs === "stacks" ? null : incomingDuration,
      ...(input.turn != null ? { appliedTurn: input.turn } : {}),
    };
    if (fresh.stacks <= 0 && def.applyAs === "stacks") return buffs.slice();
    return [...buffs, fresh];
  }

  let stacks: number;
  switch (def.stacking) {
    case "stack":
      stacks = clampStacks(input.id, existing.stacks + input.stacks, cap);
      break;
    case "refreshOnly":
      stacks = clampStacks(input.id, Math.max(existing.stacks, input.stacks), cap);
      break;
    default:
      stacks = clampStacks(input.id, existing.stacks + input.stacks, cap);
      break;
  }
  const duration = mergeDuration(def, existing.duration, incomingDuration);

  return buffs.map((b) => (b.id === input.id ? { id: b.id, stacks, duration, appliedTurn: input.turn } : b));
}

/**
 * 相位 tick：按 timing 衰减计时型 Buff，到期的移除并汇总。
 * 强度型（strength / pollution / block）永不被 tick 触碰。
 */
export function tickBuffs(buffs: readonly BuffInstance[], timing: BuffDecayTiming): BuffTickResult {
  if (timing === "none") return { buffs: buffs.slice(), expired: [] };

  const kept: BuffInstance[] = [];
  const expired: BuffInstance[] = [];
  for (const b of buffs) {
    const def = buffDefinition(b.id);
    if (def.decayAt !== timing || b.duration == null) {
      kept.push(b);
      continue;
    }
    const next = b.duration - 1;
    if (next <= 0) expired.push(b);
    else kept.push({ ...b, duration: next });
  }
  return { buffs: kept, expired };
}

/**
 * **承载者自己回合结束**的状态衰减（甲方 2026-10-09）。
 *
 * 与 {@link tickBuffs} 的区别：这里只处理 `decayAt: "ownerTurnEnd"` 的状态，
 * 且带**新鲜度护栏**——本回合刚挂上的（`appliedTurn === turn`）跳过这一次递减，
 * 保证「无论谁在什么时候施加，承载者都至少吃到一次自己的回合开始」。
 *
 * 回合口径（写死，不许再各自为政）：剩余回合只在**承载者自己的回合结束**递减。
 *
 * @param turn 当前回合数（draft.turn），用于新鲜度判定
 */
export function tickOwnerTurnEnd(buffs: readonly BuffInstance[], turn: number): BuffTickResult {
  const kept: BuffInstance[] = [];
  const expired: BuffInstance[] = [];
  for (const b of buffs) {
    const def = buffDefinition(b.id);
    if (def.decayAt !== "ownerTurnEnd" || b.duration == null) {
      kept.push(b);
      continue;
    }
    if (b.appliedTurn === turn) {
      kept.push(b);
      continue;
    }
    const next = b.duration - 1;
    if (next <= 0) expired.push({ ...b, duration: 0 });
    else kept.push({ ...b, duration: next });
  }
  return { buffs: kept, expired };
}
