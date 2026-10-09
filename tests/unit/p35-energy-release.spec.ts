// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";

const game = loadGameContent();

function setup(upgraded: boolean) {
  let state = createBattleState({
    battleId: "t",
    seed: 7,
    player: { maxHp: 70, energy: 3 },
    enemies: [{ id: "rust_hound" }],
    deck: [
      upgraded ? { cardId: "energy_release", upgraded: true, enhancements: [] } : "energy_release",
      "defend",
      "defend",
    ],
    handSize: 3,
    content: game.content,
  });
  state = reduce(state, { type: "Noop", actionId: "s" }).state;
  return state;
}

function playRelease(upgraded: boolean) {
  const state = setup(upgraded);
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id]!.cardId === "energy_release");
  expect(index, "能量释放应在手牌里").toBeGreaterThanOrEqual(0);
  const r = reduce(state, { type: "PlayCard", actionId: "p1", handIndex: index });
  expect(r.state.player.powers.length, "打出后应挂上本场能力").toBe(1);
  return r.state;
}

/** 甲方 2026-10-09 · 炉心新卡「能量释放」：本场每个回合开始 +1 充能，卡本身销毁。 */
describe("能量释放", () => {
  it("打出当回合不给充能；从**下一个**回合开始，每回合 +1", () => {
    let state = playRelease(false);
    expect(state.player.charge).toBe(0); // 打出当刻不给

    state = reduce(state, { type: "EndTurn", actionId: "e1" }).state;
    expect(state.player.charge).toBe(1); // 第二回合开始

    state = reduce(state, { type: "EndTurn", actionId: "e2" }).state;
    expect(state.player.charge).toBe(2); // 第三回合开始：是「每回合」不是「一次」
  });

  it("升级版每回合 +2", () => {
    let state = playRelease(true);
    state = reduce(state, { type: "EndTurn", actionId: "e1" }).state;
    expect(state.player.charge).toBe(2);
    state = reduce(state, { type: "EndTurn", actionId: "e2" }).state;
    expect(state.player.charge).toBe(4);
  });

  it("卡本身带「销毁」：打完进消耗堆，本场不再抽到", () => {
    const state = playRelease(false);
    const inst = state.piles.exhaust.find((id) => state.cardInstances[id]!.cardId === "energy_release");
    expect(inst, "应进消耗堆").toBeTruthy();
    expect(state.piles.hand.some((id) => state.cardInstances[id]!.cardId === "energy_release")).toBe(false);
  });
});
