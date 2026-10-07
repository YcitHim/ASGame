/**
 * core/map · 线性地图与远征进度（0.1 无分支）
 *
 * 玩法规则只住在 core：节点推进、奖励抽取都在这里，UI 只做展示与转发。
 * 随机一律走 reward 流（ADR-006），因此同样的种子 + 输入流可复现。
 */
import type { RunDifficulty } from "../registry/content";
import type { ActDefinition, ClassDefinition, EventDefinition, MapLayerSpec, MapNode, NodeKind } from "../registry/content";
import type { ContentDb } from "../registry/content";
import { Rng, type RngStream } from "../rng";
import { NEUTRAL_CLASS, pickPoolSide } from "./pool";

export {
  checkEventCondition,
  eventConditionCurrent,
  loseableRelicPool,
  percentHpDelta,
  resolveEventOption,
  type EventConditionContext,
  type EventResolution,
} from "./event";
export { CLASS_POOL_SHARE, NEUTRAL_CLASS, pickPoolSide, usableForClass } from "./pool";

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
  /**
   * 本幕已抽过的事件（docs/54 E7：同幕事件不放回抽取，池尽重置）。
   * 转幕 / 开新局清空——「一局两幕不再连撞同一个事件」而不是「一局不重复」。
   *
   * 记的是「**哪一层**抽到了哪个事件」而不是只记 id：结算那一刻 seenEvents 会变，
   * 若只记 id，同一个节点重算 rollEvent 时会掷出池里另一个事件，
   * 结算页的标题/正文会当场跳成别的故事（CDP 走查抓到的真 bug）。
   */
  readonly seenEvents: readonly SeenEvent[];
}

