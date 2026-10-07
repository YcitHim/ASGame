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
  /** 当前幕下标（docs/40 §2.1）：0 = 锈蚀回廊，1 = 沉没圣堂 */
  readonly actIndex: number;
  /** 结算统计：最深到达的幕（1 起） */
  readonly deepestAct: number;
  /** 结算统计：本幕最深到达的层（1 起） */
  readonly deepestLayer: number;
  /** legacy 档（docs/40 §2.1）：一幕已通关的旧档，不提供继续远征 */
  readonly legacy: boolean;
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
  /** 本局断链次数（成就：打断蓄力 10 次，docs/38 §三 C-3） */
  readonly interrupts: number;
  /** 本局承受过的反噬总次数（过载 + 污染满值，成就：承受 3 次仍胜） */
  readonly backlashTaken: number;
  /** 本局累计战斗回合（最佳纪录：最少回合通关） */
  readonly turns: number;
  /** 本局污染峰值（成就：贴线 —— 曾在 99 结束回合） */
  readonly pollutionPeak: number;
}

/** 记录一次血契出牌（成就判定用）。 */
export function noteBloodpact(run: RunState): RunState {
  return run.usedBloodpact ? run : { ...run, usedBloodpact: true };
}

/** 记录一次过载反噬（成就判定用）。 */
export function addOverload(run: RunState): RunState {
  return { ...run, overloadCount: run.overloadCount + 1, backlashTaken: run.backlashTaken + 1 };
}

/** 记录一次断链（成就判定用）。 */
export function addInterrupt(run: RunState): RunState {
  return { ...run, interrupts: run.interrupts + 1 };
}

/** 记录一次污染反噬（成就判定用）。 */
export function addBacklash(run: RunState): RunState {
  return { ...run, backlashTaken: run.backlashTaken + 1 };
}

/** 累加战斗回合（最佳纪录用）。 */
export function addTurns(run: RunState, turns: number): RunState {
  return { ...run, turns: run.turns + Math.max(0, Math.trunc(turns)) };
}

/** 写回局外 HP（战斗结束时调用）。 */
export function setRunHp(run: RunState, hp: number): RunState {
  return { ...run, hp: Math.max(0, Math.trunc(hp)) };
}

