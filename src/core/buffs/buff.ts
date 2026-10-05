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

function clampStacks(id: BuffInstance["id"], stacks: number): number {
  const def = buffDefinition(id);
  const capped = def.maxStacks == null ? stacks : Math.min(stacks, def.maxStacks);
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

  if (!existing) {
    const fresh: BuffInstance = {
      id: input.id,
      stacks: clampStacks(input.id, input.stacks),
      duration: def.applyAs === "stacks" ? null : incomingDuration,
    };
    if (fresh.stacks <= 0 && def.applyAs === "stacks") return buffs.slice();
    return [...buffs, fresh];
  }

  let stacks: number;
  let duration: number | null;
  switch (def.stacking) {
    case "stack":
      stacks = clampStacks(input.id, existing.stacks + input.stacks);
      duration = existing.duration;
      break;
    case "refreshOnly":
      stacks = clampStacks(input.id, Math.max(existing.stacks, input.stacks));
      duration = refreshDuration(existing.duration, incomingDuration);
      break;
    default:
      stacks = clampStacks(input.id, existing.stacks + input.stacks);
      duration = refreshDuration(existing.duration, incomingDuration);
      break;
  }

  return buffs.map((b) => (b.id === input.id ? { id: b.id, stacks, duration } : b));
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
    else kept.push({ id: b.id, stacks: b.stacks, duration: next });
  }
  return { buffs: kept, expired };
}
