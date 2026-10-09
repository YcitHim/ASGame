import { describe, expect, it } from "vitest";
import { buildMultiHitEffects, splitValues, validateMultiHitSpec } from "@/core/pipeline";
import { isChargeBonusModifier, multiHitFalloff } from "@/core/combat";

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe("多段攻击拆分器（2.4 / ADR-002）", () => {
  it("按比例拆分且各段之和恰好等于总量", () => {
    expect(splitValues(10, [0.4, 0.3, 0.3])).toEqual([4, 3, 3]);
    expect(sum(splitValues(10, [0.4, 0.3, 0.3]))).toBe(10);
  });

  it("最大余数法不因取整丢伤害", () => {
    const parts = splitValues(7, [0.4, 0.3, 0.3]);
    expect(sum(parts)).toBe(7);
    expect(parts).toEqual([3, 2, 2]);
    for (let total = 1; total <= 50; total += 1) {
      expect(sum(splitValues(total, [0.4, 0.3, 0.3]))).toBe(total);
    }
  });

  it("边界：空比例 / 非正总量", () => {
    expect(splitValues(10, [])).toEqual([]);
    expect(splitValues(0, [0.5, 0.5])).toEqual([0, 0]);
    expect(splitValues(-5, [0.5, 0.5])).toEqual([0, 0]);
  });

  it("生成 N 个彼此独立的效果（各自 id 与段号）", () => {
    const effects = buildMultiHitEffects({
      sourceId: "bloodbolt#1",
      targetIds: ["enemy-1"],
      base: 10,
      spec: { hits: 3, split: [0.4, 0.3, 0.3] },
      makeId: (segment) => `hit-${segment + 1}`,
      makePayload: (segment, value) => ({ segment, value }),
    });
    expect(effects).toHaveLength(3);
    expect(effects.map((e) => e.id)).toEqual(["hit-1", "hit-2", "hit-3"]);
    expect(effects.map((e) => e.payload.value)).toEqual([4, 3, 3]);
    expect(new Set(effects.map((e) => e.id)).size).toBe(3);
    expect(effects.every((e) => e.sourceId === "bloodbolt#1")).toBe(true);
  });

  it("低血沸腾 40/30/30 实战样例：11 伤拆成 4/3/4? 严格守和为 11", () => {
    const parts = splitValues(11, [0.4, 0.3, 0.3]);
    expect(sum(parts)).toBe(11);
  });

  // 甲方 2026-10-09：连续攻击的段间衰减——第一下原伤，之后每段再减半
  it("段间衰减：第 1 段原伤，之后 ×0.5 / ×0.25", () => {
    expect(multiHitFalloff(1, 3)).toBe(1);
    expect(multiHitFalloff(2, 3)).toBe(0.5);
    expect(multiHitFalloff(3, 3)).toBe(0.25);
  });

  it("只认「充能增伤」这一类来源：力量 / 超负荷 / 强化都不在衰减范围", () => {
    expect(isChargeBonusModifier("charge")).toBe(true);
    expect(isChargeBonusModifier("trait:glass_cannon:firstAttackCharge")).toBe(true);
    expect(isChargeBonusModifier("strength")).toBe(false);
    expect(isChargeBonusModifier("overload")).toBe(false);
    // 铁皮王八的防御向充能改道不砍：砍了防御盘会变成 107 回合的消耗战
    expect(isChargeBonusModifier("charge:hybrid")).toBe(false);
  });

  it("单段伤害永不衰减（含 AoE：多目标是同一段）", () => {
    expect(multiHitFalloff(1, 1)).toBe(1);
    expect(multiHitFalloff(2, 1)).toBe(1);
  });

  it("非法 spec 立即报错", () => {
    expect(() => validateMultiHitSpec({ hits: 0, split: [] })).toThrow();
    expect(() => validateMultiHitSpec({ hits: 2, split: [0.5] })).toThrow();
    expect(() => validateMultiHitSpec({ hits: 2, split: [0.5, 0.6] })).toThrow();
    expect(() => validateMultiHitSpec({ hits: 2, split: [0.5, -0.5] })).toThrow();
  });
});
