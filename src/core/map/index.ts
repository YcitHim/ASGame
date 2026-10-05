/**
 * core/map · 线性地图与远征进度（0.1 无分支）
 *
 * 玩法规则只住在 core：节点推进、奖励抽取都在这里，UI 只做展示与转发。
 * 随机一律走 reward 流（ADR-006），因此同样的种子 + 输入流可复现。
 */
import type { ActDefinition, MapNode, NodeKind } from "../registry/content";
import type { ContentDb } from "../registry/content";
import { Rng } from "../rng";

export interface RunState {
  readonly actId: string;
  readonly seed: number;
  /** 当前所在节点下标；等于节点数表示已通关 */
  readonly nodeIndex: number;
  readonly cleared: readonly string[];
  /** 局外 HP：跨节点保留（战斗结束写回，休息回复） */
  readonly hp: number;
}

/** 写回局外 HP（战斗结束时调用）。 */
export function setRunHp(run: RunState, hp: number): RunState {
  return { ...run, hp: Math.max(0, Math.trunc(hp)) };
}

/** 休息点回复（按最大 HP 上限截断）。 */
export function healRun(run: RunState, maxHp: number, amount: number): RunState {
  return { ...run, hp: Math.min(maxHp, run.hp + Math.max(0, Math.trunc(amount))) };
}

export interface MapView {
  readonly nodes: readonly MapNode[];
  readonly currentIndex: number;
  readonly current: MapNode | undefined;
  readonly finished: boolean;
}

export function createRunState(act: ActDefinition, seed: number): RunState {
  return { actId: act.id, seed: seed >>> 0, nodeIndex: 0, cleared: [], hp: act.player.maxHp };
}

export function mapView(run: RunState, act: ActDefinition): MapView {
  const nodes = act.map;
  return {
    nodes,
    currentIndex: run.nodeIndex,
    current: nodes[run.nodeIndex],
    finished: run.nodeIndex >= nodes.length,
  };
}

export function currentNode(run: RunState, act: ActDefinition): MapNode | undefined {
  return act.map[run.nodeIndex];
}

export function nodeKindOf(node: MapNode | undefined): NodeKind | null {
  return node?.kind ?? null;
}

/** 是否战斗类节点（需要进战斗界面）。 */
export function isCombatNode(node: MapNode | undefined): boolean {
  return node?.kind === "battle" || node?.kind === "elite" || node?.kind === "boss";
}

/** 推进到下一个节点并记录已清节点。 */
export function advanceNode(run: RunState, act: ActDefinition): RunState {
  const node = act.map[run.nodeIndex];
  const cleared = node && !run.cleared.includes(node.id) ? [...run.cleared, node.id] : [...run.cleared];
  return { ...run, nodeIndex: run.nodeIndex + 1, cleared };
}

export function isRunComplete(run: RunState, act: ActDefinition): boolean {
  return run.nodeIndex >= act.map.length;
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
  const pool = [...content.cards.values()].filter((c) => c.rarity !== "starter" && c.type !== "curse" && c.type !== "status");
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
  const rng = new Rng((run.seed ^ Math.imul(run.nodeIndex + 1, 0x85ebca6b)) >>> 0).stream("map");
  const entry = rng.weighted(node.encounters.map((e) => [e, e.weight] as const));
  return [...entry.enemies];
}

export function rollRelicChoices(
  content: ContentDb,
  owned: readonly string[],
  count = 3,
): string[] {
  const taken = new Set(owned);
  return [...content.relics.values()]
    .map((r) => r.id)
    .filter((id) => !taken.has(id))
    .sort()
    .slice(0, count);
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