/**
 * core/combat · 战斗状态结构（docs/02 §2）
 * 状态不可变：reducer 每次都产出新对象（内部用 Draft 工作副本，见 draft.ts）。
 */
import type { BuffInstance } from "../buffs";
import type { EnemySetup, IntentPayload } from "../events";
import type { ContentDb, RunDifficulty } from "../registry/content";
import { DIFFICULTY_PARAMS, emptyContent } from "../registry/content";
import type { Modifier } from "../pipeline";
import { Rng, type RngSnapshot } from "../rng";
import { EMPTY_TRAIT_SNAPSHOT, computeTraitSnapshot, getTraitHandler, type TraitSnapshot } from "../registry/trait-handler";

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
  /** 战斗开始时的上限（docs/46 §3.9 灼烧：战斗内扣上限、结束恢复） */
  readonly baseMaxHp: number;
  readonly block: number;
  /** 维续格挡池（docs/46 §3.4 坚韧）：回合开始不清零的格挡底座，上限 25 */
  readonly enduringBlock: number;
  readonly energy: number;
  readonly maxEnergy: number;
  readonly pollution: number;
  readonly charge: number;
  readonly buffs: readonly BuffInstance[];
  /** 本局携带的遗物 id */
  readonly relics: readonly string[];
  /** 本场生效的卡牌能力（power）实例 id（docs/29 §一②） */
  readonly powers: readonly string[];
  /** 已触发过的遗物/能力（once: battle，key 为 relic:<id> 或 power:<instanceId>） */
  readonly triggeredThisBattle: readonly string[];
  /** 本回合已触发过的遗物/能力（once: turn） */
  readonly triggeredThisTurn: readonly string[];
}

export interface EnemyState {
  /** 战斗内唯一实例 id（同名敌人第 2 个起为 `<defId>#2`，docs/29 §一③「猎犬 × 2」） */
  readonly id: string;
  /** 内容定义 id（content.enemies 的 key；同 id 多实例时仍指向同一份定义） */
  readonly defId: string;
  readonly name: string;
  readonly hp: number;
  readonly maxHp: number;
  /** 战斗开始时的上限（docs/46 §3.9 灼烧） */
  readonly baseMaxHp: number;
  readonly block: number;
  /** 维续格挡池（docs/46 §3.4 坚韧），敌人侧同构 */
  readonly enduringBlock: number;
  readonly buffs: readonly BuffInstance[];
  readonly intent: IntentPayload | null;
  readonly intentHistory: readonly string[];
  /** 蓄力链的剩余环节（下一招由链决定，执行后逐个揭示；空 = 正常随机） */
  readonly forcedChain: readonly IntentPayload[];
  /** 已被断链次数（docs/38 §三 C-1：每只敌人每场最多 2 次） */
  readonly interruptsTaken: number;
  /** 眩晕抗性已用掉（docs/46 §3.5：精英/Boss 首次被眩晕后本场免疫后续） */
  readonly stunResisted: boolean;
  /** 召唤者 id（docs/40 §五）：召唤物在被召唤者死亡时殉爆 */
  readonly summonerId?: string;
  /** 入场回合（docs/40 §五-4）：入场当回合不行动 */
  readonly spawnedTurn?: number;
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
  /** 颠倒（docs/46 §3.8）：本回合手牌的费用被随机覆盖（instanceId → 0~3），无颠倒时为空 */
  readonly reverseCosts: Readonly<Record<string, number>>;
  /** 本回合（含刚结束的敌方回合）玩家是否受过攻击伤害（docs/16 P2.3） */
  readonly tookDamageThisTurn: boolean;
  /** 本局职业特性 id（docs/58 §二）：null = 无特性开局（纯现版玩法，也是 sim 基线对照） */
  readonly traitId: string | null;
  /** 战斗开局快照（docs/58 §七.2）：污染阈值只在此刻判定，局内不因跌破而失效 */
  readonly traitSnapshot: TraitSnapshot;
  /** 本回合累计造伤（嗜血奖励段，docs/58 §四）：玩家来源 + hpLost>0 */
  readonly dealtDamageThisTurn: number;
  /** 本回合累计自伤（嗜血奖励段）：血契 / 血迹自伤，不含受击与反噬 */
  readonly selfHpSpentThisTurn: number;
  /** 本回合已打出的攻击牌数（玻璃大炮首张攻击牌判定） */
  readonly attackCardsPlayedThisTurn: number;
  /** 本回合神眼是否已用（每回合一次，docs/58 §七.2） */
  readonly eyeUsedThisTurn: boolean;
  /** 事件全局序号计数器 */
  readonly eventSeq: number;
  /** 难度档（docs/36 T2）：敌人 HP / 伤害倍率一并从此读 */
  readonly difficulty: RunDifficulty;
  /**
   * 玩家 HP 安全下限（docs/42 §四 教学免死）：非 undefined 时，玩家受到的任何伤害都不会把
   * HP 打到低于该值；用于教学，"教学关都能死"是口碑杀手。默认 undefined = 关闭。
   */
  readonly safetyFloor?: number;
  /** 安全网已触发次数（docs/42 §四：第二次改为补满并快进该场） */
  readonly safetySaves: number;
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
  readonly player: { readonly maxHp: number; readonly energy: number; readonly hp?: number; readonly pollution?: number };
  readonly enemies: readonly EnemySetup[];
  /** 卡组（洗牌前顺序） */
  readonly deck: readonly (string | DeckEntry)[];
  readonly handSize?: number;
  readonly content?: ContentDb;
  readonly relics?: readonly string[];
  /** 难度档（docs/36 T2）；缺省 normal */
  readonly difficulty?: RunDifficulty;
  /** 教学安全下限（docs/42 §四）；缺省 undefined = 正常结算 */
  readonly safetyFloor?: number;
  /** 职业特性 id（docs/58 §二）：缺省 / 空串 = 无特性开局 */
  readonly traitId?: string;
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
  /** 同名敌人的实例计数：第 2 个起加 `#n` 后缀，避免 id 冲突导致只能打到第一个 */
  const idCounts = new Map<string, number>();
  const difficulty = config.difficulty ?? "normal";
  /** 锈蚀难度：敌人 HP 上浮（伤害倍率在 attackModifiers 里生效，docs/36 T2） */
  const enemyHpMul = DIFFICULTY_PARAMS[difficulty].enemyHpMul;

