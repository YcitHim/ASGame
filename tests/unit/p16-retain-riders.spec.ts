import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";

/**
 * 甲方 2026-10-07：三职业各有一张「1 费 · 普通 · 技能 · 保留」的格挡牌，
 * 原本压簧与支撑一字不差 —— 现在每张挂一条本职业资源条件。
 * 这里验的是条件条**真的会结算**（JSON 断言在 data-load.spec）。
 */
const game = loadGameContent();

function start(cardId: string) {
  return reduce(
    createBattleState({
      battleId: "ridespec",
      seed: 7,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: "rust_hound" }],
      deck: [cardId, cardId, cardId, cardId, cardId],
      handSize: 5,
      content: game.content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: ReturnType<typeof start>) {
  return reduce(state, { type: "PlayCard", actionId: "p1", handIndex: 0 }).state;
}

describe("保留同位卡的本职业条件条", () => {
  it("支撑：HP ≥50% 只给 6 点；跌破 50% 再给 3 点", () => {
    expect(play(start("brace")).player.block).toBe(6);

    const low = start("brace");
    (low.player as { hp: number }).hp = 20; // 66 的 30%：失控线
    expect(play(low).player.block).toBe(9);
  });

  it("压簧：没有充能只给 6 点；充能 ≥3 再给 3 点", () => {
    const empty = start("coiled_spring");
    expect(empty.player.charge).toBe(0);
    expect(play(empty).player.block).toBe(6);

    const charged = start("coiled_spring");
    (charged.player as { charge: number }).charge = 3;
    expect(play(charged).player.block).toBe(9);
  });

  it("升级态同样带着条件条（9 点 + 条件 3 点）", () => {
    const up = reduce(
      createBattleState({
        battleId: "ridespec2",
        seed: 7,
        player: { maxHp: 66, energy: 3 },
        enemies: [{ id: "rust_hound" }],
        deck: [
          { cardId: "coiled_spring", upgraded: true },
          { cardId: "coiled_spring", upgraded: true },
          { cardId: "coiled_spring", upgraded: true },
          { cardId: "coiled_spring", upgraded: true },
          { cardId: "coiled_spring", upgraded: true },
        ],
        handSize: 5,
        content: game.content,
      }),
      { type: "Noop", actionId: "start" },
    ).state;
    expect(play(up).player.block).toBe(9);
    (up.player as { charge: number }).charge = 4;
    expect(play(up).player.block).toBe(12);
  });
});