/** 某层抽到的事件（docs/54 E7）。 */
export interface SeenEvent {
  readonly layer: number;
  readonly eventId: string;
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

/**
 * 事件结算写回 HP（docs/54 §四）：把固定点数与「上限同额」两笔合成一次写回。
 *
 * - `maxHpDelta` 只改上限，**当前 HP 同额增减**（+4 上限就是 +4 当前）；
 * - 所有结果一律夹在 `[1, maxHp]`：事件不该杀人——旧版允许落到 0，
 *   而 0 HP 会让下一场战斗的 `startRun` 判定「已阵亡」把整局重开（静默丢进度）。
 */
export function applyEventHp(run: RunState, hpDelta: number, maxHpDelta: number): RunState {
  const maxHp = Math.max(1, run.maxHp + maxHpDelta);
  const hp = Math.max(1, Math.min(maxHp, run.hp + hpDelta + maxHpDelta));
  return { ...run, maxHp, hp };
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

/** 中段层下标（10 层时 = l1~l7）：除起点 / 祭坛 / Boss 之外的层（docs/48 §3.1 修订 1）。 */
function midLayerIndexes(total: number): number[] {
  const out: number[] = [];
  for (let i = 1; i < total - 2; i += 1) out.push(i);
  return out;
}

/** 可出精英的中段层：两端中段层（l1 与倒数第二层）不出精英（docs/48 §3.2）。 */
function eliteLayerIndexes(total: number): number[] {
  const mids = midLayerIndexes(total);
  return mids.slice(1, -1);
}

/** 无放回抽 count 个（不足则全给），顺序随机。 */
function sampleDistinct<T>(rng: RngStream, pool: readonly T[], count: number): T[] {
  const rest = [...pool];
  const out: T[] = [];
  while (out.length < count && rest.length > 0) {
    out.push(rest.splice(rng.nextInt(0, rest.length - 1), 1)[0]!);
  }
  return out;
}

/** 中段层宽度分布（docs/48 §3.1 假设图口径）：2~4，典型 ~21 节点/幕。 */
function rollWidth(rng: RngStream): number {
  const r = rng.nextFloat();
  return r < 0.3 ? 2 : r < 0.75 ? 3 : 4;
}

/**
 * 环境层类型（docs/48 §3.2）：稀有节点（精英 / 篝火）由全局布置决定，
 * 这里只在「本层 kinds 去掉 elite / rest」里按 weights 抽。
 */
function ambientKind(spec: MapLayerSpec, act: ActDefinition, rng: RngStream): NodeKind {
  const authored = spec.kinds.filter((k) => k !== "elite" && k !== "rest");
  const pool = authored.length > 0 ? authored : (["battle", "altar", "event"] as NodeKind[]);
  const weights = kindWeights(spec, act);
  const entries = pool.map((k) => [k, Math.max(0, weights[k] ?? 0)] as const).filter(([, w]) => w > 0);
  return entries.length > 0 ? rng.weighted(entries) : rng.pick(pool);
}

/** 生成过程中的裸节点（还没挂遭遇 / 事件 / 精英池）。 */
interface RawNode {
  readonly layer: number;
  readonly col: number;
  kind: NodeKind;
}

/** 生成器重掷上限（docs/48 §3.3）：任一整图校验不过就重掷。 */
const MAP_ATTEMPTS = 80;

/**
 * 稀有节点总量（docs/48 §3.2.4）：精英 2~4 / 幕、篝火 1~3 / 幕。
 * §五.1 授权：通关率若因地图离开 45~65%，补偿对象是**节点配比**而非敌人数值。
 * 10 层方案实测单幕胜率跌破区间，故先跑「低精英、高篝火」这一档（见 docs/48 执行记录）。
 */
const ELITE_RANGE: readonly [number, number] = [2, 4];
const REST_RANGE: readonly [number, number] = [1, 3];

/** 该层 battle 节点的遭遇池：本层没有就继承本幕最近一层有池的（DAG 新增层不饿死）。 */
function inheritedPool<T>(act: ActDefinition, layerIdx: number, pick: (spec: MapLayerSpec) => T | undefined): T | undefined {
  for (let i = layerIdx; i >= 0; i -= 1) {
    const value = pick(act.layers[i]!);
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * 一次生成尝试（docs/48 §三 修订版）：宽度 / 列 / 类型 / 边全在同一 map 流里掷。
 * 是否合格交给 analyzeMapGraph；不合格由 generateMapGraph 就地重掷（§3.3）。
 */
function draftMap(act: ActDefinition, rng: RngStream): GeneratedMap {
  const total = act.layers.length;
  const mids = midLayerIndexes(total);
  const spine = rng.nextFloat() < 0.5 ? 1 : 2;
  const raw: RawNode[][] = act.layers.map(() => []);
  raw[0] = [{ layer: 0, col: spine, kind: act.layers[0]!.kinds[0] ?? "battle" }];
  for (const l of mids) {
    const width = rollWidth(rng);
    const cols = sampleDistinct(rng, [0, 1, 2, 3], width).sort((a, b) => a - b);
    raw[l] = cols.map((col) => ({ layer: l, col, kind: "battle" as NodeKind }));
  }
  raw[total - 2] = [{ layer: total - 2, col: spine, kind: "altar" }];
  raw[total - 1] = [{ layer: total - 1, col: spine, kind: "boss" }];

  // 稀有节点布置：先整体洗牌再取前 N，消耗的随机次数与 N 无关——
  // 这样「改节点配比」不会把整张图重新掷一遍，混比实验才有可比的同批地图。
  const eliteCount = ELITE_RANGE[0] + rng.nextInt(0, ELITE_RANGE[1] - ELITE_RANGE[0]);
  const restCount = REST_RANGE[0] + rng.nextInt(0, REST_RANGE[1] - REST_RANGE[0]);
  const eliteLayers = rng.shuffle(eliteLayerIndexes(total)).slice(0, eliteCount);
  for (const l of eliteLayers) {
    const node = rng.pick(raw[l]!);
    if (node.kind === "battle") node.kind = "elite";
  }
  const restLayers = rng.shuffle(mids).slice(0, restCount);
  for (const l of restLayers) {
    const cand = raw[l]!.filter((n) => n.kind === "battle");
    if (cand.length > 0) rng.pick(cand).kind = "rest";
  }

  const elitesTaken: string[] = [];
  const layers: MapLayer[] = act.layers.map((spec, l) => ({
    id: spec.id,
    nodes: raw[l]!.map((r, i) => makeNode(act, spec, l, i, r, rng, elitesTaken)),
  }));
  return { layers, edges: buildEdges(layers, rng) };
}

/** 组装节点：补环境类型与遭遇 / 事件 / 精英（同幕按层序抽、后排斥前，docs/48 §3.2）。 */
function makeNode(
  act: ActDefinition,
  spec: MapLayerSpec,
  layerIdx: number,
  index: number,
  rawNode: RawNode,
  rng: RngStream,
  elitesTaken: string[],
): MapNode {
  const kind = rawNode.kind === "battle" ? ambientKind(spec, act, rng) : rawNode.kind;
  const encounters = spec.encounters ?? inheritedPool(act, layerIdx, (s) => s.encounters);
  const events = spec.events ?? inheritedPool(act, layerIdx, (s) => s.events);
  let enemies: readonly string[] | undefined;
  if (kind === "elite" && spec.elitePool && spec.elitePool.length > 0) {
    const remaining = spec.elitePool.filter((id) => !elitesTaken.includes(id));
    const pool = remaining.length > 0 ? remaining : [...spec.elitePool];
    const pick = pool[rng.nextInt(0, pool.length - 1)]!;
    elitesTaken.push(pick);
    enemies = [pick];
  } else if ((kind === "battle" || kind === "elite" || kind === "boss") && spec.enemies && spec.enemies.length > 0) {
    // 写死的遭遇只给单节点必经层（l0 / Boss）；分支层写死遭遇由 validator 拦
    enemies = spec.enemies;
  }
  return {
    id: `${kind}_${layerIdx}_${index}`,
    kind,
    col: rawNode.col,
    i18n: spec.i18n ?? act.nodeI18n?.[kind] ?? `node.${kind}`,
    ...(encounters && kind === "battle" ? { encounters } : {}),
    ...(events && kind === "event" ? { events } : {}),
    ...(enemies ? { enemies } : {}),
  };
}

type Seg = readonly [MapNode, MapNode];

/**
 * 层间连边（docs/48 §3.1）：只连相邻层、两端列差 ≤1（单节点层豁免，全连）、边不交叉。
 * 先保证「每个目标有入边、每个源有出边」，再随机补到一半——三分叉与汇合点由此自然产生。
 */
function buildEdges(layers: readonly MapLayer[], rng: RngStream): MapEdge[] {
  const edges: MapEdge[] = [];
  const colDiff = (a: MapNode, b: MapNode): number => Math.abs((a.col ?? 0) - (b.col ?? 0));
  const crosses = (x: Seg, y: Seg): boolean =>
    ((x[0].col ?? 0) - (y[0].col ?? 0)) * ((x[1].col ?? 0) - (y[1].col ?? 0)) < 0;
  for (let l = 0; l + 1 < layers.length; l += 1) {
    const A = layers[l]!.nodes;
    const B = layers[l + 1]!.nodes;
    if (A.length === 0 || B.length === 0) continue;
    const free = A.length === 1 || B.length === 1;
    const cand: Seg[] = [];
    for (const a of A) for (const b of B) if (free || colDiff(a, b) <= 1) cand.push([a, b]);
    const chosen: Seg[] = [];
    const tryAdd = (edge: Seg): void => {
      if (chosen.some((c) => c[0] === edge[0] && c[1] === edge[1])) return;
      if (chosen.some((c) => crosses(c, edge))) return;
      chosen.push(edge);
    };
    for (const b of B) {
      const near = cand.filter((e) => e[1] === b).sort((x, y) => colDiff(x[0], x[1]) - colDiff(y[0], y[1]));
      if (near.length > 0) tryAdd(near[0]!);
    }
    for (const a of A) {
      const near = cand.filter((e) => e[0] === a).sort((x, y) => colDiff(x[0], x[1]) - colDiff(y[0], y[1]));
      if (near.length > 0) tryAdd(near[0]!);
    }
    for (const edge of rng.shuffle(cand)) if (rng.nextFloat() < 0.5) tryAdd(edge);
    for (const [a, b] of chosen) edges.push({ from: a.id, to: b.id });
  }
  return edges;
}

/** 兜底图的节点类型（与随机生成无关，固定式）。 */
function fallbackKind(li: number, i: number, total: number, elites: readonly number[], rest: number): NodeKind {
  if (li === total - 2) return "altar";
  if (li === total - 1) return "boss";
  if (elites.includes(li) && i === 1) return "elite";
  if (li === rest && i === 2) return "rest";
  return "battle";
}

/**
 * 兜底图（docs/48 §3.3「最多 10 次后整幕重掷」的最后一档）：菱形三列 + 定式边，
 * 数学上必过全部整图校验。正常路径用不到，只在随机生成连续失败时接管（保证"生成必成功"）。
 */
function fallbackMap(act: ActDefinition): GeneratedMap {
  const total = act.layers.length;
  const mids = midLayerIndexes(total);
  const eliteLayers = eliteLayerIndexes(total).slice(0, 2);
  const restLayer = mids[0];
  const elitesTaken: string[] = [];
  const layers: MapLayer[] = act.layers.map((spec, li) => {
    const isEnd = li === 0 || li >= total - 2;
    const cols = isEnd ? [1] : [0, 1, 2];
    const nodes: MapNode[] = cols.map((col, i) => {
      const kind = fallbackKind(li, i, total, eliteLayers, restLayer);
      let enemies: readonly string[] | undefined;
      if (kind === "elite") {
        const pool = spec.elitePool && spec.elitePool.length > 0 ? spec.elitePool : (spec.enemies ?? []);
        const pick = pool.length > 0 ? pool[elitesTaken.length % pool.length] : undefined;
        if (pick) {
          elitesTaken.push(pick);
          enemies = [pick];
        }
      } else if ((kind === "battle" || kind === "boss") && spec.enemies && spec.enemies.length > 0) {
        enemies = spec.enemies;
      }
      const encounters = spec.encounters ?? inheritedPool(act, li, (s) => s.encounters);
      const events = spec.events ?? inheritedPool(act, li, (s) => s.events);
      return {
        id: `${kind}_${li}_${i}`,
        kind,
        col,
        i18n: spec.i18n ?? act.nodeI18n?.[kind] ?? `node.${kind}`,
        ...(encounters && kind === "battle" ? { encounters } : {}),
        ...(events && kind === "event" ? { events } : {}),
        ...(enemies ? { enemies } : {}),
      };
    });
    return { id: spec.id, nodes };
  });
  const edges: MapEdge[] = [];
  const pattern: readonly (readonly [number, number])[] = [[0, 0], [1, 0], [1, 1], [1, 2], [2, 2]];
  for (let li = 0; li + 1 < total; li += 1) {
    const A = layers[li]!.nodes;
    const B = layers[li + 1]!.nodes;
    if (A.length === 1 || B.length === 1) {
      for (const a of A) for (const b of B) edges.push({ from: a.id, to: b.id });
      continue;
    }
    for (const [a, b] of pattern) {
      const from = A[a];
      const to = B[b];
      if (from && to) edges.push({ from: from.id, to: to.id });
    }
  }
  return { layers, edges };
}

/** 幕 id 混进种子：同一 run.seed 下 act1 / act2 生成两张不同的图（docs/40 §二 口径）。 */
function actSeed(act: ActDefinition, seed: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < act.id.length; i += 1) h = Math.imul(h ^ act.id.charCodeAt(i), 0x01000193) >>> 0;
  return (seed ^ h ^ 0x5f3759df) >>> 0;
}

/**
 * 树状地图生成（docs/48 §三 修订版）：DAG，同一 seed → 同一图。
 * 重掷直到整图校验全过（连边 / 密度 / 路径数 / 走廊），80 次仍不过则用兜底图。
 */
export function generateMapGraph(act: ActDefinition, seed: number): GeneratedMap {
  const rng = new Rng(actSeed(act, seed)).stream("map");
  for (let attempt = 0; attempt < MAP_ATTEMPTS; attempt += 1) {
    const draft = draftMap(act, rng);
    if (analyzeMapGraph(draft).issues.length === 0) return draft;
  }
  return fallbackMap(act);
}

export interface MapAnalysis {
  readonly nodes: number;
  /** 出度 ≥3 的中段节点（三分叉） */
  readonly forks: number;
  /** 入度 ≥2 的中段节点（汇合点） */
  readonly merges: number;
  /** start→Boss 可行路径数（封顶 99999） */
  readonly paths: number;
  readonly elites: number;
  readonly rests: number;
  readonly safePath: readonly string[];
  readonly greedyPath: readonly string[];
  readonly issues: readonly string[];
}

/** 安全走廊：start→Boss，精英 ≤1 且篝火 ≥1（docs/48 §3.4）。 */
function findSafePath(
  out: ReadonlyMap<string, readonly string[]>,
  kindOf: ReadonlyMap<string, NodeKind>,
  startId: string,
  bossId: string,
): string[] {
  const key = (id: string, e: number, r: number): string => `${id}|${e}|${r}`;
  const parent = new Map<string, string>();
  const seen = new Set<string>([key(startId, 0, 0)]);
  let queue: { id: string; e: number; r: number }[] = [{ id: startId, e: 0, r: 0 }];
  let end: { id: string; e: number; r: number } | undefined;
  while (queue.length > 0 && !end) {
    const next: { id: string; e: number; r: number }[] = [];
    for (const cur of queue) {
      if (cur.id === bossId && cur.e <= 1 && cur.r >= 1) {
        end = cur;
        break;
      }
      for (const t of out.get(cur.id) ?? []) {
        const kind = kindOf.get(t);
        const e = Math.min(2, cur.e + (kind === "elite" ? 1 : 0));
        const r = Math.min(1, cur.r + (kind === "rest" ? 1 : 0));
        const k = key(t, e, r);
        if (seen.has(k)) continue;
        seen.add(k);
        parent.set(k, key(cur.id, cur.e, cur.r));
        next.push({ id: t, e, r });
      }
    }
    queue = next;
  }
  if (!end) return [];
  const path: string[] = [];
  let cur: string | undefined = key(end.id, end.e, end.r);
  while (cur) {
    path.unshift(cur.split("|")[0]!);
    cur = parent.get(cur);
  }
  return path;
}

/** 贪婪走廊：存在精英 ≥2 的 start→Boss 路径（docs/48 §3.4）。 */
function findGreedyPath(
  map: GeneratedMap,
  out: ReadonlyMap<string, readonly string[]>,
  kindOf: ReadonlyMap<string, NodeKind>,
  startId: string,
  bossId: string,
): string[] {
  const best = new Map<string, number>([[startId, 0]]);
  const parent = new Map<string, string>();
  for (const layer of map.layers) {
    for (const node of layer.nodes) {
      const cur = best.get(node.id);
      if (cur === undefined) continue;
      for (const t of out.get(node.id) ?? []) {
        const value = cur + (kindOf.get(t) === "elite" ? 1 : 0);
        if ((best.get(t) ?? -1) < value) {
          best.set(t, value);
          parent.set(t, node.id);
        }
      }
    }
  }
  if ((best.get(bossId) ?? 0) < 2) return [];
  const path: string[] = [];
  let cur: string | undefined = bossId;
  while (cur) {
    path.unshift(cur);
    cur = parent.get(cur);
  }
  return path;
}

/**
 * 整图分析（docs/48 §3.1 修订 2 / §3.2 / §3.4）：validator、生成器与单测共用的常驻检查。
 * issues 非空 = 整图不合格（应重掷）。
 */
export function analyzeMapGraph(map: GeneratedMap): MapAnalysis {
  const issues: string[] = [];
  const layerOf = new Map<string, number>();
  const colOf = new Map<string, number>();
  const kindOf = new Map<string, NodeKind>();
  const out = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  map.layers.forEach((layer, li) =>
    layer.nodes.forEach((node) => {
      layerOf.set(node.id, li);
      colOf.set(node.id, node.col ?? 0);
      kindOf.set(node.id, node.kind);
      out.set(node.id, []);
      indeg.set(node.id, 0);
    }),
  );
  const last = map.layers.length - 1;
  for (const edge of map.edges) {
    const a = layerOf.get(edge.from);
    const b = layerOf.get(edge.to);
    if (a === undefined || b === undefined) {
      issues.push(`边 ${edge.from}→${edge.to} 引用了不存在的节点`);
      continue;
    }
    if (b - a !== 1) issues.push(`边 ${edge.from}→${edge.to} 跨了非相邻层`);
    out.get(edge.from)?.push(edge.to);
    indeg.set(edge.to, (indeg.get(edge.to) ?? 0) + 1);
  }
  // 列差 ≤1（单节点层豁免）+ 平面约束（不交叉）
  for (let li = 0; li < last; li += 1) {
    const A = map.layers[li]!;
    const B = map.layers[li + 1]!;
    const free = A.nodes.length === 1 || B.nodes.length === 1;
    const segs = map.edges
      .filter((e) => layerOf.get(e.from) === li)
      .map((e) => ({ a: colOf.get(e.from) ?? 0, b: colOf.get(e.to) ?? 0 }));
    if (!free) {
      for (const s of segs) {
        if (Math.abs(s.a - s.b) > 1) issues.push(`第 ${li}→${li + 1} 层的边列差 ${Math.abs(s.a - s.b)} > 1`);
      }
    }
    for (const x of segs) {
      for (const y of segs) {
        if (x.a < y.a && x.b > y.b) issues.push(`第 ${li}→${li + 1} 层的边交叉（${x.a}→${x.b} 与 ${y.a}→${y.b}）`);
      }
    }
  }
  // 层骨架 / 连通性 / 同层约束 / 祭坛前不出精英
  map.layers.forEach((layer, li) => {
    const edgeLayer = li === 0 || li >= last - 1;
    if (edgeLayer && layer.nodes.length !== 1) issues.push(`第 ${li} 层应是单节点`);
    if (!edgeLayer && (layer.nodes.length < 2 || layer.nodes.length > 4)) {
      issues.push(`第 ${li} 层中段节点 ${layer.nodes.length} 个（应 2~4）`);
    }
    const elitesHere = layer.nodes.filter((n) => n.kind === "elite").length;
    const restsHere = layer.nodes.filter((n) => n.kind === "rest").length;
    if (elitesHere > 1) issues.push(`第 ${li} 层精英 ${elitesHere} 个（同层 ≤1）`);
    if (restsHere > 1) issues.push(`第 ${li} 层篝火 ${restsHere} 个（同层 ≤1）`);
    if ((li === 1 || li === last - 2) && elitesHere > 0) issues.push(`第 ${li} 层不允许出现精英`);
    for (const node of layer.nodes) {
      if (li > 0 && (indeg.get(node.id) ?? 0) === 0) issues.push(`节点 ${node.id} 没有入边`);
      if (li < last && (out.get(node.id)?.length ?? 0) === 0) issues.push(`节点 ${node.id} 没有出边`);
    }
  });
  const kinds = [...kindOf.values()];
  const elites = kinds.filter((k) => k === "elite").length;
  const rests = kinds.filter((k) => k === "rest").length;
  if (elites < 2 || elites > 4) issues.push(`全图精英 ${elites} 个（应 2~4）`);
  if (rests < 1 || rests > 3) issues.push(`全图篝火 ${rests} 个（应 1~3）`);
  // 决策点密度（修订 2）
  const midIds = map.layers.slice(1, last).flatMap((l) => l.nodes.map((n) => n.id));
  const forks = midIds.filter((id) => (out.get(id)?.length ?? 0) >= 3).length;
  const merges = midIds.filter((id) => (indeg.get(id) ?? 0) >= 2).length;
  if (forks < 2) issues.push(`三分叉 ${forks} 个（应 ≥2）`);
  if (merges < 2) issues.push(`汇合点 ${merges} 个（应 ≥2）`);
  // 可行路径数（DP）
  const startId = map.layers[0]?.nodes[0]?.id ?? "";
  const bossId = map.layers[last]?.nodes[0]?.id ?? "";
  const ways = new Map<string, number>([[startId, 1]]);
  for (let li = 0; li < last; li += 1) {
    for (const node of map.layers[li]!.nodes) {
      const n = ways.get(node.id) ?? 0;
      if (n === 0) continue;
      for (const t of out.get(node.id) ?? []) ways.set(t, Math.min(99999, (ways.get(t) ?? 0) + n));
    }
  }
  const paths = ways.get(bossId) ?? 0;
  if (paths < 8) issues.push(`可行路径 ${paths} 条（应 ≥8）`);
  // 走廊保证（修订 3）
  const safePath = findSafePath(out, kindOf, startId, bossId);
  const greedyPath = findGreedyPath(map, out, kindOf, startId, bossId);
  if (safePath.length === 0) issues.push("缺少安全走廊（精英 ≤1 且篝火 ≥1 的 start→Boss 路径）");
  if (greedyPath.length === 0) issues.push("缺少贪婪走廊（精英 ≥2 的 start→Boss 路径）");
  return { nodes: layerOf.size, forks, merges, paths, elites, rests, safePath, greedyPath, issues };
}

/** 整图校验的简写：空数组 = 合格（validator 与单测的常驻检查）。 */
export function checkMapGraph(map: GeneratedMap): string[] {
  return [...analyzeMapGraph(map).issues];
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
    // 不放回池按「幕」重置（docs/54 E7）
    seenEvents: [],
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
    seenEvents: [],
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
  // docs/56 §四.1：每个槽位独立掷——70% 职业池 / 30% 中立池（中立池全职业共享）
  const usable = [...content.cards.values()].filter(
    (c) =>
      c.rarity !== "starter" &&
      c.type !== "curse" &&
      c.type !== "status" &&
      // 解锁式内容未解锁不入池（docs/36 T1）
      isContentAvailable(c.unlockCondition, c.id, run.unlocked),
  );
  const classIds = usable.filter((c) => c.class === run.classId).map((c) => c.id).sort();
  const neutralIds = usable.filter((c) => c.class === NEUTRAL_CLASS).map((c) => c.id).sort();
  const rng = new Rng((run.seed ^ Math.imul(nodeIndex + 1, 0x9e3779b9)) >>> 0).stream("reward");
  const picks: string[] = [];
  while (picks.length < count) {
    // 本槽已选中的牌不再出现，所以池子按槽现算
    const pool = pickPoolSide(
      rng,
      classIds.filter((id) => !picks.includes(id)),
      neutralIds.filter((id) => !picks.includes(id)),
    );
    if (pool.length === 0) break;
    picks.push(pool[rng.nextInt(0, pool.length - 1)]!);
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
 *
 * docs/54 E7：**同幕不放回**——把本幕已经抽过的事件剔出池子；池尽则重置（回到全池），
 * 保证「一局两幕不连撞同一个事件」而不是「一局不重复」。写死的 node.event 不受影响。
 */
export function rollEvent(content: ContentDb, run: RunState, node: MapNode): EventDefinition | undefined {
  if (node.event) return content.events.get(node.event);
  const full = node.events && node.events.length > 0 ? [...node.events] : [...content.events.keys()].sort();
  if (full.length === 0) return undefined;
  const seen = run.seenEvents ?? [];
  // 本层已经抽过 → 原样返回，节点与故事的对应关系一旦确定就不再变
  const recorded = seen.find((s) => s.layer === run.layerIndex);
  if (recorded) return content.events.get(recorded.eventId);
  const used = seen.map((s) => s.eventId);
  const unseen = full.filter((id) => !used.includes(id));
  const ids = unseen.length > 0 ? unseen : full;
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