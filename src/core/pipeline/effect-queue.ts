/**
 * core/pipeline · 栈式效果队列（ADR-002）
 *
 * 后进先出：连锁触发产生的新动作压栈，保证"杀死后抽牌再触发"这类链条有序。
 * 死亡清理：单位死亡时清除队列中所有以它为来源或目标的挂起动作。
 * 深度上限：防触发死循环（triggers README 约定）。
 */

export interface QueuedEffect<T = unknown> {
  readonly id: string;
  /** 产生该效果的来源（卡牌实例 / Buff / 遗物 / 单位 id） */
  readonly sourceId: string;
  /** 受影响单位 id 列表 */
  readonly targetIds: readonly string[];
  readonly payload: T;
}

export interface EffectQueueOptions {
  /** 队列中同时挂起的最大动作数，超出即判定触发循环 */
  readonly maxDepth?: number;
}

export const DEFAULT_MAX_DEPTH = 256;

export class EffectQueue<T = unknown> {
  private readonly stack: QueuedEffect<T>[] = [];
  private readonly maxDepth: number;
  private processedCount = 0;

  constructor(options: EffectQueueOptions = {}) {
    this.maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  get size(): number {
    return this.stack.length;
  }

  get processed(): number {
    return this.processedCount;
  }

  /** 压栈。加工过程中调用即"中途插入"，下一次 pop 优先结算。 */
  push(effect: QueuedEffect<T>): void {
    if (this.stack.length >= this.maxDepth) {
      throw new Error(`EffectQueue 深度超限（${this.maxDepth}），疑似触发死循环`);
    }
    this.stack.push(effect);
  }

  /** 取出下一个待结算动作（LIFO）。 */
  pop(): QueuedEffect<T> | undefined {
    const next = this.stack.pop();
    if (next) this.processedCount += 1;
    return next;
  }

  peek(): QueuedEffect<T> | undefined {
    return this.stack[this.stack.length - 1];
  }

  /** 死亡清理：移除所有以该单位为来源或目标的挂起动作，返回被移除项。 */
  removeByUnit(unitId: string): QueuedEffect<T>[] {
    const removed: QueuedEffect<T>[] = [];
    for (let i = this.stack.length - 1; i >= 0; i -= 1) {
      const e = this.stack[i];
      if (e.sourceId === unitId || e.targetIds.includes(unitId)) {
        removed.push(e);
        this.stack.splice(i, 1);
      }
    }
    return removed;
  }

  /** 按 LIFO 顺序清空并返回全部挂起动作。 */
  drain(): QueuedEffect<T>[] {
    const out: QueuedEffect<T>[] = [];
    let next = this.pop();
    while (next) {
      out.push(next);
      next = this.pop();
    }
    return out;
  }

  clear(): void {
    this.stack.length = 0;
  }

  /** 队列可视化转储（调试面板用）。 */
  dump(): { id: string; sourceId: string; targetIds: readonly string[] }[] {
    return this.stack.map((e) => ({ id: e.id, sourceId: e.sourceId, targetIds: e.targetIds }));
  }
}
