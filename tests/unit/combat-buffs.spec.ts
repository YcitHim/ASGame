import { describe, expect, it } from "vitest";
import { reduce, type ReduceResult } from "@/core/combat";
import { handIndex, startState, testConfig } from "../helpers/combat";

function withHand(cardIds: string[], overrides: Parameters<typeof testConfig>[0] = {}) {
  return startState(testConfig({ deck: cardIds, handSize: cardIds.length, ...overrides }));
}

function play(state: ReturnType<typeof withHand>, cardId: string, targetId?: string): ReduceResult {
  return reduce(state, { type: "PlayCard", actionId: "p", handIndex: handIndex(state, cardId), targetId });
}

function debug(state: ReturnType<typeof withHand>, command: string) {
  return reduce(state, { type: "DebugCommand", actionId: `d:${command}`, command });
}

describe("S3.3 六个基础 Buff 接入战斗结算", () => {
  it("力量：每层 +1 攻击伤害", () => {
    const buffed = debug(withHand(["strike", "strike"]), "add buff strength 2").state;
    expect(play(buffed, "strike").state.enemies[0].hp).toBe(42);
  });

  it("易伤：目标受伤 ×1.5", () => {
    const started = withHand(["expose", "strike"]);
    const exposed = play(started, "expose").state;
    expect(play(exposed, "strike").state.enemies[0].hp).toBe(41);
  });

  it("虚弱：造成伤害 ×0.75（单次取整）", () => {
    const started = withHand(["curse_weak", "strike"]);
    const weakened = play(started, "curse_weak").state;
    // 6 × 0.75 = 4.5 → 5
    expect(play(weakened, "strike").state.enemies[0].hp).toBe(45);
  });

  it("加区先于乘区：力量与易伤组合", () => {
    const started = withHand(["expose", "strike", "strike"]);
    const exposed = play(started, "expose").state;
    const buffed = debug(exposed, "add buff strength 2").state;
    // (6 + 2) × 1.5 = 12
    expect(play(buffed, "strike").state.enemies[0].hp).toBe(38);
  });

  it("再生：回合开始按层数回血", () => {
    const started = withHand(["regen", "strike"]);
    const regened = play(started, "regen").state;
    const low = debug(regened, "set hp 40").state;
    const after = reduce(low, { type: "EndTurn", actionId: "e" });
    // 敌人打 5 → 35，再生 +3 → 38
    expect(after.state.player.hp).toBe(38);
    expect(after.events.some((e) => e.type === "HpHealed")).toBe(true);
  });

  it("格挡吸收伤害后再扣 HP", () => {
    const started = withHand(["defend", "strike", "strike"]);
    const blocked = play(started, "defend").state; // 玩家 5 格挡
    const after = reduce(blocked, { type: "EndTurn", actionId: "e" });
    // 敌人 5 伤先被格挡吸收
    expect(after.state.player.hp).toBe(66);
    expect(after.events.some((e) => e.type === "BlockBroken")).toBe(true);
  });

  it("污染：满值立即反噬并清零（docs/03 §4 决策）", () => {
    const started = withHand(["strike", "strike"]);
    const result = debug(started, "add buff pollution 100");
    expect(result.state.player.pollution).toBe(0);
    expect(result.state.player.hp).toBe(56);
    const changes = result.events.filter((e) => e.type === "PollutionChanged");
    expect(changes.length).toBeGreaterThanOrEqual(2);
    const lost = result.events.find((e) => e.type === "HpLost");
    expect(lost && lost.type === "HpLost" ? lost.reason : "").toBe("pollution");
  });

  it("污染临界：回合开始受到惩罚伤害", () => {
    const started = withHand(["strike", "strike"]);
    const polluted = debug(started, "add buff pollution 80").state;
    const after = reduce(polluted, { type: "EndTurn", actionId: "e" });
    // 敌人 5 + 临界 2 = 7
    expect(after.state.player.hp).toBe(59);
  });

  it("计时型减益层数=回合数：1 层在下次回合开始即到期（策划 Q1）", () => {
    const started = withHand(["curse_weak", "strike", "strike"]);
    const weakened = play(started, "curse_weak").state;
    expect(weakened.player.buffs.find((b) => b.id === "weak")?.duration).toBe(1);
    const after = reduce(weakened, { type: "EndTurn", actionId: "e" });
    expect(after.events.some((e) => e.type === "BuffExpired")).toBe(true);
    expect(after.state.player.buffs.find((b) => b.id === "weak")).toBeUndefined();
  });
});
