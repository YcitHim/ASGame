import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb } from "@/core/registry";
import { loadGameContent } from "@/data/load";

/**
 * docs/29 §一② 格挡收益卡 + 新触发器 onBlock：
 *  - 动能电池：获得格挡 → +1 充能；
 *  - 炉渣装甲：获得格挡 → 对全体敌人造成 1（升级 2）点伤害。
 */

const game = loadGameContent();

const content = createContentDb({
  cards: game.content.cards,
  enhancements: game.content.enhancements,
  relics: new Map(),
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
});

function battle(deck: (string | { cardId: string; upgraded?: boolean })[]): BattleState {
  return reduce(
    createBattleState({
      battleId: "onblock",
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
  events.filter((e): e is { type: string; value: number } => e.type === "DamageDealt").map((e) => e.value);

describe("docs/29 §一② onBlock 格挡收益卡", () => {
  it("动能电池：打出后本场生效，每次获得格挡 +1 充能", () => {
    const first = play(battle(["kineticcell", "defend", "defend"]), "kineticcell");
    expect(first.state.player.powers.length).toBe(1);
    expect(first.state.player.charge).toBe(0);

    const b1 = play(first.state, "defend");
    expect(b1.state.player.block).toBe(5);
    expect(b1.state.player.charge).toBe(1);

    const b2 = play(b1.state, "defend");
    expect(b2.state.player.charge).toBe(2);
  });

  it("炉渣装甲：获得格挡时对全体敌人造成 1 点伤害", () => {
    const armed = play(battle(["slagarmor", "defend"]), "slagarmor");
    const r = play(armed.state, "defend");
    expect(dealt(r.events)).toEqual([1]);
    expect(r.state.enemies[0].hp).toBe(199);
  });

  it("炉渣装甲升级版：伤害 1 → 2", () => {
    const armed = play(battle([{ cardId: "slagarmor", upgraded: true }, "defend"]), "slagarmor");
    const r = play(armed.state, "defend");
    expect(dealt(r.events)).toEqual([2]);
  });

  it("未打出的能力不触发（对照）", () => {
    const r = play(battle(["defend"]), "defend");
    expect(r.state.player.charge).toBe(0);
    expect(dealt(r.events)).toEqual([]);
  });
});
