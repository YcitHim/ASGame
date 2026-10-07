import { describe, expect, it } from "vitest";
import { applyBuff, buffStacks, findBuff, hasBuff, tickBuffs } from "@/core/buffs";

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

  it("虚弱/胆怯为层级型特例（docs/46 §2）：层数累加、封顶 5、无 duration", () => {
    let b = applyBuff([], { id: "timid", stacks: 3 });
    b = applyBuff(b, { id: "timid", stacks: 4 });
    expect(findBuff(b, "timid")).toEqual({ id: "timid", stacks: 5, duration: null });
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

  it("tick turnStart：计时型 -1，到期移除并汇总；层级型不受影响", () => {
    let b = applyBuff([], { id: "regeneration", stacks: 2, duration: 1 });
    b = applyBuff(b, { id: "weak", stacks: 2 });
    b = applyBuff(b, { id: "strength", stacks: 2 });

    const r = tickBuffs(b, "turnStart");
    expect(r.expired.map((e) => e.id)).toEqual(["regeneration"]);
    expect(findBuff(r.buffs, "weak")).toEqual({ id: "weak", stacks: 2, duration: null });
    expect(findBuff(r.buffs, "strength")).toEqual({ id: "strength", stacks: 2, duration: null });
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
