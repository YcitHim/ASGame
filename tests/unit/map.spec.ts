import { describe, expect, it } from "vitest";
import {
  advanceNode,
  createRunState,
  currentNode,
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

describe("S5.1 线性地图（core/map）", () => {
  it("createRunState：满血开局、节点 0、无已清记录", () => {
    const run = createRunState(act, 42);
    expect(run.hp).toBe(act.player.maxHp);
    expect(run.nodeIndex).toBe(0);
    expect(run.cleared).toEqual([]);
  });

  it("advanceNode：推进并记录已清；末尾变为通关", () => {
    let run = createRunState(act, 1);
    for (let i = 0; i < act.map.length; i += 1) {
      expect(isRunComplete(run, act)).toBe(false);
      run = advanceNode(run, act);
    }
    expect(isRunComplete(run, act)).toBe(true);
    expect(run.cleared).toEqual(act.map.map((n) => n.id));
  });

  it("mapView / currentNode / isCombatNode", () => {
    const run = createRunState(act, 1);
    const view = mapView(run, act);
    expect(view.current?.id).toBe("n1");
    expect(isCombatNode(currentNode(run, act))).toBe(true);
    const restRun = { ...run, nodeIndex: 4 };
    expect(isCombatNode(currentNode(restRun, act))).toBe(false);
    expect(currentNode(restRun, act)?.kind).toBe("rest");
  });

  it("局外 HP：写回与休息回复（不超上限）", () => {
    let run = createRunState(act, 1);
    run = setRunHp(run, 30);
    expect(run.hp).toBe(30);
    run = healRun(run, act.player.maxHp, 100);
    expect(run.hp).toBe(act.player.maxHp);
    run = setRunHp(run, -5);
    expect(run.hp).toBe(0);
  });
});

describe("S5.1 奖励抽取（reward 流，可复现）", () => {
  it("卡奖三选一：同种子同节点结果一致，排除 starter / 诅咒 / 状态", () => {
    const run = createRunState(act, 123);
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
    const run = createRunState(act, 123);
    expect(rollCardRewards(game.content, act, run, 0)).not.toEqual(rollCardRewards(game.content, act, run, 1));
  });

  it("强化三选一：同种子同结果", () => {
    const run = createRunState(act, 9);
    const a = rollEnhancementChoices(game.content, run, 3);
    const b = rollEnhancementChoices(game.content, run, 3);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(3);
    expect(a.length).toBeGreaterThan(0);
  });
});
