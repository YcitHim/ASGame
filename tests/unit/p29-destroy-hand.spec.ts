import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import { loadGameContent } from "@/data/load";

/**
 * 祭血狂热「销毁」（甲方 2026-10-08）：从手牌选一张，本场战斗移出牌组（进消耗堆），战斗结束归还。
 * 同批还有「卖血也算本回合受过伤害」——以血还血第二段以前不触发。
 */
const game = loadGameContent();

function start(deck: string[], opts: { upgraded?: boolean } = {}): BattleState {
  return reduce(
    createBattleState({
      battleId: "destroy",
      seed: 5,
      player: { maxHp: 66, energy: 9 },
      enemies: [{ id: "rust_hound" }],
      deck: deck.map((cardId) => ({ cardId, upgraded: opts.upgraded === true })),
      handSize: deck.length,
      content: game.content,
    }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: BattleState, cardId: string, actionId: string, targetId = "rust_hound") {
  const handIndex = state.piles.hand.findIndex((id) => state.cardInstances[id]?.cardId === cardId);
  return reduce(state, { type: "PlayCard", actionId, handIndex, targetId });
}

describe("祭血狂热「销毁」（甲方 2026-10-08）", () => {
  it("打出后挂起待选；DestroyFromHand 把选中手牌移入消耗堆（本场移出）", () => {
    const deck = ["bloodfrenzy", "strike", "strike", "defend", "defend"];
    const afterPlay = play(start(deck), "bloodfrenzy", "p1");
    let state = afterPlay.state;
    expect(state.destroyPending).toBe(1);
    const chosen = state.piles.hand[0]!;
    const chosenCard = state.cardInstances[chosen]!.cardId;
    const afterPick = reduce(state, { type: "DestroyFromHand", actionId: "d1", instanceId: chosen });
    state = afterPick.state;
    expect(state.destroyPending).toBe(0);
    expect(state.piles.hand).not.toContain(chosen);
    expect(state.piles.exhaust).toContain(chosen);
    expect(afterPick.events.some((e) => e.type === "CardDestroyed")).toBe(true);
    expect(chosenCard.length).toBeGreaterThan(0);
  });

  it("没有待选额度时 DestroyFromHand 是空操作", () => {
    const state = start(["strike", "defend"]);
    const id = state.piles.hand[0]!;
    const after = reduce(state, { type: "DestroyFromHand", actionId: "d0", instanceId: id });
    expect(after.state.piles.hand).toContain(id);
    expect(after.state.piles.exhaust).not.toContain(id);
    expect(after.events.some((e) => e.type === "CardDestroyed")).toBe(false);
  });

  it("回合结束时若仍未选，自动销毁手牌，destroyPending 不跨回合泄漏", () => {
    const deck = ["bloodfrenzy", "strike", "strike", "defend", "defend"];
    const afterPlay = play(start(deck), "bloodfrenzy", "p2");
    const afterEnd = reduce(afterPlay.state, { type: "EndTurn", actionId: "e1" });
    expect(afterEnd.state.destroyPending).toBe(0);
    expect(afterEnd.state.piles.exhaust.length).toBeGreaterThanOrEqual(1);
  });
});

describe("卖血也算「本回合受过伤害」（甲方 2026-10-08）", () => {
  it("先卖血 → 以血还血第二段触发（8 + 6）", () => {
    const deck = ["bloodsurge", "bloodforblood", "defend"];
    let state = start(deck);
    state = play(state, "bloodsurge", "b1").state;
    expect(state.tookDamageThisTurn).toBe(true); // 卖 2 血 → 计入受伤
    const enemyBefore = state.enemies[0]!.hp;
    const after = play(state, "bloodforblood", "b2");
    expect(enemyBefore - after.state.enemies[0]!.hp).toBe(14); // 8 + 条件 6
  });

  it("没卖血也没挨打时，以血还血只打 8", () => {
    const deck = ["bloodforblood", "defend"];
    const state = start(deck);
    const enemyBefore = state.enemies[0]!.hp;
    const after = play(state, "bloodforblood", "b3");
    expect(enemyBefore - after.state.enemies[0]!.hp).toBe(8);
  });
});
