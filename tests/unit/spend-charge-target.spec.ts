// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { loadGameContent } from "@/data/load";

/**
 * 充能爆发的目标回归（2026-10-08 事故）：
 * 「炉心过载 / 锅炉怒吼」的 spendCharge 段曾漏写 target，引擎对非 damage 效果
 * 缺省 target=self —— 消耗充能的爆发全部打在玩家自己身上（充能越高自残越狠）。
 * 数据侧已补 target: chosenEnemy；本 spec 钉死「爆发只打敌人、绝不打自己」。
 */
const game = loadGameContent();

function battle(deck: string[], enemies: string[] = ["rust_hound"]): BattleState {
  return createBattleState({
    battleId: "spend-charge-target",
    seed: 4,
    player: { maxHp: 66, energy: 6, hp: 60, pollution: 0 },
    enemies: enemies.map((id) => ({ id })),
    deck,
    handSize: 5,
    relics: [],
    content: game.content,
  });
}

function handIndexOf(state: BattleState, cardId: string): number {
  return state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
}

function play(state: BattleState, cardId: string, targetId?: string) {
  const index = handIndexOf(state, cardId);
  expect(index).toBeGreaterThanOrEqual(0);
  return reduce(state, { type: "PlayCard", actionId: `play-${cardId}-${index}`, handIndex: index, targetId });
}

describe("充能爆发的目标（spendCharge target）", () => {
  it("炉心过载：爆发打在敌人身上，玩家一滴血不掉，充能清零", () => {
    let state = battle(["chargeup", "chargeup", "coreoverload", "defend", "defend"]);
    state = reduce(state, { type: "Noop", actionId: "s" }).state;
    state = play(state, "chargeup").state;
    state = play(state, "chargeup").state;
    expect(state.player.charge).toBe(6);

    const result = play(state, "coreoverload");
    state = result.state;
    const enemyId = state.enemies[0].id;
    // 爆发 = 6 充能 × 3 = 18 点固定伤害，全部落在敌人身上
    const burst = result.events.filter((e) => e.type === "DamageDealt" && e.targetId === enemyId);
    expect(burst.map((e) => e.type === "DamageDealt" && e.value)).toEqual([18]);
    // 玩家绝不成为伤害目标
    expect(result.events.some((e) => e.type === "DamageDealt" && e.targetId === "player")).toBe(false);
    expect(result.events.some((e) => e.type === "HpLost" && e.targetId === "player")).toBe(false);
    expect(state.player.hp).toBe(60);
    expect(state.player.charge).toBe(0);
  });

  it("锅炉怒吼：基础伤害与充能爆发都打同一个敌人", () => {
    let state = battle(["chargeup", "boilerrage", "defend", "defend", "defend"]);
    state = reduce(state, { type: "Noop", actionId: "s" }).state;
    state = play(state, "chargeup").state;
    expect(state.player.charge).toBe(3);

    const result = play(state, "boilerrage");
    state = result.state;
    const enemyId = state.enemies[0].id;
    const hits = result.events.filter((e) => e.type === "DamageDealt");
    // 两段（基础 6 + 爆发 3×2=6）都必须落在敌人身上
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const hit of hits) {
      if (hit.type === "DamageDealt") expect(hit.targetId).toBe(enemyId);
    }
    expect(state.player.hp).toBe(60);
    expect(state.player.charge).toBe(0);
  });

  it("多敌时炉心过载必须选目标（不选 = 打不出去）", () => {
    let state = battle(
      ["chargeup", "coreoverload", "defend", "defend", "defend"],
      ["rust_hound", "rust_hound"],
    );
    state = reduce(state, { type: "Noop", actionId: "s" }).state;
    state = play(state, "chargeup").state;

    const refused = play(state, "coreoverload");
    expect(refused.events.some((e) => e.type === "CardPlayed")).toBe(false);
    expect(refused.state.player.charge).toBe(3);

    const enemyId = refused.state.enemies[0].id;
    const accepted = play(refused.state, "coreoverload", enemyId);
    expect(accepted.events.some((e) => e.type === "CardPlayed")).toBe(true);
    expect(accepted.events.some((e) => e.type === "DamageDealt" && e.targetId === enemyId)).toBe(true);
    expect(accepted.state.player.hp).toBe(60);
  });
});
