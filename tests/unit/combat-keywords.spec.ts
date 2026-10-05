import { describe, expect, it } from "vitest";
import { reduce } from "@/core/combat";
import { startState, testConfig } from "../helpers/combat";

describe("S3.4 关键词 v0（消耗 / 保留 / 虚无 / 固有 / 血契）", () => {
  it("保留：回合结束不进弃牌堆并发 CardRetained", () => {
    const started = startState(
      testConfig({ deck: ["retain_guard", "strike", "strike", "strike", "strike"], handSize: 5 }),
    );
    const result = reduce(started, { type: "EndTurn", actionId: "e" });
    expect(result.events.some((e) => e.type === "CardRetained")).toBe(true);
    expect(result.state.piles.hand.some((id) => result.state.cardInstances[id].cardId === "retain_guard")).toBe(true);
    expect(result.state.piles.discard.some((id) => result.state.cardInstances[id].cardId === "retain_guard")).toBe(false);
  });

  it("虚无：回合结束若在手则消耗并发 CardExhausted", () => {
    const started = startState(
      testConfig({ deck: ["ethereal_hex", "strike", "strike", "strike", "strike"], handSize: 5 }),
    );
    const result = reduce(started, { type: "EndTurn", actionId: "e" });
    expect(result.events.some((e) => e.type === "CardExhausted")).toBe(true);
    expect(result.state.piles.exhaust.some((id) => result.state.cardInstances[id].cardId === "ethereal_hex")).toBe(true);
  });

  it("消耗：打出后进消耗堆（非弃牌堆）", () => {
    const started = startState(testConfig({ deck: ["bloodflail", "strike", "strike"], handSize: 3 }));
    const index = started.piles.hand.findIndex((id) => started.cardInstances[id].cardId === "bloodflail");
    const result = reduce(started, { type: "PlayCard", actionId: "p", handIndex: index });
    expect(result.state.piles.exhaust).toHaveLength(1);
    expect(result.state.piles.discard).toHaveLength(0);
  });

  it("血契：支付 HP 并产出 bloodpact 来源的 HpLost", () => {
    const started = startState(testConfig({ deck: ["bloodbolt", "strike", "strike"], handSize: 3 }));
    const index = started.piles.hand.findIndex((id) => started.cardInstances[id].cardId === "bloodbolt");
    const result = reduce(started, { type: "PlayCard", actionId: "p", handIndex: index });
    const lost = result.events.find((e) => e.type === "HpLost");
    expect(lost && lost.type === "HpLost" ? lost.reason : "").toBe("bloodpact");
    expect(result.state.player.hp).toBe(64);
  });
});
