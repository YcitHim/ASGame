import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb } from "@/core/registry";
import { createRunState, rollEncounter } from "@/core/map";
import { loadGameContent } from "@/data/load";

/**
 * docs/29 §一③ 遭遇池：同名敌人多实例支持 + 同种子同遭遇。
 * 背景：曾因同 id 敌人 findUnit 命中第一个，导致「猎犬 × 2」永远打不到第二只（0% 胜率）。
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
        maxHp: 10,
        intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
      },
    ],
  ]),
});

function battle(enemyIds: string[]): BattleState {
  return reduce(
    createBattleState({
      battleId: "enc",
      seed: 7,
      player: { maxHp: 66, energy: 3 },
      enemies: enemyIds.map((id) => ({ id })),
      deck: ["strike", "strike", "strike"],
      content,
    }),
    { type: "Noop", actionId: "s" },
  ).state;
}

describe("docs/29 §一③ 遭遇池", () => {
  it("同名敌人获得唯一实例 id，且共享 defId", () => {
    const state = battle(["dummy", "dummy"]);
    expect(state.enemies.map((e) => e.id)).toEqual(["dummy", "dummy#2"]);
    expect(state.enemies.map((e) => e.defId)).toEqual(["dummy", "dummy"]);
  });

  it("指定目标能打到第二只同名敌人（回归：同 id 永远只能打第一只）", () => {
    const state = battle(["dummy", "dummy"]);
    const second = state.enemies[1].id;
    const index = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === "strike");
    const r = reduce(state, { type: "PlayCard", actionId: "p", handIndex: index, targetId: second });
    expect(r.state.enemies[0].hp).toBe(10);
    expect(r.state.enemies[1].hp).toBeLessThan(10);
  });

  it("rollEncounter：同种子同结果，且只产出候选组合", () => {
    const act = game.acts[0]!;
    const node = act.map[1]!; // n2 带 encounters
    const run = createRunState(act, 12345);
    const a = rollEncounter(run, node);
    const b = rollEncounter(run, node);
    expect(a).toEqual(b);
    const allowed = (node.encounters ?? []).map((e) => e.enemies.join("+"));
    expect(allowed).toContain(a.join("+"));
  });
});
