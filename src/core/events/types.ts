/**
 * core/events · 领域事件（docs/02 §5，**只增不改**）
 *
 * 核心层对外的唯一表达：UI 动画、战斗日志、回放、调试面板全部消费这里。
 * 每个事件都带全局递增 seq 与所属 actionId（同 Action 的事件 = 一个动画帧组）。
 */
import type { ModifierDetail } from "../pipeline/modifier-evaluator";

export interface EnemySetup {
  readonly id: string;
  /** 内容定义 id；省略时等于 id（同名多实例由 createBattleState 自动加实例后缀） */
  readonly defId?: string;
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
  /** 蓄力回合附带的格挡（docs/18 Q3） */
  readonly block?: number;
  /** 蓄力链的释放伤害（预警文案用） */
  readonly thenValue?: number;
  /** 距离释放还剩几次敌人行动（蓄力链预警：2 回合后 / 下回合） */
  readonly thenIn?: number;
  /** 该攻击是蓄力链的释放段（信息标记；层数已在链上算死，无需运行期清零） */
  readonly released?: boolean;
  /** 召唤意图（docs/40 §五）：召唤物定义 id 与数量 */
  readonly enemyId?: string;
  readonly count?: number;
  /** 颠倒（docs/46 §3.8）：意图数值被随机化，UI 只显示「?」 */
  readonly fuzzed?: boolean;
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
  HpLost: {
    targetId: string;
    value: number;
    reason: "damage" | "bloodpact" | "pollution" | "backlash" | "burn";
  };
  HpHealed: { targetId: string; value: number; total: number; reason: "regen" | "card" | "relic" };
  BuffApplied: { targetId: string; buffId: string; stacks: number; duration: number | null };
  BuffTriggered: { targetId: string; buffId: string; stacks: number };
  BuffExpired: { targetId: string; buffId: string };
  /** 计时 Buffer 结算（docs/38 §二 B-2 蚀锈）：目标回合结束受到 damage 点伤害 */
  BuffTicked: { targetId: string; buffId: string; stacks: number; damage: number };
  /** 断链（docs/38 §三 C-1）：蓄力中的敌人被虚弱/胆怯/眩晕命中，链条取消、本回合空转 */
  ChargeInterrupted: { enemyId: string; buffId: string; times: number };
  /** 眩晕抗性（docs/46 §3.5）：精英 / Boss 首次被眩晕后，本场战斗免疫后续眩晕 */
  StunResisted: { targetId: string };
  /** 召唤（docs/40 §五）：敌人召唤出新单位，入场当回合不行动 */
  UnitSummoned: { summonerId: string; enemyId: string; defId: string };
  PollutionChanged: { targetId: string; before: number; after: number; delta: number; critical: boolean };
  ChargeChanged: { targetId: string; before: number; after: number; delta: number };
  Overloaded: { targetId: string; charge: number; backlash: number };
  /** 敌人蓄力开始（架盾）或释放重击；供战斗日志解释「为什么打不动它」 */
  ChargeResolved: { enemyId: string; block: number; released: boolean; value?: number };
  IntentRevealed: { enemyId: string; intent: IntentPayload };
  /** 教学安全网触发（docs/42 §四）：本该放倒玩家的伤害被截断在 safetyFloor 之上 */
  SafetyNet: { targetId: string; wouldLose: number; saved: number; hpLeft: number };
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