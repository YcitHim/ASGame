import { describe, expect, it } from "vitest";
import { generateIntent, intentKey, intentToPayload, trailingRepeat } from "@/core/intents";
import type { ConditionContext } from "@/core/registry/condition";
import type { EnemyDefinition } from "@/core/registry/content";
import { Rng } from "@/core/rng";

const ctx = (over: Partial<ConditionContext> = {}): ConditionContext => ({
  hp: 66,
  maxHp: 66,
  pollution: 0,
  charge: 0,
  buffs: [],
  cardsPlayedThisTurn: 0,
  handSize: 5,
  ...over,
});

const weakCondition: EnemyDefinition = {
  id: "test",
  name: "Test",
  maxHp: 30,
  intents: [
    { intent: { kind: "attack", value: 99 }, weight: 1000, condition: { type: "hpBelow", percent: 50 } },
    { intent: { kind: "defend", value: 5 }, weight: 0.0001 },
  ],
};

const consecutive: EnemyDefinition = {
  id: "test2",
  name: "Test2",
  maxHp: 30,
  intents: [
    { intent: { kind: "attack", value: 5 }, weight: 1000, maxConsecutive: 1 },
    { intent: { kind: "defend", value: 5 }, weight: 0.0001 },
  ],
};

describe("S3.5 意图 AI", () => {
  it("同种子同历史 → 同意图（确定性）", () => {
    const a = generateIntent(weakCondition, ctx({ hp: 10 }), [], new Rng(7).stream("combat"));
    const b = generateIntent(weakCondition, ctx({ hp: 10 }), [], new Rng(7).stream("combat"));
    expect(a.key).toBe(b.key);
  });

  it("条件过滤：高血量时打不出条件招", () => {
    const roll = generateIntent(weakCondition, ctx({ hp: 66 }), [], new Rng(7).stream("combat"));
    expect(roll.intent.kind).toBe("defend");
  });

  it("条件满足时优先条件招", () => {
    const roll = generateIntent(weakCondition, ctx({ hp: 10 }), [], new Rng(7).stream("combat"));
    expect(roll.intent.kind).toBe("attack");
    expect(roll.intent.value).toBe(99);
  });

  it("maxConsecutive：连续达到上限后换招", () => {
    const first = generateIntent(consecutive, ctx(), [], new Rng(1).stream("combat"));
    expect(first.intent.kind).toBe("attack");
    const second = generateIntent(consecutive, ctx(), [first.key], new Rng(1).stream("combat"));
    expect(second.intent.kind).toBe("defend");
  });

  it("Boss 二阶段：按自身 HP 切换整套意图（selfHpAtLeast / selfHpBelow）", () => {
    const boss: EnemyDefinition = {
      id: "boss",
      name: "Boss",
      maxHp: 100,
      intents: [
        { intent: { kind: "attack", value: 10 }, weight: 1000, condition: { type: "selfHpAtLeast", percent: 50 } },
        { intent: { kind: "attack", value: 30 }, weight: 1000, condition: { type: "selfHpBelow", percent: 50 } },
      ],
    };
    const healthy = generateIntent(boss, { ...ctx(), self: { hp: 100, maxHp: 100, buffs: [] } }, [], new Rng(3).stream("combat"));
    expect(healthy.intent.value).toBe(10);
    const wounded = generateIntent(boss, { ...ctx(), self: { hp: 20, maxHp: 100, buffs: [] } }, [], new Rng(3).stream("combat"));
    expect(wounded.intent.value).toBe(30);
  });

  it("空意图表返回 unknown", () => {
    const empty: EnemyDefinition = { id: "e", name: "e", maxHp: 1, intents: [] };
    expect(generateIntent(empty, ctx(), [], new Rng(1).stream("combat")).intent.kind).toBe("unknown");
  });

  it("key / payload / trailingRepeat 辅助", () => {
    expect(intentKey({ kind: "attack", value: 6 })).toBe("attack:6:1:");
    expect(intentToPayload({ kind: "attack", value: 6, hits: 2 })).toEqual({ kind: "attack", value: 6, hits: 2 });
    expect(trailingRepeat(["a", "b", "b"], "b")).toBe(2);
    expect(trailingRepeat(["a", "b"], "a")).toBe(0);
  });
});
