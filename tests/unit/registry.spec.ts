import { describe, expect, it } from "vitest";
import { applyBuff } from "@/core/buffs";
import { evaluateCondition } from "@/core/registry/condition";
import { getTarget } from "@/core/registry/target";
import {
  afterPlayDestination,
  hasKeyword,
  isInnate,
  pactHpCost,
  turnEndDestination,
} from "@/core/keywords";
import { Rng } from "@/core/rng";

const ctx = (over: Partial<Parameters<typeof evaluateCondition>[1]> = {}) => ({
  hp: 66,
  maxHp: 66,
  pollution: 0,
  charge: 0,
  buffs: [],
  cardsPlayedThisTurn: 0,
  handSize: 5,
  ...over,
});

describe("条件注册表（ADR-004）", () => {
  it("原子条件", () => {
    expect(evaluateCondition({ type: "hpBelow", percent: 50 }, ctx({ hp: 30 }))).toBe(true);
    expect(evaluateCondition({ type: "hpBelow", percent: 50 }, ctx({ hp: 60 }))).toBe(false);
    expect(evaluateCondition({ type: "hpAtLeast", percent: 100 }, ctx({ hp: 66 }))).toBe(true);
    expect(evaluateCondition({ type: "pollutionAbove", n: 50 }, ctx({ pollution: 80 }))).toBe(true);
    expect(evaluateCondition({ type: "chargeAtLeast", n: 3 }, ctx({ charge: 3 }))).toBe(true);
  });

  it("hasBuff 按层数判断", () => {
    const buffs = applyBuff([], { id: "strength", stacks: 2 });
    expect(evaluateCondition({ type: "hasBuff", buffId: "strength", stacks: 2 }, ctx({ buffs }))).toBe(true);
    expect(evaluateCondition({ type: "hasBuff", buffId: "strength", stacks: 3 }, ctx({ buffs }))).toBe(false);
    expect(evaluateCondition({ type: "hasBuff" }, ctx({ buffs }))).toBe(false);
  });

  it("and / or / not 组合", () => {
    const node = { type: "and" as const, of: [{ type: "hpBelow" as const, percent: 50 }, { type: "pollutionAbove" as const, n: 10 }] };
    expect(evaluateCondition(node, ctx({ hp: 20, pollution: 30 }))).toBe(true);
    expect(evaluateCondition(node, ctx({ hp: 20, pollution: 5 }))).toBe(false);
    expect(evaluateCondition({ type: "not", of: { type: "hpBelow", percent: 50 } }, ctx({ hp: 60 }))).toBe(true);
    expect(
      evaluateCondition({ type: "or", of: [{ type: "hpBelow", percent: 10 }, { type: "chargeAtLeast", n: 5 }] }, ctx({ charge: 6 })),
    ).toBe(true);
  });

  it("未注册条件抛错", () => {
    expect(() => evaluateCondition({ type: "notRegistered" as never }, ctx())).toThrow(/未注册/);
  });
});

describe("目标选择器注册表", () => {
  const rng = new Rng(1);
  const enemies = [
    { id: "a", hp: 10 },
    { id: "b", hp: 30 },
    { id: "dead", hp: 0 },
  ];
  const base = { actorId: "player", chosenTargetId: "b", enemies, rng };

  it("self / chosenEnemy / allEnemies", () => {
    expect(getTarget("self")(base)).toEqual(["player"]);
    expect(getTarget("chosenEnemy")(base)).toEqual(["b"]);
    expect(getTarget("chosenEnemy")({ ...base, chosenTargetId: "dead" })).toEqual(["a"]);
    expect(getTarget("chosenEnemy")({ ...base, chosenTargetId: null })).toEqual(["a"]);
    expect(getTarget("allEnemies")(base)).toEqual(["a", "b"]);
  });

  it("lowest / highest / random 只取存活敌人", () => {
    expect(getTarget("lowestHpEnemy")(base)).toEqual(["a"]);
    expect(getTarget("highestHpEnemy")(base)).toEqual(["b"]);
    expect(["a", "b"]).toContain(getTarget("randomEnemy")(base)[0]);
    expect(getTarget("allEnemies")({ ...base, enemies: [] })).toEqual([]);
  });

  it("未注册目标抛错", () => {
    expect(() => getTarget("nope")).toThrow(/未注册/);
  });
});

describe("关键词 v0 钩子", () => {
  it("消耗关键词决定打出后去向", () => {
    expect(afterPlayDestination({ keywords: ["exhaust"] })).toBe("exhaust");
    expect(afterPlayDestination({ keywords: [] })).toBe("discard");
  });

  it("保留 / 虚无 决定回合结束处置", () => {
    expect(turnEndDestination({ keywords: ["retain"] })).toBe("retain");
    expect(turnEndDestination({ keywords: ["ethereal"] })).toBe("exhaust");
    expect(turnEndDestination({ keywords: ["retain", "ethereal"] })).toBe("exhaust");
    expect(turnEndDestination({ keywords: [] })).toBe("discard");
  });

  it("固有与血契", () => {
    expect(isInnate({ keywords: ["innate"] })).toBe(true);
    expect(isInnate({ keywords: [] })).toBe(false);
    expect(pactHpCost({ keywords: ["bloodpact"], bloodCost: 3 })).toBe(3);
    expect(pactHpCost({ keywords: [], bloodCost: 3 })).toBe(0);
    expect(hasKeyword({ keywords: ["exhaust"] }, "exhaust")).toBe(true);
  });
});
