/**
 * core/rng · 分流种子随机（ADR-006）
 *
 * 全项目唯一随机来源。同一 rootSeed + 流名，序列永远一致；
 * 任一流被消费不影响其他流的序列——这是"改地图不废回放"的关键。
 *
 * 算法：stream seed = fnv1a(rootSeed, name) + splitmix32 finalize；
 *       序列 = mulberry32 状态机。纯整数运算，可快照/恢复。
 */

export const STREAM_NAMES = ["combat", "reward", "map", "event", "ai", "fx", "curse", "trait"] as const;
export type StreamName = (typeof STREAM_NAMES)[number];

export interface RngStreamSnapshot {
  readonly name: StreamName;
  readonly seed: number;
  readonly state: number;
  readonly draws: number;
}

export type RngSnapshot = Readonly<Record<StreamName, RngStreamSnapshot>>;

const UINT32 = 0x100000000;

function toUint32(n: number): number {
  return n >>> 0;
}

/** fnv1a 混淆 + splitmix32 收尾：rootSeed 与流名 → 独立流种子。 */
export function deriveStreamSeed(rootSeed: number, name: string): number {
  let h = toUint32(rootSeed) ^ 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  }
  h = (h ^ (h >>> 16)) >>> 0;
  h = Math.imul(h, 0x7feb352d) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h;
}

/** mulberry32 单步：输入状态 → [0,1) 与下一状态。 */
export function mulberry32Step(state: number): { value: number; next: number } {
  const next = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / UINT32;
  return { value, next };
}

/** 单条随机流。状态可变，但可随时快照/恢复（存档与回放）。 */
export class RngStream {
  readonly name: StreamName;
  readonly seed: number;
  private state: number;
  private draws: number;

  constructor(name: StreamName, seed: number, state: number = seed, draws = 0) {
    this.name = name;
    this.seed = toUint32(seed);
    this.state = toUint32(state);
    this.draws = draws;
  }

  /** 消费一次随机，返回 [0,1)。 */
  nextFloat(): number {
    const { value, next } = mulberry32Step(this.state);
    this.state = next;
    this.draws += 1;
    return value;
  }

  /** 闭区间 [min, max] 整数。 */
  nextInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      throw new Error(`RngStream.nextInt 需要整数区间，收到 [${min}, ${max}]`);
    }
    if (max < min) throw new Error(`RngStream.nextInt 区间非法：[${min}, ${max}]`);
    return Math.floor(this.nextFloat() * (max - min + 1)) + min;
  }

  /** 等概率取一个元素。 */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("RngStream.pick 不能作用于空数组");
    return items[this.nextInt(0, items.length - 1)];
  }

  /** 返回洗牌后的新数组，不修改入参（唯一合法洗牌入口）。 */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.nextInt(0, i);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  /** 按权重取一个元素；权重和必须 > 0。 */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    if (entries.length === 0) throw new Error("RngStream.weighted 不能作用于空表");
    let total = 0;
    for (const [, w] of entries) {
      if (w < 0) throw new Error("RngStream.weighted 权重不可为负");
      total += w;
    }
    if (total <= 0) throw new Error("RngStream.weighted 权重和必须大于 0");
    let roll = this.nextFloat() * total;
    for (const [item, w] of entries) {
      roll -= w;
      if (roll < 0) return item;
    }
    return entries[entries.length - 1][0];
  }

  snapshot(): RngStreamSnapshot {
    return { name: this.name, seed: this.seed, state: this.state, draws: this.draws };
  }

  static fromSnapshot(s: RngStreamSnapshot): RngStream {
    return new RngStream(s.name, s.seed, s.state, s.draws);
  }
}

/** 分流集合：一个 rootSeed 派生全部流。 */
export class Rng {
  readonly rootSeed: number;
  private readonly streams: Map<StreamName, RngStream>;

  constructor(rootSeed: number, streams?: Map<StreamName, RngStream>) {
    this.rootSeed = toUint32(rootSeed);
    this.streams = streams ?? new Map();
  }

  stream(name: StreamName): RngStream {
    let s = this.streams.get(name);
    if (!s) {
      s = new RngStream(name, deriveStreamSeed(this.rootSeed, name));
      this.streams.set(name, s);
    }
    return s;
  }

  snapshot(): RngSnapshot {
    const out = {} as Record<StreamName, RngStreamSnapshot>;
    for (const name of STREAM_NAMES) out[name] = this.stream(name).snapshot();
    return out;
  }

  static fromSnapshot(rootSeed: number, snapshot: RngSnapshot): Rng {
    const streams = new Map<StreamName, RngStream>();
    for (const name of STREAM_NAMES) {
      // 新增流名时旧存档没有该键：按 rootSeed 现派一条新流（该流此前从未被抽过，确定性不受影响）。
      const snap = snapshot[name];
      streams.set(
        name,
        snap ? RngStream.fromSnapshot(snap) : new RngStream(name, deriveStreamSeed(rootSeed, name)),
      );
    }
    return new Rng(rootSeed, streams);
  }
}