/** 写回局外污染（战斗结束 / 事件结算时调用）。 */
export function setRunPollution(run: RunState, pollution: number): RunState {
  const next = Math.max(0, Math.min(100, Math.trunc(pollution)));
  return { ...run, pollution: next, pollutionPeak: Math.max(run.pollutionPeak, next) };
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

/** 相邻两层的连边（docs/48 §3.1）：只连相邻层，列差 ≤1，边不交叉。 */
export interface MapEdge {
  readonly from: string;
  readonly to: string;
}

/** 一幕的完整图（节点表 + 边表）：同种子同图。 */
export interface GeneratedMap {
  readonly layers: readonly MapLayer[];
  readonly edges: readonly MapEdge[];
}

export interface MapView {
  readonly layers: readonly MapLayer[];
  readonly edges: readonly MapEdge[];
  readonly currentIndex: number;
  readonly current: MapNode | undefined;
  readonly picked: readonly number[];
  /** 当前节点可走到的下一层节点 id（全图可见模式下的"亮起可点"，docs/48 §4） */
  readonly reachable: readonly string[];
  readonly finished: boolean;
}

/** 节点类型权重：本层覆盖优先，缺省用幕的全局权重。 */
function kindWeights(spec: MapLayerSpec, act: ActDefinition): Readonly<Record<string, number>> {
  return spec.weights ?? act.weights;
}

/**
 * 某层的基础宽度（docs/48 §3.1）：起点 / 祭坛 / Boss 层 = 1；中间层 2~4。
 * 层数据写 1 的中间层按结构规格抬到最小分支宽度 2。
 */
function baseWidth(spec: MapLayerSpec, layerIdx: number, total: number): number {
  if (layerIdx === 0 || layerIdx >= total - 2) return 1;
  return Math.max(2, Math.min(4, Math.trunc(spec.width) || 2));
}

/**
 * 层宽规划（docs/48 §3.1）：边「两端列差 ≤1 + 全连通」在数学上要求 **相邻层宽度差 ≤1**。
 * 两端单点因此必然收敛成菱形（l0=1 → l1=2；l6=1 → l5=2）。
 * 先取基础宽度，再正向 / 反向各夹一次，保证 |w[i]-w[i+1]| ≤ 1 恒成立——
 * 生成器因此不会产出「校验不过」的图，§3.3 的重掷分支在结构上不可达（有单测钉死）。
 */
function planWidths(act: ActDefinition): number[] {
  const total = act.layers.length;
  const widths = act.layers.map((spec, i) => baseWidth(spec, i, total));
  const clampTo = (i: number, neighbour: number): void => {
    if (i === 0 || i >= total - 2) return; // 起点 / 祭坛 / Boss 固定单节点
    widths[i] = Math.max(Math.min(widths[i]!, neighbour + 1), Math.max(2, neighbour - 1));
  };
  for (let i = 1; i < total - 2; i += 1) clampTo(i, widths[i - 1]!);
  for (let i = total - 3; i >= 1; i -= 1) clampTo(i, widths[i + 1]!);
  return widths;
}

/** 本层允许的类型；受"同层精英≤1 / 篝火≤1 / l1 不出精英"约束时回落全局五类。 */
function allowedKinds(spec: MapLayerSpec, layerIdx: number, elites: number, rests: number): NodeKind[] {
  const ok = (k: NodeKind): boolean => {
    if (k === "elite" && (elites >= 1 || layerIdx <= 1)) return false;
    if (k === "rest" && rests >= 1) return false;
    return true;
  };
  const authored = spec.kinds.filter(ok);
  if (authored.length > 0) return [...authored];
  return (["battle", "elite", "rest", "altar", "event"] as NodeKind[]).filter(ok);
}

/** 该层 battle 节点的遭遇池：本层没有就继承本幕最近一层有池的（DAG 新增层不饿死）。 */
function inheritedPool<T>(act: ActDefinition, layerIdx: number, pick: (spec: MapLayerSpec) => T | undefined): T | undefined {
  for (let i = layerIdx; i >= 0; i -= 1) {
    const value = pick(act.layers[i]!);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * 树状地图生成（docs/48 §三）：DAG，同一 seed → 同一图。
 * - 深度沿用 act.layers（8 层）；l1~l5 每层 2~4 个节点；起点/祭坛/Boss 单节点
 * - 类型沿用各层 kinds 与 weights（约束：同层精英 ≤1、篝火 ≤1、l1 不出精英）
 * - 边只连相邻层、列差 ≤1、单调不交叉，且保证连通性
 */
export function generateMapGraph(act: ActDefinition, seed: number): GeneratedMap {
  const rng = new Rng((seed ^ 0x5f3759df) >>> 0).stream("map");
  const eliteRng = new Rng((seed ^ 0xe117e3) >>> 0).stream("map");
  const elitesTaken: string[] = [];
  const widths = planWidths(act);
  const layers: MapLayer[] = act.layers.map((spec, layerIdx) => {
    const width = widths[layerIdx] ?? 1;
    let elitePick: string | undefined;
    if (spec.elitePool && spec.elitePool.length > 0) {
      const remaining = spec.elitePool.filter((id) => !elitesTaken.includes(id));
      const pool = remaining.length > 0 ? remaining : [...spec.elitePool];
      elitePick = pool[eliteRng.nextInt(0, pool.length - 1)];
      elitesTaken.push(elitePick);
    }
    const encounters = spec.encounters ?? inheritedPool(act, layerIdx, (s) => s.encounters);
    const events = spec.events ?? inheritedPool(act, layerIdx, (s) => s.events);
    let elites = 0;
    let rests = 0;
    const nodes: MapNode[] = [];
    for (let i = 0; i < width; i += 1) {
      const allowed = allowedKinds(spec, layerIdx, elites, rests);
      const weights = kindWeights(spec, act);
      const entries = allowed
        .map((k) => [k, Math.max(0, weights[k] ?? 0)] as const)
        .filter(([, w]) => w > 0);
      // 层内类型权重全为 0（如精英层的全局权重为 0）时，退化为在允许集合里均匀抽
      const kind = entries.length > 0 ? rng.weighted(entries) : allowed[rng.nextInt(0, Math.max(0, allowed.length - 1))] ?? "battle";
      if (kind === "elite") elites += 1;
      if (kind === "rest") rests += 1;
      nodes.push({
        id: `${kind}_${layerIdx}_${i}`,
        kind,
        i18n: spec.i18n ?? act.nodeI18n?.[kind] ?? `node.${kind}`,
        ...(encounters && kind === "battle" ? { encounters } : {}),
        ...(events && kind === "event" ? { events } : {}),
        ...(elitePick && kind === "elite" ? { enemies: [elitePick] } : {}),
        // 写死的遭遇只贴给「本层声明过的类型」：被同层约束挤掉后回落生成的其它类型不继承，
        // 否则 l3 的精英 rust_warden 会漏到同层生成出来的 battle 节点上（docs/48 §3.2）
        ...(spec.enemies && spec.kinds.includes(kind) && (kind === "battle" || kind === "elite" || kind === "boss")
          ? { enemies: spec.enemies }
          : {}),
      });
    }
    return { id: spec.id, nodes };
  });
  return { layers, edges: buildEdges(layers) };
}

/**
 * 层间连边（docs/48 §3.1）：单调对齐保证"列差 ≤1 + 边不交叉 + 全连通"。
 * 后层比前层多出来的节点从最后一列扇出，少出来的节点汇到最后一列。
 */
function buildEdges(layers: readonly MapLayer[]): MapEdge[] {
  const edges: MapEdge[] = [];
  for (let i = 0; i + 1 < layers.length; i += 1) {
    const from = layers[i]!.nodes;
    const to = layers[i + 1]!.nodes;
    const m = from.length;
    const n = to.length;
    if (m === 0 || n === 0) continue;
    for (let a = 0; a < m; a += 1) edges.push({ from: from[a]!.id, to: to[Math.min(a, n - 1)]!.id });
    if (n > m) for (let b = m; b < n; b += 1) edges.push({ from: from[m - 1]!.id, to: to[b]!.id });
  }
  return edges;
}

/**
 * DAG 结构校验（docs/48 §3.1）：validator 与单测共用的「常驻检查」，空数组 = 合格。
 * 校验：只连相邻层 / 列差 ≤1 / 边不交叉 / 除起点外每节点 ≥1 入边 /
 * 除终点外每节点 ≥1 出边 / 同层精英 ≤1、篝火 ≤1 / l1 不出精英。
 */
export function checkMapGraph(map: GeneratedMap): string[] {
  const issues: string[] = [];
  const layerOf = new Map<string, number>();
  const colOf = new Map<string, number>();
  map.layers.forEach((layer, li) =>
    layer.nodes.forEach((node, ni) => {
      layerOf.set(node.id, li);
      colOf.set(node.id, ni);
    }),
  );
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  for (const edge of map.edges) {
    const from = layerOf.get(edge.from);
    const to = layerOf.get(edge.to);
    if (from === undefined || to === undefined) {
      issues.push(`边 ${edge.from}→${edge.to} 引用了不存在的节点`);
      continue;
    }
    if (to - from !== 1) issues.push(`边 ${edge.from}→${edge.to} 跨了非相邻层`);
    if (Math.abs((colOf.get(edge.from) ?? 0) - (colOf.get(edge.to) ?? 0)) > 1) {
      issues.push(`边 ${edge.from}→${edge.to} 两端列差 > 1`);
    }
    outDeg.set(edge.from, (outDeg.get(edge.from) ?? 0) + 1);
    inDeg.set(edge.to, (inDeg.get(edge.to) ?? 0) + 1);
  }
  // 平面约束：同一对相邻层内，from 靠左的边不允许落到更右的列（否则两线交叉）
  for (let li = 0; li + 1 < map.layers.length; li += 1) {
    const segs = map.edges
      .filter((e) => layerOf.get(e.from) === li)
      .map((e) => ({ a: colOf.get(e.from) ?? 0, b: colOf.get(e.to) ?? 0 }));
    for (const x of segs) {
      for (const y of segs) {
        if (x.a < y.a && x.b > y.b) {
          issues.push(`第 ${li}→${li + 1} 层的边交叉（${x.a}→${x.b} 与 ${y.a}→${y.b}）`);
        }
      }
    }
  }
  map.layers.forEach((layer, li) => {
    const elites = layer.nodes.filter((n) => n.kind === "elite").length;
    const rests = layer.nodes.filter((n) => n.kind === "rest").length;
    if (elites > 1) issues.push(`第 ${li} 层有 ${elites} 个精英（同层 ≤1）`);
    if (rests > 1) issues.push(`第 ${li} 层有 ${rests} 个篝火（同层 ≤1）`);
    if (li === 1 && elites > 0) issues.push("l1 不允许出现精英");
    for (const node of layer.nodes) {
      if (li > 0 && !inDeg.has(node.id)) issues.push(`节点 ${node.id} 没有入边`);
      if (li + 1 < map.layers.length && !outDeg.has(node.id)) issues.push(`节点 ${node.id} 没有出边`);
    }
  });
  return issues;
}

/** 兼容旧调用：只要层表的走这里（边表另取 generateMapGraph）。 */
export function generateActMap(act: ActDefinition, seed: number): readonly MapLayer[] {
  return generateMapGraph(act, seed).layers;
}

/** 某节点是否与当前所在节点相邻（DAG 里"可点"的判定，docs/48 §4）。 */
export function isReachable(map: GeneratedMap, run: RunState, nodeId: string): boolean {
  if (run.layerIndex === 0) return map.layers[0]?.nodes[0]?.id === nodeId;
  const prevLayer = map.layers[run.layerIndex - 1];
  // 未记录选择（开发者跳关 / 教学）时按第 0 列兜底，避免图把人堵死
  const prevIdx = run.picked[run.layerIndex - 1] ?? 0;
  const prev = prevLayer?.nodes[prevIdx] ?? prevLayer?.nodes[0];
  if (!prev) return false;
  return map.edges.some((e) => e.from === prev.id && e.to === nodeId);
}

/** 当前幕（docs/40 §二）：actIndex 越界时回落到最后一幕。 */
export function actOf(
  run: RunState,
  acts: readonly ActDefinition[],
): ActDefinition | undefined {
  if (acts.length === 0) return undefined;
  return acts[Math.min(run.actIndex, acts.length - 1)];
}

/** 是否还有下一幕（docs/40 §2.2：一幕通关后进幕间）。 */
export function hasNextAct(run: RunState, acts: readonly ActDefinition[]): boolean {
  return run.actIndex + 1 < acts.length;
}

/**
 * 幕间结算（docs/40 §2.2 / docs/45 Q7）：切幕 + 回血 40%（floor，最少 1）+ 污染清零，其余原样保留。
 * 25% → 40% 是 docs/45 Q7 第一步授权（双幕实测第一步；圣堂馈赠三选一的「回复 50%」不动）。
 */
export function applyIntermission(run: RunState): RunState {
  const heal = Math.max(1, Math.floor(run.maxHp * 0.4));
  return {
    ...run,
    actIndex: run.actIndex + 1,
    layerIndex: 0,
    picked: [],
    cleared: [],
    hp: Math.min(run.maxHp, run.hp + heal),
    pollution: 0,
    deepestAct: Math.max(run.deepestAct, run.actIndex + 2),
  };
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
    actIndex: 0,
    deepestAct: 1,
    deepestLayer: 0,
    legacy: false,
    unlocked: [...(opts.unlocked ?? [])],
    pickedRelic: opts.companionRelic ?? "",
    difficulty: opts.difficulty ?? "normal",
    usedBloodpact: false,
    overloadCount: 0,
    interrupts: 0,
    backlashTaken: 0,
    turns: 0,
    pollutionPeak: 0,
  };
}

export function mapView(run: RunState, act: ActDefinition): MapView {
  const map = generateMapGraph(act, run.seed);
  const layer = map.layers[run.layerIndex];
  return {
    layers: map.layers,
    edges: map.edges,
    currentIndex: run.layerIndex,
    current: currentNode(run, act),
    picked: run.picked,
    reachable: (layer?.nodes ?? []).filter((n) => isReachable(map, run, n.id)).map((n) => n.id),
    finished: run.layerIndex >= map.layers.length,
  };
}

export function currentLayer(run: RunState, act: ActDefinition): MapLayer | undefined {
  return generateMapGraph(act, run.seed).layers[run.layerIndex];
}

export function currentNode(run: RunState, act: ActDefinition): MapNode | undefined {
  const layer = currentLayer(run, act);
  if (!layer) return undefined;
  const idx = run.picked[run.layerIndex];
  if (idx !== undefined) return layer.nodes[idx];
  // 必经 / 汇合层（width=1）无需选择，直接生效；分支层必须显式 chooseNode
  return layer.nodes.length === 1 ? layer.nodes[0] : undefined;
}

/** 当前所在节点 id（未选的必经层也能定位，供图视图描金）。 */
export function currentNodeId(run: RunState, act: ActDefinition): string | undefined {
  return currentNode(run, act)?.id;
}

/**
 * 在当前层选定候选（DAG：必须是上一层所在节点连得到的那一个，docs/48 §四）。
 * 非法/不可达直接忽略，保证 UI 点不动就是点不动。
 */
export function chooseNode(run: RunState, act: ActDefinition, index: number): RunState {
  const map = generateMapGraph(act, run.seed);
  const layer = map.layers[run.layerIndex];
  if (!layer || !Number.isInteger(index) || index < 0 || index >= layer.nodes.length) return run;
  const target = layer.nodes[index];
  if (!target || !isReachable(map, run, target.id)) return run;
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
  return {
    ...run,
    layerIndex: run.layerIndex + 1,
    cleared,
    deepestAct: Math.max(run.deepestAct, run.actIndex + 1),
    deepestLayer: Math.max(run.deepestLayer, run.layerIndex + 1),
  };
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
  /** 当前幕 id：幕专属强化不参与其它幕的重铸池（docs/40 §七） */
  actId?: string,
): string | null {
  const owned = new Set([...keep, ...ownedElsewhere, ...exclude]);
  const pool = [...content.enhancements.values()]
    .filter((e) => {
      if (e.tier !== tier) return false;
      if (e.actScope && e.actScope !== actId) return false;
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
  /** 当前幕 id：幕专属强化（actScope）只在对应幕入池（docs/40 §七） */
  actId?: string,
): string[] {
  const ids = [...content.enhancements.values()]
    .filter((e) => !e.actScope || e.actScope === actId)
    .map((e) => e.id)
    .sort();
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