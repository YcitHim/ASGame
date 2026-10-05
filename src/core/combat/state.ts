/**
 * core/combat · 战斗状态结构（docs/02 §2）
 * 状态不可变：reducer 每次都产出新对象（内部用 Draft 工作副本，见 draft.ts）。
 */
import type { BuffInstance } from "../buffs";
import type { EnemySetup, IntentPayload } from "../events";
import type { ContentDb } from "../registry/content";
import { emptyContent } from "../registry/content";
import type { Modifier } from "../pipeline";
import { Rng, type RngSnapshot } from "../rng";

export type Phase =
  | "battleStart"
  | "turnStart"
  | "draw"
  | "playerAction"
  | "enemyAction"
  | "turnEnd"
  | "battleEnd";

export interface CardInstance {
  readonly instanceId: string;
  readonly cardId: string;
  readonly upgraded: boolean;
  readonly enhancements: readonly string[];
}

export interface PlayerState {
  readonly id: "player";
  readonly hp: number;
  readonly maxHp: number;
  readonly block: number;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly pollution: number;
  readonly charge: number;
  readonly buffs: readonly BuffInstance[];
  /** 本局携带的遗物 id */
  readonly relics: readonly string[];
  /** 已触发过的遗物（once: battle） */
  readonly triggeredThisBattle: readonly string[];
  /** 本回合已触发过的遗物（once: turn） */
  readonly triggeredThisTurn: readonly string[];
}

export interface EnemyState {
  readonly id: string;
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly block: number;
  readonly buffs: readonly BuffInstance[];
  readonly intent: IntentPayload | null;
  readonly intentHistory: readonly string[];
  /** 蓄力链的剩余环节（下一招由链决定，执行后逐个揭示；空 = 正常随机） */
  readonly forcedChain: readonly IntentPayload[];
}

export interface Piles {
  readonly draw: readonly string[];
  readonly hand: readonly string[];
  readonly discard: readonly string[];
  readonly exhaust: readonly string[];
}

export interface BattleState {
  readonly battleId: string;
  readonly rootSeed: number;
  readonly rng: RngSnapshot;
  readonly turn: number;
  readonly phase: Phase;
  readonly player: PlayerState;
  readonly enemies: readonly EnemyState[];
  readonly piles: Piles;
  readonly cardInstances: Readonly<Record<string, CardInstance>>;
  readonly modifiers: readonly Modifier[];
  readonly handSize: number;
  readonly cardsPlayedThisTurn: number;
  /** 事件全局序号计数器 */
  readonly eventSeq: number;
  /** 静态内容目录（不参与回放序列化） */
  readonly content: ContentDb;
}

/** 卡组条目：字符串 = 未升级无强化；对象 = 携带升级/强化（Roguelike 卡组实例）。 */
export interface DeckEntry {
  readonly cardId: string;
  readonly upgraded?: boolean;
  readonly enhancements?: readonly string[];
}

export interface BattleConfig {
  readonly battleId: string;
  readonly seed: number;
  readonly player: { readonly maxHp: number; readonly energy: number; readonly hp?: number };
  readonly enemies: readonly EnemySetup[];
  /** 卡组（洗牌前顺序） */
  readonly deck: readonly (string | DeckEntry)[];
  readonly handSize?: number;
  readonly content?: ContentDb;
  readonly relics?: readonly string[];
}

export const DEFAULT_HAND_SIZE = 5;

/** 卡组卡牌 id → 实例 id（实例携带升级/强化信息，卡牌 id 本身不唯一）。 */
function makeInstanceId(cardId: string, index: number): string {
  return `${cardId}#${index + 1}`;
}

export function createBattleState(config: BattleConfig): BattleState {
  const content = config.content ?? emptyContent();
  const cardInstances: Record<string, CardInstance> = {};
  const draw: string[] = [];

  config.deck.forEach((entry, index) => {
    const cardId = typeof entry === "string" ? entry : entry.cardId;
    const instanceId = makeInstanceId(cardId, index);
    cardInstances[instanceId] = {
      instanceId,
      cardId,
      upgraded: typeof entry === "string" ? false : (entry.upgraded ?? false),
      enhancements: typeof entry === "string" ? [] : (entry.enhancements ?? []),
    };
    draw.push(instanceId);
  });

  return {
    battleId: config.battleId,
    rootSeed: config.seed >>> 0,
    rng: new Rng(config.seed).snapshot(),
    turn: 0,
    phase: "battleStart",
    player: {
      id: "player",
      hp: config.player.hp ?? config.player.maxHp,
      maxHp: config.player.maxHp,
      block: 0,
      energy: config.player.energy,
      maxEnergy: config.player.energy,
      pollution: 0,
      charge: 0,
      buffs: [],
      relics: (config.relics ?? []).slice(),
      triggeredThisBattle: [],
      triggeredThisTurn: [],
    },
    enemies: config.enemies.map((e) => {
      const def = content.enemies.get(e.id);
      const maxHp = e.maxHp ?? def?.maxHp ?? 1;
      return {
        id: e.id,
        name: def?.name ?? e.id,
        hp: maxHp,
        maxHp,
        block: 0,
        buffs: [],
        intent: null,
        intentHistory: [],
        forcedChain: [],
      };
    }),
    piles: { draw, hand: [], discard: [], exhaust: [] },
    cardInstances,
    modifiers: [],
    handSize: config.handSize ?? DEFAULT_HAND_SIZE,
    cardsPlayedThisTurn: 0,
    eventSeq: 0,
    content,
  };
}
