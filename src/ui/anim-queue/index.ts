/**
 * ui/anim-queue · 动画队列（docs/02 §6 / docs/08 §6）
 *
 * 消费核心事件流：同一个 Action 产出的事件为一个"动画帧组"，组内并行、组间串行。
 * 支持跳过与 2× 倍速；时长参数锚定 docs/08 §6。
 */
import type { DomainEvent } from "@/core/events";

export interface AnimGroup {
  readonly actionId: string;
  readonly events: readonly DomainEvent[];
}

const DURATION: Partial<Record<DomainEvent["type"], number>> = {
  DamageDealt: 180,
  HpLost: 140,
  HpHealed: 140,
  BlockGained: 120,
  BlockBroken: 160,
  BuffApplied: 110,
  BuffTriggered: 110,
  BuffExpired: 110,
  CardPlayed: 140,
  CardRetained: 110,
  CardExhausted: 110,
  CardsDrawn: 60,
  DeckShuffled: 90,
  IntentRevealed: 90,
  TurnStarted: 140,
  TurnEnded: 120,
  BattleStarted: 240,
  BattleEnded: 260,
  UnitDied: 260,
  PollutionChanged: 120,
  ChargeChanged: 120,
  Overloaded: 200,
};

export function eventDelay(event: DomainEvent): number {
  return DURATION[event.type] ?? 70;
}

/** 按 actionId 分组，保持事件原始顺序。 */
export function groupByAction(events: readonly DomainEvent[]): AnimGroup[] {
  const groups: AnimGroup[] = [];
  const index = new Map<string, number>();
  for (const event of events) {
    const at = index.get(event.actionId);
    if (at === undefined) {
      index.set(event.actionId, groups.length);
      groups.push({ actionId: event.actionId, events: [event] });
    } else {
      (groups[at].events as DomainEvent[]).push(event);
    }
  }
  return groups;
}

export interface AnimQueueHandlers {
  onEvent?: (event: DomainEvent) => void;
  onIdle?: () => void;
}

export class AnimQueue {
  private groups: AnimGroup[] = [];
  private running = false;
  private speedValue = 1;
  private token = 0;
  private handlers: AnimQueueHandlers = {};

  configure(handlers: AnimQueueHandlers): void {
    this.handlers = handlers;
  }

  setSpeed(speed: number): void {
    this.speedValue = speed;
  }

  get speed(): number {
    return this.speedValue;
  }

  get isBusy(): boolean {
    return this.running || this.groups.length > 0;
  }

  get pending(): number {
    return this.groups.length;
  }

  enqueue(events: readonly DomainEvent[]): void {
    if (events.length === 0) return;
    this.groups.push(...groupByAction(events));
    void this.run();
  }

  /** 跳过剩余动画（不播放 FX，直接到达终态）。 */
  skip(): void {
    this.token += 1;
    this.groups = [];
    this.running = false;
    this.handlers.onIdle?.();
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const mine = ++this.token;
    while (this.groups.length > 0) {
      const group = this.groups.shift();
      if (!group) break;
      for (const event of group.events) {
        if (mine !== this.token) return;
        this.handlers.onEvent?.(event);
        const wait = eventDelay(event) / Math.max(1, this.speedValue);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    if (mine !== this.token) return;
    this.running = false;
    this.handlers.onIdle?.();
  }
}
