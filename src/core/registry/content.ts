/**
 * core/registry · 内容目录（ContentDb）
 *
 * data/*.json 经 content-validator 校验后，在应用启动时装入这里。
 * core 只认这些类型，不读文件系统、不 import UI（G3）。
 */
import type { BuffId, CardHandlerId, CardRarity, CardType, ConditionId, EnhancementHandlerId, KeywordId, TargetId } from "./ids";

export interface TargetRef {
  readonly type: TargetId;
}

export type ConditionNode =
  | { readonly type: "and"; readonly of: readonly ConditionNode[] }
  | { readonly type: "or"; readonly of: readonly ConditionNode[] }
  | { readonly type: "not"; readonly of: ConditionNode }
  | { readonly type: ConditionId } & Record<string, unknown>;

export interface CardEffect {
  readonly kind:
    | "damage"
    | "block"
    | "draw"
    | "heal"
    | "applyBuff"
    | "gainEnergy"
    | "gainPollution"
    | "gainCharge";
  readonly target?: TargetRef;
  readonly value?: number;
  readonly hits?: number;
  readonly buff?: BuffId;
  readonly stacks?: number;
  /** 仅对该效果生效的条件（如 HP<50% 时抽牌） */
  readonly condition?: ConditionNode;
}

export interface CardUpgrade {
  readonly cost?: number;
  readonly effects?: readonly CardEffect[];
  readonly play?: CardPlayHandler;
  readonly keywords?: readonly KeywordId[];
}

export interface CardPlayHandler {
  readonly handler: CardHandlerId;
  readonly params: Readonly<Record<string, unknown>>;
}

export interface CardDefinition {
  readonly id: string;
  readonly class: string;
  readonly type: CardType;
  readonly rarity: CardRarity;
  readonly cost: number;
  readonly bloodCost?: number;
  readonly keywords?: readonly KeywordId[];
  readonly effects?: readonly CardEffect[];
  readonly play?: CardPlayHandler;
  readonly upgraded?: CardUpgrade;
  readonly art?: string;
  readonly i18n?: string;
}

export interface IntentDefinition {
  readonly kind: "attack" | "defend" | "debuff" | "charge" | "unknown";
  readonly value?: number;
  readonly hits?: number;
  readonly buffId?: BuffId;
  readonly stacks?: number;
  readonly duration?: number;
}

export interface EnemyIntentEntry {
  readonly intent: IntentDefinition;
  readonly weight: number;
  readonly condition?: ConditionNode;
  /** 同一意图最多连续出现次数（0.1 读招体验） */
  readonly maxConsecutive?: number;
}

export interface EnemyDefinition {
  readonly id: string;
  readonly name: string;
  readonly maxHp: number;
  readonly intents: readonly EnemyIntentEntry[];
}

export interface EnhancementDefinition {
  readonly id: string;
  readonly tier: 1 | 2 | 3;
  readonly appliesTo: readonly string[];
  readonly mutex?: readonly string[];
  readonly handler: EnhancementHandlerId;
  readonly params: Readonly<Record<string, unknown>>;
  readonly i18n?: string;
}

/** 地图节点类型（0.1 用到的子集 + event 预留）。 */
export const NODE_KINDS = ["battle", "elite", "rest", "altar", "reward", "boss", "event"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

export interface MapNode {
  readonly id: string;
  readonly kind: NodeKind;
  /** battle / elite / boss 节点的敌人 id 列表 */
  readonly enemies?: readonly string[];
  /** 节点副标题（可选，i18n key） */
  readonly i18n?: string;
}

export interface ActDefinition {
  readonly id: string;
  readonly i18n: string;
  readonly player: { readonly maxHp: number; readonly energy: number };
  readonly startDeck: readonly string[];
  readonly startRelics?: readonly string[];
  /** 线性节点列表（0.1 不分支） */
  readonly map: readonly MapNode[];
}

/** 触发器时机（triggers README 的 v0 时机表）。 */
export type TriggerTiming =
  | "onBattleStart"
  | "onTurnStart"
  | "onTurnEnd"
  | "onPlay"
  | "onHit"
  | "onSell";

export interface RelicDefinition {
  readonly id: string;
  readonly i18n: string;
  readonly timing: TriggerTiming;
  readonly effects: readonly CardEffect[];
  /** 触发次数限制：battle = 整场一次；turn = 每回合一次；缺省 = 每次时机都触发 */
  readonly once?: "battle" | "turn";
}

export interface ContentDb {
  readonly cards: ReadonlyMap<string, CardDefinition>;
  readonly enemies: ReadonlyMap<string, EnemyDefinition>;
  readonly enhancements: ReadonlyMap<string, EnhancementDefinition>;
  readonly relics: ReadonlyMap<string, RelicDefinition>;
}

export function createContentDb(partial: Partial<ContentDb> = {}): ContentDb {
  return {
    cards: partial.cards ?? new Map(),
    enemies: partial.enemies ?? new Map(),
    enhancements: partial.enhancements ?? new Map(),
    relics: partial.relics ?? new Map(),
  };
}

export function emptyContent(): ContentDb {
  return createContentDb();
}