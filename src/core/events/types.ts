/**
 * core/events · 领域事件（docs/02 §5，**只增不改**）
 *
 * 核心层对外的唯一表达：UI 动画、战斗日志、回放、调试面板全部消费这里。
 * 每个事件都带全局递增 seq 与所属 actionId（同 Action 的事件 = 一个动画帧组）。
 */
import type { ModifierDetail } from "../pipeline/modifier-evaluator";

export interface EnemySetup {
  readonly id: string;
  /** 省略时由 ContentDb 的敌人定义提供 */
  readonly maxHp?: number;
}

export interface IntentPayload {
  readonly kind: "attack" | "defend" | "debuff" | "charge" | "summon" | "unknown";
  readonly value?: number;
  readonly hits?: number;
  readonly buffId?: string;
  readonly stacks?: number;
  readonly duration?: number;
  /** 蓄力类招式的后续伤害（预警文案用） */
  readonly thenValue?: number;
}

export interface EventPayloadMap {
  BattleStarted: { enemies: readonly EnemySetup[]; startingHand: readonly string[]; turn: number };
  TurnStarted: { turn: number };
  TurnEnded: { turn: number };
  CardsDrawn: { cardIds: readonly string[] };
  DeckShuffled: { from: "discard" | "exhaust"; count: number };
  CardPlayed: {
    cardId: string;
    handIndex: number;
    targetId: string | null;
    costPaid: number;
    bloodPaid: number;
  };
  CardExhausted: { cardId: string };
  CardRetained: { cardId: string };
  /** 硬性要求：携带修饰层明细（战斗日志与数值排查全靠它）。 */
  DamageDealt: {
    sourceId: string;
    targetId: string;
    base: number;
    layers: readonly ModifierDetail[];
    value: number;
    blocked: number;
    hpLost: number;
    segment: number;
    segments: number;
  };
  BlockGained: { targetId: string; value: number; total: number };
  BlockBroken: { targetId: string; value: number };
  HpLost: { targetId: string; value: number; reason: "damage" | "bloodpact" | "pollution" | "backlash" };
  HpHealed: { targetId: string; value: number; total: number; reason: "regen" | "card" | "relic" };
  BuffApplied: { targetId: string; buffId: string; stacks: number; duration: number | null };
  BuffTriggered: { targetId: string; buffId: string; stacks: number };
  BuffExpired: { targetId: string; buffId: string };
  PollutionChanged: { targetId: string; before: number; after: number; delta: number; critical: boolean };
  ChargeChanged: { targetId: string; before: number; after: number; delta: number };
  Overloaded: { targetId: string; charge: number; backlash: number };
  IntentRevealed: { enemyId: string; intent: IntentPayload };
  UnitDied: { unitId: string; clearedEffects: number };
  BattleEnded: { result: "win" | "lose"; rewardsSeed: number };
}

export type DomainEventType = keyof EventPayloadMap;

export type DomainEvent = {
  [K in DomainEventType]: {
    readonly seq: number;
    readonly actionId: string;
    readonly type: K;
  } & EventPayloadMap[K];
}[DomainEventType];

export type DomainEventOf<K extends DomainEventType> = Extract<DomainEvent, { type: K }>;