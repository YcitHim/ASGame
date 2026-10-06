/**
 * core/map · 线性地图与远征进度（0.1 无分支）
 *
 * 玩法规则只住在 core：节点推进、奖励抽取都在这里，UI 只做展示与转发。
 * 随机一律走 reward 流（ADR-006），因此同样的种子 + 输入流可复现。
 */
import type { RunDifficulty } from "../registry/content";
import type { ActDefinition, ClassDefinition, EventDefinition, MapLayerSpec, MapNode, NodeKind } from "../registry/content";
import type { ContentDb } from "../registry/content";
import { Rng } from "../rng";

export { resolveEventOption, type EventResolution } from "./event";

export { DIFFICULTY_PARAMS, type RunDifficulty } from "../registry/content";

/** 内容是否已解锁入池（docs/36 T1）：缺省 / "none" = 默认可用。 */
export function isContentAvailable(
  unlockCondition: string | undefined,
  id: string,
  unlocked: readonly string[],
): boolean {
  if (!unlockCondition || unlockCondition === "none") return true;
  return unlocked.includes(id);
}

export interface RunState {
  readonly actId: string;
  /** 本局职业 id（docs/16 5.1：职业定义抽到 data/classes） */
  readonly classId: string;
  readonly seed: number;
  /** 当前层下标（docs/16 5.4 分支地图）；等于层数表示已通关 */
  readonly layerIndex: number;
  /** 每层选中的候选下标（与 layerIndex 对齐；未选中的层为空缺） */
  readonly picked: readonly number[];
  readonly cleared: readonly string[];
  /** 局外 HP：跨节点保留（战斗结束写回，休息回复） */
  readonly hp: number;
  /** 局外污染：跨节点保留（战斗开始注入、结束写回；事件可增减，docs/27 §三） */
  readonly pollution: number;
  /** 职业最大 HP（休息回复 / 事件回复的上限来源；不再从 act 读） */
  readonly maxHp: number;
  /** 本档已解锁内容 id（卡 / 遗物）；由 meta 层注入，core 据此过滤奖池 */
  readonly unlocked: readonly string[];
  /** 随身遗物（docs/38 §一 A-2）：职业选择页从 T1 池自选 1 件；空串 = 无 */
  readonly pickedRelic: string;
  /** 难度档（docs/36 T2） */
  readonly difficulty: RunDifficulty;
  /** 本局是否打出过血契卡（成就：不朽） */
  readonly usedBloodpact: boolean;
  /** 本局过载反噬次数（成就：红线协议） */
  readonly overloadCount: number;
}

/** 记录一次血契出牌（成就判定用）。 */
export function noteBloodpact(run: RunState): RunState {
  return run.usedBloodpact ? run : { ...run, usedBloodpact: true };
}

/** 记录一次过载反噬（成就判定用）。 */
export function addOverload(run: RunState): RunState {
  return { ...run, overloadCount: run.overloadCount + 1 };
}

/** 写回局外 HP（战斗结束时调用）。 */
export function setRunHp(run: RunState, hp: number): RunState {
  return { ...run, hp: Math.max(0, Math.trunc(hp)) };
}

/** 写回局外污染（战斗结束 / 事件结算时调用）。 */
export function setRunPollution(run: RunState, pollution: number): RunState {
  return { ...run, pollution: Math.max(0, Math.min(100, Math.trunc(pollution))) };
}

/** 休息点回复（按最大 HP 上限截断）。 */
export function healRun(run: RunState, maxHp: number, amount: number): RunState {
  return { ...run, hp: Math.min(maxHp, run.hp + Math.max(0, Math.trunc(amount))) };
}

/** 运行时的地图层：层内候选节点由 generateActMap 按种子实例化。 */
export interface MapLayer {
  readonly id: string;
  readonly nodes: readonly MapNode[];
}

export interface MapView {
  readonly layers: readonly MapLayer[];
  readonly currentIndex: number;
  readonly current: MapNode | undefined;
  readonly picked: readonly number[];
  readonly finished: boolean;
}

