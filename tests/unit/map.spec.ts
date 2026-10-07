import { describe, expect, it } from "vitest";
import {
  advanceNode,
  chooseNode,
  createRunState,
  currentLayer,
  currentNode,
  generateActMap,
  healRun,
  isCombatNode,
  isRunComplete,
  mapView,
  rollCardRewards,
  rollEnhancementChoices,
  setRunHp,
} from "@/core/map";
import { loadGameContent } from "@/data/load";

const game = loadGameContent();
const act = game.acts[0];
const cls = game.content.classes.get("bloodwright")!;

describe("S5.1 分支地图（core/map）", () => {
  it("createRunState：满血开局、层 0、未选、无已清记录", () => {
    const run = createRunState(act, cls, 42);
    expect(run.hp).toBe(cls.player.maxHp);
    expect(run.layerIndex).toBe(0);
    expect(run.picked).toEqual([]);
    expect(run.cleared).toEqual([]);
  });

  it("分支层：未选时没有 currentNode，chooseNode 后可进入，advance 记录已清", () => {
    let run = createRunState(act, cls, 1);
    // l0 是 width=1 的必经战斗：无需选择自动生效
    expect(currentNode(run, act)?.kind).toBe("battle");
    run = advanceNode(run, act);
    expect(run.layerIndex).toBe(1);
    expect(run.cleared).toHaveLength(1);
    // l1 是分支层（列差 ≤1 的菱形收敛后为 2）：未选时没有 currentNode
    const layer = currentLayer(run, act);
    expect(layer!.nodes.length).toBeGreaterThanOrEqual(2);
    expect(currentNode(run, act)).toBeUndefined();
    run = chooseNode(run, act, 1);
    expect(currentNode(run, act)?.id).toBe(layer!.nodes[1].id);
  });

  it("chooseNode 拒绝越界；advanceNode 全程走完可通关", () => {
    let run = createRunState(act, cls, 7);
    const same = chooseNode(run, act, 99);
    expect(same).toBe(run);
    for (let i = 0; i < act.layers.length; i += 1) {
      expect(isRunComplete(run, act)).toBe(false);
      run = chooseNode(run, act, 0);
      run = advanceNode(run, act);
    }
    expect(isRunComplete(run, act)).toBe(true);
    expect(run.cleared).toHaveLength(act.layers.length);
  });

  it("树状结构：起点/祭坛/Boss 单节点，中间层 2~4 个，且同层精英≤1、篝火≤1", () => {
    const layers = generateActMap(act, 99);
    expect(layers[0].nodes).toHaveLength(1); // 起点
    expect(layers[6].nodes).toHaveLength(1); // 祭坛
    expect(layers[7].nodes).toHaveLength(1); // Boss
    for (const idx of [1, 2, 3, 4, 5]) {
      const nodes = layers[idx].nodes;
      expect(nodes.length).toBeGreaterThanOrEqual(2);
      expect(nodes.length).toBeLessThanOrEqual(4);
      expect(nodes.filter((n) => n.kind === "elite").length).toBeLessThanOrEqual(1);
      expect(nodes.filter((n) => n.kind === "rest").length).toBeLessThanOrEqual(1);
    }
  });

  it("边表：只连相邻层、无交叉、全连通（docs/48 §3.1）", async () => {
    const { generateMapGraph } = await import("@/core/map");
    const map = generateMapGraph(act, 99);
    const layerOf = new Map<string, number>();
    map.layers.forEach((l, i) => l.nodes.forEach((n) => layerOf.set(n.id, i)));
    for (const e of map.edges) {
      expect(layerOf.get(e.to)! - layerOf.get(e.from)!).toBe(1);
    }
    // 除起点外每节点 ≥1 入边；除 Boss 外每节点 ≥1 出边
    const ids = map.layers.flatMap((l) => l.nodes.map((n) => n.id));
    const hasIn = new Set(map.edges.map((e) => e.to));
    const hasOut = new Set(map.edges.map((e) => e.from));
    for (const [i, layer] of map.layers.entries()) {
      for (const n of layer.nodes) {
        if (i > 0) expect(hasIn.has(n.id)).toBe(true);
        if (i < map.layers.length - 1) expect(hasOut.has(n.id)).toBe(true);
      }
    }
    expect(ids.length).toBeGreaterThan(0);
  });

  it("连通性常驻检查：任意种子的生成图都必须是合格 DAG（docs/48 §3.3）", async () => {
    const { checkMapGraph, generateMapGraph } = await import("@/core/map");
    for (const a of game.acts) {
      for (let seed = 0; seed < 512; seed += 1) {
        const map = generateMapGraph(a, seed);
        const issues = checkMapGraph(map);
        expect(issues, `${a.id} seed ${seed}: ${issues.join("；")}`).toEqual([]);
      }
    }
  });


  it("mapView / currentNode / isCombatNode", () => {
    let run = createRunState(act, cls, 1);
    run = chooseNode(run, act, 0);
    const view = mapView(run, act);
    expect(view.layers).toHaveLength(8);
    expect(view.current?.kind).toBe("battle");
    expect(isCombatNode(currentNode(run, act))).toBe(true);
    // 精英层（l3）
    const eliteRun = { ...run, layerIndex: 3, picked: [0, 0, 0, 0] };
    expect(isCombatNode(currentNode(eliteRun, act))).toBe(true);
    expect(currentNode(eliteRun, act)?.kind).toBe("elite");
    // 精英后汇合点（l4）是休息
    const restRun = { ...run, layerIndex: 4, picked: [0, 0, 0, 0, 0] };
    expect(isCombatNode(currentNode(restRun, act))).toBe(false);
    expect(currentNode(restRun, act)?.kind).toBe("rest");
  });

  it("局外 HP：写回与休息回复（不超上限）", () => {
    let run = createRunState(act, cls, 1);
    run = setRunHp(run, 30);
    expect(run.hp).toBe(30);
    run = healRun(run, cls.player.maxHp, 100);
    expect(run.hp).toBe(cls.player.maxHp);
    run = setRunHp(run, -5);
    expect(run.hp).toBe(0);
  });
});

describe("S5.1 奖励抽取（reward 流，可复现）", () => {
  it("卡奖三选一：同种子同节点结果一致，排除 starter / 诅咒 / 状态", () => {
    const run = createRunState(act, cls, 123);
    const a = rollCardRewards(game.content, act, run, 0);
    const b = rollCardRewards(game.content, act, run, 0);
    expect(a).toHaveLength(3);
    expect(a).toEqual(b);
    expect(new Set(a).size).toBe(3);
    for (const id of a) {
      const def = game.content.cards.get(id);
      expect(def?.rarity).not.toBe("starter");
      expect(def?.type).not.toBe("curse");
    }
  });

  it("不同节点抽到的奖励不同（种子随节点偏移）", () => {
    const run = createRunState(act, cls, 123);
    expect(rollCardRewards(game.content, act, run, 0)).not.toEqual(rollCardRewards(game.content, act, run, 1));
  });

  it("强化三选一：同种子同结果", () => {
    const run = createRunState(act, cls, 9);
    const a = rollEnhancementChoices(game.content, run, 3);
    const b = rollEnhancementChoices(game.content, run, 3);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(a.length).toBeGreaterThan(0);
  });
});
