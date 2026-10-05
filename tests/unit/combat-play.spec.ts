import { describe, expect, it } from "vitest";
import { reduce, type ReduceResult } from "@/core/combat";
import { handIndex, startState, testConfig } from "../helpers/combat";

/** 把指定卡放进手牌（handSize = 牌堆长度，保证全在手）。 */
function withHand(cardIds: string[], overrides: Parameters<typeof testConfig>[0] = {}): ReturnType<typeof startState> {
  const config = testConfig({ deck: cardIds, handSize: cardIds.length, ...overrides });
  return startState(config);
}

function playFrom(state: ReturnType<typeof startState>, cardId: string, targetId?: string): ReduceResult {
  const index = handIndex(state, cardId);
  expect(index, `手牌中找不到 ${cardId}`).toBeGreaterThanOrEqual(0);
  return reduce(state, { type: "PlayCard", actionId: `play:${cardId}`, handIndex: index, targetId });
}

describe("S3.2 出牌判定与结算", () => {
  it("打击造成 6 点伤害、扣 1 能量、进弃牌堆", () => {
    const result = playFrom(withHand(["strike", "strike"]), "strike");
    expect(result.state.enemies[0].hp).toBe(44);
    expect(result.state.player.energy).toBe(2);
    expect(result.state.piles.discard).toHaveLength(1);
    expect(result.events.some((e) => e.type === "CardPlayed")).toBe(true);
  });

  it("防御获得格挡", () => {
    const result = playFrom(withHand(["defend", "strike"]), "defend");
    expect(result.state.player.block).toBe(5);
  });

  it("能量不足时核心拒绝，状态零改动", () => {
    const started = withHand(["strike", "strike"], { player: { maxHp: 66, energy: 1 } });
    const first = playFrom(started, "strike");
    expect(first.state.player.energy).toBe(0);
    const before = first.state.enemies[0].hp;
    const second = playFrom(first.state, "strike");
    expect(second.events).toHaveLength(0);
    expect(second.state.enemies[0].hp).toBe(before);
    expect(second.state.piles.hand).toHaveLength(1);
  });

  it("血契支付 HP 代价并结算伤害", () => {
    const result = playFrom(withHand(["bloodbolt", "strike"]), "bloodbolt");
    expect(result.state.player.hp).toBe(64);
    expect(result.state.enemies[0].hp).toBe(41);
    const lost = result.events.find((e) => e.type === "HpLost");
    expect(lost && lost.type === "HpLost" ? lost.reason : "").toBe("bloodpact");
  });

  it("血量不足以支付血契时拒绝出牌", () => {
    const started = withHand(["bloodbolt", "strike"]);
    const low = reduce(started, { type: "DebugCommand", actionId: "d", command: "set hp 1" }).state;
    const result = playFrom(low, "bloodbolt");
    expect(result.events).toHaveLength(0);
    expect(result.state.player.hp).toBe(1);
    expect(result.state.piles.hand).toHaveLength(2);
  });

  it("消耗关键词：卡牌进入消耗堆", () => {
    const result = playFrom(withHand(["bloodflail", "strike"]), "bloodflail");
    expect(result.state.piles.exhaust).toHaveLength(1);
    expect(result.events.some((e) => e.type === "CardExhausted")).toBe(true);
  });

  it("多段攻击拆成 3 段独立 DamageDealt，各段独立结算", () => {
    const result = playFrom(withHand(["bloodflail", "strike"]), "bloodflail");
    const hits = result.events.filter((e) => e.type === "DamageDealt");
    expect(hits).toHaveLength(3);
    const typed = hits.filter((h) => h.type === "DamageDealt");
    expect(typed.map((h) => h.segment)).toEqual([1, 2, 3]);
    expect(typed.every((h) => h.segments === 3)).toBe(true);
    expect(typed.reduce((a, h) => a + h.value, 0)).toBe(6);
    expect(result.state.enemies[0].hp).toBe(44);
  });

  it("条件效果：HP<50% 时才额外抽牌", () => {
    // 6 张在手、1 张留在抽牌堆，才能观察额外抽牌
    const started = startState(
      testConfig({ deck: ["bloodbolt", "strike", "strike", "strike", "strike", "strike", "strike"], handSize: 6 }),
    );
    const healthy = playFrom(started, "bloodbolt");
    expect(healthy.state.piles.hand).toHaveLength(started.piles.hand.length - 1);

    const low = reduce(started, { type: "DebugCommand", actionId: "d", command: "set hp 20" }).state;
    const lowResult = playFrom(low, "bloodbolt");
    expect(lowResult.state.piles.hand).toHaveLength(started.piles.hand.length);
  });

  it("多敌人时 chosenEnemy 必须指定目标", () => {
    const started = withHand(["strike", "strike"], { enemies: [{ id: "dummy" }, { id: "tank" }] });
    const noTarget = playFrom(started, "strike");
    expect(noTarget.events).toHaveLength(0);

    const withTarget = playFrom(started, "strike", "tank");
    expect(withTarget.state.enemies.find((e) => e.id === "tank")?.hp).toBe(74);
    expect(withTarget.state.enemies.find((e) => e.id === "dummy")?.hp).toBe(50);
  });

  it("战斗结束后不再结算出牌", () => {
    const started = withHand(["strike", "strike"]);
    const killed = reduce(started, { type: "DebugCommand", actionId: "k", command: "kill dummy" }).state;
    expect(killed.phase).toBe("battleEnd");
    const after = playFrom(killed, "strike");
    expect(after.events.every((e) => e.type !== "CardPlayed")).toBe(true);
  });
});