/**
 * 分支地图生成（docs/16 5.4）：同一 seed → 同一地图。
 * width=1 为必经/汇合点；width≥2 时每个候选按 weights 独立抽类型（docs/14 Q17）。
 */
export function generateActMap(act: ActDefinition, seed: number): MapLayer[] {
  const rng = new Rng((seed ^ 0x5f3759df) >>> 0).stream("map");
  return act.layers.map((spec, layerIdx) => {
    const width = Math.max(1, Math.trunc(spec.width));
    const nodes: MapNode[] = [];
    for (let i = 0; i < width; i += 1) {
      const kind = pickKind(rng, spec, act);
      nodes.push({
        id: `${kind}_${layerIdx}_${i}`,
        kind,
        i18n: spec.i18n ?? `node.${kind}`,
        ...(spec.encounters && kind === "battle" ? { encounters: spec.encounters } : {}),
        ...(spec.events && kind === "event" ? { events: spec.events } : {}),
        ...(spec.enemies && (kind === "battle" || kind === "elite" || kind === "boss") ? { enemies: spec.enemies } : {}),
      });
    }
    return { id: spec.id, nodes };
  });
}

function pickKind(rng: ReturnType<Rng["stream"]>, spec: MapLayerSpec, act: ActDefinition): NodeKind {
  const weights = spec.weights ?? act.weights;
  const entries = spec.kinds
    .map((k) => [k, Math.max(0, weights[k] ?? 0)] as const)
    .filter(([, w]) => w > 0);
  if (entries.length === 0) return spec.kinds[0] ?? "battle";
  return rng.weighted(entries);
}

export interface CreateRunOptions {
  /** meta 层已解锁的内容 id（docs/36 T1） */
  readonly unlocked?: readonly string[];
  /** 难度档（docs/36 T2）；缺省 normal */
  readonly difficulty?: RunDifficulty;
  /** 随身遗物（docs/38 §一 A-2）；缺省空串（调用方负责给默认） */
  readonly companionRelic?: string;
}

export function createRunState(
  act: ActDefinition,
  cls: ClassDefinition,
  seed: number,
  opts: CreateRunOptions = {},
): RunState {
  return {
    actId: act.id,
    classId: cls.id,
    seed: seed >>> 0,
    layerIndex: 0,
    picked: [],
    cleared: [],
    hp: cls.player.maxHp,
    pollution: 0,
    maxHp: cls.player.maxHp,
    unlocked: [...(opts.unlocked ?? [])],
    pickedRelic: opts.companionRelic ?? "",
    difficulty: opts.difficulty ?? "normal",
    usedBloodpact: false,
    overloadCount: 0,
  };
}

export function mapView(run: RunState, act: ActDefinition): MapView {
  const layers = generateActMap(act, run.seed);
  return {
    layers,
    currentIndex: run.layerIndex,
    current: currentNode(run, act),
    picked: run.picked,
    finished: run.layerIndex >= layers.length,
  };
}

export function currentLayer(run: RunState, act: ActDefinition): MapLayer | undefined {
  return generateActMap(act, run.seed)[run.layerIndex];
}

export function currentNode(run: RunState, act: ActDefinition): MapNode | undefined {
  const layer = currentLayer(run, act);
  if (!layer) return undefined;
  const idx = run.picked[run.layerIndex];
  if (idx !== undefined) return layer.nodes[idx];
  // 必经 / 汇合层（width=1）无需选择，直接生效；分支层必须显式 chooseNode
  return layer.nodes.length === 1 ? layer.nodes[0] : undefined;
}

/** 在当前层选定候选（分支二选一）。 */
export function chooseNode(run: RunState, act: ActDefinition, index: number): RunState {
  const layer = currentLayer(run, act);
  if (!layer || !Number.isInteger(index) || index < 0 || index >= layer.nodes.length) return run;
  const picked = [...run.picked];
  picked[run.layerIndex] = index;
  return { ...run, picked };
}

