// @vitest-environment jsdom
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { relicPool, rollRelicChoices } from "@/core/map";
import { createContentDb } from "@/core/registry";
import { loadGameContent } from "@/data/load";
import { useRunStore } from "@/stores/run";
import { SCHEMA_VERSION, migrate } from "@/systems/save";
import { TEST_CARDS, TEST_ENEMIES } from "../helpers/combat";

/** docs/38 §一 · 1.0-A 遗物分级 / 随身遗物 / 掉落池。 */

const game = loadGameContent();
const dataRelics = game.content.relics;

function contentWith(relicIds: readonly string[]) {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    enemies: new Map(TEST_ENEMIES.map((e) => [e.id, e])),
    enhancements: new Map(),
    relics: new Map(relicIds.map((id) => [id, dataRelics.get(id)!])),
  });
}

function battle(relicIds: readonly string[], opts: { pollution?: number; enemies?: string[] } = {}) {
  const content = contentWith(relicIds);
  return reduce(
    createBattleState({
      battleId: "t",
      seed: 11,
      player: { maxHp: 66, energy: 3, ...(opts.pollution !== undefined ? { pollution: opts.pollution } : {}) },
      enemies: (opts.enemies ?? ["dummy"]).map((id) => ({ id })),
      deck: ["strike", "strike", "strike", "strike", "strike"],
      handSize: 5,
      relics: [...relicIds],
      content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

describe("1.0-A 遗物分级与掉落池", () => {
  it("T1/T2/T3 池规模与身份件隔离", () => {
    expect(relicPool(game.content, 1)).toHaveLength(8);
    expect(relicPool(game.content, 2)).toHaveLength(9);
    // T3 共 5 件，其中 2 件带解锁条件（炉心余烬 / 朝圣者之铃），未解锁时不入池
    expect(relicPool(game.content, 3)).toHaveLength(3);
    expect(relicPool(game.content, 3, ["ember_core", "pilgrim_bell"])).toHaveLength(5);
    const all = [...relicPool(game.content, 1), ...relicPool(game.content, 2), ...relicPool(game.content, 3)];
    expect(all).not.toContain("broken_oil");
    expect(all).not.toContain("dentedcoil");
  });

  it("rollRelicChoices 按 tier 过滤：精英只出 T2、Boss 只出 T3", () => {
    const t2 = rollRelicChoices(game.content, [], 9, [], [2]);
    expect(t2.every((id) => dataRelics.get(id)?.tier === 2)).toBe(true);
    const t3 = rollRelicChoices(game.content, [], 5, [], [3]);
    expect(t3.every((id) => dataRelics.get(id)?.tier === 3)).toBe(true);
    expect(t3).not.toContain("blood_pump");
  });

  it("解锁式 T3 未解锁不入池", () => {
    expect(rollRelicChoices(game.content, [], 5, [], [3])).not.toContain("ember_core");
    expect(rollRelicChoices(game.content, [], 5, ["ember_core"], [3])).toContain("ember_core");
  });
});

describe("1.0-A 随身遗物（首胜后发放，甲方 2026-10-07）", () => {
  it("开局不再预带；第一场胜利前 companionDue 为真，可出 T1 三选一", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    run.startRun("bloodwright", 7);
    expect(run.run?.pickedRelic).toBe("");
    expect(run.relics).toEqual(["broken_oil"]);
    expect(run.companionDue).toBe(true);
    expect(run.companionRelicChoices()).toHaveLength(3);
    const first = run.companionRelicChoices()[0]!;
    run.takeCompanionRelic(first);
    expect(run.run?.pickedRelic).toBe(first);
    expect(run.relics).toContain(first);
    // 一局只发一次
    expect(run.companionDue).toBe(false);
    expect(run.companionRelicChoices()).toEqual([]);
  });

  it("显式传入仍直接带上（测试 / 开发定点验证）；不在 T1 池的传参不带", () => {
    window.localStorage.clear();
    setActivePinia(createPinia());
    const run = useRunStore();
    run.startRun("engineer", 7, "normal", "rust_dowsing");
    expect(run.run?.pickedRelic).toBe("rust_dowsing");
    expect(run.relics).toEqual(["dentedcoil", "rust_dowsing"]);
    run.startRun("engineer", 7, "normal", "broken_oil");
    expect(run.run?.pickedRelic).toBe("");
    expect(run.relics).toEqual(["dentedcoil"]);
  });
});

describe("1.0-A 新遗物效果（真实数据）", () => {
  it("回声号角：开战全体敌人 1 层胆怯（docs/46 §2.2，层级型）", () => {
    const state = battle(["echo_horn"], { enemies: ["rust_hound", "corroded_swarm"] });
    for (const e of state.enemies) {
      const timid = e.buffs.find((b) => b.id === "timid");
      expect(timid?.stacks).toBe(1);
      expect(timid?.duration).toBeNull();
    }
  });

  it("第三捧灰：本回合未受伤时回合结束获得 2 格挡（撑过敌方回合，下回合开始清零）", () => {
    const started = battle(["third_ash"]);
    const result = reduce(started, { type: "EndTurn", actionId: "e" });
    const gained = result.events.filter((e) => e.type === "BlockGained" && e.targetId === "player");
    expect(gained.some((e) => e.type === "BlockGained" && e.value === 2)).toBe(true);
  });

  it("圣油灯：污染 ≥50 时回合结束 −5 污染", () => {
    const started = battle(["saint_bulb"], { pollution: 60 });
    const after = reduce(started, { type: "EndTurn", actionId: "e" }).state;
    expect(after.player.pollution).toBe(55);
  });

  it("毒压表：污染 ≥80 时回合开始获得 2 层力量（docs/52 §四：第 1 回合开始就生效）", () => {
    const started = battle(["venom_gage"], { pollution: 80 });
    expect(started.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(2);
    // 第 2 回合再叠 2 层
    const turn2 = reduce(started, { type: "EndTurn", actionId: "e" }).state;
    expect(turn2.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(4);
    const low = reduce(battle(["venom_gage"], { pollution: 40 }), { type: "EndTurn", actionId: "e" }).state;
    expect(low.player.buffs.find((b) => b.id === "strength")).toBeUndefined();
  });
});

describe("1.0-A 存档 v6 → v7", () => {
  it("v6 进度档已不再回填 pickedRelic——整档在 12→13 作废（docs/48 §六）", () => {
    const bw = migrate({ version: 6, data: { run: { classId: "bloodwright", layerIndex: 1 }, deck: [] } });
    expect(bw?.version).toBe(SCHEMA_VERSION);
    expect(bw?.data).toBeNull();
    const en = migrate({ version: 6, data: { run: { classId: "engineer", layerIndex: 1 }, deck: [] } });
    expect(en?.data).toBeNull();
  });
});
