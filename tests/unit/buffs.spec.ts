import { describe, expect, it } from "vitest";
import { applyBuff, buffStacks, findBuff, hasBuff, tickBuffs, tickOwnerTurnEnd } from "@/core/buffs";

describe("Buff 结构与层数规则（2.5 / docs/03 §2）", () => {
  it("默认叠加：层数累加 + 时长刷新为较大值", () => {
    let b = applyBuff([], { id: "regeneration", stacks: 3, duration: 2 });
    b = applyBuff(b, { id: "regeneration", stacks: 2, duration: 4 });
    expect(findBuff(b, "regeneration")).toEqual({ id: "regeneration", stacks: 5, duration: 4 });
  });

  it("力量为强度型：无 duration，层数累加", () => {
    let b = applyBuff([], { id: "strength", stacks: 2, duration: 3 });
    b = applyBuff(b, { id: "strength", stacks: 3 });
    expect(findBuff(b, "strength")).toEqual({ id: "strength", stacks: 5, duration: null });
  });

  it("虚弱/胆怯为时长型（甲方 2026-10-09 双轴）：层数恒 1，幅度固定，重复施加延长时间", () => {
    let b = applyBuff([], { id: "timid", stacks: 3 });
    expect(findBuff(b, "timid")).toEqual({ id: "timid", stacks: 1, duration: 3 });
    b = applyBuff(b, { id: "timid", stacks: 4 });
    // extend：3 + 4 = 7，绝不是取较大值 4
    expect(findBuff(b, "timid")).toEqual({ id: "timid", stacks: 1, duration: 7 });
  });

  it("强度型层数为 0 时不写入", () => {
    expect(applyBuff([], { id: "strength", stacks: 0 })).toEqual([]);
    expect(applyBuff([], { id: "block", stacks: -3 })).toEqual([]);
  });

  it("污染 maxStacks 夹到 100", () => {
    let b = applyBuff([], { id: "pollution", stacks: 60 });
    b = applyBuff(b, { id: "pollution", stacks: 60 });
    expect(buffStacks(b, "pollution")).toBe(100);
  });

  it("tick turnStart：计时型 -1，到期移除并汇总；ownerTurnEnd 型与强度型不受影响", () => {
    let b = applyBuff([], { id: "regeneration", stacks: 2, duration: 1 });
    b = applyBuff(b, { id: "weak", stacks: 2 });
    b = applyBuff(b, { id: "strength", stacks: 2 });

    const r = tickBuffs(b, "turnStart");
    expect(r.expired.map((e) => e.id)).toEqual(["regeneration"]);
    // 虚弱现在是时长型：初始 duration = 2，只在承载者自己回合结束递减
    expect(findBuff(r.buffs, "weak")).toEqual({ id: "weak", stacks: 1, duration: 2 });
    expect(findBuff(r.buffs, "strength")).toEqual({ id: "strength", stacks: 2, duration: null });
  });

  it("ownerTurnEnd 衰减：承载者自己回合结束 −1，归零即移除", () => {
    const b = applyBuff([], { id: "timid", stacks: 2 });
    const first = tickOwnerTurnEnd(b, 99);
    expect(first.expired).toEqual([]);
    expect(findBuff(first.buffs, "timid")?.duration).toBe(1);
    const second = tickOwnerTurnEnd(first.buffs, 99);
    expect(second.expired.map((e) => e.id)).toEqual(["timid"]);
  });

  it("新鲜度护栏：承载者本回合刚挂上的跳过这次递减（appliedTurn === 回合实例）", () => {
    const b = applyBuff([], { id: "timid", stacks: 1, turn: 7 });
    const same = tickOwnerTurnEnd(b, 7);
    expect(same.expired).toEqual([]);
    expect(findBuff(same.buffs, "timid")?.duration).toBe(1);
    // 换到下一个回合实例（8）才真正开始倒数
    expect(tickOwnerTurnEnd(b, 8).expired.map((e) => e.id)).toEqual(["timid"]);
  });

  it("时长合并策略：虚弱/胆怯 extend 累加，灼烧 refresh 取较大值", () => {
    let weak = applyBuff([], { id: "weak", stacks: 1 });
    weak = applyBuff(weak, { id: "weak", stacks: 1 });
    expect(findBuff(weak, "weak")?.duration).toBe(2);

    // 灼烧：层数累加（强度），时长只刷新不累加
    let burn = applyBuff([], { id: "burn", stacks: 1 });
    burn = applyBuff(burn, { id: "burn", stacks: 1 });
    expect(findBuff(burn, "burn")?.stacks).toBe(2);
    expect(findBuff(burn, "burn")?.duration).toBe(2);
  });

  it("强度型永不被 tick 触碰；timing=none 返回副本", () => {
    const b = applyBuff([], { id: "pollution", stacks: 10 });
    expect(tickBuffs(b, "turnEnd").buffs).toEqual(b);
    const none = tickBuffs(b, "none");
    expect(none.expired).toEqual([]);
    expect(none.buffs).toEqual(b);
    expect(none.buffs).not.toBe(b);
  });

  it("applyBuff 不修改入参（状态不可变）", () => {
    const original = applyBuff([], { id: "strength", stacks: 1 });
    const snapshot = JSON.parse(JSON.stringify(original));
    applyBuff(original, { id: "strength", stacks: 5 });
    applyBuff(original, { id: "weak", stacks: 2 });
    expect(original).toEqual(snapshot);
  });

  it("查询辅助函数", () => {
    const b = applyBuff([], { id: "weak", stacks: 2, duration: 1 });
    expect(hasBuff(b, "weak")).toBe(true);
    expect(hasBuff(b, "strength")).toBe(false);
    expect(buffStacks(b, "strength")).toBe(0);
    expect(findBuff(b, "strength")).toBeUndefined();
  });
});
