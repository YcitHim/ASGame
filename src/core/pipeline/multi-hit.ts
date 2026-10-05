/**
 * core/pipeline · 多段攻击拆分器（ADR-002）
 *
 * { hits, split[] } → N 个独立伤害动作，每段独立触发 onHit。
 * 取整采用"最大余数法"，保证各段之和恰好等于总伤害（不因取整丢伤害）。
 */
import type { QueuedEffect } from "./effect-queue";

export interface MultiHitSpec {
  readonly hits: number;
  /** 各段比例，和必须为 1（容差 1e-6） */
  readonly split: readonly number[];
}

export function validateMultiHitSpec(spec: MultiHitSpec): void {
  if (!Number.isInteger(spec.hits) || spec.hits < 1) {
    throw new Error(`多段攻击 hits 必须 ≥1 的整数，收到 ${spec.hits}`);
  }
  if (spec.split.length !== spec.hits) {
    throw new Error(`多段攻击 split 长度(${spec.split.length})必须等于 hits(${spec.hits})`);
  }
  let sum = 0;
  for (const r of spec.split) {
    if (r < 0) throw new Error("多段攻击 split 不可为负");
    sum += r;
  }
  if (Math.abs(sum - 1) > 1e-6) {
    throw new Error(`多段攻击 split 之和必须为 1，收到 ${sum}`);
  }
}

/**
 * 按比例把总量拆成整数份，最大余数法分配，和恰好等于 total。
 */
export function splitValues(total: number, ratios: readonly number[]): number[] {
  if (ratios.length === 0) return [];
  if (total <= 0) return ratios.map(() => 0);
  const exact = ratios.map((r) => total * r);
  const floors = exact.map((v) => Math.floor(v));
  let remainder = total - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  const out = floors.slice();
  for (const { i } of order) {
    if (remainder <= 0) break;
    out[i] += 1;
    remainder -= 1;
  }
  return out;
}

export interface MultiHitBuildArgs<T> {
  readonly sourceId: string;
  readonly targetIds: readonly string[];
  readonly base: number;
  readonly spec: MultiHitSpec;
  /** 每段唯一 id（由调用方保证确定性，通常拼段号） */
  readonly makeId: (segment: number) => string;
  readonly makePayload: (segment: number, value: number) => T;
}

/** 构造 N 个彼此独立的效果动作（各自独立 onHit）。 */
export function buildMultiHitEffects<T>(args: MultiHitBuildArgs<T>): QueuedEffect<T>[] {
  validateMultiHitSpec(args.spec);
  const values = splitValues(args.base, args.spec.split);
  return values.map((value, segment) => ({
    id: args.makeId(segment),
    sourceId: args.sourceId,
    targetIds: args.targetIds,
    payload: args.makePayload(segment, value),
  }));
}
