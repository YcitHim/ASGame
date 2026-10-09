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

  it("胆怯：固定 +20% 承伤，重复施加只延长时间、不放大强度（甲方 2026-10-09 双轴）", () => {
    let s = withHand(["expose", "expose", "expose", "expose", "expose", "strike"]);
    for (let i = 0; i < 5; i += 1) s = play(s, "expose").state;
    // 层数恒 1（强度固定），时长 1 + 1×4 = 5 回合（extend）
    expect(s.enemies[0].buffs.find((b) => b.id === "timid")?.stacks).toBe(1);
    expect(s.enemies[0].buffs.find((b) => b.id === "timid")?.duration).toBe(5);
    // 6 × 1.2 = 7.2 → 7（伤害四舍五入）
    expect(play(s, "strike").state.enemies[0].hp).toBe(43);
  });

  it("虚弱：每层造伤 −10%（docs/46 §2.1；1 层：6 × 0.9 = 5.4 → 5）", () => {
    const started = withHand(["curse_weak", "strike"]);
    const weakened = play(started, "curse_weak").state;
    expect(play(weakened, "strike").state.enemies[0].hp).toBe(45);
  });

  it("加区先于乘区：力量与胆怯组合", () => {
    let s = withHand(["expose", "expose", "expose", "expose", "expose", "strike", "strike"]);
    s = debug(s, "add buff strength 2").state;
    for (let i = 0; i < 5; i += 1) s = play(s, "expose").state;
    // (6 + 2) × 1.2 = 9.6 → 10（伤害四舍五入）
    expect(play(s, "strike").state.enemies[0].hp).toBe(40);
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

  it("坚韧：回合开始 +3×层 维续格挡，不清零且累积（docs/46 §3.4）", () => {
    let s = withHand(["strike"]);
    s = debug(s, "add buff tenacity 2").state;
    s = reduce(s, { type: "EndTurn", actionId: "e1" }).state;
    // 敌军回合玩家没挡 → 掉 5 血；下回合开始 +3×2 维续格挡
    expect(s.player.hp).toBe(61);
    expect(s.player.block).toBe(6);
    s = reduce(s, { type: "EndTurn", actionId: "e2" }).state;
    // 6 格挡吃掉 5 伤，剩 1；下回合开始再 +6 → 12（证明不清零、会累积）
    expect(s.player.block).toBe(12);
  });

  it("坚韧：维续格挡总量封顶 25（防死锁保险丝）", () => {
    let s = withHand(["strike"]);
    s = debug(s, "add buff tenacity 3").state;
    for (let i = 0; i < 4; i += 1) s = reduce(s, { type: "EndTurn", actionId: `e${i}` }).state;
    expect(s.player.block).toBe(25);
  });

  it("荆棘：每层反弹 3 点，5 层封顶 15 点", () => {
    let s = withHand(["strike"]);
    s = debug(s, "add buff bramble 5").state;
    s = debug(s, "add buff bramble 5").state; // 试图叠到 10，应被 maxStacks 截到 5
    expect(s.player.buffs.find((b) => b.id === "bramble")?.stacks).toBe(5);
  });

  it("时长型减益：基础 1 回合；本回合刚挂上的不在同一回合掉时长（新鲜度护栏）", () => {
    const started = withHand(["curse_weak", "strike", "strike"]);
    const weakened = play(started, "curse_weak").state;
    const weak = weakened.player.buffs.find((b) => b.id === "weak");
    expect(weak?.stacks).toBe(1);
    expect(weak?.duration).toBe(1);

    // 玩家自己结束回合：applyTurn === 本回合实例 → 护栏挡住这一次递减
    const after = reduce(weakened, { type: "EndTurn", actionId: "e" });
    expect(after.state.player.buffs.find((b) => b.id === "weak")?.duration).toBe(1);

    // 再过一个自己的回合才真正到期
    const later = reduce(after.state, { type: "EndTurn", actionId: "e" });
    expect(later.state.player.buffs.find((b) => b.id === "weak")).toBeUndefined();
  });
});
