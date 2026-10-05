import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb, type CardDefinition } from "@/core/registry";
import { loadGameContent } from "@/data/load";

/**
 * docs/27 §二 副线卡 ×5 + 两处新机制：
 * - 新效果 `spendCharge`（泄能重锤）
 * - 新条件 `pollutionAtLeast`（蚀心之刃）
 */

const game = loadGameContent();

/** 测试辅助卡：一次性攒 8 充能（充能无 debug 指令） */
const CHARGE8: CardDefinition = {
  id: "charge8",
  class: "bloodwright",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "gainCharge", value: 8 }],
};

const content = createContentDb({
  cards: new Map([...game.content.cards, ["charge8", CHARGE8]]),
  enemies: new Map([
    [
      "dummy",
      {
        id: "dummy",
        name: "Dummy",
        maxHp: 200,
        intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
      },
    ],
  ]),
  enhancements: game.content.enhancements,
  relics: new Map(),
});

function battle(deck: string[]): BattleState {
  return reduce(
    createBattleState({
      battleId: "p4",
      seed: 5,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: "dummy" }],
      deck,
      content,
    }),
    { type: "Noop", actionId: "s" },
  ).state;
}

function play(state: BattleState, cardId: string) {
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
  return reduce(state, { type: "PlayCard", actionId: "p", handIndex: index, targetId: "dummy" });
}

const dealt = (events: readonly { type: string }[]) =>
  events
    .filter((e): e is { type: string; value: number } => e.type === "DamageDealt")
    .map((e) => e.value);

describe("P4.1 副线卡", () => {
  it("火芯刺：4 伤 + 2 充能", () => {
    const r = play(battle(["sparkjab"]), "sparkjab");
    expect(dealt(r.events)).toEqual([4]);
    expect(r.state.player.charge).toBe(2);
  });

  it("泄能重锤：先吃充能固定加伤，再按每点 +2 消耗清零", () => {
    const first = play(battle(["sparkjab", "discharge"]), "sparkjab");
    expect(first.state.player.charge).toBe(2);
    const r = play(first.state, "discharge");
    // 基础 8 + 固定充能 2 = 10；再消耗 2 点充能 ×2 = 4
    expect(dealt(r.events)).toEqual([10, 4]);
    expect(r.state.player.charge).toBe(0);
  });

  it("红线运转：充能 ≥8 时抽牌（打出前判定），<8 时不抽", () => {
    const charged = play(battle(["charge8", "redline"]), "charge8");
    expect(charged.state.player.charge).toBe(8);
    const high = play(charged.state, "redline");
    expect(high.state.player.charge).toBe(0); // 8+4=12 > 10 → 过载反噬并清零
    expect(high.events.some((e) => e.type === "Overloaded")).toBe(true);
    expect(high.events.filter((e) => e.type === "CardsDrawn").length).toBeGreaterThanOrEqual(1);

    const low = play(battle(["redline"]), "redline");
    expect(low.state.player.charge).toBe(4);
    expect(dealt(low.events)).toEqual([]);
  });

  it("污血献祭：污染 +12 并抽 2 张", () => {
    const r = play(battle(["blightoffering"]), "blightoffering");
    expect(r.state.player.pollution).toBe(12);
    expect(r.events.filter((e) => e.type === "CardsDrawn").length).toBeGreaterThanOrEqual(1);
  });

  it("蚀心之刃：污染 <50 打 7，≥50 打 14（新条件 pollutionAtLeast）", () => {
    const low = play(battle(["corrodededge"]), "corrodededge");
    expect(dealt(low.events)).toEqual([7]);

    const dirty = reduce(battle(["corrodededge"]), {
      type: "DebugCommand",
      actionId: "d",
      command: "add buff pollution 50",
    }).state;
    const high = play(dirty, "corrodededge");
    expect(dealt(high.events)).toEqual([14]);
  });
});
