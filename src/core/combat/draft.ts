/**
 * core/combat · 工作副本（Draft）
 *
 * reducer 内部用它做可变结算，结束时一次性冻结成新的不可变 BattleState。
 * 输入 state 绝不被修改（ADR-001）。
 */
import { Rng } from "../rng";
import { EffectQueue } from "../pipeline";
import type { BuffInstance } from "../buffs";
import type { ContentDb } from "../registry/content";
import type { CardDefinition, RunDifficulty } from "../registry/content";
import type { IntentPayload } from "../events";
import type { Modifier } from "../pipeline";
import type { CardInstance, EnemyState, Phase, BattleState } from "./state";
import type { EffectWork } from "./work";

export interface MutableUnit {
  readonly id: string;
  readonly maxHp: number;
  hp: number;
  block: number;
  buffs: BuffInstance[];
}

export interface MutablePlayer extends MutableUnit {
  energy: number;
  readonly maxEnergy: number;
  pollution: number;
  charge: number;
  relics: string[];
  /** 本场生效的卡牌能力（power）实例 id */
  powers: string[];
  triggeredThisBattle: string[];
  triggeredThisTurn: string[];
}

export interface MutableEnemy extends MutableUnit {
  readonly defId: string;
  readonly name: string;
  intent: EnemyState["intent"];
  intentHistory: string[];
  forcedChain: IntentPayload[];
  interruptsTaken: number;
  summonerId?: string;
  spawnedTurn?: number;
}

export interface Draft {
  readonly battleId: string;
  rootSeed: number;
  /** 难度档（docs/36 T2）：敌人伤害倍率在 attackModifiers 读取 */
  readonly difficulty: RunDifficulty;
  /** 教学安全下限（docs/42 §四）；undefined = 关闭 */
  readonly safetyFloor: number | undefined;
  /** 安全网已触发次数 */
  safetySaves: number;
  readonly content: ContentDb;
  readonly handSize: number;
  rng: Rng;
  turn: number;
  phase: Phase;
  eventSeq: number;
  cardsPlayedThisTurn: number;
  tookDamageThisTurn: boolean;
  player: MutablePlayer;
  enemies: MutableEnemy[];
  draw: string[];
  hand: string[];
  discard: string[];
  exhaust: string[];
  cardInstances: Record<string, CardInstance>;
  /** 本场临时修饰（layer:"temporary"）：随战斗结束消失 */
  modifiers: Modifier[];
  /** 栈式效果队列（ADR-002）：不在 BattleState 中持久化，每次 reduce 从空开始 */
  queue: EffectQueue<EffectWork>;
  /** 排空重入保护：结算中再入的动作只入栈，由当前循环弹出 */
  draining: boolean;
}

export function toDraft(state: BattleState): Draft {
  return {
    battleId: state.battleId,
    rootSeed: state.rootSeed,
    difficulty: state.difficulty,
    safetyFloor: state.safetyFloor,
    safetySaves: state.safetySaves,
    content: state.content,
    handSize: state.handSize,
    rng: Rng.fromSnapshot(state.rootSeed, state.rng),
    turn: state.turn,
    phase: state.phase,
    eventSeq: state.eventSeq,
    cardsPlayedThisTurn: state.cardsPlayedThisTurn,
    tookDamageThisTurn: state.tookDamageThisTurn,
    player: {
      id: "player",
      hp: state.player.hp,
      maxHp: state.player.maxHp,
      block: state.player.block,
      buffs: state.player.buffs.map((b) => ({ ...b })),
      energy: state.player.energy,
      maxEnergy: state.player.maxEnergy,
      pollution: state.player.pollution,
      charge: state.player.charge,
      relics: [...state.player.relics],
      powers: [...state.player.powers],
      triggeredThisBattle: [...state.player.triggeredThisBattle],
      triggeredThisTurn: [...state.player.triggeredThisTurn],
    },
    enemies: state.enemies.map((e) => ({
      id: e.id,
      defId: e.defId,
      name: e.name,
      hp: e.hp,
      maxHp: e.maxHp,
      block: e.block,
      buffs: e.buffs.map((b) => ({ ...b })),
      intent: e.intent,
      intentHistory: [...e.intentHistory],
      forcedChain: [...e.forcedChain],
      interruptsTaken: e.interruptsTaken,
      ...(e.summonerId !== undefined ? { summonerId: e.summonerId } : {}),
      ...(e.spawnedTurn !== undefined ? { spawnedTurn: e.spawnedTurn } : {}),
    })),
    draw: [...state.piles.draw],
    hand: [...state.piles.hand],
    discard: [...state.piles.discard],
    exhaust: [...state.piles.exhaust],
    cardInstances: { ...state.cardInstances },
    modifiers: state.modifiers.map((m) => ({ ...m })),
    queue: new EffectQueue<EffectWork>(),
    draining: false,
  };
}

export function fromDraft(draft: Draft, eventSeq: number): BattleState {
  return {
    battleId: draft.battleId,
    rootSeed: draft.rootSeed,
    difficulty: draft.difficulty,
    ...(draft.safetyFloor !== undefined ? { safetyFloor: draft.safetyFloor } : {}),
    safetySaves: draft.safetySaves,
    rng: draft.rng.snapshot(),
    turn: draft.turn,
    phase: draft.phase,
    player: {
      id: "player",
      hp: draft.player.hp,
      maxHp: draft.player.maxHp,
      block: draft.player.block,
      energy: draft.player.energy,
      maxEnergy: draft.player.maxEnergy,
      pollution: draft.player.pollution,
      charge: draft.player.charge,
      buffs: draft.player.buffs.map((b) => ({ ...b })),
      relics: [...draft.player.relics],
      powers: [...draft.player.powers],
      triggeredThisBattle: [...draft.player.triggeredThisBattle],
      triggeredThisTurn: [...draft.player.triggeredThisTurn],
    },
    enemies: draft.enemies.map((e) => ({
      id: e.id,
      defId: e.defId,
      name: e.name,
      hp: e.hp,
      maxHp: e.maxHp,
      block: e.block,
      buffs: e.buffs.map((b) => ({ ...b })),
      intent: e.intent,
      intentHistory: [...e.intentHistory],
      forcedChain: [...e.forcedChain],
      interruptsTaken: e.interruptsTaken,
      ...(e.summonerId !== undefined ? { summonerId: e.summonerId } : {}),
      ...(e.spawnedTurn !== undefined ? { spawnedTurn: e.spawnedTurn } : {}),
    })),
    piles: {
      draw: [...draft.draw],
      hand: [...draft.hand],
      discard: [...draft.discard],
      exhaust: [...draft.exhaust],
    },
    cardInstances: { ...draft.cardInstances },
    modifiers: draft.modifiers.map((m) => ({ ...m })),
    handSize: draft.handSize,
    cardsPlayedThisTurn: draft.cardsPlayedThisTurn,
    tookDamageThisTurn: draft.tookDamageThisTurn,
    eventSeq,
    content: draft.content,
  };
}

export function findUnit(draft: Draft, id: string): MutableUnit | undefined {
  if (id === "player") return draft.player;
  return draft.enemies.find((e) => e.id === id);
}

export function livingEnemies(draft: Draft): MutableEnemy[] {
  return draft.enemies.filter((e) => e.hp > 0);
}

export function instanceOf(draft: Draft, instanceId: string): CardInstance | undefined {
  return draft.cardInstances[instanceId];
}

export function definitionOf(draft: Draft, instanceId: string): CardDefinition | undefined {
  const instance = draft.cardInstances[instanceId];
  if (!instance) return undefined;
  return draft.content.cards.get(instance.cardId);
}