export function nodeKindOf(node: MapNode | undefined): NodeKind | null {
  return node?.kind ?? null;
}

/** 是否战斗类节点（需要进战斗界面）。 */
export function isCombatNode(node: MapNode | undefined): boolean {
  return node?.kind === "battle" || node?.kind === "elite" || node?.kind === "boss";
}

/** 推进到下一层并记录已清节点。 */
export function advanceNode(run: RunState, act: ActDefinition): RunState {
  const node = currentNode(run, act);
  const cleared = node && !run.cleared.includes(node.id) ? [...run.cleared, node.id] : [...run.cleared];
  return { ...run, layerIndex: run.layerIndex + 1, cleared };
}

export function isRunComplete(run: RunState, act: ActDefinition): boolean {
  return run.layerIndex >= act.layers.length;
}

export const REWARD_OPTION_COUNT = 3;
/** 每张卡的强化槽上限 */
export const MAX_ENHANCEMENT_SLOTS = 3;

/**
 * 战斗胜利后的卡奖三选一：只抽"可获得的卡"（排除 starter 与诅咒/状态）。
 * 用 reward 流，保证同种子同结果。
 */
export function rollCardRewards(
  content: ContentDb,
  act: ActDefinition,
  run: RunState,
  nodeIndex: number,
  count = REWARD_OPTION_COUNT,
): string[] {
  // 职业卡池隔离（docs/16 5.2）：只抽本局职业的卡（class === run.classId）
  const pool = [...content.cards.values()].filter(
    (c) =>
      c.class === run.classId &&
      c.rarity !== "starter" &&
      c.type !== "curse" &&
      c.type !== "status" &&
      // 解锁式内容未解锁不入池（docs/36 T1）
      isContentAvailable(c.unlockCondition, c.id, run.unlocked),
  );
  const poolIds = pool.map((c) => c.id).sort();
  const rng = new Rng((run.seed ^ Math.imul(nodeIndex + 1, 0x9e3779b9)) >>> 0).stream("reward");
  const picks: string[] = [];
  const remaining = [...poolIds];
  while (picks.length < count && remaining.length > 0) {
    const index = rng.nextInt(0, remaining.length - 1);
    picks.push(remaining[index]);
    remaining.splice(index, 1);
  }
  void act;
  return picks;
}

/**
 * 精英战遗物三选一（docs/25 §1 流程）：未持有的遗物按 id 排序取前 N。
 * store 与无头 sim 共用，避免两处各写一份。
 */
/**
 * 遭遇池抽取（docs/29 §一③）：同种子同遭遇，走独立的 map RNG 流；无池则回落 node.enemies。
 */
export function rollEncounter(run: RunState, node: MapNode): string[] {
  if (!node.encounters || node.encounters.length === 0) return [...(node.enemies ?? [])];
  const rng = new Rng((run.seed ^ Math.imul(run.layerIndex + 1, 0x85ebca6b)) >>> 0).stream("map");
  const entry = rng.weighted(node.encounters.map((e) => [e, e.weight] as const));
  return [...entry.enemies];
}

/**
 * 事件节点抽取（docs/27 §三）：同种子同事件，走独立的 map RNG 流。
 * node.event 写死单个；node.events 为池；都没有则遍历全部事件。
 */
export function rollEvent(content: ContentDb, run: RunState, node: MapNode): EventDefinition | undefined {
  if (node.event) return content.events.get(node.event);
  const ids = node.events && node.events.length > 0 ? [...node.events] : [...content.events.keys()].sort();
  if (ids.length === 0) return undefined;
  const rng = new Rng((run.seed ^ Math.imul(run.layerIndex + 5, 0x27d4eb2f)) >>> 0).stream("map");
  return content.events.get(ids[rng.nextInt(0, ids.length - 1)]);
}