  // 职业特性（docs/58 §二）：开局绑定本局，战斗里只做能力问询（无 classId 特判）。
  // 无特性 / 未注册 = null，行为与现版完全一致（sim 基线对照）。
  const traitId = config.traitId ? config.traitId : null;
  const traitDef = traitId ? content.traits.get(traitId) : undefined;
  const traitHandler = traitDef ? getTraitHandler(traitDef.handler) : undefined;
  // 超级大畸变：污染无视 100 封顶（docs/58 §七.1）——开局注入也不截断
  const pollutionUncapped = !!traitHandler?.pollutionUncapped?.(traitDef?.params ?? {});
  const rawPollution = Math.max(0, Math.trunc(config.player.pollution ?? 0));
  const startingPollution = pollutionUncapped ? rawPollution : Math.min(100, rawPollution);
  const traitSnapshot = traitDef
    ? computeTraitSnapshot(startingPollution, traitDef.params)
    : EMPTY_TRAIT_SNAPSHOT;

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
    difficulty,
    ...(config.safetyFloor !== undefined ? { safetyFloor: config.safetyFloor } : {}),
    safetySaves: 0,
    rng: new Rng(config.seed).snapshot(),
    turn: 0,
    phase: "battleStart",
    player: {
      id: "player",
      hp: config.player.hp ?? config.player.maxHp,
      maxHp: config.player.maxHp,
      baseMaxHp: config.player.maxHp,
      block: 0,
      enduringBlock: 0,
      energy: config.player.energy,
      maxEnergy: config.player.energy,
      pollution: startingPollution,
      charge: 0,
      buffs:
        startingPollution > 0
          ? [{ id: "pollution" as const, stacks: startingPollution, duration: null }]
          : [],
      relics: (config.relics ?? []).slice(),
      powers: [],
      triggeredThisBattle: [],
      triggeredThisTurn: [],
    },
    enemies: config.enemies.map((e) => {
      const defId = e.defId ?? e.id;
      const def = content.enemies.get(defId);
      const rawMaxHp = e.maxHp ?? def?.maxHp ?? 1;
      const maxHp = enemyHpMul === 1 ? rawMaxHp : Math.max(1, Math.round(rawMaxHp * enemyHpMul));
      const seen = (idCounts.get(defId) ?? 0) + 1;
      idCounts.set(defId, seen);
      return {
        id: seen === 1 ? defId : `${defId}#${seen}`,
        defId,
        name: def?.name ?? defId,
        hp: maxHp,
        maxHp,
        baseMaxHp: maxHp,
        block: 0,
        enduringBlock: 0,
        buffs: [],
        intent: null,
        intentHistory: [],
        forcedChain: [],
        interruptsTaken: 0,
        stunResisted: false,
      };
    }),
    piles: { draw, hand: [], discard: [], exhaust: [] },
    cardInstances,
    modifiers: [],
    handSize: config.handSize ?? DEFAULT_HAND_SIZE,
    cardsPlayedThisTurn: 0,
    reverseCosts: {},
    tookDamageThisTurn: false,
    traitId,
    traitSnapshot,
    dealtDamageThisTurn: 0,
    selfHpSpentThisTurn: 0,
    attackCardsPlayedThisTurn: 0,
    eyeUsedThisTurn: false,
    eventSeq: 0,
    content,
  };
}
