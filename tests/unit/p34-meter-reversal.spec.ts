// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";

const game = loadGameContent();

/** 手牌 3 张（含电表倒转）；打出后手上剩 2 张会被全销毁。 */
function setup(upgraded: boolean) {
  let state = createBattleState({
    battleId: "t",
    seed: 5,
    player: { maxHp: 70, energy: 3 },
    enemies: [{ id: "rust_hound" }],
    deck: [
      "strike",
      "strike",
      upgraded ? { cardId: "meter_reversal", upgraded: true, enhancements: [] } : "meter_reversal",
    ],
    handSize: 3,
    content: game.content,
  });
  state = reduce(state, { type: "Noop", actionId: "s" }).state;
  return state;
}

function playMeter(upgraded: boolean) {
  const state = setup(upgraded);
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id]!.cardId === "meter_reversal");
  expect(index, "电表倒转应在手牌里").toBeGreaterThanOrEqual(0);
  return reduce(state, { type: "PlayCard", actionId: "p1", handIndex: index });
}

/** 甲方 2026-10-09 · 炉心新卡「电表倒转」。 */
describe("电表倒转", () => {
  it("打出后销毁手上全部牌，每张换 3 点充能", () => {
    const r = playMeter(false);
    expect(r.state.piles.hand).toHaveLength(0);
    // 打出的那张已离手，所以是「剩下的 2 张 × 3」
    expect(r.state.player.charge).toBe(6);
    expect(r.state.player.block).toBe(0);
  });

  it("升级版：每张再给 2 点格挡", () => {
    const r = playMeter(true);
    expect(r.state.piles.hand).toHaveLength(0);
    expect(r.state.player.charge).toBe(6);
    expect(r.state.player.block).toBe(4); // 2 张 × 2
  });

  it("销毁的牌进消耗堆（本场移出，战后归还）而不是弃牌堆", () => {
    const r = playMeter(false);
    expect(r.state.piles.exhaust.length).toBeGreaterThanOrEqual(2);
    expect(r.events.filter((e) => e.type === "CardDestroyed").length).toBe(2);
  });
});
