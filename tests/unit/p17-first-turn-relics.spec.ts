import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { buffStacks } from "@/core/buffs";
import { loadGameContent } from "@/data/load";

/**
 * docs/52 §四（P0）：『回合开始时触发』的遗物在**第 1 回合**也该生效。
 *
 * 病灶：startBattle 只派发了 onBattleStart，turnStart 触发链只在 endTurn 里调 ——
 * 玩家要到第 2 回合才吃得到「每回合开始给 N 格挡」。这里逐件钉住首回合。
 */
const game = loadGameContent();

function start(relicId: string, pollution = 0) {
  return reduce(
    createBattleState({
      battleId: "firstturn",
      seed: 11,
      player: { maxHp: 66, energy: 3, pollution },
      enemies: [{ id: "rust_hound" }],
      deck: ["strike", "strike", "strike", "defend", "defend"],
      handSize: 5,
      relics: [relicId],
      content: game.content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

describe("docs/52 §四 · 回合开始遗物在首回合就生效", () => {
  it("红泪戒指：第 1 回合就获得 3 点格挡（修复前为 0）", () => {
    expect(start("redtear_ring").player.block).toBe(3);
  });

  it("锈蚀护符：第 1 回合就获得 1 层力量", () => {
    expect(buffStacks(start("rust_charm").player.buffs, "strength")).toBe(1);
  });

  it("唱诗班电池：第 1 回合就获得 1 点充能与 1 层力量", () => {
    const state = start("choir_battery");
    expect(state.player.charge).toBe(1);
    expect(buffStacks(state.player.buffs, "strength")).toBe(1);
  });

  it("锈念珠：污染 ≥50 时第 1 回合就获得 2 点格挡", () => {
    expect(start("rust_rosary", 50).player.block).toBe(2);
    // 条件不满足时不出手（不是「只要带了就给」）
    expect(start("rust_rosary", 49).player.block).toBe(0);
  });

  it("毒压表：污染 ≥80 时第 1 回合就获得 2 层力量", () => {
    expect(buffStacks(start("venom_gage", 80).player.buffs, "strength")).toBe(2);
    expect(buffStacks(start("venom_gage", 79).player.buffs, "strength")).toBe(0);
  });

  it("首回合触发不会把 once:'turn' 吃掉——第 2 回合照样触发", () => {
    const turn2 = reduce(start("redtear_ring"), { type: "EndTurn", actionId: "e" }).state;
    expect(turn2.player.block).toBe(3);
  });
});
