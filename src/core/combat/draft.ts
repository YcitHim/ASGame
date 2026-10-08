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
import type { CardInstance, DelayedEffect, EnemyState, Phase, BattleState } from "./state";
import type { EffectWork } from "./work";
import type { TraitSnapshot } from "../registry/trait-handler";

export interface MutableUnit {
  readonly id: string;
  /** 战斗开始时的上限；灼烧只改 maxHp，战斗结束时按它恢复（docs/46 §3.9） */
  readonly baseMaxHp: number;
  maxHp: number;
  hp: number;
  block: number;
  /** 维续格挡池（docs/46 §3.4 坚韧）：回合开始不清零、上限 25 */
  enduringBlock: number;
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
  /** 眩晕抗性已用掉（docs/46 §3.5） */
  stunResisted: boolean;
  /** 本回合累计承受伤害（docs/60 §八.3 不屈），每回合开始归零 */
  damageTakenThisTurn: number;
  /** 转阶段保护已用掉（docs/60 §四） */
  phaseGuardUsed: boolean;
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
  /** 颠倒（docs/46 §3.8）：本回合手牌费用的随机覆盖，回合开始重掷 */
  reverseCosts: Record<string, number>;
  tookDamageThisTurn: boolean;
  /** 职业特性 id（docs/58 §二）：null = 无特性 */
  traitId: string | null;
  /** 战斗开局快照（畸变阈值） */
  traitSnapshot: TraitSnapshot;
  /** 本回合累计造伤 / 自伤（嗜血，docs/58 §四） */
  dealtDamageThisTurn: number;
  selfHpSpentThisTurn: number;
  /** 本回合已打出的攻击牌数（玻璃大炮首张攻击牌） */
  attackCardsPlayedThisTurn: number;
  /** 本回合累计花费的能量（docs/64 商人算盘） */
  energySpentThisTurn: number;
  /** 本回合神眼是否已用 */
  eyeUsedThisTurn: boolean;
  /** 待玩家选择销毁的手牌张数（祭血狂热；0 = 无待选） */
  destroyPending: number;
  /** 回合结束那一刻的手牌为空快照（docs/64）：endTurn 在弃牌前捕获 */
  handEmptyAtTurnEnd: boolean;
  /** 上一回合打出的牌数（docs/64 停摆八音盒）；-1 = 战斗第 1 回合 */
  prevTurnCardsPlayed: number;
  /** 遗物 handler 本回合触发计数（docs/64 §三）：key = `${relicId}:${hook}` */
  relicFiresThisTurn: Record<string, number>;
  /** 延迟结算队列（甲方 2026-10-08）：回合开始递减，归零即结算 */
  delayed: DelayedEffect[];
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
    reverseCosts: { ...state.reverseCosts },
    tookDamageThisTurn: state.tookDamageThisTurn,
    traitId: state.traitId,
    traitSnapshot: state.traitSnapshot,
    dealtDamageThisTurn: state.dealtDamageThisTurn,
    selfHpSpentThisTurn: state.selfHpSpentThisTurn,
    attackCardsPlayedThisTurn: state.attackCardsPlayedThisTurn,
    energySpentThisTurn: state.energySpentThisTurn,
    eyeUsedThisTurn: state.eyeUsedThisTurn,
    destroyPending: state.destroyPending,
    handEmptyAtTurnEnd: state.handEmptyAtTurnEnd,
    prevTurnCardsPlayed: state.prevTurnCardsPlayed,
    relicFiresThisTurn: { ...state.relicFiresThisTurn },
    delayed: state.delayedEffects.map((d) => ({ ...d })),
    player: {
      id: "player",
      hp: state.player.hp,
      baseMaxHp: state.player.baseMaxHp,
      maxHp: state.player.maxHp,
      block: state.player.block,
      enduringBlock: state.player.enduringBlock,
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
      baseMaxHp: e.baseMaxHp,
      maxHp: e.maxHp,
      block: e.block,
      enduringBlock: e.enduringBlock,
      buffs: e.buffs.map((b) => ({ ...b })),
      intent: e.intent,
      intentHistory: [...e.intentHistory],
      forcedChain: [...e.forcedChain],
      interruptsTaken: e.interruptsTaken,
      stunResisted: e.stunResisted,
      damageTakenThisTurn: e.damageTakenThisTurn,
      phaseGuardUsed: e.phaseGuardUsed,
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
      baseMaxHp: draft.player.baseMaxHp,
      block: draft.player.block,
      enduringBlock: draft.player.enduringBlock,
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
      baseMaxHp: e.baseMaxHp,
      maxHp: e.maxHp,
      block: e.block,
      enduringBlock: e.enduringBlock,
      buffs: e.buffs.map((b) => ({ ...b })),
      intent: e.intent,
      intentHistory: [...e.intentHistory],
      forcedChain: [...e.forcedChain],
      interruptsTaken: e.interruptsTaken,
      stunResisted: e.stunResisted,
      damageTakenThisTurn: e.damageTakenThisTurn,
      phaseGuardUsed: e.phaseGuardUsed,
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
    reverseCosts: { ...draft.reverseCosts },
    tookDamageThisTurn: draft.tookDamageThisTurn,
    traitId: draft.traitId,
    traitSnapshot: draft.traitSnapshot,
    dealtDamageThisTurn: draft.dealtDamageThisTurn,
    selfHpSpentThisTurn: draft.selfHpSpentThisTurn,
    attackCardsPlayedThisTurn: draft.attackCardsPlayedThisTurn,
    energySpentThisTurn: draft.energySpentThisTurn,
    eyeUsedThisTurn: draft.eyeUsedThisTurn,
    destroyPending: draft.destroyPending,
    handEmptyAtTurnEnd: draft.handEmptyAtTurnEnd,
    prevTurnCardsPlayed: draft.prevTurnCardsPlayed,
    relicFiresThisTurn: { ...draft.relicFiresThisTurn },
    delayedEffects: draft.delayed.map((d) => ({ ...d })),
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