/** 某 tier 的全部可入池遗物 id（已解锁过滤、按 id 排序）；随身遗物栏与 sim 默认用。 */
export function relicPool(
  content: ContentDb,
  tier: number,
  unlocked: readonly string[] = [],
): string[] {
  return [...content.relics.values()]
    .filter((r) => r.tier === tier)
    .filter((r) => isContentAvailable(r.unlockCondition, r.id, unlocked))
    .map((r) => r.id)
    .sort();
}

export function rollRelicChoices(
  content: ContentDb,
  owned: readonly string[],
  count = 3,
  unlocked: readonly string[] = [],
  /** 只取这些 tier 的遗物（docs/38 §一 A-1）：T2 精英池 / T3 Boss 池 / [1,2] 事件池 */
  tiers?: readonly number[],
  /** 给定种子时按 reward 流随机抽 count 件（同种子同结果）；缺省取池内前 N 件 */
  seed?: number,
): string[] {
  const taken = new Set(owned);
  const pool = [...content.relics.values()]
    .filter((r) => r.tier !== undefined)
    .filter((r) => !tiers || tiers.includes(r.tier as number))
    .filter((r) => isContentAvailable(r.unlockCondition, r.id, unlocked))
    .map((r) => r.id)
    .filter((id) => !taken.has(id))
    .sort();
  if (seed === undefined) return pool.slice(0, count);
  const rng = new Rng(seed >>> 0).stream("reward");
  const remaining = [...pool];
  const picks: string[] = [];
  while (picks.length < count && remaining.length > 0) {
    const index = rng.nextInt(0, remaining.length - 1);
    picks.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picks;
}

/** 重铸 HP 消耗（docs/16 P3.4 / docs/14 Q15）。 */
export const RECAST_HP_COST = 5;

/** 从该卡已有的强化里随机移除 1 枚（同种子同结果）。 */
export function pickRecastRemoval(enhancements: readonly string[], seed: number): string | null {
  if (enhancements.length === 0) return null;
  const rng = new Rng(seed >>> 0).stream("reward");
  return enhancements[rng.nextInt(0, enhancements.length - 1)] ?? null;
}

/**
 * 重铸替换（docs/16 P3.4）：从**同 tier** 且适用于该卡的强化里随机抽 1 枚。
 * 排除：全局已持有（同一强化全局唯一）、该卡保留的其它强化、以及双向 mutex 冲突。
 */
export function rollRecastEnhancement(
  content: ContentDb,
  cardId: string,
  keep: readonly string[],
  ownedElsewhere: readonly string[],
  tier: number,
  seed: number,
  /** 被移除的那一枚：不允许原地换回（docs/23 §6） */
  exclude: readonly string[] = [],
): string | null {
  const owned = new Set([...keep, ...ownedElsewhere, ...exclude]);
  const pool = [...content.enhancements.values()]
    .filter((e) => {
      if (e.tier !== tier) return false;
      if (!e.appliesTo.includes(cardId)) return false;
      if (owned.has(e.id)) return false;
      if ((e.mutex ?? []).some((m) => keep.includes(m))) return false;
      if (keep.some((k) => (content.enhancements.get(k)?.mutex ?? []).includes(e.id))) return false;
      return true;
    })
    .map((e) => e.id)
    .sort();
  if (pool.length === 0) return null;
  const rng = new Rng(seed >>> 0).stream("reward");
  return pool[rng.nextInt(0, pool.length - 1)] ?? null;
}

/**
 * 锻造祭坛三选一：从 content.enhancements 里抽 N 个（同样走 reward 流）。
 */
export function rollEnhancementChoices(
  content: ContentDb,
  run: RunState,
  nodeIndex: number,
  count = 3,
): string[] {
  const ids = [...content.enhancements.values()].map((e) => e.id).sort();
  const rng = new Rng((run.seed ^ Math.imul(nodeIndex + 7, 0x85ebca6b)) >>> 0).stream("reward");
  const picks: string[] = [];
  const remaining = [...ids];
  while (picks.length < count && remaining.length > 0) {
    const index = rng.nextInt(0, remaining.length - 1);
    picks.push(remaining[index]);
    remaining.splice(index, 1);
  }
  return picks;
}