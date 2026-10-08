import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { createContentDb, type CardDefinition } from "@/core/registry";
import { loadGameContent } from "@/data/load";

/**
 * docs/29 §二⑥ 炉心机士 24 张卡：多段 / 蓄压 / spendCharge 三种口径 + onGainCharge 触发。
 */

const game = loadGameContent();

const CHARGE4: CardDefinition = {
  id: "charge4",
  class: "engineer",
  type: "skill",
  rarity: "common",
  cost: 0,
  effects: [{ kind: "gainCharge", value: 4 }],
};

const content = createContentDb({
  cards: new Map([...game.content.cards, ["charge4", CHARGE4]]),
  enhancements: game.content.enhancements,
  relics: game.content.relics,
  classes: game.content.classes,
  enemies: new Map([
    [
      "dummy",
      {
        id: "dummy",
        name: "Dummy",
        maxHp: 500,
        intents: [{ intent: { kind: "attack", value: 1 }, weight: 1 }],
      },
    ],
  ]),
});

function battle(deck: string[], relics: string[] = []): BattleState {
  return reduce(
    createBattleState({
      battleId: "eng",
      seed: 5,
      player: { maxHp: 66, energy: 9 },
      enemies: [{ id: "dummy" }],
      deck,
      relics,
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

describe("docs/29 §二⑥ 炉心机士卡牌", () => {
  it("活塞冲拳：基础 3；充能 ≥2 时追加 2", () => {
    expect(dealt(play(battle(["pistonjab"]), "pistonjab").events)).toEqual([3]);
    const charged = play(battle(["charge4", "pistonjab"]), "charge4");
    expect(charged.state.player.charge).toBe(4);
    // 充能按固定加伤计入每一次攻击判定（docs/20 §3.1）：3+4 / 2+4
    expect(dealt(play(charged.state, "pistonjab").events)).toEqual([7, 6]);
  });

  it("蒸汽弹：多段 3×2（docs/32 第三刀①）", () => {
    expect(dealt(play(battle(["steambolt"]), "steambolt").events)).toEqual([3, 3]);
  });

  it("泄压阀：消耗全部充能，每点 2 格挡（spendCharge mode=block）", () => {
    const charged = play(battle(["charge4", "pressurevalve"]), "charge4");
    const r = play(charged.state, "pressurevalve");
    expect(r.state.player.block).toBe(8);
    expect(r.state.player.charge).toBe(0);
  });

  it("紧急泄压：消耗全部充能，每点抽 1 张（spendCharge mode=draw）", () => {
    const charged = play(battle(["charge4", "emergencyvent", "sparkplug", "sparkplug", "sparkplug"]), "charge4");
    const before = charged.state.piles.hand.length;
    const r = reduce(charged.state, { type: "PlayCard", actionId: "p", handIndex: charged.state.piles.hand.findIndex((id) => charged.state.cardInstances[id].cardId === "emergencyvent") });
    expect(r.state.piles.hand.length).toBeGreaterThan(before - 1);
    expect(r.state.player.charge).toBe(0);
  });

  it("炉心过载：每点充能 3 伤害", () => {
    const charged = play(battle(["charge4", "coreoverload"]), "charge4");
    expect(dealt(play(charged.state, "coreoverload").events)).toEqual([12]);
  });

  it("压力表（docs/64 挪池 T2 并加强）：战斗开始时 +3 充能，clamp 彻底移除（docs/45 Q5 原裁 / docs/49 §3.1）", () => {
    const s = battle(["charge4", "charge4"], ["pressuregauge"]);
    expect(s.player.charge).toBe(3);
    const after = play(s, "charge4").state;
    expect(after.player.charge).toBe(7);
    // 旧 clamp 行为必须彻底消失：回合开始不再把充能压回 5
    const next = reduce(after, { type: "EndTurn", actionId: "e" }).state;
    expect(next.player.charge).toBe(7);
  });

  it("减重可作用于炉心攻击牌（活塞冲拳）", () => {
    const def = game.content.enhancements.get("lighten");
    expect(def?.appliesTo).toContain("pistonjab");
    expect(def?.appliesTo).toContain("coreoverload");
  });

  it("飞升齿轮（onGainCharge）：获得充能时额外 +1，且不自触发死循环", () => {
    const armed = play(battle(["ascensiongear", "charge4", "gearspin"]), "ascensiongear");
    expect(armed.state.player.powers).toHaveLength(1);
    const gain = play(armed.state, "charge4");
    // 4 基础 + 1 额外
    expect(gain.state.player.charge).toBe(5);
    const gain2 = play(gain.state, "gearspin");
    // 1 基础（docs/32 第二刀）+ 1 额外
    expect(gain2.state.player.charge).toBe(7);
  });
});
