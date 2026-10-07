// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createBattleState, reduce } from "@/core/combat";
import { loadGameContent } from "@/data/load";

/**
 * 「调血」（transfusion）：先扣 5 血，下回合开始返回 7 血。
 * 走的是回血印记（mending）——玩家回合开始结算一次，随后印记消失。
 */
const game = loadGameContent();

/**
 * 造一场只放「调血」的简单战斗。
 * seed 4：锈犬第一回合是「防御」，本回合不会掉血——回血上限的用例需要这一点。
 */
function battle(hp: number) {
  return createBattleState({
    battleId: "transfusion",
    seed: 4,
    player: { maxHp: 66, energy: 3, hp, pollution: 0 },
    enemies: [{ id: "rust_hound" }],
    deck: ["transfusion", "defend", "defend", "defend", "defend"],
    handSize: 5,
    relics: [],
    content: game.content,
  });
}

/** 找出「调血」在手里的位置（起手会洗牌，不能假定在 0 号位）。 */
function transfusionIndex(state: ReturnType<typeof battle>): number {
  return state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === "transfusion");
}

describe("调血（transfusion）", () => {
  it("打出时立刻扣 5 血，不在本回合回血", () => {
    let state = reduce(battle(50), { type: "Noop", actionId: "s" }).state;
    const result = reduce(state, { type: "PlayCard", actionId: "p1", handIndex: transfusionIndex(state) });
    state = result.state;
    expect(state.player.hp).toBe(45);
    const healed = result.events.filter((e) => e.type === "HpHealed");
    expect(healed).toHaveLength(0);
    // 印记挂上去了
    expect(state.player.buffs.some((b) => b.id === "mending")).toBe(true);
  });

  it("下回合开始时回 7 血，印记随之消失", () => {
    let state = reduce(battle(50), { type: "Noop", actionId: "s" }).state;
    state = reduce(state, { type: "PlayCard", actionId: "p1", handIndex: transfusionIndex(state) }).state;
    const end = reduce(state, { type: "EndTurn", actionId: "e1" });
    state = end.state;
    // 回血发生在"下一个玩家回合开始"，也就是敌人行动之后（seed 4 的锈犬在防御，不打人）
    const damageAt = end.events.findIndex((e) => e.type === "DamageDealt");
    const healAt = end.events.findIndex((e) => e.type === "HpHealed");
    expect(healAt).toBeGreaterThanOrEqual(0);
    if (damageAt >= 0) expect(healAt).toBeGreaterThan(damageAt);
    expect(end.events.some((e) => e.type === "HpHealed" && e.value === 7)).toBe(true);
    expect(state.player.buffs.some((b) => b.id === "mending")).toBe(false);
  });

  it("回血不会超过上限（按缺口截断）", () => {
    // 66 → 打出后 61；这一回合锈犬在防御不打人，所以缺口就是 5，只回 5
    let state = reduce(battle(66), { type: "Noop", actionId: "s" }).state;
    state = reduce(state, { type: "PlayCard", actionId: "p1", handIndex: transfusionIndex(state) }).state;
    expect(state.player.hp).toBe(61);
    const end = reduce(state, { type: "EndTurn", actionId: "e1" });
    const healed = end.events.filter((e) => e.type === "HpHealed").map((e) => e.value);
    expect(healed).toEqual([5]);
    expect(end.state.player.hp).toBe(66);
  });

  it("血不够时打不出来（血契代价 5）", () => {
    let state = reduce(battle(5), { type: "Noop", actionId: "s" }).state;
    const result = reduce(state, { type: "PlayCard", actionId: "p1", handIndex: transfusionIndex(state) });
    state = result.state;
    expect(state.player.hp).toBe(5);
    expect(result.events.some((e) => e.type === "CardPlayed")).toBe(false);
  });
});