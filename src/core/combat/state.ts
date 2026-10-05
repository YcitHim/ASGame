/**
 * core/combat · 战斗状态结构（docs/02 §2）
 * 状态不可变：reducer 每次都产出新对象。
 */
import type { BuffInstance } from "../buffs";
import type { EnemySetup, IntentPayload } from "../events";
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

export interface PlayerState {
  readonly hp: number;
  readonly maxHp: number;
  readonly block: number;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly pollution: number;
  readonly charge: number;
  readonly buffs: readonly BuffInstance[];
}

export interface EnemyState {
  readonly id: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly block: number;
  readonly buffs: readonly BuffInstance[];
  readonly intent: IntentPayload | null;
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
  readonly modifiers: readonly Modifier[];
  readonly handSize: number;
  /** 事件全局序号计数器 */
  readonly eventSeq: number;
}

export interface BattleConfig {
  readonly battleId: string;
  readonly seed: number;
  readonly player: { readonly maxHp: number; readonly energy: number };
  readonly enemies: readonly EnemySetup[];
  /** 卡组实例 id 列表（洗牌前顺序） */
  readonly deck: readonly string[];
  readonly handSize?: number;
}

export const DEFAULT_HAND_SIZE = 5;

export function createBattleState(config: BattleConfig): BattleState {
  return {
    battleId: config.battleId,
    rootSeed: config.seed >>> 0,
    rng: new Rng(config.seed).snapshot(),
    turn: 0,
    phase: "battleStart",
    player: {
      hp: config.player.maxHp,
      maxHp: config.player.maxHp,
      block: 0,
      energy: config.player.energy,
      maxEnergy: config.player.energy,
      pollution: 0,
      charge: 0,
      buffs: [],
    },
    enemies: config.enemies.map((e) => ({
      id: e.id,
      hp: e.maxHp,
      maxHp: e.maxHp,
      block: 0,
      buffs: [],
      intent: null,
    })),
    piles: { draw: config.deck.slice(), hand: [], discard: [], exhaust: [] },
    modifiers: [],
    handSize: config.handSize ?? DEFAULT_HAND_SIZE,
    eventSeq: 0,
  };
}
