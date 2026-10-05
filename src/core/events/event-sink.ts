import type { DomainEvent, DomainEventType, EventPayloadMap } from "./types";

/**
 * 事件收集器：负责分配全局递增 seq、标记所属 Action（动画帧组），
 * 并在一次 reduce 结束时整体交给调用方。
 */
export class EventSink {
  private seq: number;
  private readonly actionId: string;
  private readonly buffer: DomainEvent[] = [];

  constructor(startSeq: number, actionId: string) {
    this.seq = startSeq;
    this.actionId = actionId;
  }

  emit<K extends DomainEventType>(type: K, payload: EventPayloadMap[K]): void {
    const event = { seq: this.seq, actionId: this.actionId, type, ...payload } as DomainEvent;
    this.buffer.push(event);
    this.seq += 1;
  }

  get nextSeq(): number {
    return this.seq;
  }

  get length(): number {
    return this.buffer.length;
  }

  list(): readonly DomainEvent[] {
    return this.buffer;
  }
}
