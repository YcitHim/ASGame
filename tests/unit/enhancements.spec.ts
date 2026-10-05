import { describe, expect, it } from "vitest";
import { createBattleState, reduce, type BattleState } from "@/core/combat";
import {
  createContentDb,
  registerEnhancementHandler,
  type EnhancementDefinition,
  type EnhancementHandlerId,
} from "@/core/registry";
import { TEST_CARDS, TEST_ENEMIES } from "../helpers/combat";

/** onHit 钩子用预留的 bloodrage id 注册一个测试实现（生产数据里 0.5 才启用）。 */
/** 测试专用 handler：`bloodrage` 已被生产占用为 T2「血怒」，测试的 spark 另开 id。 */
const SPARK_HANDLER = "test_spark" as EnhancementHandlerId;

registerEnhancementHandler({
  id: SPARK_HANDLER,
  onHit: () => [{ kind: "damage", target: { type: "chosenEnemy" }, value: 1 }],
});

const ENHANCEMENTS: EnhancementDefinition[] = [
  {
    id: "boil",
    tier: 2,
    appliesTo: ["strike"],
    handler: "bloodboil",
    params: { condition: { type: "hpBelow", percent: 50 }, hits: 3, split: [0.4, 0.3, 0.3] },
  },
  { id: "sharpen", tier: 1, appliesTo: ["strike"], handler: "empower", params: { bonus: 2 } },
  { id: "reinforce", tier: 1, appliesTo: ["defend"], handler: "fortify", params: { bonus: 3 } },
  { id: "spark", tier: 1, appliesTo: ["strike"], handler: SPARK_HANDLER, params: {} },
  { id: "thrift", tier: 1, appliesTo: ["bloodbolt"], handler: "bloodpact_discount", params: { discount: 1 } },
];

function content() {
  return createContentDb({
    cards: new Map(TEST_CARDS.map((c) => [c.id, c])),
    enemies: new Map(TEST_ENEMIES.map((e) => [e.id, e])),
    enhancements: new Map(ENHANCEMENTS.map((e) => [e.id, e])),
    relics: new Map(),
  });
}

function battle(deck: (string | { cardId: string; enhancements: string[] })[]): BattleState {
  return reduce(
    createBattleState({ battleId: "t", seed: 99, player: { maxHp: 66, energy: 3 }, enemies: [{ id: "dummy" }], deck, content: content() }),
    { type: "Noop", actionId: "start" },
  ).state;
}

function play(state: BattleState, cardId: string) {
  const index = state.piles.hand.findIndex((id) => state.cardInstances[id].cardId === cardId);
  return reduce(state, { type: "PlayCard", actionId: "p", handIndex: index, targetId: "dummy" });
}

describe("S4.3 强化钩子 modifyCard / onHit", () => {
  it("低血沸腾：HP≥50% 时保持单段", () => {
    const state = battle([{ cardId: "strike", enhancements: ["boil"] }]);
    const result = play(state, "strike");
    const hits = result.events.filter((e) => e.type === "DamageDealt");
    expect(hits).toHaveLength(1);
    expect(result.state.enemies[0].hp).toBe(44);
  });

  it("低血沸腾：HP<50% 时拆成三段，段号独立、总和不变", () => {
    const started = battle([{ cardId: "strike", enhancements: ["boil"] }]);
    const low = reduce(started, { type: "DebugCommand", actionId: "d", command: "set hp 20" }).state;
    const result = play(low, "strike");
    const hits = result.events.filter((e) => e.type === "DamageDealt").filter((e) => e.type === "DamageDealt");
    expect(hits).toHaveLength(3);
    expect(hits.map((h) => h.segment)).toEqual([1, 2, 3]);
    expect(hits.every((h) => h.segments === 3)).toBe(true);
    expect(hits.reduce((a, h) => a + h.value, 0)).toBe(6);
    expect(result.state.enemies[0].hp).toBe(44);
  });

  it("锋锐：该牌伤害 +2", () => {
    const state = battle([{ cardId: "strike", enhancements: ["sharpen"] }]);
    expect(play(state, "strike").state.enemies[0].hp).toBe(42);
  });

  it("加固：该牌格挡 +3", () => {
    const state = battle([{ cardId: "defend", enhancements: ["reinforce"] }]);
    expect(play(state, "defend").state.player.block).toBe(8);
  });

  it("onHit：多段攻击每段独立触发（低血沸腾三段 → 三次 onHit）", () => {
    const started = battle([{ cardId: "strike", enhancements: ["boil", "spark"] }]);
    const low = reduce(started, { type: "DebugCommand", actionId: "d", command: "set hp 20" }).state;
    const result = play(low, "strike");
    // 3 段主伤害 + 3 次 onHit 各 1 点
    const hits = result.events.filter((e) => e.type === "DamageDealt").filter((e) => e.type === "DamageDealt");
    expect(hits).toHaveLength(6);
    expect(hits.reduce((a, h) => a + h.value, 0)).toBe(9);
    expect(result.state.enemies[0].hp).toBe(41);
  });

  it("锋锐走 enhancement 层修饰符：DamageDealt.layers 可追溯（D-3）", () => {
    const state = battle([{ cardId: "strike", enhancements: ["sharpen"] }]);
    const result = play(state, "strike");
    const hit = result.events.find((e) => e.type === "DamageDealt");
    expect(hit && hit.type === "DamageDealt").toBe(true);
    if (hit && hit.type === "DamageDealt") {
      const enhancementLayer = hit.layers.find((l) => l.layer === "enhancement");
      expect(enhancementLayer, "强化层未出现在明细里").toBeDefined();
      expect(enhancementLayer?.sourceId).toContain("sharpen");
      expect(enhancementLayer?.value).toBe(2);
    }
  });

  it("强化层在 Buff 层之前求值：（6 基础 +2 强化 +2 力量）= 10", () => {
    const started = battle([{ cardId: "strike", enhancements: ["sharpen"] }]);
    const buffed = reduce(started, { type: "DebugCommand", actionId: "d", command: "add buff strength 2" }).state;
    expect(play(buffed, "strike").state.enemies[0].hp).toBe(40);
  });

  it("节油血契：卖血代价 -1（Q12 / D-2 关键字与数值同源）", () => {
    const state = battle([{ cardId: "bloodbolt", enhancements: ["thrift"] }]);
    const result = play(state, "bloodbolt");
    const lost = result.events.find((e) => e.type === "HpLost");
    expect(lost && lost.type === "HpLost" ? lost.value : -1).toBe(1);
    expect(result.state.player.hp).toBe(65);
  });

  it("onHit：单段攻击触发一次", () => {
    const state = battle([{ cardId: "strike", enhancements: ["spark"] }]);
    const result = play(state, "strike");
    const hits = result.events.filter((e) => e.type === "DamageDealt").filter((e) => e.type === "DamageDealt");
    expect(hits).toHaveLength(2);
    expect(result.state.enemies[0].hp).toBe(43);
  });
});
