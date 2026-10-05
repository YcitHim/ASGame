import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb, type RelicDefinition } from "@/core/registry";
import { TEST_CARDS, TEST_ENEMIES } from "../helpers/combat";

const RELICS: RelicDefinition[] = [
  { id: "oil", i18n: "relic.oil", timing: "onBattleStart", once: "battle", effects: [{ kind: "applyBuff", target: { type: "self" }, buff: "strength", stacks: 2 }] },
  { id: "pump", i18n: "relic.pump", timing: "onSell", effects: [{ kind: "heal", target: { type: "self" }, value: 2 }] },
  { id: "ring", i18n: "relic.ring", timing: "onTurnStart", once: "turn", effects: [{ kind: "block", target: { type: "self" }, value: 3 }] },
  { id: "charm", i18n: "relic.charm", timing: "onTurnEnd", once: "turn", effects: [{ kind: "applyBuff", target: { type: "self" }, buff: "strength", stacks: 1 }] },
];

const CONTENT = createContentDb({
  cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
  enemies: new Map(TEST_ENEMIES.map((e) => [e.id, e])),
  enhancements: new Map(),
  relics: new Map(RELICS.map((r) => [r.id, r])),
});

function battle(relics: string[], deck: string[] = ["strike", "strike", "strike", "strike", "strike"]): BattleState {
  return reduce(
    createBattleState({
      battleId: "t",
      seed: 5,
      player: { maxHp: 66, energy: 3 },
      enemies: [{ id: "dummy" }],
      deck,
      handSize: deck.length,
      relics,
      content: CONTENT,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

describe("S4.2 遗物触发", () => {
  it("onBattleStart（once battle）：开战获得力量，且不重复触发", () => {
    const started = battle(["oil"]);
    expect(started.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(2);
    const after = reduce(started, { type: "EndTurn", actionId: "e" }).state;
    expect(after.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(2);
  });

  it("onTurnStart（once turn）：每回合开始都触发", () => {
    const started = battle(["ring"]);
    const turn2 = reduce(started, { type: "EndTurn", actionId: "e" }).state;
    expect(turn2.player.block).toBe(3);
    const turn3 = reduce(turn2, { type: "EndTurn", actionId: "e2" }).state;
    expect(turn3.player.block).toBe(3);
  });

  it("onSell：卖血后触发（血泵心脏回血）", () => {
    const started = battle(["pump"], ["bloodbolt", "strike"]);
    const index = started.piles.hand.findIndex((id) => started.cardInstances[id].cardId === "bloodbolt");
    const result = reduce(started, { type: "PlayCard", actionId: "p", handIndex: index, targetId: "dummy" });
    // 卖 2 血后又回 2 血
    expect(result.state.player.hp).toBe(66);
    const healed = result.events.filter((e) => e.type === "HpHealed").filter((e) => e.type === "HpHealed");
    expect(healed.some((e) => e.value === 2)).toBe(true);
  });

  it("onTurnEnd：回合结束获得力量，逐回合累积", () => {
    const started = battle(["charm"]);
    const turn2 = reduce(started, { type: "EndTurn", actionId: "e" }).state;
    expect(turn2.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(1);
    const turn3 = reduce(turn2, { type: "EndTurn", actionId: "e2" }).state;
    expect(turn3.player.buffs.find((b) => b.id === "strength")?.stacks).toBe(2);
  });

  it("没有遗物时不影响战斗", () => {
    const started = battle([]);
    expect(started.player.buffs).toEqual([]);
    expect(started.player.relics).toEqual([]);
  });
});
