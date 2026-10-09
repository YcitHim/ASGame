import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleConfig, type BattleState } from "@/core/combat";
import { loadGameContent } from "@/data/load";
import { buffStacks } from "@/core/buffs";
import type { ActRule } from "@/core/registry/content";
import { loadNodeContent } from "../../tools/headless-sim/src/load";
import { runBattle } from "../../tools/headless-sim/src/sim";
import { testConfig } from "../helpers/combat";

/**
 * docs/66 §三.1 / §4.2 · 幕级战斗规则（甲方 2026-10-08）：
 *  - 溺亡挽歌（act2）：敌人死亡给玩家挂 1 层蚀锈；
 *  - 锻炉高温（act3）：第 N 回合起，玩家回合开始给双方各挂 1 层灼烧。
 *
 * 两条规则都走 `BattleConfig.actRules` 注入（不进存档），缺省 = 无幕规则（一幕行为不变）。
 */

const game = loadGameContent();

function startWith(rules: readonly ActRule[] | undefined, overrides: Partial<BattleConfig> = {}): BattleState {
  const config: BattleConfig = {
    ...testConfig(),
    ...(rules ? { actRules: rules } : {}),
    ...overrides,
  };
  return reduce(createBattleState(config), { type: "Noop", actionId: "start" }).state;
}

describe("docs/66 · 幕规则「溺亡挽歌」（act2）", () => {
  it("敌人死亡 → 玩家获得 1 层蚀锈", () => {
    const state = startWith([{ id: "mourning" }], { enemies: [{ id: "dummy" }, { id: "tank" }] });
    expect(buffStacks(state.player.buffs, "corroding")).toBe(0);
    const after = reduce(state, { type: "DebugCommand", actionId: "k", command: "kill dummy" }).state;
    expect(buffStacks(after.player.buffs, "corroding")).toBe(1);
  });

  it("多只敌人死亡 → 蚀锈逐次累加（AoE 全灭的代价）", () => {
    const state = startWith([{ id: "mourning" }], { enemies: [{ id: "dummy" }, { id: "tank" }] });
    const one = reduce(state, { type: "DebugCommand", actionId: "k1", command: "kill dummy" }).state;
    const two = reduce(one, { type: "DebugCommand", actionId: "k2", command: "kill tank" }).state;
    expect(buffStacks(two.player.buffs, "corroding")).toBe(2);
  });

  it("无幕规则 / 一幕行为：敌人死亡不给蚀锈", () => {
    const state = startWith(undefined, { enemies: [{ id: "dummy" }] });
    const after = reduce(state, { type: "DebugCommand", actionId: "k", command: "kill dummy" }).state;
    expect(buffStacks(after.player.buffs, "corroding")).toBe(0);
  });

  it("act2 的 actRules 里确实声明了 mourning", () => {
    const act2 = game.acts.find((a) => a.id === "act2");
    expect(act2?.rules?.some((r) => r.id === "mourning")).toBe(true);
  });
});

describe("docs/66 · 幕规则「锻炉高温」（act3）", () => {
  /** 把战斗推到第 n 回合（每次 EndTurn 推进一轮）。 */
  function toTurn(state: BattleState, n: number): BattleState {
    let s = state;
    while (s.turn < n && s.phase !== "battleEnd") {
      s = reduce(s, { type: "EndTurn", actionId: `end-${s.turn}` }).state;
    }
    return s;
  }

  it("起始回合前不灼烧，到第 5 回合双方各挂 1 层", () => {
    const rules: ActRule[] = [{ id: "forgeHeat" }];
    // 让玩家血厚、敌人耐打，撑到第 5 回合
    const state = startWith(rules, {
      player: { maxHp: 200, energy: 3 },
      enemies: [{ id: "dummy", maxHp: 500 }],
    });
    const turn4 = toTurn(state, 4);
    expect(buffStacks(turn4.player.buffs, "burn")).toBe(0);

    const turn5 = toTurn(turn4, 5);
    expect(buffStacks(turn5.player.buffs, "burn")).toBeGreaterThanOrEqual(1);
    const enemy = turn5.enemies.find((e) => e.hp > 0);
    expect(enemy && buffStacks(enemy.buffs, "burn")).toBeGreaterThanOrEqual(1);
  });

  it("params.fromTurn 覆盖起始回合（4 是调节阀）", () => {
    const rules: ActRule[] = [{ id: "forgeHeat", params: { fromTurn: 3 } }];
    const state = startWith(rules, {
      player: { maxHp: 200, energy: 3 },
      enemies: [{ id: "dummy", maxHp: 500 }],
    });
    const turn2 = toTurn(state, 2);
    expect(buffStacks(turn2.player.buffs, "burn")).toBe(0);
    const turn3 = toTurn(turn2, 3);
    expect(buffStacks(turn3.player.buffs, "burn")).toBeGreaterThanOrEqual(1);
  });

  it("无幕规则：打到第 6 回合也不灼烧", () => {
    const state = startWith(undefined, {
      player: { maxHp: 200, energy: 3 },
      enemies: [{ id: "dummy", maxHp: 500 }],
    });
    const late = toTurn(state, 6);
    expect(buffStacks(late.player.buffs, "burn")).toBe(0);
  });
});

/**
 * sim 层透传回归：`simulateRun` / `runBattle` 必须把当前幕的 `rules` 注入 BattleConfig，
 * 否则哨兵报表测不到幕规则（曾经漏传 → sim:2act 与改动前逐字节一致，掩盖了接线缺失）。
 */
describe("docs/66 · sim 层幕规则透传", () => {
  const { content, acts } = loadNodeContent();

  const base = {
    seed: 1,
    maxHp: 80,
    energy: 3,
    hp: 80,
    enemies: ["rust_mite"],
    deck: Array.from({ length: 20 }, () => ({ cardId: "strike", upgraded: false, enhancements: [] })),
    relics: [] as string[],
  };

  it("runBattle 带 act2 规则：杀敌后玩家挂蚀锈", () => {
    const act2 = acts.find((a) => a.id === "act2");
    expect(act2).toBeDefined();
    const out = runBattle(content, { ...base, battleId: "probe", actRules: act2?.rules ?? [] });
    expect(buffStacks(out.state.player.buffs, "corroding")).toBeGreaterThanOrEqual(1);
  });

  it("runBattle 不带规则：杀敌后玩家无蚀锈", () => {
    const out = runBattle(content, { ...base, battleId: "probe2", actRules: [] });
    expect(buffStacks(out.state.player.buffs, "corroding")).toBe(0);
  });
});
